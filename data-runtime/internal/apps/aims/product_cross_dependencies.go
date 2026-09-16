package aims

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
)

func (a *Adapter) handleProductCrossDependenciesRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	for _, action := range []string{"list", "view", "targets", "create", "remove"} {
		code, match := pathParam(path, "/v1/aims/internal/products/", "/cross-dependencies:"+action)
		if !match {
			continue
		}
		operation := "aims.product-cross-dependencies." + action
		if method != http.MethodPost {
			return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
		}
		capability := "aims:product-priorities:read"
		if action == "create" || action == "remove" {
			capability = "aims:product-priorities:cross-dependency-" + action
		}
		if err := requireProductServiceCapability(query, capability); err != nil {
			return nil, operation, true, err
		}
		var source productcenter.AuthorizationPermit
		if err := decodeProductCommandPart(body["authorization"], &source); err != nil {
			return nil, operation, true, err
		}
		if action == "targets" {
			var input struct {
				ItemBizID string `json:"item_biz_id"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.DiscoverCrossDependencyTargets(ctx, a.DB(), code, query.Get("current_user"), input.ItemBizID, source)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "create" || action == "remove" {
			var target productcenter.AuthorizationPermit
			if err := decodeProductCommandPart(body["predecessor_authorization"], &target); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:cross-dependency-" + action, IdempotencyKey: key}
			if action == "create" {
				var input productcenter.CrossDependencyCreate
				if err := decodeProductCommandPart(body["input"], &input); err != nil {
					return nil, operation, true, err
				}
				result, err := productcenter.CreateCrossDependency(ctx, a.DB(), identity, source, target, input)
				return result, operation, true, productRuntimeError(err)
			}
			var input productcenter.CrossDependencyRemove
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.RemoveCrossDependency(ctx, a.DB(), identity, source, target, input)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "view" {
			var target productcenter.AuthorizationPermit
			if err := decodeProductCommandPart(body["predecessor_authorization"], &target); err != nil {
				return nil, operation, true, err
			}
			var input struct {
				BizID                  string `json:"biz_id"`
				PredecessorProductCode string `json:"predecessor_product_code"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ReadCrossDependency(ctx, a.DB(), code, input.PredecessorProductCode, query.Get("current_user"), input.BizID, source, target)
			return result, operation, true, productRuntimeError(err)
		}
		var targets map[string]productcenter.AuthorizationPermit
		if err := decodeProductCommandPart(body["predecessor_authorizations"], &targets); err != nil {
			return nil, operation, true, err
		}
		var input struct {
			ItemBizID string `json:"item_biz_id"`
			Page      int    `json:"page"`
			PageSize  int    `json:"page_size"`
		}
		if err := decodeProductCommandPart(body["input"], &input); err != nil {
			return nil, operation, true, err
		}
		result, err := productcenter.ListCrossDependencies(ctx, a.DB(), code, query.Get("current_user"), input.ItemBizID, source, targets, input.Page, input.PageSize)
		return result, operation, true, productRuntimeError(err)
	}
	return nil, "", false, nil
}
