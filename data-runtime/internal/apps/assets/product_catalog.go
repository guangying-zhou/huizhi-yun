package assets

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type ProductCatalogItem struct {
	ProductCode          string  `json:"product_code"`
	ProductName          string  `json:"product_name"`
	ProductLine          string  `json:"product_line"`
	ProductLineLabel     *string `json:"product_line_label"`
	ProductLineSortOrder *int    `json:"product_line_sort_order"`
	Status               string  `json:"source_status"`
	BusinessOwnerUID     *string `json:"business_owner_uid"`
	TechnicalOwnerUID    *string `json:"technical_owner_uid"`
	SourceUpdatedAt      string  `json:"source_updated_at"`
	Onboardable          bool    `json:"onboardable"`
}
type ProductCatalogPage struct {
	Items     []ProductCatalogItem `json:"items"`
	Total     int64                `json:"total"`
	Page      int                  `json:"page"`
	PageSize  int                  `json:"pageSize"`
	Watermark string               `json:"watermark"`
	NextPage  *int                 `json:"nextPage"`
}

func catalogPageNumber(raw string, fallback, max int) (int, error) {
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > max || strconv.Itoa(n) != raw {
		return 0, httperror.New(400, "product_catalog_query_invalid", "invalid catalog page")
	}
	return n, nil
}

func (a *Adapter) productCatalog(ctx context.Context, query url.Values) (ProductCatalogPage, error) {
	result := ProductCatalogPage{Items: []ProductCatalogItem{}}
	var err error
	result.Page, err = catalogPageNumber(query.Get("page"), 1, 1000000)
	if err != nil {
		return result, err
	}
	result.PageSize, err = catalogPageNumber(query.Get("pageSize"), 100, 100)
	if err != nil {
		return result, err
	}
	keyword, code, line := query.Get("keyword"), query.Get("code"), query.Get("productLine")
	if utf8.RuneCountInString(keyword) > 200 || utf8.RuneCountInString(code) > 64 || utf8.RuneCountInString(line) > 64 || len(query.Get("watermark")) > 191 {
		return result, httperror.New(400, "product_catalog_query_invalid", "catalog filter too long")
	}
	// Every page observes watermark, total and product/line rows in one DB
	// snapshot. Subsequent pages must carry the original watermark.
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	var ready int
	err = tx.QueryRowContext(ctx, `SELECT CONCAT(epoch,':',revision),ready FROM assets_product_catalog_state WHERE id=1`).Scan(&result.Watermark, &ready)
	if err != nil {
		return result, productCatalogError(err)
	}
	if ready != 1 {
		return result, httperror.New(503, "product_catalog_unavailable", "product catalog migration in progress")
	}
	if expected := query.Get("watermark"); expected != "" && expected != result.Watermark {
		return result, httperror.New(409, "product_catalog_changed", "product catalog changed; restart pagination")
	}
	if result.Page > 1 && query.Get("watermark") == "" {
		return result, httperror.New(400, "product_catalog_watermark_required", "subsequent pages require watermark")
	}
	where := ` FROM product_assets p WHERE (?='' OR BINARY p.product_code=BINARY ?) AND (?='' OR BINARY p.product_line=BINARY ?) AND (?='' OR LOCATE(?,p.product_code)>0 OR LOCATE(?,p.product_name)>0)`
	args := []any{code, code, line, line, keyword, keyword, keyword}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, args...).Scan(&result.Total); err != nil {
		return result, err
	}
	// Correlated scalar lookups preserve exactly one catalog row per product.
	rows, err := tx.QueryContext(ctx, `SELECT p.product_code,p.product_name,p.product_line,
		(SELECT g.category_label FROM asset_category_groups g WHERE g.category_scope='product' AND BINARY g.category_value=BINARY p.product_line LIMIT 1),
		(SELECT g.sort_order FROM asset_category_groups g WHERE g.category_scope='product' AND BINARY g.category_value=BINARY p.product_line LIMIT 1),
		p.status,p.business_owner_uid,p.technical_owner_uid,CONCAT(LEFT(DATE_FORMAT(p.updated_at,'%Y-%m-%dT%H:%i:%s.%f'),23),'Z')`+where+` ORDER BY BINARY p.product_code,p.id LIMIT ? OFFSET ?`, append(args, result.PageSize, (result.Page-1)*result.PageSize)...)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var item ProductCatalogItem
		if err := rows.Scan(&item.ProductCode, &item.ProductName, &item.ProductLine, &item.ProductLineLabel, &item.ProductLineSortOrder, &item.Status, &item.BusinessOwnerUID, &item.TechnicalOwnerUID, &item.SourceUpdatedAt); err != nil {
			rows.Close()
			return result, err
		}
		switch item.Status {
		case "poc", "mvp", "mmp", "pmf", "iterating":
			item.Onboardable = true
		}
		result.Items = append(result.Items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	if int64(result.Page*result.PageSize) < result.Total {
		next := result.Page + 1
		result.NextPage = &next
	}
	return result, tx.Commit()
}

func productCatalogError(err error) error {
	var dbErr *mysql.MySQLError
	if errors.Is(err, sql.ErrNoRows) || (errors.As(err, &dbErr) && (dbErr.Number == 1146 || dbErr.Number == 1054)) {
		return httperror.New(503, "product_catalog_unavailable", "product catalog schema not ready")
	}
	return err
}

func requireProductCatalogService(query url.Values) error {
	if query.Get("hzy_runtime_source_app") != "assets" || query.Get("hzy_runtime_tenant_code") == "" || query.Get("hzy_runtime_deployment_code") == "" || query.Get("hzy_runtime_service_client_id") != "assets.runtime" {
		return httperror.New(403, "product_catalog_service_required", "trusted Assets service required")
	}
	for _, scope := range strings.Fields(query.Get("current_user_scopes")) {
		if scope == "assets:product:read" {
			return nil
		}
	}
	return httperror.New(403, "insufficient_scope", "assets:product:read required")
}

func (a *Adapter) handleProductCatalogRuntime(ctx context.Context, method, path string, query url.Values) (any, string, bool, error) {
	if path != "/v1/assets/service/products/catalog" && path != "/v1/assets/service/products" {
		return nil, "", false, nil
	}
	if method != http.MethodGet {
		return nil, "assets.product_catalog", true, httperror.New(405, "method_not_allowed", "GET required")
	}
	if err := requireProductCatalogService(query); err != nil {
		return nil, "assets.product_catalog", true, err
	}
	if path == "/v1/assets/service/products" {
		result, err := a.listServiceProducts(ctx, query)
		return ok(result), "assets.service.products.list", true, err
	}
	result, err := a.productCatalog(ctx, query)
	return ok(result), "assets.product_catalog", true, err
}
