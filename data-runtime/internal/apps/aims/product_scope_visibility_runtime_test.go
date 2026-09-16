package aims

import (
	"context"
	"net/url"
	"testing"
)

func TestProductScopeVisibilityRuntimeRequiresExactCapability(t *testing.T) {
	var a Adapter
	path := "/v1/aims/internal/products/P1/versions:scope-visibility"
	for _, scope := range []string{"aims.read", "aims:product-versions:read", "aims:product-versions:edit", "*"} {
		q := url.Values{"current_user_scopes": {scope}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "hzy_runtime_tenant_code": {"TENANT"}, "hzy_runtime_deployment_code": {"AIMS"}}
		_, operation, matched, err := a.handleProductCenterVersionsRuntime(context.Background(), "POST", path, q, nil)
		if !matched || operation != "aims.product-versions.scope-visibility" || err == nil {
			t.Fatalf("scope %s accepted: %v", scope, err)
		}
	}
	if _, _, matched, err := a.handleProductCenterVersionsRuntime(context.Background(), "GET", path, nil, nil); !matched || err == nil {
		t.Fatal("GET accepted")
	}
}
