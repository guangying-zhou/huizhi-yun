package server

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/huizhi-yun/dev-agent/internal/config"
)

type appServerRPCError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

type appServerRPCMessage struct {
	ID     json.RawMessage    `json:"id,omitempty"`
	Method string             `json:"method,omitempty"`
	Params json.RawMessage    `json:"params,omitempty"`
	Result json.RawMessage    `json:"result,omitempty"`
	Error  *appServerRPCError `json:"error,omitempty"`
}

type appServerResponse struct {
	Result json.RawMessage
	Error  *appServerRPCError
}

type appServerTurnResult struct {
	ThreadID string
	TurnID   string
	Status   string
	Error    string
}

type appServerClient struct {
	writer        io.Writer
	writeMu       sync.Mutex
	mu            sync.Mutex
	nextID        int
	pending       map[string]chan appServerResponse
	readDone      chan error
	turnCompleted chan appServerTurnResult
	addEvent      func(level string, message string)
}

func (s *Server) runCodexAppServerJob(id string, template config.TemplateConfig) {
	job := s.findJob(id)
	if job == nil {
		return
	}

	repo, err := s.repo(template.RepoID)
	if err != nil {
		s.finishJob(job, 0, err)
		return
	}
	cwd, err := safeCWD(repo.Path, template.CWD)
	if err != nil {
		s.finishJob(job, 0, err)
		return
	}

	timeout := time.Duration(template.TimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 30 * time.Minute
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	attachmentContext, err := s.materializeJobAttachments(job)
	if err != nil {
		s.finishJob(job, 0, err)
		return
	}

	vars := jobVariables(job, repo, cwd, attachmentContext)
	argv := substituteAll(template.Argv, vars)
	env := os.Environ()
	for key, value := range template.Environment {
		env = append(env, fmt.Sprintf("%s=%s", key, substitute(value, vars)))
	}

	startedAt := time.Now().UTC()
	s.mu.Lock()
	job.Status = "running"
	job.StartedAt = &startedAt
	job.cancel = cancel
	s.addEventLocked(job, "system", "job started")
	s.addEventLocked(job, "system", fmt.Sprintf("running template %s in repo %s/%s", template.ID, repo.ID, template.CWD))
	s.addEventLocked(job, "system", "codex app-server runner enabled")
	if len(attachmentContext.Items) > 0 {
		s.addEventLocked(job, "system", fmt.Sprintf("attached %d file(s): %s", len(attachmentContext.Items), attachmentContext.Dir))
	}
	s.mu.Unlock()

	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Dir = cwd
	cmd.Env = env

	stdin, err := cmd.StdinPipe()
	if err != nil {
		s.finishJob(job, 0, err)
		return
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		s.finishJob(job, 0, err)
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		s.finishJob(job, 0, err)
		return
	}
	if err := cmd.Start(); err != nil {
		s.finishJob(job, 0, err)
		return
	}

	client := newAppServerClient(stdin, func(level string, message string) {
		s.addJobEvent(job, level, message)
	})

	var wg sync.WaitGroup
	wg.Add(2)
	go s.scanOutput(job, "stderr", stderr, &wg)
	go func() {
		defer wg.Done()
		client.readLoop(stdout)
	}()

	turnErr := s.driveCodexAppServerTurn(ctx, client, job, template, repo, cwd, attachmentContext)
	_ = stdin.Close()
	waitErr := waitForAppServerProcess(cmd, cancel, 5*time.Second)
	wg.Wait()

	exitCode := 0
	if cmd.ProcessState != nil {
		exitCode = cmd.ProcessState.ExitCode()
	}

	if turnErr != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			s.finishCanceled(job, exitCode)
			return
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			s.finishJob(job, exitCode, fmt.Errorf("job timed out after %s", timeout))
			return
		}
		s.finishJob(job, exitCode, turnErr)
		return
	}

	if waitErr != nil {
		s.addJobEvent(job, "system", fmt.Sprintf("codex app-server stopped after turn: %v", waitErr))
	}
	s.finishJob(job, exitCode, nil)
}

