package aims

import (
	"context"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"testing"
)

func TestFeatureCreateRequiresSignedActorAndExactCapabilityBeforeDatabase(t *testing.T) {
	var adapter Adapter
	valid := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:product-features:create"}}
	for _, key := range []string{"hzy_runtime_actor_delegated", "hzy_runtime_source_app", "hzy_runtime_tenant_code", "hzy_runtime_deployment_code", "hzy_runtime_service_client_id", "current_user_scopes"} {
		q := url.Values{}
		for k, v := range valid {
			q[k] = append([]string(nil), v...)
		}
		q.Del(key)
		_, _, handled, err := adapter.handleProductFeatureCreateRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-1/features:create", q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("%s: %v", key, err)
		}
	}
}

func TestFeatureReadsRequireSignedActorAndReadCapabilityBeforeDatabase(t *testing.T) {
	var adapter Adapter
	for _, action := range []string{"list", "view", "version-matrix"} {
		for _, scope := range []string{"aims.read", "aims.write aims:product-features:create", "aims.read aims:product-features:*"} {
			q := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {scope}}
			_, _, handled, err := adapter.handleProductFeatureReadRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-1/features:"+action, q, nil)
			var e httperror.Error
			if !handled || !errors.As(err, &e) || e.Status != 403 {
				t.Fatalf("%s %s: %v", action, scope, err)
			}
		}
	}
}
func TestFeatureEditRequiresSignedActorAndExactCapabilityBeforeDatabase(t *testing.T) {
	var adapter Adapter
	valid := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:product-features:edit"}}
	for _, key := range []string{"hzy_runtime_actor_delegated", "hzy_runtime_source_app", "hzy_runtime_tenant_code", "hzy_runtime_deployment_code", "hzy_runtime_service_client_id", "current_user_scopes"} {
		q := url.Values{}
		for k, v := range valid {
			q[k] = append([]string(nil), v...)
		}
		q.Del(key)
		_, _, handled, err := adapter.handleProductFeatureEditRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-1/features:edit", q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("%s: %v", key, err)
		}
	}
}

func TestFeatureDeleteRequiresSignedActorAndExactCapabilityBeforeDatabase(t *testing.T) {
	var adapter Adapter
	valid := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:product-features:delete"}}
	for _, key := range []string{"hzy_runtime_actor_delegated", "hzy_runtime_source_app", "hzy_runtime_tenant_code", "hzy_runtime_deployment_code", "hzy_runtime_service_client_id", "current_user_scopes"} {
		q := url.Values{}
		for k, v := range valid {
			q[k] = append([]string(nil), v...)
		}
		q.Del(key)
		_, _, handled, err := adapter.handleProductFeatureDeleteRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-1/features:delete", q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("%s: %v", key, err)
		}
	}
}

func TestFeatureLifecycleRequiresSignedActorAndExactCapabilityBeforeDatabase(t *testing.T) {
	var adapter Adapter
	valid := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:product-features:lifecycle"}}
	for _, key := range []string{"hzy_runtime_actor_delegated", "hzy_runtime_source_app", "hzy_runtime_tenant_code", "hzy_runtime_deployment_code", "hzy_runtime_service_client_id", "current_user_scopes"} {
		q := url.Values{}
		for k, v := range valid {
			q[k] = append([]string(nil), v...)
		}
		q.Del(key)
		_, _, handled, err := adapter.handleProductFeatureLifecycleRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-1/features:lifecycle", q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("%s: %v", key, err)
		}
	}
}

func TestFeatureComponentRequiresSignedActorAndExactCapabilityBeforeDatabase(t *testing.T) {
	var adapter Adapter
	valid := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:product-features:component-assign"}}
	for _, key := range []string{"hzy_runtime_actor_delegated", "hzy_runtime_source_app", "hzy_runtime_tenant_code", "hzy_runtime_deployment_code", "hzy_runtime_service_client_id", "current_user_scopes"} {
		q := url.Values{}
		for k, v := range valid {
			q[k] = append([]string(nil), v...)
		}
		q.Del(key)
		_, _, handled, err := adapter.handleProductFeatureComponentRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-1/features:component-assign", q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("%s: %v", key, err)
		}
	}
}

func TestFeatureVersionMatrixDecodeBoundary(t *testing.T) {
	var adapter Adapter
	q := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims:product-features:read"}}
	path := "/v1/aims/internal/products/P/features:version-matrix"
	for _, body := range []map[string]any{
		{"authorization": map[string]any{}, "version_authorization": "invalid"},
		{"authorization": map[string]any{}, "version_authorization": map[string]any{}, "input": map[string]any{"version_ids": []int{1}, "page": 1, "page_size": 20, "actor_uid": "override"}},
	} {
		_, operation, handled, err := adapter.handleProductFeatureReadRuntime(context.Background(), http.MethodPost, path, q, body)
		var e httperror.Error
		if !handled || operation != "aims.product-features.version-matrix" || !errors.As(err, &e) || e.Status != 400 {
			t.Fatalf("decode %s %v", operation, err)
		}
	}
	_, _, _, err := adapter.handleProductFeatureReadRuntime(context.Background(), http.MethodGet, path, q, nil)
	var e httperror.Error
	if !errors.As(err, &e) || e.Status != 405 {
		t.Fatalf("method %v", err)
	}
}
