package server

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/huizhi-yun/dev-agent/internal/config"
	"github.com/huizhi-yun/dev-agent/internal/version"
)

type Server struct {
	cfg         config.Config
	mu          sync.Mutex
	jobs        map[string]*Job
	idempotency map[string]string // clientRequestId -> jobId
	attachments map[string]Attachment
	redactMap   map[string]string
}

var ansiEscapeRegexp = regexp.MustCompile(`\x1b\[[0-?]*[ -/]*[@-~]`)

type Job struct {
	ID              string            `json:"id"`
	Type            string            `json:"type"`
	Status          string            `json:"status"`
	RepoID          string            `json:"repoId"`
	TemplateID      string            `json:"templateId"`
	Prompt          string            `json:"prompt,omitempty"`
	Target          string            `json:"target,omitempty"`
	Variables       map[string]string `json:"variables,omitempty"`
	Attachments     []AttachmentRef   `json:"attachments,omitempty"`
	ClientRequestID string            `json:"clientRequestId,omitempty"`
	CreatedAt       time.Time         `json:"createdAt"`
	StartedAt       *time.Time        `json:"startedAt,omitempty"`
	FinishedAt      *time.Time        `json:"finishedAt,omitempty"`
	ExitCode        *int              `json:"exitCode,omitempty"`
	Error           string            `json:"error,omitempty"`

	events []Event
	cancel context.CancelFunc
}

type Event struct {
	Sequence  int       `json:"sequence"`
	Level     string    `json:"level"`
	Message   string    `json:"message"`
	CreatedAt time.Time `json:"createdAt"`
}

type AttachmentRef struct {
	ID          string    `json:"id"`
	Filename    string    `json:"filename"`
	ContentType string    `json:"contentType,omitempty"`
	Size        int64     `json:"size,omitempty"`
	Sha256      string    `json:"sha256,omitempty"`
	CreatedAt   time.Time `json:"createdAt,omitempty"`
}

type Attachment struct {
	AttachmentRef
	Path string `json:"-"`
}

type CreateJobRequest struct {
	Type        string            `json:"type"`
	RepoID      string            `json:"repoId"`
	TemplateID  string            `json:"templateId"`
	Prompt      string            `json:"prompt"`
	Target      string            `json:"target"`
	Variables   map[string]string `json:"variables"`
	Attachments []AttachmentRef   `json:"attachments"`
	// ClientRequestID 是可选的幂等键：相同 key 的重复请求返回同一个 job，
	// 不会重复执行（如 WebDev Issue 领取重试 / 并发）。
	ClientRequestID string `json:"clientRequestId"`
}

type materializedAttachment struct {
	ID          string `json:"id"`
	Filename    string `json:"filename"`
	SavedName   string `json:"savedName"`
	ContentType string `json:"contentType,omitempty"`
	Size        int64  `json:"size,omitempty"`
	Sha256      string `json:"sha256,omitempty"`
	Path        string `json:"path"`
}

type attachmentContext struct {
	Dir      string
	Manifest string
	Items    []materializedAttachment
}

func New(cfg config.Config) *Server {
	return &Server{
		cfg:         cfg,
		jobs:        map[string]*Job{},
		idempotency: map[string]string{},
		attachments: map[string]Attachment{},
		redactMap:   buildRedactMap(),
	}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := cleanPath(r.URL.Path)

	if r.Method == http.MethodGet && path == "/runtime/health" {
		s.writeJSON(w, http.StatusOK, map[string]any{
			"status":        "ok",
			"agentId":       s.cfg.AgentID,
			"version":       version.Version,
			"commit":        version.Commit,
			"builtAt":       version.BuiltAt,
			"repos":         publicRepos(s.cfg.Repos),
			"templateCount": len(s.cfg.Templates),
		})
		return
	}

	if path == "/runtime/enrollment" {
		if !s.authenticate(w, r) {
			return
		}
		s.writeJSON(w, http.StatusOK, map[string]any{
			"agentId":   s.cfg.AgentID,
			"version":   version.Version,
			"repos":     publicRepos(s.cfg.Repos),
			"templates": publicTemplates(s.cfg.Templates),
		})
		return
	}

	if strings.HasPrefix(path, "/v1/") && !s.authenticate(w, r) {
		return
	}

	switch {
	case r.Method == http.MethodPost && path == "/v1/attachments":
		s.uploadAttachments(w, r)
	case r.Method == http.MethodPost && path == "/v1/jobs":
		s.createJob(w, r)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/v1/jobs/") && strings.HasSuffix(path, "/events"):
		s.getJobEvents(w, r, strings.TrimSuffix(strings.TrimPrefix(path, "/v1/jobs/"), "/events"))
	case r.Method == http.MethodPost && strings.HasPrefix(path, "/v1/jobs/") && strings.HasSuffix(path, "/cancel"):
		s.cancelJob(w, r, strings.TrimSuffix(strings.TrimPrefix(path, "/v1/jobs/"), "/cancel"))
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/v1/jobs/"):
		s.getJob(w, strings.TrimPrefix(path, "/v1/jobs/"))
	default:
		s.writeError(w, http.StatusNotFound, "not_found", "Route not found")
	}
}

