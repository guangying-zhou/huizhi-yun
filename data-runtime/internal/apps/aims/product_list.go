package aims

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
)

func (a *Adapter) handleProductListRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	if path != "/v1/aims/internal/product-list" {
		return nil, "", false, nil
	}
	operation := "aims.products.list"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:products:view"); err != nil {
		return nil, operation, true, err
	}
	var permit productcenter.ProductListPermit
	var input productcenter.ProductListQuery
	if err := decodeProductCommandPart(body["authorization"], &permit); err != nil {
		return nil, operation, true, err
	}
	if err := decodeProductCommandPart(body["input"], &input); err != nil {
		return nil, operation, true, err
	}
	result, err := productcenter.ListProducts(ctx, a.DB(), query.Get("current_user"), permit, input)
	return result, operation, true, productRuntimeError(err)
}
