package finance

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/http"
	"net/url"
	"testing"
	"time"
)

func TestProductCostRuntimeRejectsUnsignedOrBroadAccess(t *testing.T) {
	adapter := &Adapter{}
	for _, scope := range []string{"", "finance:read", "finance:*", productCostReadCapability} {
		_, operation, err := adapter.HandleMutationWithQuery(context.Background(), http.MethodPost, "/v1/finance/internal/product-cost:read", url.Values{"scope": {scope}}, map[string]any{})
		if err == nil || operation != "finance.product_cost.read" {
			t.Fatalf("scope %q accepted: %s %v", scope, operation, err)
		}
	}
	if _, _, err := adapter.HandleMutationWithQuery(context.Background(), http.MethodGet, "/v1/finance/internal/product-cost:read", nil, nil); err == nil {
		t.Fatal("GET accepted")
	}
}

func TestProductCostRuntimeRejectsDelegationAndScopeMismatch(t *testing.T) {
	for _, field := range []string{"current_user", "tenant", "deployment", "runtime_source_app", "hzy_runtime_actor_delegated", "hzy_runtime_actor_purpose"} {
		q, body := productCostRuntimeFixture(t)
		q.Set(field, "wrong")
		if _, err := (&Adapter{}).readProductCostRuntime(context.Background(), http.MethodPost, q, body); err == nil {
			t.Fatalf("accepted wrong %s", field)
		}
	}
	for _, override := range []map[string]any{
		{"current_user": "OTHER"}, {"current_user_project_finance_access": ""},
		{"current_user_project_finance_access": "none"}, {"current_user_project_finance_project_codes": "OTHER"},
		{"expiresAt": float64(0)}, {"expiresAt": float64(time.Now().Add(time.Hour).UnixMilli())},
	} {
		q, body := productCostRuntimeFixture(t)
		for key, value := range override {
			body["productCostAuthorization"].(map[string]any)[key] = value
		}
		if _, err := (&Adapter{}).readProductCostRuntime(context.Background(), http.MethodPost, q, body); err == nil {
			t.Fatalf("accepted %v", override)
		}
	}
}

func productCostRuntimeFixture(t *testing.T) (url.Values, map[string]any) {
	t.Helper()
	command := map[string]any{"actorUid": "U1", "productCode": "P1", "projectCode": "PRJ-1", "periodMonth": "2026-09", "action": "read"}
	digest, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatal(err)
	}

	body := map[string]any{
		integrationoperation.TrustedServiceCommandTenantKey:           "T",
		integrationoperation.TrustedServiceCommandSourceDeploymentKey: "AIMS",
		integrationoperation.TrustedServiceCommandTargetDeploymentKey: "FINANCE",
		integrationoperation.TrustedServiceCommandSourceAppKey:        "aims",
		integrationoperation.TrustedServiceCommandTargetAppKey:        "finance",
		integrationoperation.TrustedServiceCommandSourceClientKey:     "aims.runtime",
		"serviceCommand":           map[string]any{"operationId": "a1111111-1111-4111-8111-111111111111", "targetApp": "finance", "operationCode": productCostReadOperation, "requiredCapability": productCostReadCapability, "idempotencyKey": "adoption:read:1", "commandSchemaVersion": productCostReadOperation, "commandSha256": digest, "command": command},
		"productCostAuthorization": map[string]any{"expiresAt": float64(time.Now().Add(15 * time.Second).UnixMilli()), "current_user": "U1", "current_user_project_finance_access": "projects", "current_user_project_finance_project_codes": "PRJ-1"},
	}
	query := url.Values{"scope": {productCostReadCapability}, "runtime_source_app": {"finance"}, "tenant": {"T"}, "deployment": {"FINANCE"}, "current_user": {"U1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_actor_purpose": {"service-command"}}
	return query, body
}
