package assets

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func (a *Adapter) handleProductAdoptionRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	if path != "/v1/assets/internal/product-adoption:read" {
		return nil, "", false, nil
	}
	operation := "assets.product_adoption.read"
	deny := func() (any, string, bool, error) {
		return nil, operation, true, httperror.New(403, "product_adoption_runtime_forbidden", "Trusted product adoption authorization is required")
	}
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	allowed := false
	for _, scope := range strings.Fields(query.Get("scope")) {
		if scope == productAdoptionReadCapability {
			allowed = true
		}
	}
	if !allowed {
		return deny()
	}
	envelope, command, err := integrationoperation.ReceiptCommandFromBody(body, "assets", productAdoptionReadOperation, productAdoptionReadCapability)
	if err != nil {
		return deny()
	}
	input, err := parseProductAdoptionReadCommand(command)
	if err != nil {
		return nil, operation, true, err
	}
	if envelope.CommandSchemaVersion != productAdoptionReadOperation || envelope.TrustedContext.SourceApp != "aims" || envelope.TrustedContext.ServiceClientID != "aims.runtime" || query.Get("runtime_source_app") != "assets" || query.Get("tenant") != envelope.TrustedContext.TenantCode || query.Get("deployment") != envelope.TargetDeploymentCode || query.Get("current_user") != input.ActorUID || query.Get("hzy_runtime_actor_delegated") != "1" || query.Get("hzy_runtime_actor_purpose") != "service-command" {
		return deny()
	}
	// This authorization is produced by Assets BFF after fresh Console queries;
	// it is not part of the source AIMS command or accepted from the browser.
	authorization, valid := body["productAdoptionAuthorization"].(map[string]any)
	if !valid {
		return deny()
	}
	expiresAt, valid := authorization["expiresAt"].(float64)
	now := float64(time.Now().UnixMilli())
	if !valid || expiresAt <= now || expiresAt > now+30000 {
		return deny()
	}
	scopes := make([]url.Values, 0, 2)
	for _, key := range []string{"delivery", "environment"} {
		fields, valid := authorization[key].(map[string]any)
		if !valid {
			return deny()
		}
		values := url.Values{}
		for _, name := range []string{"current_user", assetsObjectAccessQueryKey, assetsScopeUnitsQueryKey} {
			if value, ok := fields[name].(string); ok {
				values.Set(name, value)
			}
		}
		if values.Get("current_user") != input.ActorUID {
			return deny()
		}
		scopes = append(scopes, values)
	}
	result, err := readProductAdoption(ctx, a.DB(), input.ProductCode, scopes[0], scopes[1], input.Page, input.PageSize)
	if err != nil {
		return nil, operation, true, err
	}
	return ok(result), operation, true, nil
}
