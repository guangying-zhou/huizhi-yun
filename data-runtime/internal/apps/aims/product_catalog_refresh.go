package aims

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleCatalogRefreshRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	prefix := "/v1/aims/internal/product-catalog/"
	if !strings.HasPrefix(path, prefix) {
		return nil, "", false, nil
	}
	action := strings.TrimPrefix(path, prefix)
	operation := "aims.products.catalog." + action
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:products:onboard"); err != nil {
		return nil, operation, true, err
	}
	var permit productcenter.CatalogPermit
	if err := decodeProductCommandPart(body["authorization"], &permit); err != nil {
		return nil, operation, true, err
	}
	var input struct {
		RefreshID        string `json:"refresh_id"`
		ExpectedRevision uint64 `json:"expected_revision"`
	}
	if err := decodeProductCommandPart(body["input"], &input); err != nil {
		return nil, operation, true, err
	}
	uid := query.Get("current_user")
	var result productcenter.CatalogRefresh
	var err error
	switch action {
	case "start":
		key, _ := body["idempotency_key"].(string)
		result, err = productcenter.StartCatalogRefresh(ctx, a.DB(), uid, key, permit)
	case "view":
		result, err = productcenter.ReadCatalogRefresh(ctx, a.DB(), uid, input.RefreshID, permit)
	case "fail":
		result, err = productcenter.FailCatalogRefresh(ctx, a.DB(), uid, input.RefreshID, permit)
	case "append":
		var page productcenter.CatalogSourcePage
		if err := decodeProductCommandPart(body["page"], &page); err != nil {
			return nil, operation, true, err
		}
		result, err = productcenter.AppendCatalogPage(ctx, a.DB(), uid, input.RefreshID, permit, input.ExpectedRevision, page)
	default:
		return nil, operation, true, httperror.New(404, "not_found", "unknown catalog command")
	}
	return result, operation, true, productRuntimeError(err)
}
