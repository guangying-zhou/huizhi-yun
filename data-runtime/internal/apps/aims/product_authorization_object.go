package aims

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Internal capability supplies only the signed actor's relationship facts to
// the AIMS BFF. It grants no product action and is not a browser-facing API.
func (a *Adapter) handleProductAuthorizationRuntime(ctx context.Context, method, path string, query url.Values) (any, string, bool, error) {
	code, matched := pathParam(path, "/v1/aims/internal/products/", "/authorization-object")
	if !matched {
		return nil, "", false, nil
	}
	const operation = "aims.products.authorization_object"
	if method != http.MethodGet {
		return nil, operation, true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "GET required")
	}
	if err := requireProductAuthorizationService(query); err != nil {
		return nil, operation, true, err
	}
	facts, err := productcenter.LoadAuthorizationFacts(ctx, a.DB(), code, query.Get("current_user"))
	return facts, operation, true, productRuntimeError(err)
}

func requireProductAuthorizationService(query url.Values) error {
	return requireProductServiceCapability(query, "aims:products:authorization-object")
}

func requireProductServiceCapability(query url.Values, capability string) error {
	if err := requireCurrentUser(query); err != nil {
		return err
	}
	if query.Get("hzy_runtime_actor_delegated") != "1" || query.Get("hzy_runtime_actor_purpose") != "" || query.Get("current_user") == query.Get("hzy_runtime_service_client_id") {
		return httperror.New(http.StatusForbidden, "product_user_actor_required", "signed user actor required")
	}
	if query.Get("hzy_runtime_source_app") != "aims" || strings.TrimSpace(query.Get("hzy_runtime_tenant_code")) == "" || strings.TrimSpace(query.Get("hzy_runtime_deployment_code")) == "" || strings.TrimSpace(query.Get("hzy_runtime_service_client_id")) == "" {
		return httperror.New(http.StatusForbidden, "product_authorization_context_required", "trusted AIMS service context required")
	}
	for _, scope := range strings.Fields(query.Get("current_user_scopes")) {
		if scope == capability {
			return nil
		}
	}
	return httperror.New(http.StatusForbidden, "insufficient_scope", "product authorization capability required")
}
