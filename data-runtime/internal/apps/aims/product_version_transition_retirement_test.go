package aims

import (
	"context"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"testing"
)

func TestLegacyVersionTransitionsRetiredBeforeDatabase(t *testing.T) {
	var adapter Adapter
	for _, path := range []string{"/v1/aims/admin/product-versions/1/transition", "/v1/aims/projects/2/releases/1/transition"} {
		for _, status := range []string{"planning", "developing", "released", "archived"} {
			_, _, handled, err := adapter.handleProductVersionRuntime(context.Background(), http.MethodPost, path, url.Values{"current_user": {"admin"}}, map[string]any{"to_status": status, "is_admin": true})
			var domain httperror.Error
			if !handled || !errors.As(err, &domain) || domain.Status != http.StatusGone {
				t.Fatalf("old transition %s %s: %v", path, status, err)
			}
		}
	}
}

func TestLegacyAdminVersionCreationRetiredBeforeDatabase(t *testing.T) {
	var adapter Adapter
	for _, status := range []string{"planning", "developing", "released", "archived"} {
		_, err := adapter.adminCreateProductVersion(context.Background(), "P-A", url.Values{"current_user": {"admin"}, "current_user_is_project_admin": {"1"}}, map[string]any{"version_code": "v1", "status": status})
		var domain httperror.Error
		if !errors.As(err, &domain) || domain.Status != http.StatusGone || domain.Code != "legacy_product_version_create_retired" {
			t.Fatalf("legacy create status %s: %v", status, err)
		}
	}
}

func TestLegacyAdminVersionEditRetiredBeforeDatabase(t *testing.T) {
	var adapter Adapter
	_, err := adapter.adminUpdateProductVersion(context.Background(), "12", url.Values{}, map[string]any{"name": "changed"})
	var result httperror.Error
	if !errors.As(err, &result) || result.Status != http.StatusGone || result.Code != "legacy_product_version_edit_retired" {
		t.Fatalf("legacy edit: %v", err)
	}
}

func TestLegacyVersionWritesRetiredThroughRouter(t *testing.T) {
	var adapter Adapter
	for _, tc := range []struct{ method, path, action string }{
		{http.MethodPost, "/v1/aims/admin/products/P-A/versions", "create"},
		{http.MethodPost, "/v1/aims/projects/3/releases", "create"},
		{http.MethodPut, "/v1/aims/admin/product-versions/12", "edit"},
		{http.MethodPatch, "/v1/aims/admin/product-versions/12", "edit"},
		{http.MethodPut, "/v1/aims/projects/3/releases/12", "edit"},
		{http.MethodPatch, "/v1/aims/projects/3/releases/12", "edit"},
		{http.MethodDelete, "/v1/aims/admin/product-versions/12", "delete"},
		{http.MethodDelete, "/v1/aims/projects/3/releases/12", "delete"},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			_, _, handled, err := adapter.handleProductVersionRuntime(context.Background(), tc.method, tc.path, url.Values{"current_user": {"admin"}}, map[string]any{"name": "changed", "is_admin": true})
			var result httperror.Error
			if !handled || !errors.As(err, &result) || result.Status != http.StatusGone || result.Code != "legacy_product_version_"+tc.action+"_retired" {
				t.Fatalf("legacy route: handled=%v err=%v", handled, err)
			}
		})
	}
}

func TestLegacyScopeCreateRetiredThroughRouter(t *testing.T) {
	var adapter Adapter
	for _, path := range []string{"/v1/aims/projects/3/releases/12/features", "/v1/aims/admin/product-versions/12/features"} {
		_, _, handled, err := adapter.handleProductVersionRuntime(context.Background(), http.MethodPost, path, url.Values{"current_user": {"admin"}}, map[string]any{"title": "unscored", "is_admin": true})
		var result httperror.Error
		if !handled || !errors.As(err, &result) || result.Status != http.StatusGone || result.Code != "legacy_product_version_scope_create_retired" {
			t.Fatalf("legacy scope route %s: %v %v", path, handled, err)
		}
	}
}

func TestLegacyScopeEditRetiredThroughRouter(t *testing.T) {
	var adapter Adapter
	for _, path := range []string{"/v1/aims/projects/3/releases/12/features/7", "/v1/aims/admin/product-versions/12/features/7"} {
		for _, method := range []string{http.MethodPut, http.MethodPatch} {
			_, _, handled, err := adapter.handleProductVersionRuntime(context.Background(), method, path, url.Values{"current_user": {"admin"}}, map[string]any{"is_public": true, "status": "delivered", "is_admin": true})
			var result httperror.Error
			if !handled || !errors.As(err, &result) || result.Status != http.StatusGone || result.Code != "legacy_product_version_scope_edit_retired" {
				t.Fatalf("legacy edit %s %s: %v %v", method, path, handled, err)
			}
		}
	}
}

func TestLegacyScopeDeleteRetiredThroughRouter(t *testing.T) {
	var adapter Adapter
	for _, path := range []string{"/v1/aims/projects/3/releases/12/features/7", "/v1/aims/admin/product-versions/12/features/7"} {
		_, _, handled, err := adapter.handleProductVersionRuntime(context.Background(), http.MethodDelete, path, url.Values{"current_user": {"admin"}, "current_user_is_project_admin": {"1"}}, nil)
		var result httperror.Error
		if !handled || !errors.As(err, &result) || result.Status != http.StatusGone || result.Code != "legacy_product_version_scope_delete_retired" {
			t.Fatalf("legacy delete %s: %v %v", path, handled, err)
		}
	}
}
