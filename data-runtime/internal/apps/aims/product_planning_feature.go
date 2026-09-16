package aims

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
)

func (a *Adapter) handleProductPlanningFeatureRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	for _, action := range []string{"view", "change"} {
		code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-feature:"+action)
		if !match {
			continue
		}
		operation := "aims.product-priorities.feature-" + action
		if method != http.MethodPost {
			return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
		}
		capability := "aims:product-priorities:read"
		if action == "change" {
			capability = "aims:product-priorities:feature-link"
		}
		if err := requireProductServiceCapability(query, capability); err != nil {
			return nil, operation, true, err
		}
		var planningPermit, featurePermit productcenter.AuthorizationPermit
		for _, part := range []struct {
			key    string
			target any
		}{{"planning_authorization", &planningPermit}, {"feature_authorization", &featurePermit}} {
			if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
				return nil, operation, true, err
			}
		}
		if action == "view" {
			var input struct {
				ItemBizID string `json:"item_biz_id"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ReadPlanningFeature(ctx, a.DB(), code, query.Get("current_user"), input.ItemBizID, planningPermit, featurePermit)
			return result, operation, true, productRuntimeError(err)
		}
		var input productcenter.PlanningFeatureChange
		if err := decodeProductCommandPart(body["input"], &input); err != nil {
			return nil, operation, true, err
		}
		key, _ := body["idempotency_key"].(string)
		identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:feature-link", IdempotencyKey: key}
		result, err := productcenter.ChangePlanningFeature(ctx, a.DB(), identity, planningPermit, featurePermit, input)
		return result, operation, true, productRuntimeError(err)
	}
	return nil, "", false, nil
}
