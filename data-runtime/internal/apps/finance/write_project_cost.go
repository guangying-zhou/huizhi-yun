package finance

import "context"

func (a *Adapter) UpsertProjectCostAllocation(ctx context.Context, body jsonBody) (DataResult[map[string]any], error) {
	code := firstNonEmpty(cleanStringValue(bodyValue(body, "code")), generateFinanceCode("PCA"))
	projectCode, err := requiredStringValue(bodyValue(body, "projectCode", "project_code"), "projectCode")
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := requireProjectFinanceBodyAccess(body, projectCode); err != nil {
		return DataResult[map[string]any]{}, err
	}
	month, err := periodMonthValue(bodyValue(body, "periodMonth", "period_month"))
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	amount, err := moneyStringValue(bodyValue(body, "amount"), "amount", true, false)
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

	_, err = a.db.ExecContext(ctx, `
		INSERT INTO project_cost_allocation (
		  code,
		  project_code,
		  period_month,
		  allocation_type,
		  source_table,
		  source_id,
		  employee_uid,
		  amount,
		  allocation_basis,
		  basis_value,
		  rule_code,
		  status,
		  created_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
		  project_code = VALUES(project_code),
		  period_month = VALUES(period_month),
		  allocation_type = VALUES(allocation_type),
		  source_table = VALUES(source_table),
		  source_id = VALUES(source_id),
		  employee_uid = VALUES(employee_uid),
		  amount = VALUES(amount),
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
		nilString(bodyValue(body, "allocationBasis", "allocation_basis")),
		basisValue,
		nilString(bodyValue(body, "ruleCode", "rule_code")),
		firstNonEmpty(cleanStringValue(bodyValue(body, "status")), "active"),
		nilString(bodyValue(body, "createdBy", "created_by")),
	)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	row, err := queryOneMap(ctx, a.db, "SELECT * FROM project_cost_allocation WHERE code = ?", code)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	return resultData(row), nil
}
