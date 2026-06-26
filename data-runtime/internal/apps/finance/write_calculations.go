package finance

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

type execQueryer interface {
	queryer
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func (a *Adapter) recalculateContractSummary(ctx context.Context, conn execQueryer, contractCode any) error {
	code := cleanStringValue(contractCode)
	if code == "" {
		return nil
	}

	row, err := queryOneMap(ctx, conn, `
		SELECT
		  COALESCE(invoice.customer_code, receipt.customer_code, reconciliation.customer_code) AS customer_code,
		  COALESCE(invoice.project_code, receipt.project_code, reconciliation.project_code) AS project_code,
		  COALESCE(invoice.invoice_amount, 0) AS invoice_amount,
		  COALESCE(receipt.received_amount, 0) AS received_amount,
		  COALESCE(reconciliation.reconciled_amount, 0) AS reconciled_amount,
		  COALESCE(invoice.invoice_count, 0) AS invoice_count,
		  COALESCE(receipt.receipt_count, 0) AS receipt_count,
		  invoice.latest_invoice_date,
		  receipt.latest_received_at
		FROM (SELECT 1) seed
		LEFT JOIN (
		  SELECT
		    MAX(customer_code) AS customer_code,
		    MAX(project_code) AS project_code,
		    SUM(invoice_amount) AS invoice_amount,
		    COUNT(*) AS invoice_count,
		    MAX(invoice_date) AS latest_invoice_date
		  FROM finance_invoice
		  WHERE deleted_at IS NULL AND status NOT IN ('canceled', 'red_reversed') AND contract_code = ?
		) invoice ON TRUE
		LEFT JOIN (
		  SELECT
		    MAX(customer_code) AS customer_code,
		    MAX(project_code) AS project_code,
		    SUM(received_amount) AS received_amount,
		    COUNT(*) AS receipt_count,
		    MAX(received_at) AS latest_received_at
		  FROM finance_receipt
		  WHERE deleted_at IS NULL AND status <> 'canceled' AND contract_code = ?
		) receipt ON TRUE
		LEFT JOIN (
		  SELECT
		    MAX(customer_code) AS customer_code,
		    MAX(project_code) AS project_code,
		    SUM(reconciled_amount) AS reconciled_amount
		  FROM finance_reconciliation
		  WHERE status = 'active' AND contract_code = ?
		) reconciliation ON TRUE
	`, code, code, code)
	if err != nil {
		return err
	}

	invoiceAmount := amountFromMap(row, "invoice_amount")
	receivedAmount := amountFromMap(row, "received_amount")
	reconciledAmount := amountFromMap(row, "reconciled_amount")
	unreconciledAmount := receivedAmount - reconciledAmount
	if unreconciledAmount < 0 {
		unreconciledAmount = 0
	}

	_, err = conn.ExecContext(ctx, `
		INSERT INTO finance_contract_summary (
		  contract_code,
		  customer_code,
		  project_code,
		  invoice_amount,
		  received_amount,
		  reconciled_amount,
		  unreceived_amount,
		  unreconciled_amount,
		  invoice_count,
		  receipt_count,
		  latest_invoice_date,
		  latest_received_at,
		  calculated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
		ON DUPLICATE KEY UPDATE
		  customer_code = VALUES(customer_code),
		  project_code = VALUES(project_code),
		  invoice_amount = VALUES(invoice_amount),
		  received_amount = VALUES(received_amount),
		  reconciled_amount = VALUES(reconciled_amount),
		  unreceived_amount = VALUES(unreceived_amount),
		  unreconciled_amount = VALUES(unreconciled_amount),
		  invoice_count = VALUES(invoice_count),
		  receipt_count = VALUES(receipt_count),
		  latest_invoice_date = VALUES(latest_invoice_date),
		  latest_received_at = VALUES(latest_received_at),
		  calculated_at = NOW()
	`, code, row["customer_code"], row["project_code"], fmt.Sprintf("%.2f", invoiceAmount), fmt.Sprintf("%.2f", receivedAmount), fmt.Sprintf("%.2f", reconciledAmount), nil, fmt.Sprintf("%.2f", unreconciledAmount), int64(amountFromMap(row, "invoice_count")), int64(amountFromMap(row, "receipt_count")), row["latest_invoice_date"], row["latest_received_at"])
	return err
}

func financeContractSummaryMap(ctx context.Context, conn queryer, contractCode any) (map[string]any, error) {
	code := cleanStringValue(contractCode)
	if code == "" {
		return nil, nil
	}
	return queryOneMap(ctx, conn, `
		SELECT *
		FROM finance_contract_summary
		WHERE contract_code = ?
		LIMIT 1
	`, code)
}

func financeReceivablePlanSummaryMap(ctx context.Context, conn queryer, receivablePlanCode any) (map[string]any, error) {
	code := cleanStringValue(receivablePlanCode)
	if code == "" {
		return nil, nil
	}
	return queryOneMap(ctx, conn, `
		SELECT
		  seed.receivable_plan_code,
		  COALESCE(invoice.customer_code, receipt.customer_code, reconciliation.customer_code) AS customer_code,
		  COALESCE(invoice.contract_code, receipt.contract_code, reconciliation.contract_code) AS contract_code,
		  COALESCE(invoice.project_code, receipt.project_code, reconciliation.project_code) AS project_code,
		  COALESCE(invoice.invoice_amount, 0) AS invoice_amount,
		  COALESCE(receipt.received_amount, 0) AS received_amount,
		  COALESCE(reconciliation.reconciled_amount, 0) AS reconciled_amount,
		  COALESCE(receipt.received_amount, 0) - COALESCE(reconciliation.reconciled_amount, 0) AS unreconciled_amount,
		  COALESCE(invoice.invoice_count, 0) AS invoice_count,
		  COALESCE(receipt.receipt_count, 0) AS receipt_count,
		  COALESCE(reconciliation.reconciliation_count, 0) AS reconciliation_count,
		  invoice.latest_invoice_date,
		  receipt.latest_received_at,
		  reconciliation.latest_reconciled_at,
		  NOW() AS calculated_at
		FROM (SELECT ? AS receivable_plan_code) seed
		LEFT JOIN (
		  SELECT
		    MAX(customer_code) AS customer_code,
		    MAX(contract_code) AS contract_code,
		    MAX(project_code) AS project_code,
		    SUM(invoice_amount) AS invoice_amount,
		    COUNT(*) AS invoice_count,
		    MAX(invoice_date) AS latest_invoice_date
		  FROM finance_invoice
		  WHERE deleted_at IS NULL
		    AND status NOT IN ('canceled', 'red_reversed')
		    AND receivable_plan_code = ?
		) invoice ON TRUE
		LEFT JOIN (
		  SELECT
		    MAX(customer_code) AS customer_code,
		    MAX(contract_code) AS contract_code,
		    MAX(project_code) AS project_code,
		    SUM(received_amount) AS received_amount,
		    COUNT(*) AS receipt_count,
		    MAX(received_at) AS latest_received_at
		  FROM finance_receipt
		  WHERE deleted_at IS NULL
		    AND status <> 'canceled'
		    AND receivable_plan_code = ?
		) receipt ON TRUE
		LEFT JOIN (
		  SELECT
		    MAX(customer_code) AS customer_code,
		    MAX(contract_code) AS contract_code,
		    MAX(project_code) AS project_code,
		    SUM(reconciled_amount) AS reconciled_amount,
		    COUNT(*) AS reconciliation_count,
		    MAX(reconciled_at) AS latest_reconciled_at
		  FROM finance_reconciliation
		  WHERE status = 'active'
		    AND receivable_plan_code = ?
		) reconciliation ON TRUE
	`, code, code, code, code)
}

func (a *Adapter) RecalculateProjectFinance(ctx context.Context, body jsonBody) (DataResult[map[string]any], error) {
	projectCode := cleanStringValue(bodyValue(body, "projectCode", "project_code"))
	monthValue := bodyValue(body, "periodMonth", "period_month")
	periodMonth := ""
	if monthValue != nil && cleanStringValue(monthValue) != "" {
		var err error
		periodMonth, err = periodMonthValue(monthValue)
		if err != nil {
			return DataResult[map[string]any]{}, err
		}
	}

	where := []string{"metric.project_code IS NOT NULL"}
	args := make([]any, 0)
	if projectCode != "" {
		if err := requireProjectFinanceBodyAccess(body, projectCode); err != nil {
			return DataResult[map[string]any]{}, err
		}
		where = append(where, "metric.project_code = ?")
		args = append(args, projectCode)
	} else {
		if err := applyProjectFinanceBodyProjectCodeAccess(&where, &args, body, "metric.project_code"); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}
	if periodMonth != "" {
		where = append(where, "metric.period_month = ?")
		args = append(args, periodMonth)
	}

	rows, err := queryMaps(ctx, a.db, `
		SELECT
		  metric.project_code,
		  metric.period_month,
		  MAX(metric.customer_code) AS customer_code,
		  MAX(metric.contract_code) AS contract_code,
		  SUM(metric.contract_amount) AS contract_amount,
		  SUM(metric.invoice_amount) AS invoice_amount,
		  SUM(metric.received_amount) AS received_amount,
		  SUM(metric.direct_expense_amount) AS direct_expense_amount,
		  SUM(metric.labor_cost_amount) AS labor_cost_amount,
		  SUM(metric.allocated_cost_amount) AS allocated_cost_amount
		FROM (
		  SELECT project_code, DATE_FORMAT(invoice_date, '%Y-%m') AS period_month, customer_code, contract_code,
		         0 AS contract_amount, SUM(invoice_amount) AS invoice_amount, 0 AS received_amount,
		         0 AS direct_expense_amount, 0 AS labor_cost_amount, 0 AS allocated_cost_amount
		  FROM finance_invoice
		  WHERE deleted_at IS NULL AND status NOT IN ('canceled', 'red_reversed') AND project_code IS NOT NULL
		  GROUP BY project_code, DATE_FORMAT(invoice_date, '%Y-%m'), customer_code, contract_code
		  UNION ALL
		  SELECT project_code, DATE_FORMAT(received_at, '%Y-%m') AS period_month, customer_code, contract_code,
		         0, 0, SUM(received_amount), 0, 0, 0
		  FROM finance_receipt
		  WHERE deleted_at IS NULL AND status <> 'canceled' AND project_code IS NOT NULL
		  GROUP BY project_code, DATE_FORMAT(received_at, '%Y-%m'), customer_code, contract_code
		  UNION ALL
		  SELECT project_code, DATE_FORMAT(expense_date, '%Y-%m') AS period_month, customer_code, contract_code,
		         0, 0, 0, SUM(expense_amount), 0, 0
		  FROM finance_expense
		  WHERE deleted_at IS NULL AND status <> 'canceled' AND project_code IS NOT NULL
		  GROUP BY project_code, DATE_FORMAT(expense_date, '%Y-%m'), customer_code, contract_code
		  UNION ALL
		  SELECT project_code, period_month, NULL, NULL,
		         0, 0, 0, 0,
		         SUM(CASE WHEN allocation_type = 'labor' THEN amount ELSE 0 END),
		         SUM(CASE WHEN allocation_type <> 'labor' THEN amount ELSE 0 END)
		  FROM project_cost_allocation
		  WHERE COALESCE(status, 'active') = 'active'
		    AND project_code IS NOT NULL AND project_code <> ''
		    AND period_month IS NOT NULL AND period_month <> ''
		  GROUP BY project_code, period_month
		  UNION ALL
		  SELECT project_code, period_month, customer_code, contract_code,
		         SUM(COALESCE(contract_amount, 0)), 0, 0, 0, 0, 0
		  FROM project_finance_summary
		  GROUP BY project_code, period_month, customer_code, contract_code
		) metric
		WHERE `+strings.Join(where, " AND ")+`
		GROUP BY metric.project_code, metric.period_month
	`, args...)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	for _, row := range rows {
		receivedAmount := amountFromMap(row, "received_amount")
		directExpenseAmount := amountFromMap(row, "direct_expense_amount")
		laborCostAmount := amountFromMap(row, "labor_cost_amount")
		allocatedCostAmount := amountFromMap(row, "allocated_cost_amount")
		grossProfitAmount := receivedAmount - directExpenseAmount - laborCostAmount - allocatedCostAmount
		var grossMarginRate any
		if receivedAmount > 0 {
			grossMarginRate = fmt.Sprintf("%.4f", grossProfitAmount/receivedAmount)
		}
		snapshot, _ := json.Marshal(map[string]any{
			"source":      "finance.recalculateProjectFinance",
			"projectCode": row["project_code"],
			"periodMonth": row["period_month"],
		})
		if _, err := a.db.ExecContext(ctx, `
			INSERT INTO project_finance_summary (
			  project_code, project_name, customer_code, contract_code, period_month,
			  contract_amount, invoice_amount, received_amount, direct_expense_amount,
			  labor_cost_amount, allocated_cost_amount, gross_profit_amount, gross_margin_rate,
			  calculated_at, calculation_source, snapshot_json
			) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'system', ?)
			ON DUPLICATE KEY UPDATE
			  customer_code = VALUES(customer_code),
			  contract_code = VALUES(contract_code),
			  contract_amount = VALUES(contract_amount),
			  invoice_amount = VALUES(invoice_amount),
			  received_amount = VALUES(received_amount),
			  direct_expense_amount = VALUES(direct_expense_amount),
			  labor_cost_amount = VALUES(labor_cost_amount),
			  allocated_cost_amount = VALUES(allocated_cost_amount),
			  gross_profit_amount = VALUES(gross_profit_amount),
			  gross_margin_rate = VALUES(gross_margin_rate),
			  calculated_at = NOW(),
			  calculation_source = 'system',
			  snapshot_json = VALUES(snapshot_json)
		`, row["project_code"], row["customer_code"], row["contract_code"], row["period_month"], fmt.Sprintf("%.2f", amountFromMap(row, "contract_amount")), fmt.Sprintf("%.2f", amountFromMap(row, "invoice_amount")), fmt.Sprintf("%.2f", receivedAmount), fmt.Sprintf("%.2f", directExpenseAmount), fmt.Sprintf("%.2f", laborCostAmount), fmt.Sprintf("%.2f", allocatedCostAmount), fmt.Sprintf("%.2f", grossProfitAmount), grossMarginRate, string(snapshot)); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}

	return resultData(map[string]any{"recalculated": len(rows)}), nil
}

func (a *Adapter) RecalculateEmployeePerformance(ctx context.Context, body jsonBody) (DataResult[map[string]any], error) {
	employeeUID := cleanStringValue(bodyValue(body, "employeeUid", "employee_uid"))
	monthValue := bodyValue(body, "periodMonth", "period_month")
	periodMonth := ""
	if monthValue != nil && cleanStringValue(monthValue) != "" {
		var err error
		periodMonth, err = periodMonthValue(monthValue)
		if err != nil {
			return DataResult[map[string]any]{}, err
		}
	}

	where := []string{"status = 'active'"}
	args := make([]any, 0)
	if employeeUID != "" {
		where = append(where, "employee_uid = ?")
		args = append(args, employeeUID)
	}
	if periodMonth != "" {
		where = append(where, "period_month = ?")
		args = append(args, periodMonth)
	}

	rows, err := queryMaps(ctx, a.db, `
		SELECT
		  employee_uid,
		  MAX(employee_name) AS employee_name,
		  MAX(dept_code) AS dept_code,
		  period_month,
		  SUM(COALESCE(contribution_amount, 0) * COALESCE(contribution_ratio, 1)) AS base_amount
		FROM employee_finance_contribution
		WHERE `+strings.Join(where, " AND ")+`
		GROUP BY employee_uid, period_month
	`, args...)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	calculatedBy := firstNonEmpty(cleanStringValue(bodyValue(body, "calculatedBy", "calculated_by")), "finance-system")
	for _, row := range rows {
		baseAmount := amountFromMap(row, "base_amount")
		code := performanceCode(cleanStringValue(row["employee_uid"]), cleanStringValue(row["period_month"]))
		snapshotMap := map[string]any{
			"source":            "finance.recalculateEmployeePerformance",
			"employeeUid":       row["employee_uid"],
			"periodMonth":       row["period_month"],
			"baseAmount":        fmt.Sprintf("%.2f", baseAmount),
			"performanceAmount": fmt.Sprintf("%.2f", baseAmount),
		}
		snapshot, _ := json.Marshal(snapshotMap)
		if _, err := a.db.ExecContext(ctx, `
			INSERT INTO employee_finance_performance (
			  code, employee_uid, employee_name, dept_code, period_month, performance_type,
			  base_amount, performance_amount, performance_score, status, calculated_at,
			  calculation_snapshot_json, created_by, updated_by
			) VALUES (?, ?, ?, ?, ?, 'commission', ?, ?, NULL, 'calculated', NOW(), ?, ?, ?)
			ON DUPLICATE KEY UPDATE
			  employee_name = VALUES(employee_name),
			  dept_code = VALUES(dept_code),
			  base_amount = VALUES(base_amount),
			  performance_amount = VALUES(performance_amount),
			  status = 'calculated',
			  calculated_at = NOW(),
			  calculation_snapshot_json = VALUES(calculation_snapshot_json),
			  updated_by = VALUES(updated_by)
		`, code, row["employee_uid"], row["employee_name"], row["dept_code"], row["period_month"], fmt.Sprintf("%.2f", baseAmount), fmt.Sprintf("%.2f", baseAmount), string(snapshot), calculatedBy, calculatedBy); err != nil {
			return DataResult[map[string]any]{}, err
		}
		hash := sha256.Sum256(snapshot)
		if _, err := a.db.ExecContext(ctx, `
			INSERT INTO performance_calculation_snapshot (
			  code, period_month, calculation_type, target_type, target_code,
			  input_hash, result_json, calculated_by, calculated_at
			) VALUES (?, ?, 'employee', 'employee', ?, ?, ?, ?, NOW())
		`, generateFinanceCode("PCS"), row["period_month"], row["employee_uid"], hex.EncodeToString(hash[:]), string(snapshot), calculatedBy); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}

	return resultData(map[string]any{"recalculated": len(rows)}), nil
}

func performanceCode(employeeUID string, month string) string {
	normalized := employeeUID + ":" + month
	hash := int32(0)
	for _, char := range normalized {
		hash = (hash << 5) - hash + int32(char)
	}
	if hash < 0 {
		hash = -hash
	}
	code := fmt.Sprintf("PERF%s%06s", strings.ReplaceAll(month, "-", ""), strings.ToUpper(strconv.FormatInt(int64(hash), 36)))
	if len(code) > 50 {
		return code[:50]
	}
	return code
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}
