package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/projectcost"
	"math/big"
	"sort"
	"strings"
)

type costSummaryTarget struct{ Project, Month string }

func lockCostFinancialTargets(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, i FinanceInput, locked map[string]map[string]any) ([]costSummaryTarget, error) {
	if _, e := r.Table("finance_project_cost_period"); e != nil {
		return nil, nil
	}
	for _, table := range domaininstall.FinanceCostTables() {
		if _, e := r.Table(table.Logical); e != nil {
			return nil, e
		}
	}
	projects := map[string]bool{}
	if p := ledgerText(i.Payload["projectCode"]); p != "" {
		projects[p] = true
	}
	for _, row := range locked {
		if p := ledgerText(row["project_code"]); p != "" {
			projects[p] = true
		}
	}
	if row := locked["finance_receipt"]; row != nil {
		recon, _ := r.Table("finance_reconciliation")
		rows, e := tx.QueryContext(ctx, "SELECT DISTINCT project_code FROM "+recon+" WHERE receipt_id=? AND project_code IS NOT NULL", row["id"])
		if e != nil {
			return nil, e
		}
		for rows.Next() {
			var code string
			if e = rows.Scan(&code); e != nil {
				rows.Close()
				return nil, e
			}
			if code != "" {
				projects[code] = true
			}
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
	}
	codes := []string{}
	for p := range projects {
		codes = append(codes, p)
	}
	sort.Strings(codes)
	out := []costSummaryTarget{}
	period, _ := r.Table("finance_project_cost_period")
	summary, _ := r.Table("finance_project_summary")
	for _, code := range codes {
		rows, e := tx.QueryContext(ctx, "SELECT project_code,period_month FROM "+period+" WHERE project_code=? ORDER BY period_month FOR UPDATE", code)
		if e != nil {
			return nil, e
		}
		for rows.Next() {
			var v costSummaryTarget
			if e = rows.Scan(&v.Project, &v.Month); e != nil {
				rows.Close()
				return nil, e
			}
			out = append(out, v)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
	}
	for _, v := range out {
		var id int64
		e := tx.QueryRowContext(ctx, "SELECT id FROM "+summary+" WHERE project_code=? AND period_month=? FOR UPDATE", v.Project, v.Month).Scan(&id)
		if e != nil && e != sql.ErrNoRows {
			return nil, e
		}
	}
	return out, nil
}

// This is a current projection refresh on the caller's existing RC write Tx,
// after sorted period/summary locks. It never locks an earlier M3 input table.
func refreshCostFinancialTargets(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, targets []costSummaryTarget) error {
	summary, _ := r.Table("finance_project_summary")
	receipt, _ := r.Table("finance_receipt")
	recon, _ := r.Table("finance_reconciliation")
	expense, _ := r.Table("finance_expense")
	for _, target := range targets {
		p, e := projectcost.NewPeriod(target.Project, target.Month)
		if e != nil {
			return e
		}
		var currency, readiness, missing string
		var labor sql.NullString
		var other string
		e = tx.QueryRowContext(ctx, "SELECT COALESCE(currency_code,''),cost_readiness_status,cost_missing_inputs_json,CAST(labor_cost_amount AS CHAR),CAST(other_cost_amount AS CHAR) FROM "+summary+" WHERE project_code=? AND period_month=?", target.Project, target.Month).Scan(&currency, &readiness, &missing, &labor, &other)
		if e == sql.ErrNoRows {
			continue
		}
		if e != nil {
			return e
		}
		income, totalExpense := new(big.Rat), new(big.Rat)
		facts := []any{}
		currencies := map[string]bool{}
		rows, e := tx.QueryContext(ctx, "SELECT rc.id,r.id,CAST(rc.row_version AS CHAR),CAST(r.row_version AS CHAR),CAST(rc.reconciled_amount AS CHAR),rc.currency_code,CAST(r.received_at AS CHAR),r.currency_code FROM "+recon+" rc JOIN "+receipt+" r ON r.id=rc.receipt_id WHERE rc.project_code=? AND rc.status='active' AND r.status IN ('confirmed','partially_reconciled','reconciled') AND r.confirmed_by IS NOT NULL AND r.deleted_at IS NULL AND r.received_at>=? AND r.received_at<=? ORDER BY rc.id", target.Project, p.Start.Format("2006-01-02"), p.End.Format("2006-01-02"))
		if e != nil {
			return e
		}
		for rows.Next() {
			var id, rid int64
			var rv, pv, amount, c, date, pc string
			if e = rows.Scan(&id, &rid, &rv, &pv, &amount, &c, &date, &pc); e != nil {
				rows.Close()
				return e
			}
			n, ok := new(big.Rat).SetString(amount)
			if !ok {
				rows.Close()
				return costErr(503, "financial_input_invalid")
			}
			income.Add(income, n)
			currencies[c] = true
			currencies[pc] = true
			facts = append(facts, []any{"reconciliation", id, rid, rv, pv, amount, c, date})
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		rows, e = tx.QueryContext(ctx, "SELECT id,CAST(row_version AS CHAR),CAST(expense_amount AS CHAR),currency_code,CAST(expense_date AS CHAR) FROM "+expense+" WHERE project_code=? AND status='confirmed' AND confirmed_by IS NOT NULL AND deleted_at IS NULL AND expense_date>=? AND expense_date<=? ORDER BY id", target.Project, p.Start.Format("2006-01-02"), p.End.Format("2006-01-02"))
		if e != nil {
			return e
		}
		for rows.Next() {
			var id int64
			var version, amount, c, date string
			if e = rows.Scan(&id, &version, &amount, &c, &date); e != nil {
				rows.Close()
				return e
			}
			n, ok := new(big.Rat).SetString(amount)
			if !ok {
				rows.Close()
				return costErr(503, "financial_input_invalid")
			}
			totalExpense.Add(totalExpense, n)
			currencies[c] = true
			facts = append(facts, []any{"expense", id, version, amount, c, date})
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		mismatch := len(currencies) > 1
		for c := range currencies {
			if currency != "" && c != currency {
				mismatch = true
			}
		}
		var profit, margin any
		if mismatch {
			readiness = "not_ready"
			labor.Valid = false
			var reasons []string
			json.Unmarshal([]byte(missing), &reasons)
			if !strings.Contains(missing, "financial_currency_mismatch") {
				reasons = append(reasons, "financial_currency_mismatch")
			}
			b, _ := json.Marshal(reasons)
			missing = string(b)
		} else if readiness == "ready" && labor.Valid {
			l, _ := new(big.Rat).SetString(labor.String)
			o, _ := new(big.Rat).SetString(other)
			g := new(big.Rat).Sub(new(big.Rat).Sub(new(big.Rat).Sub(income, totalExpense), l), o)
			profit = projectcost.Round(g, 2)
			if income.Sign() > 0 {
				margin = projectcost.Round(new(big.Rat).Quo(g, income), 4)
			}
		}
		var laborValue any
		if labor.Valid {
			laborValue = labor.String
		}
		if _, e = tx.ExecContext(ctx, "UPDATE "+summary+" SET receipt_amount=?,direct_expense_amount=?,labor_cost_amount=?,gross_profit_amount=?,gross_margin_rate=?,financial_input_sha256=?,cost_readiness_status=?,cost_missing_inputs_json=?,row_version=row_version+1 WHERE project_code=? AND period_month=?", projectcost.Round(income, 2), projectcost.Round(totalExpense, 2), laborValue, profit, margin, projectcost.Hash(facts), readiness, missing, target.Project, target.Month); e != nil {
			return e
		}
	}
	return nil
}
