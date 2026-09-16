package finance

import (
	"context"
	"database/sql"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func allocationCurrencyInput(value any) (any, error) {
	if value == nil || value == "" {
		return nil, nil
	}
	currency, ok := value.(string)
	if !ok || !productCostCurrencyPattern.MatchString(currency) {
		return nil, httperror.New(400, "invalid_allocation_currency", "currencyCode must be an explicit three-letter uppercase code")
	}
	return currency, nil
}

func (a *Adapter) UpsertProjectCostAllocation(ctx context.Context, body jsonBody) (DataResult[map[string]any], error) {
	code := firstNonEmpty(cleanStringValue(bodyValue(body, "code")), generateFinanceCode("PCA"))
	projectCode, err := requiredStringValue(bodyValue(body, "projectCode", "project_code"), "projectCode")
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := requireProjectFinanceBodyAccess(body, projectCode); err != nil {
		return DataResult[map[string]any]{}, err
	}
	managedSource := func(source, rule string) bool {
		return strings.EqualFold(source, managedLaborSourceTable) || strings.EqualFold(rule, managedLaborRuleCode)
	}
	managedError := func() error {
		return httperror.New(409, "managed_labor_sync_required", "自动人工成本须通过项目人工成本同步更新")
	}
	if managedSource(cleanStringValue(bodyValue(body, "sourceTable", "source_table")), cleanStringValue(bodyValue(body, "ruleCode", "rule_code"))) {
		return DataResult[map[string]any]{}, managedError()
	}
	month, err := periodMonthValue(bodyValue(body, "periodMonth", "period_month"))
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	amount, err := moneyStringValue(bodyValue(body, "amount"), "amount", true, false)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	currency, err := allocationCurrencyInput(bodyValue(body, "currencyCode", "currency_code"))
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	sourceID, err := numberOrNil(bodyValue(body, "sourceId", "source_id"), "sourceId")
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	basisValue, err := numberOrNil(bodyValue(body, "basisValue", "basis_value"), "basisValue")
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	defer tx.Rollback()
	var previousProject, previousSource, previousRule string
	err = tx.QueryRowContext(ctx, `SELECT project_code, COALESCE(source_table, ''), COALESCE(rule_code, '') FROM project_cost_allocation WHERE code = ? FOR UPDATE`, code).Scan(&previousProject, &previousSource, &previousRule)
	if err != nil && err != sql.ErrNoRows {
		return DataResult[map[string]any]{}, err
	}
	if err == nil {
		if err := requireProjectFinanceBodyAccess(body, previousProject); err != nil {
			return DataResult[map[string]any]{}, err
		}
		if managedSource(previousSource, previousRule) {
			return DataResult[map[string]any]{}, managedError()
		}
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO project_cost_allocation (
		  code,
		  project_code,
		  period_month,
		  allocation_type,
		  source_table,
		  source_id,
		  employee_uid,
		  amount,
		  currency_code,
		  allocation_basis,
		  basis_value,
		  rule_code,
		  status,
		  created_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
		  project_code = VALUES(project_code),
		  period_month = VALUES(period_month),
		  allocation_type = VALUES(allocation_type),
		  source_table = VALUES(source_table),
		  source_id = VALUES(source_id),
		  employee_uid = VALUES(employee_uid),
		  amount = VALUES(amount),
		  currency_code = VALUES(currency_code),
		  allocation_basis = VALUES(allocation_basis),
		  basis_value = VALUES(basis_value),
		  rule_code = VALUES(rule_code),
		  status = VALUES(status),
		  updated_at = NOW()
	`, code,
		projectCode,
		month,
		firstNonEmpty(cleanStringValue(bodyValue(body, "allocationType", "allocation_type")), "other"),
		nilString(bodyValue(body, "sourceTable", "source_table")),
		sourceID,
		nilString(bodyValue(body, "employeeUid", "employee_uid")),
		amount,
		currency,
		nilString(bodyValue(body, "allocationBasis", "allocation_basis")),
		basisValue,
		nilString(bodyValue(body, "ruleCode", "rule_code")),
		firstNonEmpty(cleanStringValue(bodyValue(body, "status")), "active"),
		nilString(bodyValue(body, "createdBy", "created_by")),
	)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	row, err := queryOneMap(ctx, tx, "SELECT * FROM project_cost_allocation WHERE code = ?", code)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := tx.Commit(); err != nil {
		return DataResult[map[string]any]{}, err
	}
	return resultData(row), nil
}
