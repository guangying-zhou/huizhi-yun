package aims

import (
	"context"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"testing"
)

func TestCatalogRefreshCommandsRequireExplicitOnboardServiceCapability(t *testing.T) {
	var a Adapter
	for _, action := range []string{"start", "view", "append", "fail"} {
		q := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:products:admin"}}
		_, _, handled, err := a.handleCatalogRefreshRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/product-catalog/"+action, q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Code != "insufficient_scope" {
			t.Fatalf("%s %v", action, err)
		}
	}
}