func (s *Server) driveCodexAppServerTurn(ctx context.Context, client *appServerClient, job *Job, template config.TemplateConfig, repo config.RepoConfig, cwd string, attachments attachmentContext) error {
	initParams := map[string]any{
		"clientInfo": map[string]any{
			"name":    "hzy_webdev",
			"title":   "HZY WebDev Dev Agent",
			"version": "0.1.0",
		},
		"capabilities": map[string]any{
			"experimentalApi": true,
		},
	}
	if _, err := client.request(ctx, "initialize", initParams); err != nil {
		return fmt.Errorf("initialize codex app-server: %w", err)
	}
	if err := client.notify("initialized", map[string]any{}); err != nil {
		return fmt.Errorf("acknowledge codex app-server initialization: %w", err)
	}
	s.addJobEvent(job, "system", "codex app-server initialized")

	legacySandbox, sandboxPolicy := codexAppServerSandboxPolicy(template, repo.Path)

	threadResult, err := client.request(ctx, "thread/start", map[string]any{
		"approvalPolicy":        "never",
		"cwd":                   cwd,
		"runtimeWorkspaceRoots": []string{repo.Path},
		"sandbox":               legacySandbox,
	})
	if err != nil {
		return fmt.Errorf("start codex thread: %w", err)
	}

	threadID := jsonPathString(threadResult, "thread", "id")
	if threadID == "" {
		return fmt.Errorf("codex app-server thread/start response did not include thread.id")
	}
	s.addJobEvent(job, "system", fmt.Sprintf("codex thread %s", threadID))

	turnResult, err := client.request(ctx, "turn/start", map[string]any{
		"approvalPolicy":        "never",
		"cwd":                   cwd,
		"input":                 []map[string]string{{"type": "text", "text": promptWithAttachments(job.Prompt, attachments)}},
		"runtimeWorkspaceRoots": []string{repo.Path},
		"sandboxPolicy":         sandboxPolicy,
		"threadId":              threadID,
	})
	if err != nil {
		return fmt.Errorf("start codex turn: %w", err)
	}

	turnID := jsonPathString(turnResult, "turn", "id")
	if turnID == "" {
		return fmt.Errorf("codex app-server turn/start response did not include turn.id")
	}
	s.addJobEvent(job, "system", fmt.Sprintf("codex turn %s", turnID))

	result, err := client.waitTurn(ctx, turnID)
	if err != nil {
		return err
	}
	if result.Status != "" && result.Status != "completed" {
		if result.Error != "" {
			return fmt.Errorf("codex turn %s: %s: %s", result.TurnID, result.Status, result.Error)
		}
		return fmt.Errorf("codex turn %s ended with status %s", result.TurnID, result.Status)
	}
	return nil
}

func codexAppServerSandboxPolicy(template config.TemplateConfig, repoPath string) (string, map[string]any) {
	switch strings.TrimSpace(template.CodexSandboxPolicy) {
	case "dangerFullAccess", "danger-full-access":
		return "danger-full-access", map[string]any{
			"type": "dangerFullAccess",
		}
	default:
		return "workspace-write", map[string]any{
			"type":          "workspaceWrite",
			"networkAccess": true,
			"writableRoots": []string{repoPath},
		}
	}
}

func newAppServerClient(writer io.Writer, addEvent func(level string, message string)) *appServerClient {
	return &appServerClient{
		writer:        writer,
		pending:       map[string]chan appServerResponse{},
		readDone:      make(chan error, 1),
		turnCompleted: make(chan appServerTurnResult, 4),
		addEvent:      addEvent,
	}
}

