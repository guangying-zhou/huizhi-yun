package aims

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleProductRequestCreateRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/requests:create")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-requests.create"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-requests:create"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.RequestDraft
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_requests:create", IdempotencyKey: key}
	result, err := productcenter.CreateProductRequest(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductRequestReadRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	for _, action := range []string{"list", "view"} {
		code, match := pathParam(path, "/v1/aims/internal/products/", "/requests:"+action)
		if !match {
			continue
		}
		operation := "aims.product-requests." + action
		if method != http.MethodPost {
			return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
		}
		if err := requireProductServiceCapability(query, "aims:product-requests:read"); err != nil {
			return nil, operation, true, err
		}
		var permit productcenter.AuthorizationPermit
		if err := decodeProductCommandPart(body["authorization"], &permit); err != nil {
			return nil, operation, true, err
		}
		if action == "list" {
			var input productcenter.RequestPageQuery
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ListProductRequests(ctx, a.DB(), code, query.Get("current_user"), permit, input)
			return result, operation, true, productRuntimeError(err)
		}
		var input struct {
			BizID string `json:"biz_id"`
		}
		if err := decodeProductCommandPart(body["input"], &input); err != nil {
			return nil, operation, true, err
		}
		result, err := productcenter.ReadProductRequest(ctx, a.DB(), code, query.Get("current_user"), input.BizID, permit)
		return result, operation, true, productRuntimeError(err)
	}
	return nil, "", false, nil
}

func (a *Adapter) handleProductRequestEditRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/requests:edit")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-requests.edit"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-requests:edit"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.RequestEdit
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_requests:edit", IdempotencyKey: key}
	result, err := productcenter.EditProductRequest(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductRequestDecisionRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/requests:decide")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-requests.decide"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-requests:decide"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.RequestDecision
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_requests:decide", IdempotencyKey: key}
	trusted := integrationoperation.TrustedContext{TenantCode: query.Get("hzy_runtime_tenant_code"), DeploymentCode: query.Get("hzy_runtime_deployment_code"), SourceApp: "aims", ServiceClientID: query.Get("hzy_runtime_service_client_id")}
	result, err := productcenter.DecideProductRequest(ctx, a.DB(), identity, permit, input, trusted)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductRequestSourcesRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/request-sources:list")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-requests.sources-list"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-requests:read"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.RequestSourcePageQuery
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.ListRequestSources(ctx, a.DB(), code, query.Get("current_user"), permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductRequestSourceCreateRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/request-sources:create")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-requests.source-create"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-requests:source-create"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.ManualRequestSource
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_requests:source-create", IdempotencyKey: key}
	result, err := productcenter.AddManualRequestSource(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductRequestSourceDeleteRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/request-sources:delete")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-requests.source-delete"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-requests:source-delete"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.RequestSourceDelete
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_requests:source-delete", IdempotencyKey: key}
	result, err := productcenter.DeleteManualRequestSource(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductRequestMergeRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/requests:merge")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-requests.merge"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-requests:merge"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.RequestMerge
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_requests:merge", IdempotencyKey: key}
	trusted := integrationoperation.TrustedContext{TenantCode: query.Get("hzy_runtime_tenant_code"), DeploymentCode: query.Get("hzy_runtime_deployment_code"), SourceApp: "aims", ServiceClientID: query.Get("hzy_runtime_service_client_id")}
	result, err := productcenter.MergeProductRequest(ctx, a.DB(), identity, permit, input, trusted)
	return result, operation, true, productRuntimeError(err)
}
