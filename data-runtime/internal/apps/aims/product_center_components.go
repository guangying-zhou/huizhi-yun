package aims

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
)

func (a *Adapter) handleProductCenterComponentsRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	for _, action := range []string{"list", "create", "move", "edit", "delete"} {
		code, match := pathParam(path, "/v1/aims/internal/products/", "/components:"+action)
		if !match {
			continue
		}
		operation := "aims.product-components." + action
		if method != http.MethodPost {
			return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
		}
		capability := "aims:product-components:" + action
		if action == "list" {
			capability = "aims:product-components:read"
		}
		if err := requireProductServiceCapability(query, capability); err != nil {
			return nil, operation, true, err
		}
		var permit productcenter.AuthorizationPermit
		if err := decodeProductCommandPart(body["authorization"], &permit); err != nil {
			return nil, operation, true, err
		}
		key, _ := body["idempotency_key"].(string)
		identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_components:" + action, IdempotencyKey: key}
		switch action {
		case "list":
			var input struct {
				ParentID *int64 `json:"parent_id"`
				Page     int    `json:"page"`
				PageSize int    `json:"page_size"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ListProductComponents(ctx, a.DB(), code, identity.ActorUID, permit, input.ParentID, input.Page, input.PageSize)
			return result, operation, true, productRuntimeError(err)
		case "create":
			var input productcenter.ProductComponentDraft
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.CreateProductComponent(ctx, a.DB(), identity, permit, input)
			return result, operation, true, productRuntimeError(err)
		case "delete":
			var input productcenter.ProductComponentDelete
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.DeleteProductComponent(ctx, a.DB(), identity, permit, input)
			return result, operation, true, productRuntimeError(err)
		case "edit":
			var input productcenter.ProductComponentEdit
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.EditProductComponent(ctx, a.DB(), identity, permit, input)
			return result, operation, true, productRuntimeError(err)
		case "move":
			var input productcenter.ProductComponentMove
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.MoveProductComponent(ctx, a.DB(), identity, permit, input)
			return result, operation, true, productRuntimeError(err)
		}
	}
	return nil, "", false, nil
}
