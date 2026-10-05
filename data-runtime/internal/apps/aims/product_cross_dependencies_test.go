package aims

import (
	"context"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"testing"
)

func TestProductCrossDependenciesRuntimeBoundary(t *testing.T) {
	var adapter Adapter
	for _, action := range []string{"list", "view", "targets", "create", "remove"} {
		path := "/v1/aims/internal/products/P-A/cross-dependencies:" + action
		query := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}}
		for _, scope := range []string{"aims.read", "aims.write", "aims:product-roadmaps:*", "aims:product-features:edit"} {
			query.Set("current_user_scopes", scope)
			_, _, handled, err := adapter.handleProductCrossDependenciesRuntime(context.Background(), http.MethodPost, path, query, nil)
			var response httperror.Error
			if !handled || !errors.As(err, &response) || response.Status != 403 {
				t.Fatalf("%s %s: %v", action, scope, err)
			}
		}
		capability := "aims:product-priorities:read"
		if action == "create" || action == "remove" {
			capability = "aims:product-priorities:cross-dependency-" + action
		}
		query.Set("current_user_scopes", capability)
		_, _, handled, err := adapter.handleProductCrossDependenciesRuntime(context.Background(), http.MethodGet, path, query, nil)
		var response httperror.Error
		if !handled || !errors.As(err, &response) || response.Status != 405 {
			t.Fatalf("method: %v", err)
		}
		_, _, handled, err = adapter.handleProductCrossDependenciesRuntime(context.Background(), http.MethodPost, path, query, map[string]any{"authorization": "invalid"})
		if !handled || !errors.As(err, &response) || response.Status != 400 {
			t.Fatalf("decode: %v", err)
		}
		query.Del("hzy_runtime_actor_delegated")
		_, _, handled, err = adapter.handleProductCrossDependenciesRuntime(context.Background(), http.MethodPost, path, query, nil)
		if !handled || !errors.As(err, &response) || response.Status != 403 {
			t.Fatalf("actor: %v", err)
		}
	}
}
