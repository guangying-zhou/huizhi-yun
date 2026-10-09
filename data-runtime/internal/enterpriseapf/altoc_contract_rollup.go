package enterpriseapf

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
)

const (
	customerSubtreeDepth = 10
	customerSubtreeNodes = 2000
)

// customerSubtree returns the root and all non-deleted descendants. Only IDs
// leave this function: names of customers outside the caller's customer scope
// are never read. Oversized or cyclic trees are refused rather than truncated.
func customerSubtree(ctx context.Context, tx *sql.Tx, table, root string) ([]any, error) {
	seen := map[string]bool{root: true}
	out, level := []any{root}, []any{root}
	for depth := 0; len(level) > 0; depth++ {
		if depth == customerSubtreeDepth {
			return nil, contractError(422, "altoc_customer_subtree_too_large")
		}
		rows, e := tx.QueryContext(ctx, "SELECT id FROM "+table+" WHERE deleted_at IS NULL AND parent_customer_id IN ("+strings.TrimSuffix(strings.Repeat("?,", len(level)), ",")+") ORDER BY id", level...)
		if e != nil {
			return nil, e
		}
		next := []any{}
		for rows.Next() {
			var id int64
			if e = rows.Scan(&id); e != nil {
				rows.Close()
				return nil, e
			}
			key := strconv.FormatInt(id, 10)
			if seen[key] {
				continue
			}
			seen[key] = true
			next = append(next, key)
		}
		if e = rows.Close(); e != nil {
			return nil, e
		}
		if e = rows.Err(); e != nil {
			return nil, e
		}
		out = append(out, next...)
		if len(out) > customerSubtreeNodes {
			return nil, contractError(422, "altoc_customer_subtree_too_large")
		}
		level = next
	}
	return out, nil
}

// One row per currency; amounts are never added across currencies.
func contractAmounts(ctx context.Context, tx *sql.Tx, table, where string, args []any) ([]map[string]any, error) {
	rows, e := tx.QueryContext(ctx, "SELECT currency_code,COUNT(*),CAST(COALESCE(SUM(amount_tax_inclusive),0) AS CHAR) FROM "+table+" WHERE "+where+" GROUP BY currency_code ORDER BY currency_code", args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var currency, amount string
		var count int64
		if e = rows.Scan(&currency, &count, &amount); e != nil {
			return nil, e
		}
		out = append(out, map[string]any{"currency_code": currency, "count": count, "amount": amount})
	}
	return out, rows.Err()
}

// contractRollup summarizes sales contracts of the given customers that the
// caller's contract scope can see. Search/status filters do not apply: the
// figures describe the customer, not the current list filter. Terminated
// contracts are counted separately and excluded from amounts.
func contractRollup(ctx context.Context, tx *sql.Tx, table, scopeWhere string, scopeArgs []any, customers []any) (map[string]any, error) {
	in := "customer_id IN (" + strings.TrimSuffix(strings.Repeat("?,", len(customers)), ",") + ")"
	base := "deleted_at IS NULL AND direction='sales' AND " + in
	visible := scopeWhere + " AND direction='sales' AND " + in
	args := append(append([]any{}, scopeArgs...), customers...)
	out := map[string]any{}
	metrics, err := contractEffectiveMetrics(ctx, tx, table, visible+" AND status<>'terminated'", args)
	if err != nil {
		return nil, err
	}
	out["effectiveMetrics"] = metrics
	var e error
	if out["amounts"], e = contractAmounts(ctx, tx, table, visible+" AND status<>'terminated'", args); e != nil {
		return nil, e
	}
	if out["signedLast12Months"], e = contractAmounts(ctx, tx, table, visible+" AND status<>'terminated' AND sign_date>=DATE_SUB(CURRENT_DATE,INTERVAL 12 MONTH)", args); e != nil {
		return nil, e
	}
	if out["signedThisYear"], e = contractAmounts(ctx, tx, table, visible+" AND status<>'terminated' AND sign_date>=MAKEDATE(YEAR(CURRENT_DATE),1)", args); e != nil {
		return nil, e
	}
	has, e := financeHasColumn(ctx, tx, table, "effective_amount")
	if e != nil {
		return nil, e
	}
	if has {
		rows, e := tx.QueryContext(ctx, "SELECT currency_code,COUNT(*),CAST(COALESCE(SUM(effective_amount),0) AS CHAR),SUM(effective_amount IS NULL) FROM "+table+" WHERE "+visible+" AND status<>'terminated' GROUP BY currency_code ORDER BY currency_code", args...)
		if e != nil {
			return nil, e
		}
		amounts := []map[string]any{}
		for rows.Next() {
			var currency, amount string
			var count, missing int64
			if e = rows.Scan(&currency, &count, &amount, &missing); e != nil {
				rows.Close()
				return nil, e
			}
			amounts = append(amounts, map[string]any{"currency_code": currency, "count": count, "amount": amount, "missingCount": missing})
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
		out["effectiveAmounts"] = amounts
	}
	var count, terminated, all int64
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*),COALESCE(SUM(status='terminated'),0) FROM "+table+" WHERE "+visible, args...).Scan(&count, &terminated); e != nil {
		return nil, e
	}
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE "+base, customers...).Scan(&all); e != nil {
		return nil, e
	}
	out["count"], out["terminatedCount"] = count-terminated, terminated
	// Only whether something is hidden; never how much.
	out["excluded"] = all > count
	return out, nil
}
