package aims

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
)

func (a *Adapter) handleProductFeatureUnscheduledRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/feature-unscheduled:view")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.feature-unscheduled"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:read"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.FeatureUnscheduledQuery
	var planningPermit, featurePermit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"planning_authorization", &planningPermit}, {"feature_authorization", &featurePermit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.ListFeatureUnscheduled(ctx, a.DB(), code, query.Get("current_user"), planningPermit, featurePermit, input)
	return result, operation, true, productRuntimeError(err)
}
