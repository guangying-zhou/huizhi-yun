package aims

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
)

func (a *Adapter) handleProductSavedViewsRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	for _, action := range []string{"list", "view", "apply", "create", "update", "delete"} {
		code, match := pathParam(path, "/v1/aims/internal/products/", "/roadmap-views:"+action)
		if !match {
			continue
		}
		operation := "aims.product-roadmap-views." + action
		if method != http.MethodPost {
			return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
		}
		capability := "aims:product-roadmaps:read"
		if action == "create" || action == "update" || action == "delete" {
			capability = "aims:product-roadmaps:view-" + action
		}
		if err := requireProductServiceCapability(query, capability); err != nil {
			return nil, operation, true, err
		}
		var planning, roadmap productcenter.AuthorizationPermit
		if err := decodeProductCommandPart(body["planning_authorization"], &planning); err != nil {
			return nil, operation, true, err
		}
		if err := decodeProductCommandPart(body["authorization"], &roadmap); err != nil {
			return nil, operation, true, err
		}
		uid := query.Get("current_user")
		if action == "create" {
			var input productcenter.RoadmapSavedViewCreate
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: uid, Action: "product_roadmaps:view-create", IdempotencyKey: key}
			result, err := productcenter.CreateRoadmapSavedView(ctx, a.DB(), identity, planning, roadmap, input)
			return result, operation, true, productRuntimeError(err)
		}

		if action == "update" {
			var input productcenter.RoadmapSavedViewUpdate
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: uid, Action: "product_roadmaps:view-update", IdempotencyKey: key}
			result, err := productcenter.UpdateRoadmapSavedView(ctx, a.DB(), identity, planning, roadmap, input)
			return result, operation, true, productRuntimeError(err)
		}

		if action == "delete" {
			var input productcenter.RoadmapSavedViewDelete
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: uid, Action: "product_roadmaps:view-delete", IdempotencyKey: key}
			result, err := productcenter.DeleteRoadmapSavedView(ctx, a.DB(), identity, planning, roadmap, input)
			return result, operation, true, productRuntimeError(err)
		}

		if action == "view" {
			var input struct {
				BizID string `json:"biz_id"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ReadRoadmapSavedView(ctx, a.DB(), code, uid, input.BizID, planning, roadmap)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "list" {
			var input struct {
				Page     int `json:"page"`
				PageSize int `json:"page_size"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ListRoadmapSavedViews(ctx, a.DB(), code, uid, planning, roadmap, input.Page, input.PageSize)
			return result, operation, true, productRuntimeError(err)
		}
		var input struct {
			BizID    string `json:"biz_id"`
			Page     int    `json:"page"`
			PageSize int    `json:"page_size"`
		}
		if err := decodeProductCommandPart(body["input"], &input); err != nil {
			return nil, operation, true, err
		}
		result, err := productcenter.ApplyRoadmapSavedView(ctx, a.DB(), code, uid, input.BizID, planning, roadmap, input.Page, input.PageSize)
		return result, operation, true, productRuntimeError(err)
	}
	return nil, "", false, nil
}
