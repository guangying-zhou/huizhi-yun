package server

import (
	"os"
	"strings"
	"testing"
)

func TestGitLabIssueUpsertRouteIsEnumeratedAndRequiresIdempotency(t *testing.T) {
	sourceBytes, err := os.ReadFile("server.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	if !strings.Contains(source, `"issue-upsert": true`) {
		t.Fatal("GitLab issue-upsert must be in the fixed operation allow-list")
	}
	// Repository content is read-only: the write operations must stay out of
	// the fixed allow-list (document asset design DOC-01).
	for _, removed := range []string{`"commit": true`, `"resolve-actions": true`} {
		if strings.Contains(source, removed) {
			t.Fatalf("GitLab repository write operation %s must not be allow-listed", removed)
		}
	}
	if !strings.Contains(source, `operation == "issue-upsert" && strings.TrimSpace(r.Header.Get("Idempotency-Key"))`) ||
		!strings.Contains(source, `r.Header.Get("Idempotency-Key")`) {
		t.Fatal("GitLab issue-upsert must require an Idempotency-Key before dispatch")
	}
}

func TestGitLabGroupProjectsRouteIsEnumerated(t *testing.T) {
	sourceBytes, err := os.ReadFile("server.go")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(sourceBytes), `"group-projects": true`) {
		t.Fatal("GitLab group-projects must be in the HTTP fixed operation allow-list")
	}
}