func (s *Server) createJob(w http.ResponseWriter, r *http.Request) {
	var req CreateJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_json", "Invalid JSON request body")
		return
	}
	req.Type = strings.TrimSpace(req.Type)
	req.RepoID = strings.TrimSpace(req.RepoID)
	req.TemplateID = strings.TrimSpace(req.TemplateID)
	req.ClientRequestID = strings.TrimSpace(req.ClientRequestID)
	if req.Type == "" {
		s.writeError(w, http.StatusBadRequest, "missing_type", "Job type is required")
		return
	}
	// 幂等快路径：相同 clientRequestId 已有 job 时直接返回，不重复创建/执行。
	if req.ClientRequestID != "" {
		if existing := s.jobByClientRequestID(req.ClientRequestID); existing != nil {
			s.writeJSON(w, http.StatusOK, s.publicJob(existing))
			return
		}
	}
	template, err := s.templateFor(req)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_template", err.Error())
		return
	}
	if template.Type != req.Type {
		s.writeError(w, http.StatusBadRequest, "template_type_mismatch", "Template type does not match job type")
		return
	}
	if req.Type == "codex_task" && strings.TrimSpace(req.Prompt) == "" {
		s.writeError(w, http.StatusBadRequest, "missing_prompt", "Prompt is required for codex_task")
		return
	}
	attachments, err := s.resolveAttachmentRefs(req.Attachments)
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_attachment", err.Error())
		return
	}

	job := &Job{
		ID:              newID(),
		Type:            req.Type,
		Status:          "queued",
		RepoID:          template.RepoID,
		TemplateID:      template.ID,
		Prompt:          req.Prompt,
		Target:          req.Target,
		Variables:       req.Variables,
		Attachments:     attachments,
		ClientRequestID: req.ClientRequestID,
		CreatedAt:       time.Now().UTC(),
	}

	s.mu.Lock()
	// 幂等双重检查：并发的相同 clientRequestId 请求可能在快路径之后插入，
	// 此处在锁内复查，命中则丢弃本次构建的 job、返回既有 job。
	if req.ClientRequestID != "" {
		if existingID, ok := s.idempotency[req.ClientRequestID]; ok {
			if existing := s.jobs[existingID]; existing != nil {
				s.mu.Unlock()
				s.writeJSON(w, http.StatusOK, s.publicJob(existing))
				return
			}
		}
		s.idempotency[req.ClientRequestID] = job.ID
	}
	s.jobs[job.ID] = job
	s.addEventLocked(job, "system", "job queued")
	s.mu.Unlock()

	go s.runJob(job.ID, template)

	s.writeJSON(w, http.StatusAccepted, s.publicJob(job))
}

func (s *Server) jobByClientRequestID(key string) *Job {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id, ok := s.idempotency[key]; ok {
		return s.jobs[id]
	}
	return nil
}

func (s *Server) getJob(w http.ResponseWriter, id string) {
	job := s.findJob(id)
	if job == nil {
		s.writeError(w, http.StatusNotFound, "job_not_found", "Job not found")
		return
	}
	s.writeJSON(w, http.StatusOK, s.publicJob(job))
}

func (s *Server) getJobEvents(w http.ResponseWriter, r *http.Request, id string) {
	job := s.findJob(id)
	if job == nil {
		s.writeError(w, http.StatusNotFound, "job_not_found", "Job not found")
		return
	}
	after := 0
	if value := strings.TrimSpace(r.URL.Query().Get("after")); value != "" {
		_, _ = fmt.Sscanf(value, "%d", &after)
	}

	s.mu.Lock()
	events := make([]Event, 0, len(job.events))
	for _, event := range job.events {
		if event.Sequence > after {
			events = append(events, event)
		}
	}
	s.mu.Unlock()

	s.writeJSON(w, http.StatusOK, map[string]any{
		"jobId":  id,
		"events": events,
	})
}

