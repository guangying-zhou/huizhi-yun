package workflow

import (
	"encoding/json"
	"testing"
)

func TestAltocApprovalRequiresNonSelfFrozenRound(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{"requestNo": "APF-fixed", "requestedBy": "initiator"})
	instance := map[string]any{"app_code": "altoc", "resource_code": "quotation", "action_code": "approve", "form_data": string(raw)}
	if e := requireAltocNonSelfApproval(instance, "reviewer"); e != nil {
		t.Fatal(e)
	}
	if requireAltocNonSelfApproval(instance, "initiator") == nil {
		t.Fatal("self decision or delegation allowed")
	}
	instance["form_data"] = "{}"
	if requireAltocNonSelfApproval(instance, "reviewer") == nil {
		t.Fatal("legacy unbound approval allowed")
	}
	instance["app_code"] = "ordinary"
	if e := requireAltocNonSelfApproval(instance, "initiator"); e != nil {
		t.Fatal("ordinary workflow changed", e)
	}
}
