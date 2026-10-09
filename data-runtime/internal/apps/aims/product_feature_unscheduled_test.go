package aims

import (
	"context"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"testing"
)

func TestFeatureUnscheduledRuntimeRejectsInsufficientCapabilityBeforeDatabase(t *testing.T) {
	var adapter Adapter
	for _, action := range []string{"view"} {
		for _, scope := range []string{"aims.read", "aims.write", "aims:product-features:*", "aims:product-requests:edit", "aims:product-features:edit"} {
			query := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {scope}}
			_, _, handled, err := adapter.handleProductFeatureUnscheduledRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-A/feature-unscheduled:"+action, query, nil)
			var result httperror.Error
			if !handled || !errors.As(err, &result) || result.Status != 403 {
				t.Fatalf("%s %s: %v", action, scope, err)
			}
		}
	}
}
