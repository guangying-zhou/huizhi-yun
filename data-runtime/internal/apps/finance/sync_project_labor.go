package finance

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const (
	managedLaborSourceTable = "aims_time_entries_people_standard_cost_work_calendar"
	managedLaborRuleCode    = "std_labor_calendar_hours_v1"
)

type projectLaborMissingInput struct {
	Code        string `json:"code"`
	EmployeeUID string `json:"employeeUid,omitempty"`
}

type projectLaborItem struct {
	EmployeeUID          string `json:"employeeUid"`
	EmployeeName         string `json:"employeeName,omitempty"`
	DeptCode             string `json:"deptCode,omitempty"`
	PositionCode         string `json:"positionCode,omitempty"`
	RankCode             string `json:"rankCode,omitempty"`
	StandardCostAmount   string `json:"standardCostAmount"`
	ActualCostAmount     string `json:"actualCostAmount,omitempty"`
	ProjectHours         string `json:"projectHours"`
	StandardWorkHours    string `json:"standardWorkHours"`
	AllocationRatio      string `json:"allocationRatio"`
	AllocatedCostAmount  string `json:"allocatedCostAmount"`
	EmployeeSourceRefs   any    `json:"employeeSourceRefs,omitempty"`
	AllocationSourceRefs any    `json:"allocationSourceRefs,omitempty"`
}

type projectLaborSyncCommand struct {
	ProjectCode       string                     `json:"projectCode"`
	PeriodMonth       string                     `json:"periodMonth"`
	ReadinessStatus   string                     `json:"readinessStatus"`
	MissingInputs     []projectLaborMissingInput `json:"missingInputs"`
	CalculationRule   string                     `json:"calculationRule"`
	LaborItems        []projectLaborItem         `json:"laborItems"`
	CalculatedBy      string                     `json:"-"`
	ExpectedInputHash string                     `json:"-"`
}

