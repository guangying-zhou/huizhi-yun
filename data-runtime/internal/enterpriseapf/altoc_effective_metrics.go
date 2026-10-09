package enterpriseapf

import (
	"context"
	"database/sql"
)

// Current visible contract set, not a legacy customer snapshot. Deduplication
// excludes a child only when its parent is also in this same filtered set.
// Missing effective amounts stay missing; never substitute the signed amount.
func contractEffectiveMetrics(ctx context.Context, tx *sql.Tx, table, where string, args []any) ([]map[string]any, error) {
	has, err := financeHasColumn(ctx, tx, table, "effective_amount")
	if err != nil {
		return nil, err
	}
	if !has {
		return nil, nil
	}
	parent := "NULL"
	has, err = financeHasColumn(ctx, tx, table, "parent_contract_id")
	if err != nil {
		return nil, err
	}
	if has {
		parent = "parent_contract_id"
	}
	query := "WITH eligible AS (SELECT id," + parent + " AS parent_id,currency_code,effective_amount FROM " + table + " WHERE " + where + ") SELECT c.currency_code,COUNT(*),SUM(c.effective_amount IS NULL),CAST(SUM(c.effective_amount) AS CHAR) FROM eligible c WHERE NOT EXISTS (SELECT 1 FROM eligible p WHERE p.id=c.parent_id) GROUP BY c.currency_code ORDER BY c.currency_code"
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var currency string
		var count, missing int64
		var amount sql.NullString
		if err = rows.Scan(&currency, &count, &missing, &amount); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"currency_code": currency, "contract_count": count, "missing_count": missing, "effective_amount": nullString(amount)})
	}
	return out, rows.Err()
}
