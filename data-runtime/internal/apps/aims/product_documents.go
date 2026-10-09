package aims

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
)

func (a *Adapter) handleProductDocumentReadRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	outbox, outboxErr := a.enterpriseOutbox()
	if outboxErr != nil {
		return nil, "", true, outboxErr
	}
	code, match := pathParam(path, "/v1/aims/internal/products/", "/documents:list")
	detail := false
	requestDetail := false
	requestList := false
	if !match {
		code, match = pathParam(path, "/v1/aims/internal/products/", "/documents:view")
		detail = match
	}
	if !match {
		code, match = pathParam(path, "/v1/aims/internal/products/", "/documents:request-view")
		requestDetail = match
	}
	if !match {
		code, match = pathParam(path, "/v1/aims/internal/products/", "/documents:requests-list")
		requestList = match
	}
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-documents.list"
	if requestList {
		operation = "aims.product-documents.requests-list"
	}
	if requestDetail {
		operation = "aims.product-documents.request-view"
	}
	if detail {
		operation = "aims.product-documents.view"
	}
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-documents:read"); err != nil {
		return nil, operation, true, err
	}
	if requestList {
		var input productcenter.PlanningPageQuery
		var permit productcenter.AuthorizationPermit
		if err := decodeProductCommandPart(body["input"], &input); err != nil {
			return nil, operation, true, err
		}
		if err := decodeProductCommandPart(body["authorization"], &permit); err != nil {
			return nil, operation, true, err
		}
		result, err := productcenter.ListProductDocumentRequests(ctx, a.DB(), outbox, code, query.Get("current_user"), permit, input)
		return result, operation, true, productRuntimeError(err)
	}
	if detail || requestDetail {
		var input struct {
			BizID string `json:"biz_id"`
		}
		var permit productcenter.AuthorizationPermit
		if err := decodeProductCommandPart(body["input"], &input); err != nil {
			return nil, operation, true, err
		}
		if err := decodeProductCommandPart(body["authorization"], &permit); err != nil {
			return nil, operation, true, err
		}
		if requestDetail {
			result, err := productcenter.ReadProductDocumentRequest(ctx, a.DB(), outbox, code, query.Get("current_user"), input.BizID, permit)
			return result, operation, true, productRuntimeError(err)
		}
		result, err := productcenter.ReadProductDocument(ctx, a.DB(), code, query.Get("current_user"), input.BizID, permit)
		return result, operation, true, productRuntimeError(err)
	}
	var input productcenter.ProductDocumentQuery
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.ListProductDocuments(ctx, a.DB(), code, query.Get("current_user"), permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductDocumentRemoveRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/documents:remove")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-documents.remove"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-documents:remove"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.ProductDocumentTransition
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
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_documents:remove", IdempotencyKey: key}
	result, err := productcenter.TransitionProductDocument(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductDocumentPurposeRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/documents:edit")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-documents.edit"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-documents:edit"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.ProductDocumentPurposeChange
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
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_documents:edit", IdempotencyKey: key}
	result, err := productcenter.ChangeProductDocumentPurpose(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductDocumentRestoreRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/documents:restore")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-documents.restore"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-documents:restore"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.ProductDocumentTransition
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
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_documents:restore", IdempotencyKey: key}
	result, err := productcenter.TransitionProductDocument(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductDocumentCreateRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/documents:create")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-documents.create"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-documents:create"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.ProductDocumentCreate
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
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_documents:create", IdempotencyKey: key}
	result, err := productcenter.CreateProductDocument(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}
