package server

import (
	"os"
	"strings"
	"testing"
)

func TestConnectorPeopleBatchAppliesCanonicalDepartmentsBeforePeopleFacts(t *testing.T) {
	source, err := os.ReadFile("server.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	start := strings.Index(text, `path == "/runtime/internal/connector-runtime/people-sync-batches"`)
	if start < 0 {
		t.Fatal("connector People batch route is missing")
	}
	applyDepartments := strings.Index(text[start:], "ApplyDingTalkDepartmentBatch")
	finalizeSnapshot := strings.Index(text[start:], "FinalizeDingTalkDepartmentSnapshot")
	applyPeople := strings.Index(text[start:], "ApplyConnectorPeopleBatch")
	if applyDepartments < 0 || finalizeSnapshot < 0 || applyPeople < 0 {
		t.Fatalf("connector People batch route is missing its canonical department, snapshot proof, or People fact step")
	}
	if applyDepartments >= finalizeSnapshot || finalizeSnapshot >= applyPeople {
		t.Fatalf("connector People batch route must apply canonical departments, verify the final snapshot, then apply People facts")
	}
}
