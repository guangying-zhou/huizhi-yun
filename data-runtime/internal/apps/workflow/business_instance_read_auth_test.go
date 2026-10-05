package workflow

import (
	"os"
	"strings"
	"testing"
)

func TestBusinessInstanceReadsRequireTrustedActorAndParticipantRelation(t *testing.T) {
	source, err := os.ReadFile("runtime_instances.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	for _, function := range []string{"instanceByBiz", "instanceByBizHistory"} {
		start := strings.Index(text, "func (a *Adapter) "+function)
		if start < 0 {
			t.Fatalf("%s not found", function)
		}
		end := strings.Index(text[start+1:], "\nfunc ")
		block := text[start:]
		if end >= 0 {
			block = text[start : start+1+end]
		}
		for _, required := range []string{
			`query.Get("hzy_runtime_actor_delegated") != "1"`,
			"initiator_uid = ?",
			"flow_tasks participant_task",
			"flow_actions participant_action",
		} {
			if !strings.Contains(block, required) {
				t.Fatalf("%s must contain %q", function, required)
			}
		}
		if strings.Contains(block, `query.Get("request_app_code")`) {
			t.Fatalf("%s must not treat caller-provided request_app_code as trusted runtime context", function)
		}
	}
}
