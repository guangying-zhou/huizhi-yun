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
	if !strings.Contains(source, `operation == "commit" || operation == "issue-upsert"`) ||
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
