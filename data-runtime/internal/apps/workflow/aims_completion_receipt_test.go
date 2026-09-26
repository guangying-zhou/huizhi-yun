package workflow

import (
	"strings"
	"testing"
)

func completionCommandFixture() map[string]any {
	hash := strings.Repeat("a", 64)
	return map[string]any{"completionRequestId": float64(1), "workItemId": float64(2), "projectId": float64(3), "workItemKey": "WI-2", "actorUid": "U1", "snapshotSha256": hash, "bizTitle": "完成工作项", "idempotencyKey": "aims:work-item-completion:1:workflow-submit:v1", "bizContext": map[string]any{"project_id": float64(3)}, "formData": map[string]any{"completionRequestId": float64(1), "workItemId": float64(2), "projectId": float64(3), "snapshotSha256": hash}}
}

func matterCompletionCommandFixture() map[string]any {
	command := completionCommandFixture()
	command["kind"] = "matter"
	command["idempotencyKey"] = "aims:work-item-completion:matter:1:workflow-submit:v2"
	command["formData"].(map[string]any)["kind"] = "matter"
	command["formData"].(map[string]any)["evidenceSummary"] = map[string]any{"deliverableCount": float64(1), "requiredDeliverableCount": float64(1), "commitCount": float64(0), "timeEntryCount": float64(1)}
	return command
}

func TestAimsCompletionReceiptSchemaContract(t *testing.T) {
	for _, tc := range []struct {
		name   string
		matter bool
		schema string
		accept bool
	}{
		{"target-v1", false, "v1", true},
		{"matter-v2", true, "v2", true},
		{"target-v2", false, "v2", false},
		{"matter-v1", true, "v1", false},
		{"target-v3", false, "v3", false},
		{"matter-v3", true, "v3", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			command := completionCommandFixture()
			if tc.matter {
				command = matterCompletionCommandFixture()
			}
			_, _, err := validateAimsCompletionCommand(command)
			accepted := err == nil && aimsCompletionSchemaMatchesCommand(tc.schema, command)
			if accepted != tc.accept {
				t.Fatalf("accepted=%v, want %v", accepted, tc.accept)
			}
		})
	}
}

func TestMatterCompletionFrozenCommandRequiresExactKind(t *testing.T) {
	if _, _, err := validateAimsCompletionCommand(matterCompletionCommandFixture()); err != nil {
		t.Fatal("valid matter command rejected", err)
	}
	for _, change := range []func(map[string]any){
		func(c map[string]any) { c["kind"] = "target" },
		func(c map[string]any) { delete(c, "kind") },
		func(c map[string]any) { c["formData"].(map[string]any)["kind"] = "target" },
		func(c map[string]any) { delete(c["formData"].(map[string]any), "kind") },
		func(c map[string]any) { c["callbackUrl"] = "https://example.invalid" },
	} {
		command := matterCompletionCommandFixture()
		change(command)
		if _, _, err := validateAimsCompletionCommand(command); err == nil {
			t.Fatal("invalid matter command accepted", command)
		}
	}
}

func TestAimsCompletionFrozenCommandRejectsUnboundContext(t *testing.T) {
	request, item, err := validateAimsCompletionCommand(completionCommandFixture())
	if err != nil || request != 1 || item != 2 {
		t.Fatalf("valid source command rejected: %d %d %v", request, item, err)
	}
	for name, change := range map[string]func(map[string]any){
		"callback override": func(c map[string]any) { c["callbackUrl"] = "https://example.invalid" },
		"numeric string":    func(c map[string]any) { c["workItemId"] = "2" },
		"fractional id":     func(c map[string]any) { c["projectId"] = 2.5 },
		"project context":   func(c map[string]any) { c["bizContext"].(map[string]any)["project_id"] = float64(4) },
		"form request":      func(c map[string]any) { c["formData"].(map[string]any)["completionRequestId"] = float64(4) },
		"form hash":         func(c map[string]any) { c["formData"].(map[string]any)["snapshotSha256"] = strings.Repeat("b", 64) },
		"extra form":        func(c map[string]any) { c["formData"].(map[string]any)["status"] = "approved" },
		"invalid hash":      func(c map[string]any) { c["snapshotSha256"] = "invalid" },
		"title overflow":    func(c map[string]any) { c["bizTitle"] = strings.Repeat("中", 256) },
		"actor overflow":    func(c map[string]any) { c["actorUid"] = strings.Repeat("u", 51) },
		"actor whitespace":  func(c map[string]any) { c["actorUid"] = " U1" },
		"actor control":     func(c map[string]any) { c["actorUid"] = "U\x00" },
		"key whitespace":    func(c map[string]any) { c["workItemKey"] = "WI-2 " },
	} {
		t.Run(name, func(t *testing.T) {
			c := completionCommandFixture()
			change(c)
			if _, _, err := validateAimsCompletionCommand(c); err == nil {
				t.Fatal("unbound command accepted")
			}
		})
	}
}

func TestAimsCompletionCommandAcceptsUnicodeTitleAtStorageLimit(t *testing.T) {
	c := completionCommandFixture()
	c["bizTitle"] = strings.Repeat("中", 255)
	if _, _, err := validateAimsCompletionCommand(c); err != nil {
		t.Fatal(err)
	}
}
