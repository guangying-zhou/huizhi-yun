package aims

import (
	"context"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"testing"
)

func TestProductObjectivesRuntimeBoundary(t *testing.T) {
	var adapter Adapter
	for _, action := range []string{"item-objectives", "list", "view", "cycles", "items", "observations", "create", "edit", "item-link", "cycle-map", "cycle-revoke", "observe", "activate", "close", "reopen", "archive"} {
		path := "/v1/aims/internal/products/P-A/objectives:" + action
		query := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}}
		for _, scope := range []string{"aims.read", "aims.write", "aims:product-objectives:*", "aims:product-features:edit"} {
			query.Set("current_user_scopes", scope)
			_, _, handled, err := adapter.handleProductCenterObjectivesRuntime(context.Background(), http.MethodPost, path, query, nil)
			var response httperror.Error
			if !handled || !errors.As(err, &response) || response.Status != 403 {
				t.Fatalf("%s %s: %v", action, scope, err)
			}
		}
		capability := "aims:product-objectives:" + action
		if action == "item-objectives" || action == "list" || action == "view" || action == "observations" || action == "items" || action == "cycles" {
			capability = "aims:product-objectives:read"
		}
		query.Set("current_user_scopes", capability)
		_, _, handled, err := adapter.handleProductCenterObjectivesRuntime(context.Background(), http.MethodGet, path, query, nil)
		var response httperror.Error
		if !handled || !errors.As(err, &response) || response.Status != 405 {
			t.Fatalf("method: %v", err)
		}
		_, _, handled, err = adapter.handleProductCenterObjectivesRuntime(context.Background(), http.MethodPost, path, query, map[string]any{"authorization": "invalid"})
		if !handled || !errors.As(err, &response) || response.Status != 400 {
			t.Fatalf("decode: %v", err)
		}
		if action == "item-objectives" {
			for _, body := range []map[string]any{
				{"authorization": map[string]any{}, "planning_authorization": "invalid"},
				{"authorization": map[string]any{}, "planning_authorization": map[string]any{}, "input": map[string]any{"item_biz_id": "id", "page": 1, "page_size": 20, "actor_uid": "override"}},
			} {
				_, _, handled, err = adapter.handleProductCenterObjectivesRuntime(context.Background(), http.MethodPost, path, query, body)
				if !handled || !errors.As(err, &response) || response.Status != 400 {
					t.Fatalf("reverse decode: %v", err)
				}
			}
		}
		query.Del("hzy_runtime_actor_delegated")
		_, _, handled, err = adapter.handleProductCenterObjectivesRuntime(context.Background(), http.MethodPost, path, query, nil)
		if !handled || !errors.As(err, &response) || response.Status != 403 {
			t.Fatalf("actor: %v", err)
		}
	}
}
