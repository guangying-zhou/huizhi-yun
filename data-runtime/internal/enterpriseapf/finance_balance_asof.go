package enterpriseapf

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"strings"
)

// One account at one cutoff. Same-day conflicting evidence is not resolved by
// ID; totals omit those amounts and expose a conflict count instead.
func financeBalancesAsOf(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, i FinanceInput) (any, error) {
	bank, err := r.Table("finance_bank_account")
	if err != nil {
		return nil, err
	}
	snap, err := r.Table("finance_account_balance_snapshot")
	if err != nil {
		return nil, err
	}
	hasEntity, err := financeHasColumn(ctx, tx, bank, "legal_entity_code")
	if err != nil {
		return nil, err
	}
	entity := "NULL"
	if hasEntity {
		entity = "a.legal_entity_code"
	}
	hasTies, err := financeHasColumn(ctx, tx, snap, "distinct_amounts")
	if err != nil {
		return nil, err
	}
	tie := "0"
	if hasTies {
		tie = "MAX(COALESCE(s.distinct_amounts,0))>1"
	}
	query := "SELECT a.id,a.code,a.account_name," + entity + " AS legal_entity_code,a.currency_code,CAST(MAX(s.snapshot_date) AS CHAR) AS value_date,CASE WHEN COUNT(DISTINCT s.balance_amount)>1 OR " + tie + " THEN NULL ELSE CAST(MAX(s.balance_amount) AS CHAR) END AS balance_amount,CASE WHEN COUNT(s.id)=0 THEN 'missing' WHEN COUNT(DISTINCT s.balance_amount)>1 OR " + tie + " THEN 'conflict' WHEN MAX(s.snapshot_date)<? THEN 'stale' ELSE 'known' END AS balance_state FROM " + bank + " a LEFT JOIN " + snap + " s ON s.bank_account_id=a.id AND s.snapshot_date=(SELECT MAX(x.snapshot_date) FROM " + snap + " x WHERE x.bank_account_id=a.id AND x.snapshot_date<=? AND " + financeSnapshotVisibility(snap, "x") + ") AND " + financeSnapshotVisibility(snap, "s") + " WHERE a.deleted_at IS NULL"
	args := []any{i.StaleBefore, i.AsOfDate}
	for _, f := range []struct{ column, value string }{{"a.status", i.Status}, {"a.account_type", i.AccountType}, {"a.currency_code", i.CurrencyCode}} {
		if f.value != "" {
			query += " AND " + f.column + "=?"
			args = append(args, f.value)
		}
	}
	if i.LegalEntityCode != "" {
		if hasEntity {
			query += " AND BINARY a.legal_entity_code=BINARY ?"
			args = append(args, i.LegalEntityCode)
		} else {
			query += " AND 1=0"
		}
	}
	if i.Search != "" {
		query += " AND (LOCATE(?,a.code)>0 OR LOCATE(?,a.account_name)>0)"
		args = append(args, i.Search, i.Search)
	}
	query += " GROUP BY a.id,a.code,a.account_name," + entity + ",a.currency_code"
	from := "(" + query + ") v"
	where := "1=1"
	if i.BalanceState != "" {
		where += " AND v.balance_state=?"
		args = append(args, i.BalanceState)
	}
	var total int64
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+from+" WHERE "+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	cols := []string{"id", "code", "account_name", "legal_entity_code", "currency_code", "value_date", "balance_amount", "balance_state"}
	rows, err := tx.QueryContext(ctx, "SELECT "+strings.Join(cols, ",")+" FROM "+from+" WHERE "+where+" ORDER BY code,id LIMIT ? OFFSET ?", append(append([]any{}, args...), i.PageSize, (i.Page-1)*i.PageSize)...)
	if err != nil {
		return nil, err
	}
	items, err := readFinanceRows(rows, cols)
	if err != nil {
		return nil, err
	}
	rows, err = tx.QueryContext(ctx, "SELECT legal_entity_code,currency_code,COUNT(*),SUM(balance_state='missing'),SUM(balance_state='conflict'),SUM(balance_state='stale'),CAST(SUM(CASE WHEN balance_state IN ('known','stale') THEN CAST(balance_amount AS DECIMAL(18,2)) ELSE NULL END) AS CHAR) FROM "+from+" WHERE "+where+" GROUP BY legal_entity_code,currency_code ORDER BY legal_entity_code,currency_code", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	totals := []map[string]any{}
	for rows.Next() {
		var entity, amount sql.NullString
		var currency string
		var count, missing, conflict, stale int64
		if err = rows.Scan(&entity, &currency, &count, &missing, &conflict, &stale, &amount); err != nil {
			return nil, err
		}
		totals = append(totals, map[string]any{"legal_entity_code": nullString(entity), "currency_code": currency, "account_count": count, "covered_count": count - missing - conflict, "missing_count": missing, "conflict_count": conflict, "stale_count": stale, "amount": nullString(amount)})
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"data": items, "total": total, "page": i.Page, "pageSize": i.PageSize, "asOfDate": i.AsOfDate, "balanceTotals": totals}, nil
}
