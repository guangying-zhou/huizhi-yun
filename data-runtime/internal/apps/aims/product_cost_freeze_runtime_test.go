package aims

import (
	"context"
	"net/url"
	"testing"
	"time"
)

func TestProductCostFreezeRuntimeRejectsUntrustedPermitBeforeDB(t *testing.T) {
	for _, mode := range []string{"scope", "client", "actor", "expiry", "purpose", "project", "request"} {
		t.Run(mode, func(t *testing.T) {
			q := url.Values{"current_user": {"U1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "hzy_runtime_tenant_code": {"TENANT"}, "hzy_runtime_deployment_code": {"AIMS"}, "current_user_scopes": {"aims.write aims:product-cost-rules:freeze"}}
			c := map[string]any{"actorUid": "U1", "projectCode": "PRJ1", "periodMonth": "2026-09", "expectedRevision": float64(2), "evidenceRef": "review", "shares": []any{}}
			p := map[string]any{"actorUid": "U1", "projectId": "1", "projectCode": "PRJ1", "resource": "projects", "action": "edit", "purpose": "product_cost_rules_freeze", "expiresAt": float64(time.Now().Add(15 * time.Second).UnixMilli())}
			b := map[string]any{"command": c, "authorization": p, "requestId": "00000000-0000-4000-8000-000000000001"}
			switch mode {
			case "scope":
				q.Set("current_user_scopes", "aims.write")
			case "client":
				q.Set("hzy_runtime_service_client_id", "other")
			case "actor":
				p["actorUid"] = "OTHER"
			case "expiry":
				p["expiresAt"] = float64(1)
			case "purpose":
				p["purpose"] = "product_cost_read"
			case "project":
				p["projectCode"] = "OTHER"
			case "request":
				b["requestId"] = "bad"
			}
			a := &Adapter{}
			_, _, handled, err := a.handleProductCostFreezeRuntime(context.Background(), "POST", "/v1/aims/internal/product-cost-rules:freeze", q, b)
			if !handled || err == nil {
				t.Fatalf("accepted invalid %s", mode)
			}
		})
	}
}
