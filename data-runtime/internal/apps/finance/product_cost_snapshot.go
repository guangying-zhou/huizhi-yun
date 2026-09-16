package finance

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Internal facts only, never an API DTO: source snapshots can contain employee
// compensation details. Callers must authorize the project before this read and
// project only the final permitted product result to the user.
type productCostSnapshot struct {
	Rules                                                     *productCostAttributionRules
	SummaryExists                                             bool
	ReadinessStatus, InputHash, CheckedAt                     string
	DirectExpenseAmount, LaborCostAmount, AllocatedCostAmount string
	Allocations                                               []productCostAllocationFact
	DirectExpenses                                            []productDirectExpenseFact
}

func readProductCostSnapshot(ctx context.Context, db *sql.DB, projectCode, periodMonth string) (productCostSnapshot, error) {
	var result productCostSnapshot
	// Validate business keys before opening any database transaction.
	validation := productCostAttributionRules{ProjectCode: projectCode, PeriodMonth: periodMonth, Revision: 1, EvidenceRef: "read-validation"}
	if _, err := distributeProductCost("0.00", "CNY", validation); err != nil {
		return result, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	rules, err := readProductCostAttribution(ctx, tx, projectCode, periodMonth)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return result, err
	}
	if err == nil {
		result.Rules = &rules
	}
	var status, hash sql.NullString
	var checked sql.NullTime
	var direct, labor, allocated sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT cost_readiness_status, cost_input_hash, cost_readiness_checked_at,
		direct_expense_amount, labor_cost_amount, allocated_cost_amount
		FROM project_finance_summary WHERE BINARY project_code = BINARY ? AND period_month = ?`, projectCode, periodMonth).
		Scan(&status, &hash, &checked, &direct, &labor, &allocated)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return result, err
	}
	result.SummaryExists = err == nil
	result.ReadinessStatus = status.String
	result.InputHash = hash.String
	if checked.Valid {
		result.CheckedAt = checked.Time.UTC().Format(time.RFC3339Nano)
	}
	// Preserve NULL as missing evidence, not zero cost.
	result.DirectExpenseAmount, result.LaborCostAmount, result.AllocatedCostAmount = direct.String, labor.String, allocated.String
	rows, err := tx.QueryContext(ctx, `SELECT code, project_code, period_month, COALESCE(employee_uid, ''),
		allocation_type, COALESCE(source_table, ''), COALESCE(rule_code, ''), status, amount, source_refs_json, COALESCE(currency_code, '')
		FROM project_cost_allocation WHERE BINARY project_code = BINARY ? AND period_month = ?
		AND status = 'active' ORDER BY BINARY code`, projectCode, periodMonth)
	if err != nil {
		return result, err
	}
	result.Allocations = make([]productCostAllocationFact, 0)
	for rows.Next() {
		var fact productCostAllocationFact
		var sourceRefs []byte
		if err := rows.Scan(&fact.Code, &fact.ProjectCode, &fact.PeriodMonth, &fact.EmployeeUID,
			&fact.AllocationType, &fact.SourceTable, &fact.RuleCode, &fact.Status, &fact.Amount, &sourceRefs, &fact.CurrencyCode); err != nil {
			rows.Close()
			return productCostSnapshot{}, err
		}
		fact.SourceRefs = sourceRefs
		result.Allocations = append(result.Allocations, fact)
	}
	err = rows.Err()
	closeErr := rows.Close()
	if err != nil {
		return productCostSnapshot{}, err
	}
	if closeErr != nil {
		return productCostSnapshot{}, closeErr
	}
	result.DirectExpenses, err = readProductDirectExpenses(ctx, tx, projectCode, periodMonth)
	if err != nil {
		return productCostSnapshot{}, err
	}
	if err := tx.Commit(); err != nil {
		return productCostSnapshot{}, err
	}
	return result, nil
}
