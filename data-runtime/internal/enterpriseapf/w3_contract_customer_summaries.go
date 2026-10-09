package enterpriseapf

import (
	"context"
	"database/sql"
)

// This reader receives only the contract permit's filtered SQL. It does not
// resolve customer metadata, use a customer scope, or expose excluded counts.
func w3ContractCustomerSummaries(ctx context.Context, tx *sql.Tx, table, where string, args []any, ids []string) (map[string]any, error) {
	out := map[string]any{}
	for _, id := range ids {
		out[id] = map[string]any{"count": int64(0), "amounts": []map[string]any{}}
	}
	rows, err := tx.QueryContext(ctx, "SELECT customer_id,currency_code,COUNT(*),CAST(COALESCE(SUM(amount_tax_inclusive),0) AS CHAR) FROM "+table+" WHERE "+where+" AND direction='sales' AND status<>'terminated' GROUP BY customer_id,currency_code ORDER BY customer_id,currency_code", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, currency, amount string
		var count int64
		if err = rows.Scan(&id, &currency, &count, &amount); err != nil {
			return nil, err
		}
		v, ok := out[id]
		if !ok {
			continue
		}
		summary := v.(map[string]any)
		summary["count"] = summary["count"].(int64) + count
		summary["amounts"] = append(summary["amounts"].([]map[string]any), map[string]any{"currency_code": currency, "count": count, "amount": amount})
	}
	return out, rows.Err()
}