func (c *appServerClient) request(ctx context.Context, method string, params any) (json.RawMessage, error) {
	id := c.nextRequestID()
	responseCh := make(chan appServerResponse, 1)

	c.mu.Lock()
	c.pending[id] = responseCh
	c.mu.Unlock()

	if err := c.write(map[string]any{
		"id":     id,
		"method": method,
		"params": params,
	}); err != nil {
		c.deletePending(id)
		return nil, err
	}

	select {
	case response := <-responseCh:
		if response.Error != nil {
			return nil, fmt.Errorf("json-rpc %s failed: %s", method, response.Error.Message)
		}
		return response.Result, nil
	case err := <-c.readDone:
		if err == nil {
			err = io.EOF
		}
		return nil, fmt.Errorf("codex app-server stdout closed: %w", err)
	case <-ctx.Done():
		c.deletePending(id)
		return nil, ctx.Err()
	}
}

func (c *appServerClient) notify(method string, params any) error {
	return c.write(map[string]any{
		"method": method,
		"params": params,
	})
}

func (c *appServerClient) waitTurn(ctx context.Context, turnID string) (appServerTurnResult, error) {
	for {
		select {
		case result := <-c.turnCompleted:
			if turnID == "" || result.TurnID == turnID {
				return result, nil
			}
		case err := <-c.readDone:
			if err == nil {
				err = io.EOF
			}
			return appServerTurnResult{}, fmt.Errorf("codex app-server stdout closed before turn completed: %w", err)
		case <-ctx.Done():
			return appServerTurnResult{}, ctx.Err()
		}
	}
}

func (c *appServerClient) nextRequestID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.nextID++
	return fmt.Sprintf("hzy-%d", c.nextID)
}

func (c *appServerClient) deletePending(id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.pending, id)
}

func (c *appServerClient) write(message any) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}

	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if _, err := c.writer.Write(append(data, '\n')); err != nil {
		return err
	}
	return nil
}

func (c *appServerClient) readLoop(reader io.Reader) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		var message appServerRPCMessage
		if err := json.Unmarshal(line, &message); err != nil {
			c.addEvent("error", fmt.Sprintf("codex app-server emitted invalid JSON: %v", err))
			continue
		}
		c.handleMessage(message)
	}
	c.readDone <- scanner.Err()
}

func (c *appServerClient) handleMessage(message appServerRPCMessage) {
	if len(message.ID) > 0 && message.Method != "" {
		c.handleServerRequest(message)
		return
	}
	if len(message.ID) > 0 {
		key := requestIDKey(message.ID)
		c.mu.Lock()
		ch := c.pending[key]
		delete(c.pending, key)
		c.mu.Unlock()
		if ch != nil {
			ch <- appServerResponse{Result: message.Result, Error: message.Error}
		}
		return
	}
	if message.Method != "" {
		c.handleNotification(message.Method, message.Params)
	}
}

func (c *appServerClient) handleServerRequest(message appServerRPCMessage) {
	c.addEvent("system", fmt.Sprintf("codex app-server requested %s; PoC default decision is decline", message.Method))
	switch message.Method {
	case "item/commandExecution/requestApproval":
		_ = c.respond(message.ID, map[string]any{"decision": "decline"})
	case "item/fileChange/requestApproval":
		_ = c.respond(message.ID, map[string]any{"decision": "decline"})
	default:
		_ = c.respondError(message.ID, -32601, fmt.Sprintf("server request %s is not supported by hzy-dev-agent PoC", message.Method))
	}
}

func (c *appServerClient) respond(id json.RawMessage, result any) error {
	idValue := decodeRequestID(id)
	return c.write(map[string]any{
		"id":     idValue,
		"result": result,
	})
}

func (c *appServerClient) respondError(id json.RawMessage, code int, message string) error {
	idValue := decodeRequestID(id)
	return c.write(map[string]any{
		"id": idValue,
		"error": map[string]any{
			"code":    code,
			"message": message,
		},
	})
}

