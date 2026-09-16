package aims

import (
	"context"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"testing"
)

func TestRequestCreateRequiresSignedActorAndExactCapabilityBeforeDatabase(t *testing.T) {
	var adapter Adapter
	valid := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:product-requests:create"}}
	for _, key := range []string{"hzy_runtime_actor_delegated", "hzy_runtime_source_app", "hzy_runtime_tenant_code", "hzy_runtime_deployment_code", "hzy_runtime_service_client_id", "current_user_scopes"} {
		q := url.Values{}
		for k, v := range valid {
			q[k] = append([]string(nil), v...)
		}
		q.Del(key)
		_, _, handled, err := adapter.handleProductRequestCreateRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-1/requests:create", q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("%s: %v", key, err)
		}
	}
}

func TestRequestReadsRequireSignedActorAndReadCapabilityBeforeDatabase(t *testing.T) {
	var adapter Adapter
	for _, action := range []string{"list", "view"} {
		for _, scope := range []string{"aims.read", "aims.write aims:product-requests:create", "aims.read aims:product-requests:*"} {
			q := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {scope}}
			_, _, handled, err := adapter.handleProductRequestReadRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-1/requests:"+action, q, nil)
			var e httperror.Error
			if !handled || !errors.As(err, &e) || e.Status != 403 {
				t.Fatalf("%s %s: %v", action, scope, err)
			}
		}
	}
}

func TestRequestEditRequiresSignedActorAndExactCapabilityBeforeDatabase(t *testing.T) {
	var adapter Adapter
	valid := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:product-requests:edit"}}
	for _, key := range []string{"hzy_runtime_actor_delegated", "hzy_runtime_source_app", "hzy_runtime_tenant_code", "hzy_runtime_deployment_code", "hzy_runtime_service_client_id", "current_user_scopes"} {
		q := url.Values{}
		for k, v := range valid {
			q[k] = append([]string(nil), v...)
		}
		q.Del(key)
		_, _, handled, err := adapter.handleProductRequestEditRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-1/requests:edit", q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("%s: %v", key, err)
		}
	}
}

func TestRequestDecisionRequiresSignedActorAndExactCapabilityBeforeDatabase(t *testing.T) {
	var adapter Adapter
	valid := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:product-requests:decide"}}
	for _, key := range []string{"hzy_runtime_actor_delegated", "hzy_runtime_source_app", "hzy_runtime_tenant_code", "hzy_runtime_deployment_code", "hzy_runtime_service_client_id", "current_user_scopes"} {
		q := url.Values{}
		for k, v := range valid {
			q[k] = append([]string(nil), v...)
		}
		q.Del(key)
		_, _, handled, err := adapter.handleProductRequestDecisionRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-1/requests:decide", q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("%s: %v", key, err)
		}
	}
}

func TestRequestDecisionRejectsEditCapability(t *testing.T) {
	var adapter Adapter
	q := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:product-requests:edit"}}
	_, _, handled, err := adapter.handleProductRequestDecisionRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-1/requests:decide", q, nil)
	var e httperror.Error
	if !handled || !errors.As(err, &e) || e.Status != 403 {
		t.Fatalf("edit authorized decision: %v", err)
	}
}

func TestRequestSourceListRejectsMissingReadCapability(t *testing.T) {
	var adapter Adapter
	q := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.read aims:product-requests:edit"}}
	_, _, handled, err := adapter.handleProductRequestSourcesRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-1/request-sources:list", q, nil)
	var e httperror.Error
	if !handled || !errors.As(err, &e) || e.Status != 403 {
		t.Fatalf("unexpected authorization: %v", err)
	}
}

func TestRequestSourceCreateRequiresSignedActorAndExactCapabilityBeforeDatabase(t *testing.T) {
	var adapter Adapter
	valid := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:product-requests:source-create"}}
	for _, key := range []string{"hzy_runtime_actor_delegated", "hzy_runtime_source_app", "hzy_runtime_tenant_code", "hzy_runtime_deployment_code", "hzy_runtime_service_client_id", "current_user_scopes"} {
		q := url.Values{}
		for k, v := range valid {
			q[k] = append([]string(nil), v...)
		}
		q.Del(key)
		_, _, handled, err := adapter.handleProductRequestSourceCreateRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-1/request-sources:create", q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("%s: %v", key, err)
		}
	}
}

func TestRequestSourceDeleteRequiresSignedActorAndExactCapabilityBeforeDatabase(t *testing.T) {
	var adapter Adapter
	valid := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:product-requests:source-delete"}}
	for _, key := range []string{"hzy_runtime_actor_delegated", "hzy_runtime_source_app", "hzy_runtime_tenant_code", "hzy_runtime_deployment_code", "hzy_runtime_service_client_id", "current_user_scopes"} {
		q := url.Values{}
		for k, v := range valid {
			q[k] = append([]string(nil), v...)
		}
		q.Del(key)
		_, _, handled, err := adapter.handleProductRequestSourceDeleteRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-1/request-sources:delete", q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("%s: %v", key, err)
		}
	}
}

func TestRequestSourceDeleteRejectsOtherCapabilities(t *testing.T) {
	var adapter Adapter
	for _, capability := range []string{"edit", "source-create", "read", "*"} {
		q := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:product-requests:" + capability}}
		_, _, handled, err := adapter.handleProductRequestSourceDeleteRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-1/request-sources:delete", q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("%s authorized source deletion: %v", capability, err)
		}
	}
}

func TestRequestMergeRequiresSignedActorAndExactCapabilityBeforeDatabase(t *testing.T) {
	var adapter Adapter
	valid := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:product-requests:merge"}}
	for _, key := range []string{"hzy_runtime_actor_delegated", "hzy_runtime_source_app", "hzy_runtime_tenant_code", "hzy_runtime_deployment_code", "hzy_runtime_service_client_id", "current_user_scopes"} {
		q := url.Values{}
		for k, v := range valid {
			q[k] = append([]string(nil), v...)
		}
		q.Del(key)
		_, _, handled, err := adapter.handleProductRequestMergeRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-1/requests:merge", q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("%s: %v", key, err)
		}
	}
}

func TestRequestMergeRejectsOtherCapabilities(t *testing.T) {
	var adapter Adapter
	for _, capability := range []string{"edit", "source-create", "decide", "read", "*"} {
		q := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:product-requests:" + capability}}
		_, _, handled, err := adapter.handleProductRequestMergeRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-1/requests:merge", q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("%s authorized source deletion: %v", capability, err)
		}
	}
}