func (s *Server) cancelJob(w http.ResponseWriter, _ *http.Request, id string) {
	job := s.findJob(id)
	if job == nil {
		s.writeError(w, http.StatusNotFound, "job_not_found", "Job not found")
		return
	}

	s.mu.Lock()
	cancel := job.cancel
	if cancel == nil || isTerminal(job.Status) {
		s.mu.Unlock()
		s.writeJSON(w, http.StatusOK, s.publicJob(job))
		return
	}
	s.addEventLocked(job, "system", "cancel requested")
	s.mu.Unlock()

	cancel()
	s.writeJSON(w, http.StatusAccepted, s.publicJob(job))
}

func (s *Server) runJob(id string, template config.TemplateConfig) {
	if templateRunner(template) == "codex_app_server" {
		s.runCodexAppServerJob(id, template)
		return
	}

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
	if len(attachmentContext.Items) > 0 {
		s.addEventLocked(job, "system", fmt.Sprintf("attached %d file(s): %s", len(attachmentContext.Items), attachmentContext.Dir))
	}
	s.mu.Unlock()

	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Dir = cwd
	cmd.Env = env

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

	var wg sync.WaitGroup
	wg.Add(2)
	go s.scanOutput(job, "stdout", stdout, &wg)
	go s.scanOutput(job, "stderr", stderr, &wg)
	waitErr := cmd.Wait()
	wg.Wait()

	exitCode := cmd.ProcessState.ExitCode()
	if errors.Is(ctx.Err(), context.Canceled) {
		s.finishCanceled(job, exitCode)
		return
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		s.finishJob(job, exitCode, fmt.Errorf("job timed out after %s", timeout))
		return
	}
	if waitErr != nil {
		s.finishJob(job, exitCode, waitErr)
		return
	}
	s.finishJob(job, exitCode, nil)
}

func (s *Server) scanOutput(job *Job, level string, pipe any, wg *sync.WaitGroup) {
	defer wg.Done()
	reader, ok := pipe.(interface {
		Read([]byte) (int, error)
	})
	if !ok {
		return
	}
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		message := s.redact(scanner.Text())
		s.mu.Lock()
		s.addEventLocked(job, normalizeOutputLevel(level, message), message)
		s.mu.Unlock()
	}
}

func (s *Server) uploadAttachments(w http.ResponseWriter, r *http.Request) {
	maxBytes := s.maxAttachmentBytes()
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes*8)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_multipart", "Invalid attachment upload")
		return
	}
	if r.MultipartForm == nil || len(r.MultipartForm.File) == 0 {
		s.writeError(w, http.StatusBadRequest, "missing_file", "At least one file is required")
		return
	}

	attachments := []AttachmentRef{}
	for _, headers := range r.MultipartForm.File {
		for _, header := range headers {
			if len(attachments) >= 8 {
				s.writeError(w, http.StatusBadRequest, "too_many_files", "At most 8 files can be uploaded")
				return
			}
			attachment, err := s.storeAttachment(header, maxBytes)
			if err != nil {
				s.writeError(w, http.StatusBadRequest, "invalid_file", err.Error())
				return
			}
			s.mu.Lock()
			s.attachments[attachment.ID] = attachment
			s.mu.Unlock()
			attachments = append(attachments, attachment.AttachmentRef)
		}
	}

	s.writeJSON(w, http.StatusCreated, map[string]any{
		"attachments": attachments,
	})
}

func (s *Server) storeAttachment(header *multipart.FileHeader, maxBytes int64) (Attachment, error) {
	file, err := header.Open()
	if err != nil {
		return Attachment{}, err
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return Attachment{}, err
	}
	if int64(len(data)) > maxBytes {
		return Attachment{}, fmt.Errorf("file %s exceeds %d bytes", header.Filename, maxBytes)
	}

	id := newID()
	filename := sanitizeFilename(header.Filename)
	if filename == "" {
		filename = "attachment-" + id
	}
	dir := filepath.Join(s.attachmentStoreDir(), id)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return Attachment{}, err
	}
	path := filepath.Join(dir, filename)
	if err := os.WriteFile(path, data, 0600); err != nil {
		return Attachment{}, err
	}

	sum := sha256.Sum256(data)
	contentType := strings.TrimSpace(header.Header.Get("Content-Type"))
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	now := time.Now().UTC()
	return Attachment{
		AttachmentRef: AttachmentRef{
			ID:          id,
			Filename:    filename,
			ContentType: contentType,
			Size:        int64(len(data)),
			Sha256:      hex.EncodeToString(sum[:]),
			CreatedAt:   now,
		},
		Path: path,
	}, nil
}

