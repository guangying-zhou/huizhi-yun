package workflow

import (
	"strings"
	"testing"
)

func completionCommandFixture() map[string]any {
	hash := strings.Repeat("a", 64)
	return map[string]any{"completionRequestId": float64(1), "workItemId": float64(2), "projectId": float64(3), "workItemKey": "WI-2", "actorUid": "U1", "snapshotSha256": hash, "bizTitle": "完成工作项", "idempotencyKey": "aims:work-item-completion:1:workflow-submit:v1", "bizContext": map[string]any{"project_id": float64(3)}, "formData": map[string]any{"completionRequestId": float64(1), "workItemId": float64(2), "projectId": float64(3), "snapshotSha256": hash}}
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
