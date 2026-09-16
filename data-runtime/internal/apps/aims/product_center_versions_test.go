package aims

import (
	"context"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestProductCenterVersionsRuntimeRejectsInsufficientCapabilityBeforeDatabase(t *testing.T) {
	var adapter Adapter
	for _, action := range []string{"plan", "plan-edit", "plan-items", "plan-item-create", "plan-item-edit", "plan-item-delete", "plan-confirm", "execution-coordination", "release-diff", "list", "view", "create", "edit", "scope-list", "scope-history", "scope-create", "scope-edit", "scope-deliver", "scope-reopen", "scope-legacy-criteria", "acceptance-preview", "acceptance-list", "acceptance-view", "accept", "publish", "release-view", "reopen", "release-list", "transition", "archive", "delete"} {
		for _, scope := range []string{"aims.read", "aims.write", "aims:product-features:*", "aims:product-requests:edit", "aims:product-features:edit"} {
			query := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {scope}}
			_, _, handled, err := adapter.handleProductCenterVersionsRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-A/versions:"+action, query, nil)
			var result httperror.Error
			if !handled || !errors.As(err, &result) || result.Status != 403 {
				t.Fatalf("%s %s: %v", action, scope, err)
			}
		}
	}
}

func TestLightweightPlanRuntimeRequiresForwardedObjectPermitsBeforeDatabase(t *testing.T) {
	var adapter Adapter
	baseQuery := func(scope string) url.Values {
		return url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {scope}}
	}
	versionPermit := map[string]any{"resource": "product_versions", "action": "view", "facts": map[string]any{}, "expires_at": 1}
	for _, action := range []string{"plan", "plan-items"} {
		body := map[string]any{"authorization": versionPermit, "input": map[string]any{"version_id": 1, "page": 1, "page_size": 20}}
		_, _, handled, err := adapter.handleProductCenterVersionsRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-A/versions:"+action, baseQuery("aims:product-versions:read"), body)
		var result httperror.Error
		if !handled || !errors.As(err, &result) || result.Status != http.StatusBadRequest {
			t.Fatalf("%s must require request authorization before database: %v", action, err)
		}
	}
	for _, action := range []string{"plan-item-create", "plan-confirm"} {
		body := map[string]any{"authorization": map[string]any{"resource": "product_versions", "action": "edit", "facts": map[string]any{}, "expires_at": 1}, "input": map[string]any{"version_id": 1}}
		_, _, handled, err := adapter.handleProductCenterVersionsRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-A/versions:"+action, baseQuery("aims:product-versions:edit"), body)
		var result httperror.Error
		if !handled || !errors.As(err, &result) || result.Status != http.StatusBadRequest {
			t.Fatalf("%s must require planning/request authorization before database: %v", action, err)
		}
	}
	create := map[string]any{
		"authorization":          map[string]any{"resource": "product_versions", "action": "edit", "facts": map[string]any{}, "expires_at": 1},
		"request_authorization":  map[string]any{"resource": "product_requests", "action": "view", "facts": map[string]any{}, "expires_at": 1},
		"planning_authorization": map[string]any{"resource": "product_priorities", "action": "edit", "facts": map[string]any{}, "expires_at": 1},
		"input":                  map[string]any{"version_id": 1, "adopt_request": true},
	}
	_, _, handled, err := adapter.handleProductCenterVersionsRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-A/versions:plan-item-create", baseQuery("aims:product-versions:edit"), create)
	var result httperror.Error
	if !handled || !errors.As(err, &result) || result.Status != http.StatusBadRequest {
		t.Fatalf("plan item adoption must require a separate decision permit before database: %v", err)
	}
}

func TestProductVersionWriteRequiresExecutionReviewBeforeDatabase(t *testing.T) {
	var adapter Adapter
	for _, action := range []string{"accept", "publish"} {
		for _, hash := range []any{nil, "", strings.Repeat("a", 63), strings.Repeat("A", 64), strings.Repeat("z", 64), 123, []string{strings.Repeat("a", 64)}} {
			query := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims:product-versions:" + action}}
			_, _, handled, err := adapter.handleProductCenterVersionsRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-A/versions:"+action, query, map[string]any{"execution_review_hash": hash})
			var response httperror.Error
			if !handled || !errors.As(err, &response) || response.Status != 400 || response.Code != "product_execution_review_required" {
				t.Fatalf("%s malformed review: %v", action, err)
			}
		}
	}
}

func TestLegacyProductVersionDeleteRetiredBeforeDatabase(t *testing.T) {
	var adapter Adapter
	for _, entry := range []string{"admin", "project"} {
		var err error
		if entry == "admin" {
			_, err = adapter.adminDeleteProductVersion(context.Background(), "12", url.Values{})
		} else {
			_, err = adapter.deleteProductVersion(context.Background(), "3", "12", url.Values{})
		}
		var response httperror.Error
		if !errors.As(err, &response) || response.Status != http.StatusGone || response.Code != "legacy_product_version_delete_retired" {
			t.Fatalf("%s legacy deletion: %v", entry, err)
		}
	}
}

func TestLegacyProjectVersionCreateRetiredBeforeDatabase(t *testing.T) {
	var adapter Adapter
	_, err := adapter.createProductVersion(context.Background(), "3", url.Values{}, map[string]any{"product_code": "P-A", "version_code": "v1"})
	var response httperror.Error
	if !errors.As(err, &response) || response.Status != http.StatusGone || response.Code != "legacy_product_version_create_retired" {
		t.Fatalf("legacy project version creation: %v", err)
	}
}
