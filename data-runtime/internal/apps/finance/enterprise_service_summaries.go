package finance

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"strings"
)

// ServiceSummaryDisclosure is a signed Foundation projection, not browser input.
// Each field family keeps its own personnel resource and responsibility scope.
type ServiceSummaryDisclosure struct{ Invoices, Receipts, Reconciliation string }

func (p ServiceSummaryDisclosure) Validate() error {
	for _, a := range []string{p.Invoices, p.Receipts, p.Reconciliation} {
		if a != "all" && a != "self" && a != "none" {
			return httperror.New(403, "finance_summary_scope_invalid", "财务摘要范围无效")
		}
	}
	return nil
}
func (p ServiceSummaryDisclosure) Denied() bool {
	return p.Invoices == "none" && p.Receipts == "none" && p.Reconciliation == "none"
}

// ReadCustomerServiceSummaryTx reads only current Finance facts and never writes
// a summary. Denied families do not resolve a table or issue COUNT/amount SQL.
func ReadCustomerServiceSummaryTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), customer, actor string, contracts []string, p ServiceSummaryDisclosure) (map[string]any, error) {
	if e := p.Validate(); e != nil {
		return nil, e
	}
	if p.Denied() {
		return map[string]any{"access": "denied"}, nil
	}
	out := map[string]any{"access": "allowed"}
	families := []struct{ name, table, amount, owner, where, access string }{
		{"invoices", "finance_invoice", "invoice_amount", "issued_by", "deleted_at IS NULL AND status='issued'", p.Invoices},
		{"receipts", "finance_receipt", "received_amount", "reconciliation_responsible_uid", "deleted_at IS NULL AND status IN ('confirmed','partially_reconciled','reconciled')", p.Receipts},
		{"reconciliation", "finance_reconciliation", "reconciled_amount", "reconciled_by", "status='active'", p.Reconciliation},
	}
	for _, f := range families {
		if f.access == "none" {
			out[f.name] = map[string]any{"access": "denied"}
			continue
		}
		totals := []map[string]any{}
		if len(contracts) > 0 {
			if len(contracts) > 1000 {
				return nil, httperror.New(503, "finance_summary_limit", "财务摘要范围超过上限")
			}
			t, e := table(f.table)
			if e != nil {
				return nil, e
			}
			args := []any{customer}
			for _, c := range contracts {
				args = append(args, c)
			}
			where := f.where + " AND BINARY customer_code=BINARY ? AND BINARY contract_code IN (" + strings.TrimSuffix(strings.Repeat("BINARY ?,", len(contracts)), ",") + ")"
			if f.access == "self" {
				where += " AND BINARY " + f.owner + "=BINARY ?"
				args = append(args, actor)
			}
			rows, e := tx.QueryContext(ctx, "SELECT currency_code,CAST(SUM("+f.amount+") AS CHAR),COUNT(*) FROM "+t+" WHERE "+where+" GROUP BY currency_code ORDER BY currency_code", args...)
			if e != nil {
				return nil, e
			}
			for rows.Next() {
				var currency, amount string
				var count int64
				if e = rows.Scan(&currency, &amount, &count); e != nil {
					rows.Close()
					return nil, e
				}
				totals = append(totals, map[string]any{"currency": currency, "amount": amount, "count": count})
			}
			e = rows.Err()
			rows.Close()
			if e != nil {
				return nil, e
			}
		}
		out[f.name] = map[string]any{"access": "allowed", "currencyTotals": totals}
	}
	return out, nil
}

// ReadServiceProjectCostTx returns the APF-14 confirmed public project summary;
// personal rates, employee IDs, source hashes and work entries never escape.
func ReadServiceProjectCostTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), project, month string) (map[string]any, error) {
	t, e := table("finance_project_summary")
	if e != nil {
		return nil, e
	}
	var currency, readiness, missing string
	var labor, expense, other, profit, margin sql.NullString
	e = tx.QueryRowContext(ctx, "SELECT COALESCE(currency_code,''),cost_readiness_status,CAST(COALESCE(cost_missing_inputs_json,JSON_ARRAY()) AS CHAR),CAST(labor_cost_amount AS CHAR),CAST(direct_expense_amount AS CHAR),CAST(other_cost_amount AS CHAR),CAST(gross_profit_amount AS CHAR),CAST(gross_margin_rate AS CHAR) FROM "+t+" WHERE BINARY project_code=BINARY ? AND period_month=?", project, month).Scan(&currency, &readiness, &missing, &labor, &expense, &other, &profit, &margin)
	if e == sql.ErrNoRows {
		return map[string]any{"projectCode": project, "periodMonth": month, "readiness": "not_ready", "missingInputs": []string{"cost_batch_required"}, "laborCostAmount": nil, "directExpenseAmount": nil, "otherCostAmount": nil, "grossProfitAmount": nil, "grossMarginRate": nil}, nil
	}
	if e != nil {
		return nil, e
	}
	var reasons []string
	if json.Unmarshal([]byte(missing), &reasons) != nil || (readiness != "ready" && readiness != "not_ready") {
		return nil, httperror.New(503, "finance_summary_invalid", "成本摘要不可用")
	}
	out := map[string]any{"projectCode": project, "periodMonth": month, "currency": currency, "readiness": readiness, "missingInputs": reasons}
	for k, v := range map[string]sql.NullString{"laborCostAmount": labor, "directExpenseAmount": expense, "otherCostAmount": other, "grossProfitAmount": profit, "grossMarginRate": margin} {
		if readiness == "ready" && v.Valid {
			out[k] = v.String
		} else {
			out[k] = nil
		}
	}
	return out, nil
}
