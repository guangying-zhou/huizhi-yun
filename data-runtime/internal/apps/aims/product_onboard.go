package aims

import (
	"context"
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleProductOnboardRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/onboard")
	line := path == "/v1/aims/internal/product-line-onboard"
	if !match && !line {
		return nil, "", false, nil
	}
	operation := "aims.products.onboard"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:products:onboard"); err != nil {
		return nil, operation, true, err
	}
	if line {
		var input productcenter.LineOnboardInput
		var permit productcenter.OnboardPermit
		var source productcenter.LineSourceEvidence
		var directory productcenter.MemberDirectoryEvidence
		for _, part := range []struct {
			key    string
			target any
		}{{"input", &input}, {"authorization", &permit}, {"source", &source}, {"directory", &directory}} {
			if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
				return nil, operation, true, err
			}
		}
		key, _ := body["idempotency_key"].(string)
		identity := productcenter.CommandIdentity{ProductCode: productcenter.LineWorkspaceCode(input.LineCode), ActorUID: query.Get("current_user"), Action: "products:onboard-line", IdempotencyKey: key}
		result, err := productcenter.OnboardProductLine(ctx, a.DB(), identity, permit, source, directory, input)
		return result, "aims.products.onboard-line", true, productRuntimeError(err)
	}
	var input productcenter.OnboardInput
	var permit productcenter.OnboardPermit
	var source productcenter.OnboardSourceEvidence
	var directory productcenter.MemberDirectoryEvidence
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}, {"source", &source}, {"directory", &directory}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "products:onboard", IdempotencyKey: key}
	result, err := productcenter.OnboardWorkspace(ctx, a.DB(), identity, permit, source, directory, input)
	return result, operation, true, productRuntimeError(err)
}
