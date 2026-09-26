package aims

import "testing"

func TestEnterpriseProjectUpdateReceiptBindsProjectAndPayload(t *testing.T) {
	id := EnterpriseProjectCreateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "U1", ServiceClientID: "enterprise.runtime", RequestID: "r1", IdempotencyKey: "same-key"}
	a, err := enterpriseProjectCreateReceiptInput(id, map[string]any{"projectId": "7", "changes": map[string]any{"name": "Alpha"}})
	if err != nil {
		t.Fatal(err)
	}
	b, err := enterpriseProjectCreateReceiptInput(id, map[string]any{"projectId": "8", "changes": map[string]any{"name": "Alpha"}})
	if err != nil {
		t.Fatal(err)
	}
	if a.OperationID != b.OperationID {
		t.Fatal("same idempotency key must keep operation id")
	}
	if a.CommandSHA256 == b.CommandSHA256 {
		t.Fatal("project binding must change command hash")
	}
}

func TestEnterpriseProjectUpdateAllowlistExcludesAdjacentWrites(t *testing.T) {
	for _, key := range []string{"moduleConfig", "boardConfig", "workflowConfig", "members", "milestones"} {
		if _, ok := enterpriseProjectUpdateColumns[key]; ok {
			t.Fatalf("adjacent write field %s exposed", key)
		}
	}
}
