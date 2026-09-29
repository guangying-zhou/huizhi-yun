package codocs

import (
	"net/http"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestEnterpriseCompanyReceiptIdentityBindsIntent(t *testing.T) {
	id := EnterpriseCompanyCommandIdentity{Tenant: "C000001", SourceDeployment: "enterprise", TargetDeployment: "codocs", Actor: "user-a", Client: "enterprise.runtime", Key: "intent-1"}
	first, err := enterpriseCompanyReceiptInput(id, "enterprise.codocs.company-access.record.v1", "company-access-record.v1", map[string]any{"path": "codocs/company/rules/a.md"})
	if err != nil {
		t.Fatal(err)
	}
	if first.RequiredCapability != "codocs:enterprise-host:execute" || first.TrustedContext.SourceApp != "enterprise" || first.TargetApp != "codocs" {
		t.Fatalf("incorrect receipt binding: %+v", first)
	}
	otherActor := id
	otherActor.Actor = "user-b"
	second, err := enterpriseCompanyReceiptInput(otherActor, "enterprise.codocs.company-access.record.v1", "company-access-record.v1", map[string]any{"path": "codocs/company/rules/a.md"})
	if err != nil {
		t.Fatal(err)
	}
	if first.OperationID == second.OperationID {
		t.Fatal("actor change reused receipt operation")
	}
	changedIntent, err := enterpriseCompanyReceiptInput(id, "enterprise.codocs.company-access.record.v1", "company-access-record.v1", map[string]any{"path": "codocs/company/rules/b.md"})
	if err != nil {
		t.Fatal(err)
	}
	if first.OperationID != changedIntent.OperationID || first.CommandSHA256 == changedIntent.CommandSHA256 {
		t.Fatal("same key must bind one operation and reject changed payload")
	}
}

func TestEnterpriseCompanyReceiptRejectsUnverifiedService(t *testing.T) {
	_, err := enterpriseCompanyReceiptInput(EnterpriseCompanyCommandIdentity{Tenant: "C000001", SourceDeployment: "enterprise", TargetDeployment: "codocs", Actor: "user-a", Client: "browser", Key: "intent-1"}, "enterprise.codocs.company-access.record.v1", "company-access-record.v1", map[string]any{})
	if err == nil {
		t.Fatal("unverified service accepted")
	}
	if h, ok := err.(httperror.Error); !ok || h.Status != http.StatusForbidden {
		t.Fatalf("want 403, got %v", err)
	}
}
