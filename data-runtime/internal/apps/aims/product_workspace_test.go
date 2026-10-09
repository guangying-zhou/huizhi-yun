package aims

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestWorkspaceRoutesRequireOwnCapabilityBeforeDatabase(t *testing.T) {
	var adapter Adapter
	for _, action := range []string{"view", "edit", "archive", "restore"} {
		query := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:products:authorization-object"}}
		_, _, handled, err := adapter.handleProductWorkspaceRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-A/workspace:"+action, query, nil)
		var httpErr httperror.Error
		if !handled || !errors.As(err, &httpErr) || httpErr.Code != "insufficient_scope" {
			t.Fatalf("%s: %v", action, err)
		}
	}
}

func TestProductCommandDecoderRejectsUnknownFieldsAndWrongTypes(t *testing.T) {
	for _, input := range []any{nil, map[string]any{"expected_revision": 1, "status": "active"}, map[string]any{"expected_revision": "1"}, map[string]any{"expected_revision": 1.5}} {
		var change productcenter.WorkspaceChange
		if err := decodeProductCommandPart(input, &change); err == nil {
			t.Fatalf("accepted %#v", input)
		}
	}
}

func TestProductVersionOwnerErrorContract(t *testing.T) {
	for code, want := range map[string]int{
		"product_version_owner_required":    http.StatusConflict,
		"product_version_owner_unavailable": http.StatusConflict,
		"product_version_owner_invalid":     http.StatusBadRequest,
		"product_authorization_invalid":     http.StatusForbidden,
	} {
		err := productRuntimeError(&productcenter.RuleError{Code: code, Message: "请重新确认负责人"})
		var response httperror.Error
		if !errors.As(err, &response) || response.Status != want || response.Code != code || response.Message != "请重新确认负责人" {
			t.Fatalf("%s: %#v", code, err)
		}
	}
}
