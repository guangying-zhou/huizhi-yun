package aims

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
)

func (a *Adapter) handleProductCenterObjectivesRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	for _, action := range []string{"item-objectives", "list", "view", "cycles", "items", "observations", "create", "edit", "item-link", "cycle-map", "cycle-revoke", "observe", "activate", "close", "reopen", "archive"} {
		code, match := pathParam(path, "/v1/aims/internal/products/", "/objectives:"+action)
		if !match {
			continue
		}
		operation := "aims.product-objectives." + action
		if method != http.MethodPost {
			return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
		}
		capability := "aims:product-objectives:" + action
		if action == "item-objectives" || action == "list" || action == "view" || action == "observations" || action == "items" || action == "cycles" {
			capability = "aims:product-objectives:read"
		}
		if err := requireProductServiceCapability(query, capability); err != nil {
			return nil, operation, true, err
		}
		var permit productcenter.AuthorizationPermit
		if err := decodeProductCommandPart(body["authorization"], &permit); err != nil {
			return nil, operation, true, err
		}
		key, _ := body["idempotency_key"].(string)
		identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_objectives:" + action, IdempotencyKey: key}
		switch action {
		case "item-objectives":
			var planningPermit productcenter.AuthorizationPermit
			if err := decodeProductCommandPart(body["planning_authorization"], &planningPermit); err != nil {
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
			result, err := productcenter.ListPlanningItemObjectives(ctx, a.DB(), code, identity.ActorUID, permit, planningPermit, input.ItemBizID, input.Page, input.PageSize)
			return result, operation, true, productRuntimeError(err)
		case "list":
			var input struct {
				Status   string `json:"status"`
				Page     int    `json:"page"`
				PageSize int    `json:"page_size"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ListProductObjectives(ctx, a.DB(), code, identity.ActorUID, permit, input.Status, input.Page, input.PageSize)
			return result, operation, true, productRuntimeError(err)
		case "create":
			var input productcenter.ProductObjectiveDraft
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.CreateProductObjective(ctx, a.DB(), identity, permit, input)
			return result, operation, true, productRuntimeError(err)
		case "cycle-map":
			var input productcenter.ProductObjectiveCycleMap
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.MapProductObjectiveCycle(ctx, a.DB(), identity, permit, input)
			return result, operation, true, productRuntimeError(err)
		case "cycle-revoke":
			var input productcenter.ProductObjectiveCycleRevoke
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.RevokeProductObjectiveCycle(ctx, a.DB(), identity, permit, input)
			return result, operation, true, productRuntimeError(err)
		case "item-link":
			var input productcenter.ProductObjectiveItemLink
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.LinkProductObjectiveItem(ctx, a.DB(), identity, permit, input)
			return result, operation, true, productRuntimeError(err)
		case "edit":
			var input productcenter.ProductObjectiveEdit
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.EditProductObjective(ctx, a.DB(), identity, permit, input)
			return result, operation, true, productRuntimeError(err)
		case "observe":
			var input productcenter.ProductObjectiveObservation
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.CreateProductObjectiveObservation(ctx, a.DB(), identity, permit, input)
			return result, operation, true, productRuntimeError(err)
		case "activate", "close", "reopen", "archive":
			var input productcenter.ProductObjectiveTransition
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			if input.Action != action {
				return nil, operation, true, httperror.New(400, "product_command_identity_invalid", "目标状态动作须与路由一致")
			}
			result, err := productcenter.TransitionProductObjective(ctx, a.DB(), identity, permit, input)
			return result, operation, true, productRuntimeError(err)
		case "observations", "items", "cycles":
			var input struct {
				ObjectiveID int64 `json:"objective_id"`
				Page        int   `json:"page"`
				PageSize    int   `json:"page_size"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			if action == "cycles" {
				result, err := productcenter.ListProductObjectiveCycles(ctx, a.DB(), code, identity.ActorUID, permit, input.ObjectiveID, input.Page, input.PageSize)
				return result, operation, true, productRuntimeError(err)
			}
			if action == "items" {
				result, err := productcenter.ListProductObjectiveItems(ctx, a.DB(), code, identity.ActorUID, permit, input.ObjectiveID, input.Page, input.PageSize)
				return result, operation, true, productRuntimeError(err)
			}
			result, err := productcenter.ListProductObjectiveObservations(ctx, a.DB(), code, identity.ActorUID, permit, input.ObjectiveID, input.Page, input.PageSize)
			return result, operation, true, productRuntimeError(err)
		case "view":
			var input struct {
				ID int64 `json:"id"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.GetProductObjective(ctx, a.DB(), code, identity.ActorUID, permit, input.ID)
			return result, operation, true, productRuntimeError(err)
		}
	}
	return nil, "", false, nil
}
