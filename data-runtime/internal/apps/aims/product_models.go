package aims

import (
	"context"
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleProductModelsRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	var code, action string
	for _, candidate := range []string{"list", "create", "rice-create", "cycle-select"} {
		if value, match := pathParam(path, "/v1/aims/internal/products/", "/priority-models:"+candidate); match {
			code, action = value, candidate
			break
		}
	}
	if action == "" {
		return nil, "", false, nil
	}
	operation := "aims.product-priority-models." + action
	capability := "aims:product-priorities:read"
	if action == "create" || action == "rice-create" {
		capability = "aims:product-priorities:model-create"
	}
	if action == "cycle-select" {
		capability = "aims:product-priorities:cycle-model-select"
	}
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, capability); err != nil {
		return nil, operation, true, err
	}
	var permit productcenter.AuthorizationPermit
	if err := decodeProductCommandPart(body["authorization"], &permit); err != nil {
		return nil, operation, true, err
	}
	if action != "list" {
		key, _ := body["idempotency_key"].(string)
		commandAction := "product_priorities:model-create"
		if action == "cycle-select" {
			commandAction = "product_priorities:cycle-model-select"
		}
		identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: commandAction, IdempotencyKey: key}
		if action == "rice-create" {
			var input productcenter.RICEModelCreate
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.CreateRICEModelVersion(ctx, a.DB(), identity, permit, input)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "create" {
			var input productcenter.WeightedModelCreate
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.CreateWeightedModelVersion(ctx, a.DB(), identity, permit, input)
			return result, operation, true, productRuntimeError(err)
		}
		var input productcenter.PlanningCycleModelSelect
		if err := decodeProductCommandPart(body["input"], &input); err != nil {
			return nil, operation, true, err
		}
		result, err := productcenter.SelectPlanningCycleModel(ctx, a.DB(), identity, permit, input)
		return result, operation, true, productRuntimeError(err)
	}
	var input struct {
		Page     int `json:"page"`
		PageSize int `json:"page_size"`
	}
	if err := decodeProductCommandPart(body["input"], &input); err != nil {
		return nil, operation, true, err
	}
	result, err := productcenter.ListPriorityModels(ctx, a.DB(), code, query.Get("current_user"), permit, input.Page, input.PageSize)
	return result, operation, true, productRuntimeError(err)
}