func (a *Adapter) SyncProjectLaborCosts(ctx context.Context, body jsonBody) (DataResult[map[string]any], error) {
	command, err := parseProjectLaborSyncCommand(body)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := requireProjectFinanceBodyAccess(body, command.ProjectCode); err != nil {
		return DataResult[map[string]any]{}, err
	}
	inputHash, err := projectLaborInputHash(command)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO project_finance_summary (
		  project_code, period_month, gross_profit_amount, gross_margin_rate,
		  cost_readiness_status, calculated_at, calculation_source
		) VALUES (?, ?, NULL, NULL, 'not_ready', NOW(), 'system')
		ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
	`, command.ProjectCode, command.PeriodMonth); err != nil {
		return DataResult[map[string]any]{}, err
	}

	var currentInputHash sql.NullString
	if err := tx.QueryRowContext(ctx, `
		SELECT cost_input_hash
		FROM project_finance_summary
		WHERE project_code = ? AND period_month = ?
		FOR UPDATE
	`, command.ProjectCode, command.PeriodMonth).Scan(&currentInputHash); err != nil {
		return DataResult[map[string]any]{}, err
	}

	idempotentReplay := currentInputHash.Valid && currentInputHash.String == inputHash
	if !idempotentReplay && command.ExpectedInputHash != cleanStringValue(currentInputHash.String) {
		return DataResult[map[string]any]{}, httperror.New(
			http.StatusConflict,
			"project_labor_sync_conflict",
			"Project labor cost inputs changed after preflight; refresh and retry",
		)
	}

	for _, item := range command.LaborItems {
		employeeRefs, err := jsonOrNil(item.EmployeeSourceRefs)
		if err != nil {
			return DataResult[map[string]any]{}, err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO employee_cost_snapshot (
			  employee_uid, employee_name, dept_code, position_code, rank_code, period_month,
			  standard_cost_amount, actual_cost_amount, cost_source, source_refs_json
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'people_standard_cost', ?)
			ON DUPLICATE KEY UPDATE
			  employee_name = VALUES(employee_name),
			  dept_code = VALUES(dept_code),
			  position_code = VALUES(position_code),
			  rank_code = VALUES(rank_code),
			  standard_cost_amount = VALUES(standard_cost_amount),
			  actual_cost_amount = VALUES(actual_cost_amount),
			  cost_source = VALUES(cost_source),
			  source_refs_json = VALUES(source_refs_json),
			  updated_at = NOW()
		`, item.EmployeeUID, nilString(item.EmployeeName), nilString(item.DeptCode),
			nilString(item.PositionCode), nilString(item.RankCode), command.PeriodMonth,
			item.StandardCostAmount, nilString(item.ActualCostAmount), employeeRefs); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}

	allocationCodes := make([]string, 0, len(command.LaborItems))
	for _, item := range command.LaborItems {
		allocationCode := managedLaborAllocationCode(command.ProjectCode, command.PeriodMonth, item.EmployeeUID, command.CalculationRule)
		allocationCodes = append(allocationCodes, allocationCode)
		allocationRefs, err := jsonOrNil(item.AllocationSourceRefs)
		if err != nil {
			return DataResult[map[string]any]{}, err
		}
		refsText, _ := allocationRefs.(string)
		currency, _ := productCostAllocationCurrency(productCostAllocationFact{
			Code: allocationCode, ProjectCode: command.ProjectCode, PeriodMonth: command.PeriodMonth,
			EmployeeUID: item.EmployeeUID, AllocationType: "labor", SourceTable: managedLaborSourceTable,
			RuleCode: command.CalculationRule, Status: "active", Amount: item.AllocatedCostAmount,
			SourceRefs: json.RawMessage(refsText),
		})
		// Missing or inconsistent evidence stays unknown, including on resync.
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO project_cost_allocation (
			  code, project_code, period_month, allocation_type, source_table, source_id,
			  employee_uid, amount, allocation_basis, basis_value, rule_code,
			  source_refs_json, currency_code, status, created_by
			) VALUES (?, ?, ?, 'labor', ?, NULL, ?, ?, 'calendar_month_standard_hour_ratio', ?, ?, ?, ?, 'active', ?)
			ON DUPLICATE KEY UPDATE
			  project_code = VALUES(project_code),
			  period_month = VALUES(period_month),
			  allocation_type = 'labor',
			  source_table = VALUES(source_table),
			  source_id = NULL,
			  employee_uid = VALUES(employee_uid),
			  amount = VALUES(amount),
			  allocation_basis = VALUES(allocation_basis),
			  basis_value = VALUES(basis_value),
			  rule_code = VALUES(rule_code),
			  source_refs_json = VALUES(source_refs_json),
			  currency_code = VALUES(currency_code),
			  status = 'active',
			  updated_at = NOW()
		`, allocationCode, command.ProjectCode, command.PeriodMonth, managedLaborSourceTable,
			item.EmployeeUID, item.AllocatedCostAmount, item.AllocationRatio, command.CalculationRule,
			allocationRefs, nilString(currency), nilString(command.CalculatedBy)); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}

	reversed, err := reverseMissingManagedLaborAllocations(ctx, tx, command, allocationCodes)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	summary, err := updateProjectFinanceSummaryForLaborSync(ctx, tx, command, inputHash)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	if err := tx.Commit(); err != nil {
		return DataResult[map[string]any]{}, err
	}
	return resultData(map[string]any{
		"projectCode":                   command.ProjectCode,
		"periodMonth":                   command.PeriodMonth,
		"readinessStatus":               command.ReadinessStatus,
		"missingInputs":                 command.MissingInputs,
		"inputHash":                     inputHash,
		"idempotentReplay":              idempotentReplay,
		"employeeCostSnapshotsUpserted": len(command.LaborItems),
		"laborAllocationsUpserted":      len(command.LaborItems),
		"laborAllocationsReversed":      reversed,
		"summary":                       summary,
	}), nil
}

func parseProjectLaborSyncCommand(body jsonBody) (projectLaborSyncCommand, error) {
	projectCode, err := requiredStringValue(bodyValue(body, "projectCode", "project_code"), "projectCode")
	if err != nil {
		return projectLaborSyncCommand{}, err
	}
	periodMonth, err := periodMonthValue(bodyValue(body, "periodMonth", "period_month"))
	if err != nil {
		return projectLaborSyncCommand{}, err
	}
	status, err := requiredAllowedString(bodyValue(body, "readinessStatus", "readiness_status"), "readinessStatus", []string{"ready", "not_ready"})
	if err != nil {
		return projectLaborSyncCommand{}, err
	}
	if !bodyHas(body, "expectedInputHash", "expected_input_hash") {
		return projectLaborSyncCommand{}, httperror.New(http.StatusPreconditionRequired, "expected_input_hash_required", "expectedInputHash is required")
	}
	expectedInputHash := cleanStringValue(bodyValue(body, "expectedInputHash", "expected_input_hash"))
	if expectedInputHash != "" && (len(expectedInputHash) != 64 || !isLowerHex(expectedInputHash)) {
		return projectLaborSyncCommand{}, httperror.New(http.StatusBadRequest, "invalid_expected_input_hash", "expectedInputHash must be a lowercase SHA-256 hex string or null")
	}
	calculationRule := firstNonEmpty(cleanStringValue(bodyValue(body, "calculationRule", "calculation_rule")), managedLaborRuleCode)
	if calculationRule != managedLaborRuleCode {
		return projectLaborSyncCommand{}, httperror.New(http.StatusBadRequest, "invalid_calculation_rule", "Unsupported project labor calculation rule")
	}

	missingInputs, err := parseProjectLaborMissingInputs(bodyValue(body, "missingInputs", "missing_inputs"))
	if err != nil {
		return projectLaborSyncCommand{}, err
	}
	items, err := parseProjectLaborItems(bodyValue(body, "laborItems", "labor_items"))
	if err != nil {
		return projectLaborSyncCommand{}, err
	}
	if status == "ready" && (len(missingInputs) > 0 || len(items) == 0) {
		return projectLaborSyncCommand{}, httperror.New(http.StatusBadRequest, "invalid_ready_labor_sync", "Ready labor sync requires a non-empty complete item set and no missing inputs")
	}
	if status == "not_ready" && len(missingInputs) == 0 {
		return projectLaborSyncCommand{}, httperror.New(http.StatusBadRequest, "invalid_not_ready_labor_sync", "Not-ready labor sync requires at least one missing input")
	}

	return projectLaborSyncCommand{
		ProjectCode:       projectCode,
		PeriodMonth:       periodMonth,
		ReadinessStatus:   status,
		MissingInputs:     missingInputs,
		CalculationRule:   calculationRule,
		LaborItems:        items,
		CalculatedBy:      firstNonEmpty(cleanStringValue(bodyValue(body, "calculatedBy", "calculated_by")), auditOperatorID(body)),
		ExpectedInputHash: expectedInputHash,
	}, nil
}

func parseProjectLaborMissingInputs(value any) ([]projectLaborMissingInput, error) {
	raw, ok := value.([]any)
	if value == nil {
		return []projectLaborMissingInput{}, nil
	}
	if !ok || len(raw) > 500 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_missing_inputs", "missingInputs must be an array with at most 500 items")
	}
	result := make([]projectLaborMissingInput, 0, len(raw))
	seen := map[string]bool{}
	for _, value := range raw {
		item, ok := value.(map[string]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "invalid_missing_inputs", "Each missing input must be an object")
		}
		code := cleanStringValue(item["code"])
		employeeUID := cleanStringValue(firstSet(item["employeeUid"], item["employee_uid"]))
		if code == "" {
			return nil, httperror.New(http.StatusBadRequest, "invalid_missing_inputs", "Each missing input requires code")
		}
		key := code + "\x00" + employeeUID
		if !seen[key] {
			seen[key] = true
			result = append(result, projectLaborMissingInput{Code: code, EmployeeUID: employeeUID})
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Code == result[j].Code {
			return result[i].EmployeeUID < result[j].EmployeeUID
		}
		return result[i].Code < result[j].Code
	})
	return result, nil
}

func parseProjectLaborItems(value any) ([]projectLaborItem, error) {
	raw, ok := value.([]any)
	if value == nil {
		return []projectLaborItem{}, nil
	}
	if !ok || len(raw) > 500 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_labor_items", "laborItems must be an array with at most 500 items")
	}
	items := make([]projectLaborItem, 0, len(raw))
	seen := map[string]bool{}
	for _, value := range raw {
		item, ok := value.(map[string]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "invalid_labor_item", "Each labor item must be an object")
		}
		employeeUID, err := requiredStringValue(firstSet(item["employeeUid"], item["employee_uid"]), "employeeUid")
		if err != nil {
			return nil, err
		}
		if seen[employeeUID] {
			return nil, httperror.New(http.StatusBadRequest, "duplicate_labor_employee", "laborItems contains a duplicate employeeUid")
		}
		seen[employeeUID] = true
		standardCost, err := nonnegativeDecimal(firstSet(item["standardCostAmount"], item["standard_cost_amount"]), "standardCostAmount", 2, true)
		if err != nil {
			return nil, err
		}
		actualCost, err := nonnegativeDecimal(firstSet(item["actualCostAmount"], item["actual_cost_amount"]), "actualCostAmount", 2, false)
		if err != nil {
			return nil, err
		}
		projectHours, err := nonnegativeDecimal(firstSet(item["projectHours"], item["project_hours"]), "projectHours", 4, true)
		if err != nil {
			return nil, err
		}
		standardWorkHours, err := nonnegativeDecimal(firstSet(item["standardWorkHours"], item["standard_work_hours"]), "standardWorkHours", 4, true)
		if err != nil {
			return nil, err
		}
		allocationRatio, err := nonnegativeDecimal(firstSet(item["allocationRatio"], item["allocation_ratio"]), "allocationRatio", 4, true)
		if err != nil {
			return nil, err
		}
		allocatedCost, err := nonnegativeDecimal(firstSet(item["allocatedCostAmount"], item["allocated_cost_amount"]), "allocatedCostAmount", 2, true)
		if err != nil {
			return nil, err
		}
		items = append(items, projectLaborItem{
			EmployeeUID:          employeeUID,
			EmployeeName:         cleanStringValue(firstSet(item["employeeName"], item["employee_name"])),
			DeptCode:             cleanStringValue(firstSet(item["deptCode"], item["dept_code"])),
			PositionCode:         cleanStringValue(firstSet(item["positionCode"], item["position_code"])),
			RankCode:             cleanStringValue(firstSet(item["rankCode"], item["rank_code"])),
			StandardCostAmount:   standardCost,
			ActualCostAmount:     actualCost,
			ProjectHours:         projectHours,
			StandardWorkHours:    standardWorkHours,
			AllocationRatio:      allocationRatio,
			AllocatedCostAmount:  allocatedCost,
			EmployeeSourceRefs:   firstSet(item["employeeSourceRefs"], item["employee_source_refs"]),
			AllocationSourceRefs: firstSet(item["allocationSourceRefs"], item["allocation_source_refs"]),
		})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].EmployeeUID < items[j].EmployeeUID })
	return items, nil
}

func nonnegativeDecimal(value any, field string, precision int, required bool) (string, error) {
	text := cleanStringValue(value)
	if text == "" {
		if required {
			return "", httperror.New(http.StatusBadRequest, "field_required", field+" is required")
		}
		return "", nil
	}
	number, err := strconv.ParseFloat(strings.ReplaceAll(text, ",", ""), 64)
	if err != nil || math.IsNaN(number) || math.IsInf(number, 0) || number < 0 {
		return "", httperror.New(http.StatusBadRequest, "invalid_number", field+" must be a non-negative number")
	}
	return strconv.FormatFloat(number, 'f', precision, 64), nil
}

func projectLaborInputHash(command projectLaborSyncCommand) (string, error) {
	encoded, err := json.Marshal(command)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(encoded)
	return hex.EncodeToString(hash[:]), nil
}

func managedLaborAllocationCode(projectCode string, periodMonth string, employeeUID string, ruleCode string) string {
	hash := sha256.Sum256([]byte(projectCode + ":" + periodMonth + ":" + employeeUID + ":" + ruleCode))
	return "PCL" + strings.ReplaceAll(periodMonth, "-", "") + hex.EncodeToString(hash[:20])
}

func reverseMissingManagedLaborAllocations(
	ctx context.Context,
	tx *sql.Tx,
	command projectLaborSyncCommand,
	allocationCodes []string,
) (int64, error) {
	query := `
		UPDATE project_cost_allocation
		SET status = 'reversed', updated_at = NOW()
		WHERE project_code = ?
		  AND period_month = ?
		  AND allocation_type = 'labor'
		  AND source_table = ?
		  AND rule_code = ?
		  AND COALESCE(status, 'active') = 'active'`
	args := []any{command.ProjectCode, command.PeriodMonth, managedLaborSourceTable, command.CalculationRule}
	if len(allocationCodes) > 0 {
		query += " AND code NOT IN (" + strings.TrimRight(strings.Repeat("?,", len(allocationCodes)), ",") + ")"
		for _, code := range allocationCodes {
			args = append(args, code)
		}
	}
	result, err := tx.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func updateProjectFinanceSummaryForLaborSync(
	ctx context.Context,
	tx *sql.Tx,
	command projectLaborSyncCommand,
	inputHash string,
) (map[string]any, error) {
	var customerCode sql.NullString
	var contractCode sql.NullString
	var contractAmountText string
	var invoiceAmountText string
	var receivedAmountText string
	var directExpenseAmountText string
	var laborCostAmountText string
	var allocatedCostAmountText string
	err := tx.QueryRowContext(ctx, `
		SELECT
		  COALESCE(
		    (SELECT MAX(customer_code) FROM finance_invoice WHERE deleted_at IS NULL AND status NOT IN ('canceled', 'red_reversed') AND project_code = ? AND DATE_FORMAT(invoice_date, '%Y-%m') = ?),
		    (SELECT MAX(customer_code) FROM finance_receipt WHERE deleted_at IS NULL AND status <> 'canceled' AND project_code = ? AND DATE_FORMAT(received_at, '%Y-%m') = ?),
		    (SELECT MAX(customer_code) FROM finance_expense WHERE deleted_at IS NULL AND status <> 'canceled' AND project_code = ? AND DATE_FORMAT(expense_date, '%Y-%m') = ?),
		    summary.customer_code
		  ),
		  COALESCE(
		    (SELECT MAX(contract_code) FROM finance_invoice WHERE deleted_at IS NULL AND status NOT IN ('canceled', 'red_reversed') AND project_code = ? AND DATE_FORMAT(invoice_date, '%Y-%m') = ?),
		    (SELECT MAX(contract_code) FROM finance_receipt WHERE deleted_at IS NULL AND status <> 'canceled' AND project_code = ? AND DATE_FORMAT(received_at, '%Y-%m') = ?),
		    (SELECT MAX(contract_code) FROM finance_expense WHERE deleted_at IS NULL AND status <> 'canceled' AND project_code = ? AND DATE_FORMAT(expense_date, '%Y-%m') = ?),
		    summary.contract_code
		  ),
		  CAST(COALESCE(summary.contract_amount, 0) AS CHAR),
		  CAST(COALESCE((SELECT SUM(invoice_amount) FROM finance_invoice WHERE deleted_at IS NULL AND status NOT IN ('canceled', 'red_reversed') AND project_code = ? AND DATE_FORMAT(invoice_date, '%Y-%m') = ?), 0) AS CHAR),
		  CAST(COALESCE((SELECT SUM(received_amount) FROM finance_receipt WHERE deleted_at IS NULL AND status <> 'canceled' AND project_code = ? AND DATE_FORMAT(received_at, '%Y-%m') = ?), 0) AS CHAR),
		  CAST(COALESCE((SELECT SUM(expense_amount) FROM finance_expense WHERE deleted_at IS NULL AND status <> 'canceled' AND project_code = ? AND DATE_FORMAT(expense_date, '%Y-%m') = ?), 0) AS CHAR),
		  CAST(COALESCE((SELECT SUM(amount) FROM project_cost_allocation WHERE COALESCE(status, 'active') = 'active' AND allocation_type = 'labor' AND project_code = ? AND period_month = ?), 0) AS CHAR),
		  CAST(COALESCE((SELECT SUM(amount) FROM project_cost_allocation WHERE COALESCE(status, 'active') = 'active' AND allocation_type <> 'labor' AND project_code = ? AND period_month = ?), 0) AS CHAR)
		FROM project_finance_summary summary
		WHERE summary.project_code = ? AND summary.period_month = ?
		FOR UPDATE
	`,
		command.ProjectCode, command.PeriodMonth, command.ProjectCode, command.PeriodMonth, command.ProjectCode, command.PeriodMonth,
		command.ProjectCode, command.PeriodMonth, command.ProjectCode, command.PeriodMonth, command.ProjectCode, command.PeriodMonth,
		command.ProjectCode, command.PeriodMonth, command.ProjectCode, command.PeriodMonth, command.ProjectCode, command.PeriodMonth,
		command.ProjectCode, command.PeriodMonth, command.ProjectCode, command.PeriodMonth,
		command.ProjectCode, command.PeriodMonth,
	).Scan(
		&customerCode, &contractCode, &contractAmountText, &invoiceAmountText, &receivedAmountText,
		&directExpenseAmountText, &laborCostAmountText, &allocatedCostAmountText,
	)
	if err != nil {
		return nil, err
	}

	receivedAmount := parseDecimal(receivedAmountText)
	directExpenseAmount := parseDecimal(directExpenseAmountText)
	laborCostAmount := parseDecimal(laborCostAmountText)
	allocatedCostAmount := parseDecimal(allocatedCostAmountText)
	var grossProfitAmount any
	var grossMarginRate any
	if command.ReadinessStatus == "ready" {
		gross := receivedAmount - directExpenseAmount - laborCostAmount - allocatedCostAmount
		grossProfitAmount = fmt.Sprintf("%.2f", gross)
		if receivedAmount > 0 {
			grossMarginRate = fmt.Sprintf("%.4f", gross/receivedAmount)
		}
	}
	reasonsJSON, err := jsonOrNil(command.MissingInputs)
	if err != nil {
		return nil, err
	}
	snapshotJSON, err := jsonOrNil(map[string]any{
		"source":          "finance.syncProjectLaborCosts",
		"projectCode":     command.ProjectCode,
		"periodMonth":     command.PeriodMonth,
		"calculationRule": command.CalculationRule,
		"inputHash":       inputHash,
	})
	if err != nil {
		return nil, err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE project_finance_summary
		SET customer_code = ?,
		    contract_code = ?,
		    contract_amount = ?,
		    invoice_amount = ?,
		    received_amount = ?,
		    direct_expense_amount = ?,
		    labor_cost_amount = ?,
		    allocated_cost_amount = ?,
		    gross_profit_amount = ?,
		    gross_margin_rate = ?,
		    cost_readiness_status = ?,
		    cost_readiness_reasons_json = ?,
		    cost_input_hash = ?,
		    cost_readiness_checked_at = CURRENT_TIMESTAMP(6),
		    calculated_at = NOW(),
		    calculation_source = 'system',
		    snapshot_json = ?
		WHERE project_code = ? AND period_month = ?
	`, nullableSQLString(customerCode), nullableSQLString(contractCode), contractAmountText, invoiceAmountText,
		receivedAmountText, directExpenseAmountText, laborCostAmountText, allocatedCostAmountText,
		grossProfitAmount, grossMarginRate, command.ReadinessStatus, reasonsJSON, inputHash, snapshotJSON,
		command.ProjectCode, command.PeriodMonth); err != nil {
		return nil, err
	}
	return queryOneMap(ctx, tx, `
		SELECT project_code, period_month, invoice_amount, received_amount, direct_expense_amount,
		       labor_cost_amount, allocated_cost_amount, gross_profit_amount, gross_margin_rate,
		       cost_readiness_status, cost_readiness_reasons_json, cost_input_hash,
		       cost_readiness_checked_at
		FROM project_finance_summary
		WHERE project_code = ? AND period_month = ?
	`, command.ProjectCode, command.PeriodMonth)
}

func parseDecimal(value string) float64 {
	number, _ := strconv.ParseFloat(value, 64)
	return number
}

func nullableSQLString(value sql.NullString) any {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}
	return value.String
}

func isLowerHex(value string) bool {
	for _, char := range value {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return value != ""
}

func firstSet(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}