func (c *appServerClient) handleNotification(method string, params json.RawMessage) {
	switch method {
	case "thread/started":
		if id := jsonPathString(params, "thread", "id"); id != "" {
			c.addEvent("system", fmt.Sprintf("codex thread started %s", id))
		}
	case "turn/started":
		if id := jsonPathString(params, "turn", "id"); id != "" {
			c.addEvent("system", fmt.Sprintf("codex turn started %s", id))
		}
	case "turn/completed":
		result := appServerTurnResult{
			ThreadID: jsonPathString(params, "threadId"),
			TurnID:   jsonPathString(params, "turn", "id"),
			Status:   jsonPathString(params, "turn", "status"),
			Error:    jsonPathString(params, "turn", "error", "message"),
		}
		c.addEvent("system", fmt.Sprintf("codex turn completed %s", result.Status))
		c.turnCompleted <- result
	case "item/agentMessage/delta":
		// Agent message deltas are token-sized and make the current WebDev log
		// renderer unreadable. Emit the completed agent message as one event
		// from item/completed instead.
	case "item/commandExecution/outputDelta", "command/exec/outputDelta", "process/outputDelta", "item/fileChange/outputDelta":
		c.addDeltaEvent("stdout", params)
	case "item/reasoning/summaryTextDelta", "item/reasoning/textDelta":
		c.addDeltaEvent("info", params)
	case "turn/diff/updated":
		if diff := jsonPathString(params, "diff"); strings.TrimSpace(diff) != "" {
			c.addEvent("system", fmt.Sprintf("codex diff updated (%d bytes)", len(diff)))
		}
	case "item/fileChange/patchUpdated":
		c.addEvent("system", "codex file change patch updated")
	case "item/started":
		c.addItemLifecycleEvent("started", params)
	case "item/completed":
		c.addItemLifecycleEvent("completed", params)
	case "error":
		c.addEvent("error", jsonPathString(params, "message"))
	case "warning", "guardianWarning", "configWarning", "deprecationNotice":
		message := jsonPathString(params, "message")
		if message == "" {
			message = method
		}
		c.addEvent("info", message)
	}
}

func (c *appServerClient) addDeltaEvent(level string, params json.RawMessage) {
	delta := jsonPathString(params, "delta")
	if strings.TrimSpace(delta) == "" {
		return
	}
	c.addEvent(level, delta)
}

func (c *appServerClient) addItemLifecycleEvent(phase string, params json.RawMessage) {
	itemType := jsonPathString(params, "item", "type")
	if itemType == "" {
		return
	}
	switch itemType {
	case "agentMessage":
		if phase == "completed" {
			if text := strings.TrimSpace(jsonPathString(params, "item", "text")); text != "" {
				c.addEvent("assistant", text)
			}
		}
		return
	case "commandExecution":
		command := jsonPathString(params, "item", "command")
		status := jsonPathString(params, "item", "status")
		if command != "" {
			c.addEvent("system", fmt.Sprintf("codex command %s: %s", phase, command))
			return
		}
		if status != "" {
			c.addEvent("system", fmt.Sprintf("codex command %s: %s", phase, status))
			return
		}
	case "fileChange":
		status := jsonPathString(params, "item", "status")
		if status != "" {
			c.addEvent("system", fmt.Sprintf("codex file change %s: %s", phase, status))
			return
		}
	}
	c.addEvent("system", fmt.Sprintf("codex item %s: %s", phase, itemType))
}

func (s *Server) addJobEvent(job *Job, level string, message string) {
	if strings.TrimSpace(message) == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.addEventLocked(job, level, s.redact(message))
}

func waitForAppServerProcess(cmd *exec.Cmd, cancel context.CancelFunc, grace time.Duration) error {
	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()
	select {
	case err := <-done:
		return err
	case <-time.After(grace):
		cancel()
		return <-done
	}
}

func requestIDKey(raw json.RawMessage) string {
	value := decodeRequestID(raw)
	return fmt.Sprint(value)
}

func decodeRequestID(raw json.RawMessage) any {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return string(raw)
	}
	return value
}

func jsonPathString(raw json.RawMessage, path ...string) string {
	if len(raw) == 0 {
		return ""
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return ""
	}
	for _, key := range path {
		object, ok := value.(map[string]any)
		if !ok {
			return ""
		}
		value = object[key]
	}
	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return fmt.Sprintf("%.0f", typed)
	case bool:
		if typed {
			return "true"
		}
		return "false"
	default:
		return ""
	}
}