func (s *Server) resolveAttachmentRefs(refs []AttachmentRef) ([]AttachmentRef, error) {
	if len(refs) == 0 {
		return nil, nil
	}
	if len(refs) > 8 {
		return nil, fmt.Errorf("at most 8 attachments are allowed")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	output := make([]AttachmentRef, 0, len(refs))
	for _, ref := range refs {
		id := strings.TrimSpace(ref.ID)
		if id == "" {
			continue
		}
		attachment, ok := s.attachments[id]
		if !ok {
			return nil, fmt.Errorf("attachment %s is not available", id)
		}
		output = append(output, attachment.AttachmentRef)
	}
	return output, nil
}

func (s *Server) materializeJobAttachments(job *Job) (attachmentContext, error) {
	if len(job.Attachments) == 0 {
		return attachmentContext{}, nil
	}

	destDir := filepath.Join(os.TempDir(), "hzy-dev-agent", "jobs", job.ID, "attachments")
	if err := os.MkdirAll(destDir, 0700); err != nil {
		return attachmentContext{}, err
	}

	items := make([]materializedAttachment, 0, len(job.Attachments))
	for index, ref := range job.Attachments {
		attachment, err := s.attachmentByID(ref.ID)
		if err != nil {
			return attachmentContext{}, err
		}
		savedName := uniqueAttachmentName(index, attachment.Filename)
		target := filepath.Join(destDir, savedName)
		if err := copyFile(attachment.Path, target); err != nil {
			return attachmentContext{}, err
		}
		items = append(items, materializedAttachment{
			ID:          attachment.ID,
			Filename:    attachment.Filename,
			SavedName:   savedName,
			ContentType: attachment.ContentType,
			Size:        attachment.Size,
			Sha256:      attachment.Sha256,
			Path:        target,
		})
	}

	manifestPath := filepath.Join(destDir, "attachments.json")
	manifest, err := json.MarshalIndent(items, "", "  ")
	if err != nil {
		return attachmentContext{}, err
	}
	if err := os.WriteFile(manifestPath, manifest, 0600); err != nil {
		return attachmentContext{}, err
	}

	return attachmentContext{
		Dir:      destDir,
		Manifest: manifestPath,
		Items:    items,
	}, nil
}

func (s *Server) attachmentByID(id string) (Attachment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	attachment, ok := s.attachments[id]
	if !ok {
		return Attachment{}, fmt.Errorf("attachment %s is not available", id)
	}
	return attachment, nil
}

func (s *Server) finishJob(job *Job, exitCode int, err error) {
	finishedAt := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	job.cancel = nil
	job.FinishedAt = &finishedAt
	job.ExitCode = &exitCode
	if err != nil {
		job.Status = "failed"
		job.Error = err.Error()
		s.addEventLocked(job, "error", s.redact(err.Error()))
		return
	}
	job.Status = "succeeded"
	s.addEventLocked(job, "system", "job succeeded")
}

func (s *Server) finishCanceled(job *Job, exitCode int) {
	finishedAt := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	job.cancel = nil
	job.FinishedAt = &finishedAt
	job.ExitCode = &exitCode
	job.Status = "canceled"
	s.addEventLocked(job, "system", "job canceled")
}

func (s *Server) templateFor(req CreateJobRequest) (config.TemplateConfig, error) {
	for _, template := range s.cfg.Templates {
		if req.TemplateID != "" && template.ID == req.TemplateID {
			return template, nil
		}
	}
	if req.TemplateID != "" {
		return config.TemplateConfig{}, fmt.Errorf("template %s is not configured", req.TemplateID)
	}
	for _, template := range s.cfg.Templates {
		if template.Type == req.Type && (req.RepoID == "" || template.RepoID == req.RepoID) {
			return template, nil
		}
	}
	return config.TemplateConfig{}, fmt.Errorf("no template configured for job type %s", req.Type)
}

func (s *Server) repo(id string) (config.RepoConfig, error) {
	for _, repo := range s.cfg.Repos {
		if repo.ID == id {
			return repo, nil
		}
	}
	return config.RepoConfig{}, fmt.Errorf("repo %s is not configured", id)
}

func (s *Server) findJob(id string) *Job {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.jobs[id]
}

func (s *Server) publicJob(job *Job) map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return map[string]any{
		"id":              job.ID,
		"type":            job.Type,
		"status":          job.Status,
		"repoId":          job.RepoID,
		"templateId":      job.TemplateID,
		"target":          job.Target,
		"attachments":     job.Attachments,
		"clientRequestId": job.ClientRequestID,
		"createdAt":       job.CreatedAt,
		"startedAt":       job.StartedAt,
		"finishedAt":      job.FinishedAt,
		"exitCode":        job.ExitCode,
		"error":           job.Error,
		"eventCount":      len(job.events),
	}
}

