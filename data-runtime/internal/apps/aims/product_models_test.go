package aims

import (
	"context"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"testing"
)

func TestProductModelsRuntimeBoundary(t *testing.T) {
	var adapter Adapter
	for _, action := range []string{"list", "create", "rice-create", "cycle-select"} {
		path := "/v1/aims/internal/products/P-A/priority-models:" + action
		query := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}}
		for _, scope := range []string{"aims.read", "aims.write", "aims:product-priorities:*", "aims:product-features:edit"} {
			query.Set("current_user_scopes", scope)
			_, _, handled, err := adapter.handleProductModelsRuntime(context.Background(), http.MethodPost, path, query, nil)
			var response httperror.Error
			if !handled || !errors.As(err, &response) || response.Status != 403 {
				t.Fatalf("%s %s: %v", action, scope, err)
			}
		}
		capability := "aims:product-priorities:read"
		if action == "create" || action == "rice-create" {
			capability = "aims:product-priorities:model-create"
		}
		if action == "cycle-select" {
			capability = "aims:product-priorities:cycle-model-select"
		}
		query.Set("current_user_scopes", capability)
		_, _, handled, err := adapter.handleProductModelsRuntime(context.Background(), http.MethodGet, path, query, nil)
		var response httperror.Error
		if !handled || !errors.As(err, &response) || response.Status != 405 {
			t.Fatalf("method: %v", err)
		}
		_, _, handled, err = adapter.handleProductModelsRuntime(context.Background(), http.MethodPost, path, query, map[string]any{"authorization": "invalid"})
		if !handled || !errors.As(err, &response) || response.Status != 400 {
			t.Fatalf("decode: %v", err)
		}
		if action == "create" || action == "rice-create" {
			model := map[string]any{"version": "v2", "reach_unit": "unique_users"}
			if action == "rice-create" {
				model = map[string]any{"version": "v2", "strategic": 30}
			}
			_, _, _, err = adapter.handleProductModelsRuntime(context.Background(), http.MethodPost, path, query, map[string]any{"authorization": map[string]any{}, "input": map[string]any{"model": model}})
			if !errors.As(err, &response) || response.Status != 400 {
				t.Fatalf("cross-method input should fail decoding: %v", err)
			}
		}
		query.Del("hzy_runtime_actor_delegated")
		_, _, handled, err = adapter.handleProductModelsRuntime(context.Background(), http.MethodPost, path, query, nil)
		if !handled || !errors.As(err, &response) || response.Status != 403 {
			t.Fatalf("actor: %v", err)
		}
	}
}
