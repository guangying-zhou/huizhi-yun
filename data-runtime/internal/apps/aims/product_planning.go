package aims

import (
	"context"
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleProductPlanningCreateRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-items:create")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.create"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:create"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningItemDraft
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
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:create", IdempotencyKey: key}
	result, err := productcenter.CreatePlanningItem(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningListRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-items:list")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.list"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:read"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningPageQuery
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.ListPlanningItems(ctx, a.DB(), code, query.Get("current_user"), permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningViewRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-items:view")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.view"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:read"); err != nil {
		return nil, operation, true, err
	}
	var input struct {
		BizID string `json:"biz_id"`
	}
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.ReadPlanningItem(ctx, a.DB(), code, query.Get("current_user"), input.BizID, permit)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningEditRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-items:edit")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.edit"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:edit"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningItemEdit
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
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:edit", IdempotencyKey: key}
	result, err := productcenter.EditPlanningItem(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}
