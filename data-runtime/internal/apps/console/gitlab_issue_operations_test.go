package console

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGitLabIssueUpsertCreatesIssueWithStableAimsMarker(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/issues"):
			if r.URL.Query().Get("search") != "AIMS-7" || r.Header.Get("PRIVATE-TOKEN") != "secret" {
				t.Fatalf("unexpected search request: %s %#v", r.URL.String(), r.Header)
			}
			_, _ = w.Write([]byte(`[]`))
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/issues"):
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(body["description"].(string), "<!-- hzy-aims:item-key=AIMS-7 -->") {
				t.Fatalf("missing stable marker: %#v", body)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"iid":7,"state":"opened","web_url":"https://gitlab.example/group/repo/-/issues/7"}`))
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer server.Close()

	runtime := gitLabOperationRuntime{BaseURL: server.URL, Token: "secret"}
	result, err := runtime.upsertIssue(context.Background(), "group/repo", map[string]any{
		"externalKey": "AIMS-7", "title": "[AIMS-7] Task", "description": "Body",
		"state": "opened", "labels": []any{"hzy::aims"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result["iid"] != int64(7) || result["created"] != true || requests != 2 {
		t.Fatalf("unexpected result: %#v requests=%d", result, requests)
	}
}

func TestGitLabIssueUpsertRefusesForeignExistingIssue(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"iid":9,"state":"opened","web_url":"https://gitlab.example/issues/9","description":"<!-- hzy-aims:item-key=OTHER-1 -->"}`))
	}))
	defer server.Close()
	runtime := gitLabOperationRuntime{BaseURL: server.URL, Token: "secret"}
	_, err := runtime.upsertIssue(context.Background(), "group/repo", map[string]any{
		"externalKey": "AIMS-7", "title": "Task", "description": "Body",
		"state": "opened", "issueIid": 9,
	})
	if err == nil {
		t.Fatal("foreign issue binding must be rejected")
	}
}
