package server

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/huizhi-yun/dev-agent/internal/config"
)

func testServer(t *testing.T) *Server {
	t.Helper()
	return New(config.Config{
		AgentID: "test-agent",
		Repos: []config.RepoConfig{
			{ID: "r", Path: t.TempDir(), DefaultBranch: "main"},
		},
		Templates: []config.TemplateConfig{
			{ID: "t1", Type: "test", RepoID: "r", CWD: ".", Argv: []string{"true"}, TimeoutSec: 30},
		},
	})
}

func postJob(t *testing.T, s *Server, body map[string]any) (int, map[string]any) {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/jobs", bytes.NewReader(raw))
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	var decoded map[string]any
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &decoded); err != nil {
			t.Fatalf("decode response: %v (body=%s)", err, rec.Body.String())
		}
	}
	return rec.Code, decoded
}

func (s *Server) jobCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.jobs)
}

func TestCreateJobIdempotentByClientRequestID(t *testing.T) {
	s := testServer(t)

	status1, body1 := postJob(t, s, map[string]any{"type": "test", "templateId": "t1", "clientRequestId": "k1"})
	if status1 != http.StatusAccepted {
		t.Fatalf("first create: want 202, got %d", status1)
	}
	id1, _ := body1["id"].(string)
	if id1 == "" {
		t.Fatalf("first create: missing job id")
	}

	status2, body2 := postJob(t, s, map[string]any{"type": "test", "templateId": "t1", "clientRequestId": "k1"})
	if status2 != http.StatusOK {
		t.Fatalf("retry: want 200 (existing job), got %d", status2)
	}
	if id2, _ := body2["id"].(string); id2 != id1 {
		t.Fatalf("retry returned different job id: %q vs %q", id2, id1)
	}

	if n := s.jobCount(); n != 1 {
		t.Fatalf("idempotent retry created extra job: jobCount=%d", n)
	}
}

func TestCreateJobWithoutClientRequestIDNotDeduped(t *testing.T) {
	s := testServer(t)

	_, body1 := postJob(t, s, map[string]any{"type": "test", "templateId": "t1"})
	_, body2 := postJob(t, s, map[string]any{"type": "test", "templateId": "t1"})

	id1, _ := body1["id"].(string)
	id2, _ := body2["id"].(string)
	if id1 == "" || id2 == "" || id1 == id2 {
		t.Fatalf("expected two distinct jobs, got %q and %q", id1, id2)
	}
	if n := s.jobCount(); n != 2 {
		t.Fatalf("want 2 jobs, got %d", n)
	}
}

