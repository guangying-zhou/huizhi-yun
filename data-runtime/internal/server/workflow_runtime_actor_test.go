package server

import (
	"os"
	"strings"
	"testing"
)

func TestWorkflowRuntimeRequiresTrustedActorForUserRelationPaths(t *testing.T) {
	for _, path := range []string{
		"/v1/workflow/actions",
		"/v1/workflow/tasks/pending",
		"/v1/workflow/tasks/42",
		"/v1/workflow/instances",
		"/v1/workflow/instances/42",
		"/v1/workflow/instances/by-biz",
		"/v1/workflow/admin/flow-schemas",
	} {
		if !workflowRuntimeRequiresTrustedActor(path) {
			t.Fatalf("workflow path %q must require a trusted actor", path)
		}
	}
	if workflowRuntimeRequiresTrustedActor("/v1/workflow/actionable-lifecycle-effects/pending") {
		t.Fatal("internal Workflow outbox path must not require a browser actor")
	}
}

func TestWorkflowInstanceMutationsOverwriteBodyActorWithTrustedDelegation(t *testing.T) {
	source, err := os.ReadFile("server.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	for _, route := range []string{
		`path == "/v1/workflow/instances/prepare"`,
		`path == "/v1/workflow/instances"`,
	} {
		start := strings.Index(text, route)
		if start < 0 {
			t.Fatalf("Workflow mutation route %q not found", route)
		}
		block := text[start:]
		if end := strings.Index(block[len(route):], "\n\tif "); end >= 0 {
			block = block[:len(route)+end]
		}
		for _, required := range []string{"trustedWorkflowUserActor(r, authCtx)", "injectRuntimeAuthBody(body, authCtx, actorUID, deptCodes)"} {
			if !strings.Contains(block, required) {
				t.Fatalf("Workflow mutation route %q must contain %q", route, required)
			}
		}
	}
	if !strings.Contains(text, `purpose != ""`) {
		t.Fatal("Workflow user mutation actor helper must reject non-user delegation purposes")
	}
}