func (s *Server) addEventLocked(job *Job, level string, message string) {
	job.events = append(job.events, Event{
		Sequence:  len(job.events) + 1,
		Level:     level,
		Message:   message,
		CreatedAt: time.Now().UTC(),
	})
}

func (s *Server) authenticate(w http.ResponseWriter, r *http.Request) bool {
	if strings.TrimSpace(s.cfg.Auth.StaticToken) == "" {
		return true
	}
	token := bearerToken(r.Header.Get("authorization"))
	if token == "" {
		token = strings.TrimSpace(r.Header.Get("x-hzy-dev-agent-token"))
	}
	if token != s.cfg.Auth.StaticToken {
		s.writeError(w, http.StatusUnauthorized, "unauthorized", "Missing or invalid Dev Agent token")
		return false
	}
	return true
}

func (s *Server) writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (s *Server) writeError(w http.ResponseWriter, status int, code string, message string) {
	s.writeJSON(w, status, map[string]any{
		"error": map[string]string{
			"code":    code,
			"message": message,
		},
	})
}

func (s *Server) redact(input string) string {
	output := stripANSIEscapeSequences(input)
	for secret, replacement := range s.redactMap {
		if secret != "" {
			output = strings.ReplaceAll(output, secret, replacement)
		}
	}
	return output
}

func stripANSIEscapeSequences(input string) string {
	return ansiEscapeRegexp.ReplaceAllString(input, "")
}

func publicRepos(repos []config.RepoConfig) []map[string]any {
	items := make([]map[string]any, 0, len(repos))
	for _, repo := range repos {
		items = append(items, map[string]any{
			"id":            repo.ID,
			"defaultBranch": repo.DefaultBranch,
		})
	}
	return items
}

func publicTemplates(templates []config.TemplateConfig) []map[string]any {
	items := make([]map[string]any, 0, len(templates))
	for _, template := range templates {
		items = append(items, map[string]any{
			"id":                 template.ID,
			"type":               template.Type,
			"repoId":             template.RepoID,
			"cwd":                template.CWD,
			"runner":             templateRunner(template),
			"codexSandboxPolicy": codexSandboxPolicyName(template),
			"timeoutSec":         template.TimeoutSec,
		})
	}
	return items
}

func templateRunner(template config.TemplateConfig) string {
	runner := strings.TrimSpace(template.Runner)
	if runner == "" {
		return "command"
	}
	return runner
}

func codexSandboxPolicyName(template config.TemplateConfig) string {
	switch strings.TrimSpace(template.CodexSandboxPolicy) {
	case "dangerFullAccess", "danger-full-access":
		return "dangerFullAccess"
	default:
		return "workspaceWrite"
	}
}

func cleanPath(path string) string {
	if path == "" {
		return "/"
	}
	if len(path) > 1 {
		path = strings.TrimRight(path, "/")
	}
	return path
}

func bearerToken(header string) string {
	parts := strings.Fields(header)
	if len(parts) == 2 && strings.EqualFold(parts[0], "bearer") {
		return parts[1]
	}
	return ""
}

func safeCWD(repoPath string, relative string) (string, error) {
	root, err := filepath.Abs(repoPath)
	if err != nil {
		return "", err
	}
	cwd := root
	if strings.TrimSpace(relative) != "" {
		cwd = filepath.Join(root, relative)
	}
	cwd, err = filepath.Abs(cwd)
	if err != nil {
		return "", err
	}
	if cwd != root && !strings.HasPrefix(cwd, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("template cwd escapes repo path")
	}
	return cwd, nil
}

