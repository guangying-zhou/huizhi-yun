package aims

import (
	"context"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"testing"
)

func TestProductDocumentReadRuntimeBoundary(t *testing.T) {
	for _, action := range []string{"list", "view", "remove", "edit", "restore", "create", "request-view", "requests-list", "template-create", "link-created"} {
		testProductDocumentReadRuntimeBoundary(t, action)
	}
}
func testProductDocumentReadRuntimeBoundary(t *testing.T, action string) {
	var a Adapter
	path := "/v1/aims/internal/products/P/documents:" + action
	valid := url.Values{"current_user": {"u"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.read aims:product-documents:read"}}
	if action == "remove" || action == "edit" || action == "restore" || action == "create" {
		valid.Set("current_user_scopes", "aims.write aims:product-documents:"+action)
	}
	if action == "template-create" || action == "link-created" {
		valid.Set("current_user_scopes", "aims.write aims:product-documents:create")
	}
	for key := range valid {
		q := url.Values{}
		for k, v := range valid {
			q[k] = append([]string(nil), v...)
		}
		q.Del(key)
		expectedStatus := 403
		if key == "current_user" {
			expectedStatus = 401
		}
		_, op, err := a.HandleRuntime(context.Background(), http.MethodPost, path, q, nil)
		var e httperror.Error
		if op != "aims.product-documents."+action || !errors.As(err, &e) || e.Status != expectedStatus {
			t.Fatalf("%s: %s %v", key, op, err)
		}
	}
	for _, scope := range []string{"aims.read", "aims:product-documents:*", "codocs:product-document:read"} {
		valid.Set("current_user_scopes", scope)
		_, _, err := a.HandleRuntime(context.Background(), http.MethodPost, path, valid, nil)
		var e httperror.Error
		if !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("%s: %v", scope, err)
		}
	}
	_, _, err := a.HandleRuntime(context.Background(), http.MethodGet, path, valid, nil)
	var e httperror.Error
	if !errors.As(err, &e) || e.Status != 405 {
		t.Fatalf("GET: %v", err)
	}
}
