package aims

import (
	"context"
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleProductFeatureCreateRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/features:create")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-features.create"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-features:create"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.FeatureDraft
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
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_features:create", IdempotencyKey: key}
	result, err := productcenter.CreateProductFeature(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductFeatureReadRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	for _, action := range []string{"list", "view", "version-matrix"} {
		code, match := pathParam(path, "/v1/aims/internal/products/", "/features:"+action)
		if !match {
			continue
		}
		operation := "aims.product-features." + action
		if method != http.MethodPost {
			return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
		}
		if err := requireProductServiceCapability(query, "aims:product-features:read"); err != nil {
			return nil, operation, true, err
		}
		var permit productcenter.AuthorizationPermit
		if err := decodeProductCommandPart(body["authorization"], &permit); err != nil {
			return nil, operation, true, err
		}
		if action == "version-matrix" {
			var versionPermit productcenter.AuthorizationPermit
			var input productcenter.FeatureVersionMatrixQuery
			if err := decodeProductCommandPart(body["version_authorization"], &versionPermit); err != nil {
				return nil, operation, true, err
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ReadFeatureVersionMatrix(ctx, a.DB(), code, query.Get("current_user"), permit, versionPermit, input)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "list" {
			var input productcenter.FeaturePageQuery
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ListProductFeatures(ctx, a.DB(), code, query.Get("current_user"), permit, input)
			return result, operation, true, productRuntimeError(err)
		}
		var input struct {
			BizID string `json:"biz_id"`
		}
		if err := decodeProductCommandPart(body["input"], &input); err != nil {
			return nil, operation, true, err
		}
		result, err := productcenter.ReadProductFeature(ctx, a.DB(), code, query.Get("current_user"), input.BizID, permit)
		return result, operation, true, productRuntimeError(err)
	}
	return nil, "", false, nil
}
func (a *Adapter) handleProductFeatureEditRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/features:edit")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-features.edit"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-features:edit"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.FeatureEdit
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
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_features:edit", IdempotencyKey: key}
	result, err := productcenter.EditProductFeature(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductFeatureDeleteRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/features:delete")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-features.delete"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-features:delete"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.FeatureDelete
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
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_features:delete", IdempotencyKey: key}
	result, err := productcenter.DeleteProductFeature(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductFeatureLifecycleRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/features:lifecycle")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-features.lifecycle"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-features:lifecycle"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.FeatureLifecycleChange
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
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_features:lifecycle", IdempotencyKey: key}
	result, err := productcenter.ChangeFeatureLifecycle(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductFeatureComponentRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/features:component-assign")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-features.component-assign"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-features:component-assign"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.FeatureComponentAssignment
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
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_features:component-assign", IdempotencyKey: key}
	result, err := productcenter.AssignProductFeatureComponent(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}