func TestEnrollmentExposesTemplateRunner(t *testing.T) {
	s := New(config.Config{
		AgentID: "test-agent",
		Repos: []config.RepoConfig{
			{ID: "r", Path: t.TempDir(), DefaultBranch: "main"},
		},
		Templates: []config.TemplateConfig{
			{ID: "codex.app-server", Type: "codex_task", RepoID: "r", CWD: ".", Runner: "codex_app_server", CodexSandboxPolicy: "dangerFullAccess", Argv: []string{"codex", "app-server"}},
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/runtime/enrollment", nil)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("enrollment: want 200, got %d", rec.Code)
	}
	var body struct {
		Templates []map[string]any `json:"templates"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode enrollment: %v", err)
	}
	if len(body.Templates) != 1 {
		t.Fatalf("expected one template, got %d", len(body.Templates))
	}
	if got := body.Templates[0]["runner"]; got != "codex_app_server" {
		t.Fatalf("runner = %v, want codex_app_server", got)
	}
	if got := body.Templates[0]["codexSandboxPolicy"]; got != "dangerFullAccess" {
		t.Fatalf("codexSandboxPolicy = %v, want dangerFullAccess", got)
	}
}

func TestCodexAppServerRunnerCompletesWithFakeProtocol(t *testing.T) {
	s := New(config.Config{
		AgentID: "test-agent",
		Repos: []config.RepoConfig{
			{ID: "r", Path: t.TempDir(), DefaultBranch: "main"},
		},
		Templates: []config.TemplateConfig{
			{
				ID:     "codex.app-server",
				Type:   "codex_task",
				RepoID: "r",
				CWD:    ".",
				Runner: "codex_app_server",
				Argv:   []string{os.Args[0], "-test.run=TestFakeCodexAppServerProcess", "--"},
				Environment: map[string]string{
					"HZY_FAKE_CODEX_APP_SERVER": "1",
				},
				TimeoutSec: 5,
			},
		},
	})

	status, body := postJob(t, s, map[string]any{"type": "codex_task", "templateId": "codex.app-server", "prompt": "fix it"})
	if status != http.StatusAccepted {
		t.Fatalf("create app-server job: want 202, got %d", status)
	}
	id, _ := body["id"].(string)
	if id == "" {
		t.Fatalf("create app-server job: missing job id")
	}

	jobStatus, events := waitForTerminalJob(t, s, id)
	if jobStatus != "succeeded" {
		t.Fatalf("app-server job status = %s, want succeeded", jobStatus)
	}
	if !eventsContain(events, "hello from fake app-server") {
		t.Fatalf("app-server events did not include fake assistant delta: %#v", events)
	}
}

func TestCodexAppServerSandboxPolicyDangerFullAccess(t *testing.T) {
	legacySandbox, sandboxPolicy := codexAppServerSandboxPolicy(config.TemplateConfig{
		CodexSandboxPolicy: "dangerFullAccess",
	}, "/tmp/repo")

	if legacySandbox != "danger-full-access" {
		t.Fatalf("legacy sandbox = %q, want danger-full-access", legacySandbox)
	}
	if sandboxPolicy["type"] != "dangerFullAccess" {
		t.Fatalf("sandbox policy type = %v, want dangerFullAccess", sandboxPolicy["type"])
	}
	if _, ok := sandboxPolicy["writableRoots"]; ok {
		t.Fatalf("dangerFullAccess policy should not include writableRoots: %#v", sandboxPolicy)
	}
}

func TestCodexAppServerSandboxPolicyDefaultsToWorkspaceWrite(t *testing.T) {
	legacySandbox, sandboxPolicy := codexAppServerSandboxPolicy(config.TemplateConfig{}, "/tmp/repo")

	if legacySandbox != "workspace-write" {
		t.Fatalf("legacy sandbox = %q, want workspace-write", legacySandbox)
	}
	if sandboxPolicy["type"] != "workspaceWrite" {
		t.Fatalf("sandbox policy type = %v, want workspaceWrite", sandboxPolicy["type"])
	}
}

func TestFakeCodexAppServerProcess(t *testing.T) {
	if os.Getenv("HZY_FAKE_CODEX_APP_SERVER") != "1" {
		return
	}
	runFakeCodexAppServer()
	os.Exit(0)
}

func runFakeCodexAppServer() {
	scanner := bufio.NewScanner(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var message map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &message); err != nil {
			continue
		}
		id, hasID := message["id"]
		method, _ := message["method"].(string)

		switch method {
		case "initialize":
			if hasID {
				_ = encoder.Encode(map[string]any{"id": id, "result": map[string]any{}})
			}
		case "initialized":
			continue
		case "thread/start":
			if hasID {
				_ = encoder.Encode(map[string]any{
					"id": id,
					"result": map[string]any{
						"thread": map[string]any{"id": "thread-test"},
					},
				})
			}
		case "turn/start":
			if hasID {
				_ = encoder.Encode(map[string]any{
					"id": id,
					"result": map[string]any{
						"turn": map[string]any{"id": "turn-test", "status": "running", "items": []any{}},
					},
				})
			}
			_ = encoder.Encode(map[string]any{
				"method": "turn/started",
				"params": map[string]any{
					"threadId": "thread-test",
					"turn":     map[string]any{"id": "turn-test", "status": "running", "items": []any{}},
				},
			})
			_ = encoder.Encode(map[string]any{
				"method": "item/agentMessage/delta",
				"params": map[string]any{
					"threadId": "thread-test",
					"turnId":   "turn-test",
					"itemId":   "item-test",
					"delta":    "hello from fake app-server",
				},
			})
			_ = encoder.Encode(map[string]any{
				"method": "item/completed",
				"params": map[string]any{
					"threadId":      "thread-test",
					"turnId":        "turn-test",
					"completedAtMs": time.Now().UnixMilli(),
					"item": map[string]any{
						"id":   "item-test",
						"type": "agentMessage",
						"text": "hello from fake app-server",
					},
				},
			})
			_ = encoder.Encode(map[string]any{
				"method": "turn/completed",
				"params": map[string]any{
					"threadId": "thread-test",
					"turn":     map[string]any{"id": "turn-test", "status": "completed", "items": []any{}},
				},
			})
		}
	}
}

func waitForTerminalJob(t *testing.T, s *Server, id string) (string, []Event) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		job := s.jobs[id]
		if job != nil && isTerminal(job.Status) {
			events := append([]Event(nil), job.events...)
			status := job.Status
			s.mu.Unlock()
			return status, events
		}
		s.mu.Unlock()
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("job %s did not reach terminal status", id)
	return "", nil
}

func eventsContain(events []Event, text string) bool {
	for _, event := range events {
		if event.Message == text {
			return true
		}
	}
	return false
}

func TestRedactStripsANSIEscapeSequences(t *testing.T) {
	s := testServer(t)
	got := s.redact("\x1b[31mERROR\x1b[0m failed")
	if got != "ERROR failed" {
		t.Fatalf("redact stripped ANSI = %q, want %q", got, "ERROR failed")
	}
}
