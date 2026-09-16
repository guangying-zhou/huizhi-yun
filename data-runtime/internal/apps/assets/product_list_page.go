package assets

import (
	"context"
	"database/sql"
	"net/url"
	"strconv"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Column identifiers are fixed server-side, never interpolated from a request.
// ID breaks ties to keep page boundaries deterministic.
func productListOrder(query url.Values) string {
	columns := map[string]string{
		"code": "p.product_code", "name": "p.product_name",
		"domain": "p.product_line", "asset_value": "p.asset_level",
		"investment_strategy": "p.product_level", "status_label": "p.status",
	}
	column, ok := columns[query.Get("sortBy")]
	if !ok {
		return "p.id DESC"
	}
	direction := " ASC"
	if query.Get("sortOrder") == "desc" {
		direction = " DESC"
	}
	return column + direction + ", p.id" + direction
}

// Both reads use one repeatable-read snapshot so a concurrent edit cannot make
// the page disagree with its filtered totals. Legacy directory callers without
// pagination parameters retain their existing response.
func (a *Adapter) productListPage(ctx context.Context, query url.Values, statement string, args []any) (map[string]any, error) {
	page, size := 1, 20
	for key, target := range map[string]*int{"page": &page, "pageSize": &size} {
		if raw := query.Get(key); raw != "" {
			value, err := strconv.Atoi(raw)
			if err != nil || value < 1 || (key == "pageSize" && value > 100) || (key == "page" && value > 1000000) {
				return nil, httperror.New(400, "invalid_product_pagination", "产品分页参数无效")
			}
			*target = value
		}
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var total, active, assets int64
	err = tx.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(status IN ('mvp','mmp','pmf','iterating')),0), COALESCE(SUM(asset_count),0) FROM (`+statement+`) product_summary`, args...).Scan(&total, &active, &assets)
	if err != nil {
		return nil, err
	}
	pageArgs := append(append([]any{}, args...), size, (page-1)*size)
	rows, err := tx.QueryContext(ctx, statement+` LIMIT ? OFFSET ?`, pageArgs...)
	if err != nil {
		return nil, err
	}
	items, err := rowsToMaps(rows)
	closeErr := rows.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	for _, item := range items {
		normalizeProductMap(item)
	}
	return map[string]any{
		"items": items, "total": total, "page": page, "pageSize": size,
		"summary": []summaryMetric{
			metric("产品主档", total, "平台产品家底", "primary"),
			metric("活跃产品", active, "MVP/MMP/PMF 生命周期", "success"),
			metric("关联资源", assets, "运行与交付资源", "info"),
		},
	}, nil
}
