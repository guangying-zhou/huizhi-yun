package assets

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/http"
	"net/url"
	"testing"
	"time"
)

func productAdoptionRuntimeFixture(t *testing.T) (url.Values, map[string]any) {
	t.Helper()
	command := map[string]any{"actorUid": "U1", "productCode": "PROD", "action": "read", "page": float64(1), "pageSize": float64(20)}
	digest, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatal(err)
	}
	scope := map[string]any{"current_user": "U1", assetsObjectAccessQueryKey: "relation", assetsScopeUnitsQueryKey: `[{"directRelation":true,"relationPredicates":["owner"]}]`}
	body := map[string]any{
		integrationoperation.TrustedServiceCommandTenantKey:           "T",
		integrationoperation.TrustedServiceCommandSourceDeploymentKey: "AIMS",
		integrationoperation.TrustedServiceCommandTargetDeploymentKey: "ASSETS",
		integrationoperation.TrustedServiceCommandSourceAppKey:        "aims",
		integrationoperation.TrustedServiceCommandTargetAppKey:        "assets",
		integrationoperation.TrustedServiceCommandSourceClientKey:     "aims.runtime",
		"serviceCommand":               map[string]any{"operationId": "a1111111-1111-4111-8111-111111111111", "targetApp": "assets", "operationCode": productAdoptionReadOperation, "requiredCapability": productAdoptionReadCapability, "idempotencyKey": "adoption:read:1", "commandSchemaVersion": productAdoptionReadOperation, "commandSha256": digest, "command": command},
		"productAdoptionAuthorization": map[string]any{"expiresAt": float64(time.Now().Add(15 * time.Second).UnixMilli()), "delivery": scope, "environment": scope},
	}
	query := url.Values{"scope": {productAdoptionReadCapability}, "runtime_source_app": {"assets"}, "tenant": {"T"}, "deployment": {"ASSETS"}, "current_user": {"U1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_actor_purpose": {"service-command"}}
	return query, body
}

func TestProductAdoptionRuntimeRejectsInvalidDelegation(t *testing.T) {
	for _, field := range []string{"current_user", "runtime_source_app", "tenant", "deployment", "hzy_runtime_actor_delegated", "hzy_runtime_actor_purpose"} {
		q, body := productAdoptionRuntimeFixture(t)
		q.Set(field, "wrong")
		if _, _, _, err := (&Adapter{}).handleProductAdoptionRuntime(context.Background(), http.MethodPost, "/v1/assets/internal/product-adoption:read", q, body); err == nil {
			t.Fatalf("accepted wrong %s", field)
		}
	}
	for _, expiry := range []float64{0, float64(time.Now().Add(time.Hour).UnixMilli())} {
		q, body := productAdoptionRuntimeFixture(t)
		body["productAdoptionAuthorization"].(map[string]any)["expiresAt"] = expiry
		if _, _, _, err := (&Adapter{}).handleProductAdoptionRuntime(context.Background(), http.MethodPost, "/v1/assets/internal/product-adoption:read", q, body); err == nil {
			t.Fatal("accepted invalid expiry")
		}
	}
}

func TestProductAdoptionRuntimeRejectsBeforeStorage(t *testing.T) {
	adapter := &Adapter{}
	for _, scope := range []string{"", "assets.read", "assets:read", "assets:*", productAdoptionReadCapability} {
		_, op, handled, err := adapter.handleProductAdoptionRuntime(context.Background(), http.MethodPost, "/v1/assets/internal/product-adoption:read", url.Values{"scope": {scope}}, nil)
		if !handled || op != "assets.product_adoption.read" || err == nil {
			t.Fatalf("accepted unsigned query with scope %q", scope)
		}
	}
	if _, _, handled, err := adapter.handleProductAdoptionRuntime(context.Background(), http.MethodGet, "/v1/assets/internal/product-adoption:read", nil, nil); !handled || err == nil {
		t.Fatal("GET accepted")
	}
	if _, _, handled, _ := adapter.handleProductAdoptionRuntime(context.Background(), http.MethodPost, "/v1/assets/other", nil, nil); handled {
		t.Fatal("unrelated route intercepted")
	}
}
