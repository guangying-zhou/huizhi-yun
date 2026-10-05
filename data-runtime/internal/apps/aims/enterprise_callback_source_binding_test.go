package aims

import (
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"testing"
)

func TestCompletionCallbackRegisteredSourceIsNotDomainOwner(t *testing.T) {
	b := &enterpriseWriteBinding{writer: e.ResolveRequest{Key: e.BindingKey{Tenant: "T"}}, sourceDeployment: "T-enterprise", workerDeployment: "T-aims", binding: e.Binding{Domains: map[string]e.DomainBinding{"aims": {OwnerDeployment: "physical-aims-owner"}}}}
	for _, c := range []struct {
		app, client, deployment, tenant string
		allowed                         bool
	}{
		{"enterprise", "enterprise.runtime", "T-enterprise", "T", true},
		{"aims", "aims.runtime", "T-aims", "T", true},
		{"enterprise", "enterprise.runtime", "physical-aims-owner", "T", false},
		{"enterprise", "aims.runtime", "T-enterprise", "T", false},
		{"aims", "enterprise.runtime", "T-aims", "T", false},
		{"codocs", "codocs.runtime", "T-enterprise", "T", false},
		{"enterprise", "enterprise.runtime", "T-enterprise", "other", false},
		{"enterprise", "enterprise.runtime", "", "T", false},
	} {
		source := io.TrustedContext{SourceApp: c.app, ServiceClientID: c.client, DeploymentCode: c.deployment, TenantCode: c.tenant}
		if got := b.completionCallbackBindingAllowed(source); got != c.allowed {
			t.Fatalf("source binding %v: got %v", c, got)
		}
	}
	var absent *enterpriseWriteBinding
	if absent.completionCallbackBindingAllowed(io.TrustedContext{}) {
		t.Fatal("missing binding accepted")
	}
}
