package assets

import (
	"context"
	"database/sql"
	"net/url"
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
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := (productMasterReader{tx: tx}).productListPage(ctx, query, statement, args)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}