func jobVariables(job *Job, repo config.RepoConfig, cwd string, attachments attachmentContext) map[string]string {
	values := map[string]string{
		"jobId":         job.ID,
		"type":          job.Type,
		"repoId":        job.RepoID,
		"repoPath":      repo.Path,
		"cwd":           cwd,
		"prompt":        promptWithAttachments(job.Prompt, attachments),
		"target":        job.Target,
		"defaultBranch": repo.DefaultBranch,
	}
	for key, value := range job.Variables {
		values[key] = value
	}
	return values
}

func substituteAll(items []string, values map[string]string) []string {
	output := make([]string, len(items))
	for index, item := range items {
		output[index] = substitute(item, values)
	}
	return output
}

func promptWithAttachments(prompt string, attachments attachmentContext) string {
	if len(attachments.Items) == 0 {
		return prompt
	}

	var builder strings.Builder
	builder.WriteString(prompt)
	builder.WriteString("\n\n---\n")
	builder.WriteString("附件已保存到本地临时目录，请在执行任务前查看相关文件。\n")
	builder.WriteString("附件目录: ")
	builder.WriteString(attachments.Dir)
	builder.WriteString("\n附件清单: ")
	builder.WriteString(attachments.Manifest)
	builder.WriteString("\n附件列表:\n")
	for _, item := range attachments.Items {
		builder.WriteString("- ")
		builder.WriteString(item.Filename)
		builder.WriteString(" -> ")
		builder.WriteString(item.Path)
		builder.WriteString("\n")
	}
	return builder.String()
}

func normalizeOutputLevel(level string, message string) string {
	if level == "stderr" && !isErrorLikeOutput(message) {
		return "info"
	}
	return level
}

func isErrorLikeOutput(message string) bool {
	lower := strings.ToLower(strings.TrimSpace(message))
	if lower == "" {
		return false
	}
	errorMarkers := []string{
		"error:",
		"fatal:",
		"panic:",
		"failed",
		"exception",
		"unauthorized",
		"permission denied",
		"could not resolve",
		"no such file",
		"not found",
	}
	for _, marker := range errorMarkers {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func (s *Server) maxAttachmentBytes() int64 {
	if value := strings.TrimSpace(s.cfg.Settings["maxAttachmentBytes"]); value != "" {
		var parsed int64
		if _, err := fmt.Sscanf(value, "%d", &parsed); err == nil && parsed > 0 {
			return parsed
		}
	}
	return 10 << 20
}

func (s *Server) attachmentStoreDir() string {
	if value := strings.TrimSpace(os.Getenv("HZY_DEV_AGENT_ATTACHMENT_DIR")); value != "" {
		return filepath.Clean(os.ExpandEnv(value))
	}
	if value := strings.TrimSpace(s.cfg.Settings["attachmentDir"]); value != "" {
		return filepath.Clean(os.ExpandEnv(value))
	}
	return filepath.Join(os.TempDir(), "hzy-dev-agent", "attachments")
}

func sanitizeFilename(filename string) string {
	name := filepath.Base(strings.TrimSpace(filename))
	name = strings.ReplaceAll(name, string(os.PathSeparator), "-")
	name = strings.ReplaceAll(name, "\x00", "")
	if name == "." || name == "/" {
		return ""
	}
	return name
}

func uniqueAttachmentName(index int, filename string) string {
	name := sanitizeFilename(filename)
	if name == "" {
		name = "attachment"
	}
	return fmt.Sprintf("%02d-%s", index+1, name)
}

func copyFile(source string, target string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()

	output, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer output.Close()

	_, err = io.Copy(output, input)
	return err
}

func substitute(input string, values map[string]string) string {
	output := input
	for key, value := range values {
		output = strings.ReplaceAll(output, "{{"+key+"}}", value)
	}
	return output
}

func buildRedactMap() map[string]string {
	items := map[string]string{}
	for _, env := range os.Environ() {
		key, value, ok := strings.Cut(env, "=")
		if !ok || len(value) < 8 {
			continue
		}
		upper := strings.ToUpper(key)
		if strings.Contains(upper, "TOKEN") || strings.Contains(upper, "SECRET") || strings.Contains(upper, "PASSWORD") || strings.Contains(upper, "KEY") {
			items[value] = "[redacted:" + key + "]"
		}
	}
	return items
}

func isTerminal(status string) bool {
	switch status {
	case "succeeded", "failed", "canceled":
		return true
	default:
		return false
	}
}

func newID() string {
	var bytes [8]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(bytes[:])
}
