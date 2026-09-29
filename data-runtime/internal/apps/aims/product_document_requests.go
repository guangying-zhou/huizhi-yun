package aims

import (
	"context"
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func (a *Adapter) handleProductDocumentRequestRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	outbox, outboxErr := a.enterpriseOutbox()
	if outboxErr != nil {
		return nil, "", true, outboxErr
	}
	action := "template-create"
	code, match := pathParam(path, "/v1/aims/internal/products/", "/documents:"+action)
	if !match {
		action = "link-created"
		code, match = pathParam(path, "/v1/aims/internal/products/", "/documents:"+action)
	}
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-documents." + action
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	// Both actions create an Aims document relationship. Codocs creation has its
	// own, separate capability checked by the target application.
	if err := requireProductServiceCapability(query, "aims:product-documents:create"); err != nil {
		return nil, operation, true, err
	}
	var permit productcenter.AuthorizationPermit
	if err := decodeProductCommandPart(body["authorization"], &permit); err != nil {
		return nil, operation, true, err
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_documents:" + action, IdempotencyKey: key}
	if action == "link-created" {
		var input productcenter.ProductDocumentRequestLink
		if err := decodeProductCommandPart(body["input"], &input); err != nil {
			return nil, operation, true, err
		}
		result, err := productcenter.LinkCreatedProductDocument(ctx, a.DB(), outbox, identity, permit, input)
		return result, operation, true, productRuntimeError(err)
	}
	var input productcenter.ProductDocumentRequestCreate
	if err := decodeProductCommandPart(body["input"], &input); err != nil {
		return nil, operation, true, err
	}
	// Auth middleware owns these query fields. Never accept caller body overrides.
	trusted := integrationoperation.TrustedContext{TenantCode: query.Get("hzy_runtime_tenant_code"), DeploymentCode: query.Get("hzy_runtime_deployment_code"), SourceApp: "aims", ServiceClientID: query.Get("hzy_runtime_service_client_id")}
	result, err := productcenter.CreateProductDocumentRequest(ctx, a.DB(), identity, permit, input, trusted)
	return result, operation, true, productRuntimeError(err)
}
