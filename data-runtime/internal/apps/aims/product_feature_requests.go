package aims

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/http"
	"net/url"
)

func (a *Adapter) handleProductFeatureRequestsRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	for _, action := range []string{"list", "change"} {
		code, match := pathParam(path, "/v1/aims/internal/products/", "/feature-requests:"+action)
		if !match {
			continue
		}
		operation := "aims.product-features.requests-" + action
		if method != http.MethodPost {
			return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
		}
		capability := "aims:product-features:read"
		if action == "change" {
			capability = "aims:product-features:request-link"
		}
		if err := requireProductServiceCapability(query, capability); err != nil {
			return nil, operation, true, err
		}
		var requestPermit, featurePermit productcenter.AuthorizationPermit
		for _, part := range []struct {
			key    string
			target any
		}{{"request_authorization", &requestPermit}, {"feature_authorization", &featurePermit}} {
			if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
				return nil, operation, true, err
			}
		}
		if action == "list" {
			var input productcenter.FeatureRequestPageQuery
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ListFeatureRequests(ctx, a.DB(), code, query.Get("current_user"), requestPermit, featurePermit, input)
			return result, operation, true, productRuntimeError(err)
		}
		var input productcenter.FeatureRequestChange
		if err := decodeProductCommandPart(body["input"], &input); err != nil {
			return nil, operation, true, err
		}
		key, _ := body["idempotency_key"].(string)
		identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_features:request-link", IdempotencyKey: key}
		trusted := integrationoperation.TrustedContext{TenantCode: query.Get("hzy_runtime_tenant_code"), DeploymentCode: query.Get("hzy_runtime_deployment_code"), SourceApp: "aims", ServiceClientID: query.Get("hzy_runtime_service_client_id")}
		result, err := productcenter.ChangeFeatureRequest(ctx, a.DB(), identity, requestPermit, featurePermit, input, trusted)
		return result, operation, true, productRuntimeError(err)
	}
	return nil, "", false, nil
}
