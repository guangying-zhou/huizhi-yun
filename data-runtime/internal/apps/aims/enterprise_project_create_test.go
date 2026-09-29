package aims

import "testing"

func TestEnterpriseProjectCreateReceiptIdentityDetectsChangedPayload(t *testing.T) {
	identity := EnterpriseProjectCreateIdentity{Tenant: "tenant-a", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "person-a", ServiceClientID: "enterprise.runtime", RequestID: "req-1", IdempotencyKey: "same-key"}
	first, err := enterpriseProjectCreateReceiptInput(identity, map[string]any{"projectCode": "P1", "name": "One"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := enterpriseProjectCreateReceiptInput(identity, map[string]any{"projectCode": "P1", "name": "Changed"})
	if err != nil {
		t.Fatal(err)
	}
	if first.OperationID != second.OperationID || first.IdempotencyKey != second.IdempotencyKey {
		t.Fatal("same key did not retain receipt identity")
	}
	if first.CommandSHA256 == second.CommandSHA256 {
		t.Fatal("changed payload did not change receipt hash")
	}
	if first.OriginalActorUID != "person-a" || first.OperationCode != EnterpriseProjectCreateOperation {
		t.Fatal("actor or operation not bound")
	}
}
