package aims

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
)

func (a *Adapter) handleProductPlanningCommentsRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	var code, action string
	for _, candidate := range []string{"history", "list", "create", "edit", "delete"} {
		if value, ok := pathParam(path, "/v1/aims/internal/products/", "/planning-comments:"+candidate); ok {
			code, action = value, candidate
			break
		}
	}
	if action == "" {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.comment-" + action
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	capability := "aims:product-priorities:comment"
	if action == "list" || action == "history" {
		capability = "aims:product-priorities:read"
	}
	if err := requireProductServiceCapability(query, capability); err != nil {
		return nil, operation, true, err
	}
	var permit productcenter.AuthorizationPermit
	if err := decodeProductCommandPart(body["authorization"], &permit); err != nil {
		return nil, operation, true, err
	}
	if action == "history" {
		var input struct {
			productcenter.PlanningCommentQuery
			CommentID int64 `json:"comment_id"`
		}
		if err := decodeProductCommandPart(body["input"], &input); err != nil {
			return nil, operation, true, err
		}
		result, err := productcenter.ReadPlanningCommentHistory(ctx, a.DB(), code, query.Get("current_user"), permit, input.PlanningCommentQuery, input.CommentID)
		return result, operation, true, productRuntimeError(err)
	}
	if action == "list" {
		var input productcenter.PlanningCommentQuery
		if err := decodeProductCommandPart(body["input"], &input); err != nil {
			return nil, operation, true, err
		}
		result, err := productcenter.ListPlanningComments(ctx, a.DB(), code, query.Get("current_user"), permit, input)
		return result, operation, true, productRuntimeError(err)
	}
	var input productcenter.PlanningCommentInput
	if err := decodeProductCommandPart(body["input"], &input); err != nil {
		return nil, operation, true, err
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:comment-" + action, IdempotencyKey: key}
	result, err := productcenter.ChangePlanningComment(ctx, a.DB(), identity, permit, action, input)
	return result, operation, true, productRuntimeError(err)
}
