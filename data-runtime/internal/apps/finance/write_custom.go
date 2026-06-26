package finance

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) UpsertBankAccountBalance(ctx context.Context, code string, body jsonBody) (DataResult[map[string]any], error) {
	accountCode := firstNonEmpty(code, cleanStringValue(bodyValue(body, "accountCode", "account_code")))
	if accountCode == "" {
		return DataResult[map[string]any]{}, httperror.New(http.StatusBadRequest, "field_required", "accountCode is required")
	}
	account, err := queryOneMap(ctx, a.db, "SELECT id FROM finance_bank_account WHERE code = ? AND deleted_at IS NULL", accountCode)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if account == nil {
		return DataResult[map[string]any]{}, notFound("bank account not found")
	}
	snapshotDate, err := optionalDateValue(bodyValue(body, "snapshotDate", "snapshot_date"))
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if snapshotDate == nil {
		snapshotDate = todayDate()
	}
	balanceAmount, err := moneyStringValue(bodyValue(body, "balanceAmount", "balance_amount"), "balanceAmount", true, false)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	createdBy := firstNonEmpty(cleanStringValue(bodyValue(body, "createdBy", "created_by")), "unknown")
	if _, err := a.db.ExecContext(ctx, `
		INSERT INTO finance_account_balance_snapshot (
		  bank_account_id, snapshot_date, balance_amount, currency_code, source_type, created_by
		) VALUES (?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
		  balance_amount = VALUES(balance_amount),
		  currency_code = VALUES(currency_code),
		  created_by = VALUES(created_by),
		  created_at = CURRENT_TIMESTAMP
	`, account["id"], snapshotDate, balanceAmount, firstNonEmpty(cleanStringValue(bodyValue(body, "currencyCode", "currency_code")), "CNY"), "manual", createdBy); err != nil {
		return DataResult[map[string]any]{}, err
	}
	row, err := queryOneMap(ctx, a.db, `
		SELECT *
		FROM finance_account_balance_snapshot
		WHERE bank_account_id = ? AND snapshot_date = ? AND source_type = ?
		LIMIT 1
	`, account["id"], snapshotDate, "manual")
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	return resultData(row), nil
}

func (a *Adapter) RedReverseInvoice(ctx context.Context, code string, body jsonBody) (DataResult[map[string]any], error) {
	if err := requireCodePath(code); err != nil {
		return DataResult[map[string]any]{}, err
	}
	reason, err := requiredStringValue(bodyValue(body, "reason", "redReverseReason", "red_reverse_reason"), "reason")
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	operatorID := auditOperatorID(body)
	redInvoiceNo := cleanStringValue(bodyValue(body, "redInvoiceNo", "red_invoice_no"))

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	defer tx.Rollback()

	before, err := queryOneMap(ctx, tx, "SELECT * FROM finance_invoice WHERE code = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE", code)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if before == nil {
		return DataResult[map[string]any]{}, notFound("invoice not found")
	}
	status := cleanStringValue(before["status"])
	if status == "red_reversed" {
		return DataResult[map[string]any]{}, httperror.New(http.StatusBadRequest, "invoice_already_red_reversed", "invoice is already red reversed")
	}
	if status == "canceled" {
		return DataResult[map[string]any]{}, httperror.New(http.StatusBadRequest, "invoice_canceled", "canceled invoice cannot be red reversed")
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE finance_invoice
		SET status = 'red_reversed',
		    source_refs_json = JSON_SET(
		      COALESCE(source_refs_json, JSON_OBJECT()),
		      '$.redReverse',
		      JSON_OBJECT(
		        'reason', ?,
		        'redInvoiceNo', ?,
		        'operatorId', ?,
		        'reversedAt', DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%dT%H:%i:%sZ')
		      )
		    ),
		    remark = COALESCE(NULLIF(?, ''), remark),
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE code = ? AND deleted_at IS NULL
	`, reason, redInvoiceNo, operatorID, cleanStringValue(bodyValue(body, "remark")), nilString(operatorID), code); err != nil {
		return DataResult[map[string]any]{}, err
	}

	if err := a.recalculateContractSummary(ctx, tx, before["contract_code"]); err != nil {
		return DataResult[map[string]any]{}, err
	}

	updated, err := queryOneMap(ctx, tx, "SELECT * FROM finance_invoice WHERE code = ? AND deleted_at IS NULL LIMIT 1", code)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	if err := writeFinanceAuditLog(ctx, tx, "invoice", before["id"], code, "reverse", before, map[string]any{
		"code":         code,
		"status":       "red_reversed",
		"reason":       reason,
		"redInvoiceNo": redInvoiceNo,
		"operatorId":   operatorID,
	}, operatorID); err != nil {
		return DataResult[map[string]any]{}, err
	}

	if err := tx.Commit(); err != nil {
		return DataResult[map[string]any]{}, err
	}
	return resultData(updated), nil
}

func (a *Adapter) CreateSubjectMapping(ctx context.Context, body jsonBody) (DataResult[map[string]any], error) {
	bizType, err := requiredStringValue(bodyValue(body, "bizType", "biz_type"), "bizType")
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	defaultSubjectCode, err := requiredStringValue(bodyValue(body, "defaultSubjectCode", "default_subject_code"), "defaultSubjectCode")
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	objectStrategy, err := requiredStringValue(bodyValue(body, "objectStrategy", "object_strategy"), "objectStrategy")
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	dimensions, err := jsonOrNil(bodyValue(body, "requiredDimensions", "required_dimensions_json"))
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	status, err := allowedString(firstNonEmpty(cleanStringValue(bodyValue(body, "status")), "active"), "status", []string{"active", "inactive"})
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	sortNo, err := numberOrNil(bodyValue(body, "sortNo", "sort_no"), "sortNo")
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if sortNo == nil {
		sortNo = int64(0)
	}
	bizSubtype := firstNonEmpty(cleanStringValue(bodyValue(body, "bizSubtype", "biz_subtype")), "")
	incomeTypeCode := firstNonEmpty(cleanStringValue(bodyValue(body, "incomeTypeCode", "income_type_code")), "")
	expenseTypeCode := firstNonEmpty(cleanStringValue(bodyValue(body, "expenseTypeCode", "expense_type_code")), "")
	if _, err := a.db.ExecContext(ctx, `
		INSERT INTO finance_subject_mapping (
		  biz_type, biz_subtype, income_type_code, expense_type_code, default_subject_code,
		  object_strategy, required_dimensions_json, status, sort_no, remark
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, bizType, bizSubtype, incomeTypeCode, expenseTypeCode, defaultSubjectCode, objectStrategy, dimensions, status, sortNo, nilString(bodyValue(body, "remark"))); err != nil {
		return DataResult[map[string]any]{}, err
	}
	row, err := queryOneMap(ctx, a.db, `
		SELECT *
		FROM finance_subject_mapping
		WHERE biz_type = ? AND biz_subtype = ? AND income_type_code = ? AND expense_type_code = ?
		LIMIT 1
	`, bizType, bizSubtype, incomeTypeCode, expenseTypeCode)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	return resultData(row), nil
}

func (a *Adapter) UpsertEmployeeCost(ctx context.Context, body jsonBody) (DataResult[map[string]any], error) {
	employeeUID, err := requiredStringValue(bodyValue(body, "employeeUid", "employee_uid"), "employeeUid")
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	month, err := periodMonthValue(bodyValue(body, "periodMonth", "period_month"))
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	standardCost, err := moneyStringValue(bodyValue(body, "standardCostAmount", "standard_cost_amount"), "standardCostAmount", false, false)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	actualCost, err := moneyStringValue(bodyValue(body, "actualCostAmount", "actual_cost_amount"), "actualCostAmount", false, false)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	sourceRefs, err := jsonOrNil(bodyValue(body, "sourceRefs", "source_refs_json"))
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if _, err := a.db.ExecContext(ctx, `
		INSERT INTO employee_cost_snapshot (
		  employee_uid, employee_name, dept_code, position_code, rank_code, period_month,
		  standard_cost_amount, actual_cost_amount, cost_source, source_refs_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
		  employee_name = VALUES(employee_name),
		  dept_code = VALUES(dept_code),
		  position_code = VALUES(position_code),
		  rank_code = VALUES(rank_code),
		  standard_cost_amount = VALUES(standard_cost_amount),
		  actual_cost_amount = VALUES(actual_cost_amount),
		  cost_source = VALUES(cost_source),
		  source_refs_json = VALUES(source_refs_json)
	`, employeeUID, nilString(bodyValue(body, "employeeName", "employee_name")), nilString(bodyValue(body, "deptCode", "dept_code")), nilString(bodyValue(body, "positionCode", "position_code")), nilString(bodyValue(body, "rankCode", "rank_code")), month, standardCost, actualCost, firstNonEmpty(cleanStringValue(bodyValue(body, "costSource", "cost_source")), "manual"), sourceRefs); err != nil {
		return DataResult[map[string]any]{}, err
	}
	row, err := queryOneMap(ctx, a.db, "SELECT * FROM employee_cost_snapshot WHERE employee_uid = ? AND period_month = ?", employeeUID, month)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	return resultData(row), nil
}

func (a *Adapter) CreateExpenseClaim(ctx context.Context, body jsonBody) (DataResult[map[string]any], error) {
	if err := requireApplicantRequestCreateAccess(body); err != nil {
		return DataResult[map[string]any]{}, err
	}
	return a.createRequestWithItems(ctx, body, requestWithItemsSpec{
		table: "expense_claim", itemTable: "expense_claim_item", codePrefix: "CLM",
		titleDefault: "费用报销", notFoundTable: "expense_claim",
		headerColumns: []string{"code", "title", "applicant_user_id", "applicant_dept_code", "project_code", "contract_code", "customer_code", "total_amount", "currency_code", "cost_bearer_type", "cost_bearer_code", "status", "remark", "created_by", "updated_by"},
		headerValues: func(code string, status string) ([]any, error) {
			amount, err := moneyStringValue(bodyValue(body, "totalAmount", "total_amount"), "totalAmount", true, true)
			if err != nil {
				return nil, err
			}
			return []any{code, firstNonEmpty(cleanStringValue(bodyValue(body, "title")), "费用报销"), firstNonEmpty(cleanStringValue(bodyValue(body, "applicantUserId", "applicant_user_id")), cleanStringValue(bodyValue(body, "createdBy", "created_by")), "unknown"), nilString(bodyValue(body, "applicantDeptCode", "applicant_dept_code")), nilString(bodyValue(body, "projectCode", "project_code")), nilString(bodyValue(body, "contractCode", "contract_code")), nilString(bodyValue(body, "customerCode", "customer_code")), amount, firstNonEmpty(cleanStringValue(bodyValue(body, "currencyCode", "currency_code")), "CNY"), nilString(bodyValue(body, "costBearerType", "cost_bearer_type")), nilString(bodyValue(body, "costBearerCode", "cost_bearer_code")), status, nilString(bodyValue(body, "remark")), nilString(bodyValue(body, "createdBy", "created_by")), nilString(bodyValue(body, "updatedBy", "updated_by"))}, nil
		},
		itemColumns: []string{"claim_id", "expense_type_id", "subject_id", "occurred_at", "amount", "tax_amount", "invoice_no", "description", "sort_no"},
		itemValues:  expenseClaimItemValues,
	})
}

func (a *Adapter) CreateProjectExpenseRequest(ctx context.Context, body jsonBody) (DataResult[map[string]any], error) {
	if err := requireApplicantRequestCreateAccess(body); err != nil {
		return DataResult[map[string]any]{}, err
	}
	return a.createRequestWithItems(ctx, body, requestWithItemsSpec{
		table: "project_expense_request", itemTable: "project_expense_request_item", codePrefix: "PER",
		titleDefault: "项目支出申请", notFoundTable: "project_expense_request",
		headerColumns: []string{"code", "title", "applicant_user_id", "applicant_dept_code", "project_code", "contract_code", "customer_code", "supplier_code", "total_amount", "status", "remark", "created_by", "updated_by"},
		headerValues: func(code string, status string) ([]any, error) {
			amount, err := moneyStringValue(bodyValue(body, "totalAmount", "total_amount"), "totalAmount", true, true)
			if err != nil {
				return nil, err
			}
			return []any{code, firstNonEmpty(cleanStringValue(bodyValue(body, "title")), "项目支出申请"), firstNonEmpty(cleanStringValue(bodyValue(body, "applicantUserId", "applicant_user_id")), cleanStringValue(bodyValue(body, "createdBy", "created_by")), "unknown"), nilString(bodyValue(body, "applicantDeptCode", "applicant_dept_code")), firstNonEmpty(cleanStringValue(bodyValue(body, "projectCode", "project_code")), "UNKNOWN"), nilString(bodyValue(body, "contractCode", "contract_code")), nilString(bodyValue(body, "customerCode", "customer_code")), nilString(bodyValue(body, "supplierCode", "supplier_code")), amount, status, nilString(bodyValue(body, "remark")), nilString(bodyValue(body, "createdBy", "created_by")), nilString(bodyValue(body, "updatedBy", "updated_by"))}, nil
		},
		itemColumns: []string{"request_id", "expense_type_id", "subject_id", "item_name", "amount", "quantity", "unit_price", "description", "sort_no"},
		itemValues:  projectExpenseItemValues,
	})
}

type requestWithItemsSpec struct {
	table         string
	itemTable     string
	codePrefix    string
	titleDefault  string
	notFoundTable string
	headerColumns []string
	headerValues  func(code string, status string) ([]any, error)
	itemColumns   []string
	itemValues    func(jsonBody, jsonBody, int, int64) ([]any, error)
}

func (a *Adapter) createRequestWithItems(ctx context.Context, body jsonBody, spec requestWithItemsSpec) (DataResult[map[string]any], error) {
	code := firstNonEmpty(cleanStringValue(bodyValue(body, "code")), generateFinanceCode(spec.codePrefix))
	statusValue, err := allowedString(firstNonEmpty(cleanStringValue(bodyValue(body, "status")), "draft"), "status", []string{"draft", "pending_approval", "approved", "rejected", "paid", "canceled"})
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	status := cleanStringValue(statusValue)
	items, _ := body["items"].([]any)

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	defer tx.Rollback()

	headerValues, err := spec.headerValues(code, status)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	result, err := tx.ExecContext(ctx, "INSERT INTO "+spec.table+" ("+strings.Join(spec.headerColumns, ", ")+") VALUES ("+placeholders(len(headerValues))+")", headerValues...)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	id, err := insertID(result)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	for index, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		values, err := spec.itemValues(body, item, index, id)
		if err != nil {
			return DataResult[map[string]any]{}, err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO "+spec.itemTable+" ("+strings.Join(spec.itemColumns, ", ")+") VALUES ("+placeholders(len(values))+")", values...); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}
	row, err := queryOneMap(ctx, tx, "SELECT * FROM "+spec.table+" WHERE code = ?", code)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := tx.Commit(); err != nil {
		return DataResult[map[string]any]{}, err
	}
	return resultData(row), nil
}

func expenseClaimItemValues(_ jsonBody, item jsonBody, index int, id int64) ([]any, error) {
	expenseTypeID, err := numberOrNil(bodyValue(item, "expenseTypeId", "expense_type_id"), "expenseTypeId")
	if err != nil {
		return nil, err
	}
	subjectID, err := numberOrNil(bodyValue(item, "subjectId", "subject_id"), "subjectId")
	if err != nil {
		return nil, err
	}
	occurredAt, err := optionalDateValue(bodyValue(item, "occurredAt", "occurred_at"))
	if err != nil {
		return nil, err
	}
	amount, err := moneyStringValue(bodyValue(item, "amount"), "item.amount", true, true)
	if err != nil {
		return nil, err
	}
	taxAmount, err := moneyStringValue(bodyValue(item, "taxAmount", "tax_amount"), "item.taxAmount", false, false)
	if err != nil {
		return nil, err
	}
	return []any{id, expenseTypeID, subjectID, occurredAt, amount, taxAmount, nilString(bodyValue(item, "invoiceNo", "invoice_no")), nilString(bodyValue(item, "description")), index}, nil
}

func projectExpenseItemValues(header jsonBody, item jsonBody, index int, id int64) ([]any, error) {
	expenseTypeID, err := numberOrNil(bodyValue(item, "expenseTypeId", "expense_type_id"), "expenseTypeId")
	if err != nil {
		return nil, err
	}
	subjectID, err := numberOrNil(bodyValue(item, "subjectId", "subject_id"), "subjectId")
	if err != nil {
		return nil, err
	}
	amount, err := moneyStringValue(bodyValue(item, "amount"), "item.amount", true, true)
	if err != nil {
		return nil, err
	}
	quantity, err := numberOrNil(bodyValue(item, "quantity"), "item.quantity")
	if err != nil {
		return nil, err
	}
	unitPrice, err := moneyStringValue(bodyValue(item, "unitPrice", "unit_price"), "item.unitPrice", false, false)
	if err != nil {
		return nil, err
	}
	itemName := firstNonEmpty(cleanStringValue(bodyValue(item, "itemName", "item_name")), cleanStringValue(bodyValue(header, "title")), "项目支出")
	return []any{id, expenseTypeID, subjectID, itemName, amount, quantity, unitPrice, nilString(bodyValue(item, "description")), index}, nil
}

func (a *Adapter) updateReceiptReconciliationState(ctx context.Context, conn execQueryer, receiptID any) error {
	row, err := queryOneMap(ctx, conn, `
		SELECT
		  receipt.received_amount,
		  COALESCE(SUM(CASE WHEN reconciliation.status = 'active' THEN reconciliation.reconciled_amount ELSE 0 END), 0) AS reconciled_amount
		FROM finance_receipt receipt
		LEFT JOIN finance_reconciliation reconciliation ON reconciliation.receipt_id = receipt.id
		WHERE receipt.id = ?
		GROUP BY receipt.id, receipt.received_amount
	`, receiptID)
	if err != nil {
		return err
	}
	receivedAmount := amountFromMap(row, "received_amount")
	reconciledAmount := amountFromMap(row, "reconciled_amount")
	unreconciledAmount := receivedAmount - reconciledAmount
	if unreconciledAmount < 0 {
		unreconciledAmount = 0
	}
	status := "confirmed"
	if reconciledAmount > 0 && unreconciledAmount <= 0.000001 {
		status = "reconciled"
	} else if reconciledAmount > 0 {
		status = "partially_reconciled"
	}
	_, err = conn.ExecContext(ctx, `
		UPDATE finance_receipt
		SET reconciled_amount = ?, unreconciled_amount = ?, status = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, fmt.Sprintf("%.2f", reconciledAmount), fmt.Sprintf("%.2f", unreconciledAmount), status, receiptID)
	return err
}

func (a *Adapter) CreateReconciliation(ctx context.Context, body jsonBody) (DataResult[map[string]any], error) {
	receiptCode := cleanStringValue(bodyValue(body, "receiptCode", "receipt_code"))
	receiptID := cleanStringValue(bodyValue(body, "receiptId", "receipt_id"))
	if receiptCode == "" && receiptID == "" {
		return DataResult[map[string]any]{}, httperror.New(http.StatusBadRequest, "field_required", "receiptCode or receiptId is required")
	}
	amount, err := moneyStringValue(bodyValue(body, "reconciledAmount", "reconciled_amount"), "reconciledAmount", true, true)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	code := firstNonEmpty(cleanStringValue(bodyValue(body, "code")), generateFinanceCode("REC"))
	invoiceCode := cleanStringValue(bodyValue(body, "invoiceCode", "invoice_code"))
	reconciliationType, err := allowedString(firstNonEmpty(cleanStringValue(bodyValue(body, "reconciliationType", "reconciliation_type")), map[bool]string{true: "invoice", false: "contract_receivable"}[invoiceCode != ""]), "reconciliationType", []string{"invoice", "contract_receivable", "advance", "unclassified", "manual"})
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	defer tx.Rollback()

	condition := "id = ?"
	arg := any(receiptID)
	if receiptCode != "" {
		condition = "code = ?"
		arg = receiptCode
	}
	receipt, err := queryOneMap(ctx, tx, "SELECT id, code, customer_code, contract_code, project_code, receivable_plan_code, received_amount FROM finance_receipt WHERE deleted_at IS NULL AND "+condition+" FOR UPDATE", arg)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if receipt == nil {
		return DataResult[map[string]any]{}, notFound("receipt not found")
	}
	var invoice map[string]any
	if invoiceCode != "" {
		invoice, err = queryOneMap(ctx, tx, "SELECT id, customer_code, contract_code, project_code, receivable_plan_code FROM finance_invoice WHERE deleted_at IS NULL AND code = ? LIMIT 1", invoiceCode)
		if err != nil {
			return DataResult[map[string]any]{}, err
		}
		if invoice == nil {
			return DataResult[map[string]any]{}, notFound("invoice not found")
		}
	}
	active, err := queryOneMap(ctx, tx, "SELECT COALESCE(SUM(reconciled_amount), 0) AS amount FROM finance_reconciliation WHERE receipt_id = ? AND status = ?", receipt["id"], "active")
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	nextAmount := amountFromMap(active, "amount") + amountAsFloat(amount)
	if nextAmount > amountFromMap(receipt, "received_amount")+0.000001 {
		return DataResult[map[string]any]{}, httperror.New(http.StatusBadRequest, "amount_exceeded", "reconciledAmount exceeds receipt unreconciled amount")
	}
	contractCode := firstNonEmpty(cleanStringValue(bodyValue(body, "contractCode", "contract_code")), cleanStringValue(valueFrom(invoice, "contract_code")), cleanStringValue(receipt["contract_code"]))
	customerCode := firstNonEmpty(cleanStringValue(bodyValue(body, "customerCode", "customer_code")), cleanStringValue(valueFrom(invoice, "customer_code")), cleanStringValue(receipt["customer_code"]))
	projectCode := firstNonEmpty(cleanStringValue(bodyValue(body, "projectCode", "project_code")), cleanStringValue(valueFrom(invoice, "project_code")), cleanStringValue(receipt["project_code"]))
	receivablePlanCode := firstNonEmpty(cleanStringValue(bodyValue(body, "receivablePlanCode", "receivable_plan_code")), cleanStringValue(valueFrom(invoice, "receivable_plan_code")), cleanStringValue(receipt["receivable_plan_code"]))
	invoiceID := valueFrom(invoice, "id")
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO finance_reconciliation (
		  code, receipt_id, invoice_id, customer_code, contract_code, project_code,
		  receivable_plan_code, reconciled_amount, reconciled_at, reconciliation_type, status, created_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
	`, code, receipt["id"], invoiceID, customerCode, contractCode, projectCode, receivablePlanCode, amount, firstNonEmpty(cleanStringValue(optionalDateTimeValue(bodyValue(body, "reconciledAt", "reconciled_at"))), timeNowSQL()), reconciliationType, nilString(bodyValue(body, "createdBy", "created_by"))); err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := a.updateReceiptReconciliationState(ctx, tx, receipt["id"]); err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := a.recalculateContractSummary(ctx, tx, receipt["contract_code"]); err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := a.recalculateContractSummary(ctx, tx, contractCode); err != nil {
		return DataResult[map[string]any]{}, err
	}
	row, err := queryOneMap(ctx, tx, "SELECT * FROM finance_reconciliation WHERE code = ?", code)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if contractCode != "" {
		summary, err := financeContractSummaryMap(ctx, tx, contractCode)
		if err != nil {
			return DataResult[map[string]any]{}, err
		}
		row["contractSummary"] = summary
		row["contract_summary"] = summary
	}
	if receivablePlanCode != "" {
		summary, err := financeReceivablePlanSummaryMap(ctx, tx, receivablePlanCode)
		if err != nil {
			return DataResult[map[string]any]{}, err
		}
		row["receivablePlanSummary"] = summary
		row["receivable_plan_summary"] = summary
	}
	if err := tx.Commit(); err != nil {
		return DataResult[map[string]any]{}, err
	}
	return resultData(row), nil
}

func (a *Adapter) VoidReconciliation(ctx context.Context, code string, body jsonBody) (DataResult[map[string]any], error) {
	if err := requireCodePath(code); err != nil {
		return DataResult[map[string]any]{}, err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	defer tx.Rollback()
	row, err := queryOneMap(ctx, tx, "SELECT id, receipt_id, contract_code FROM finance_reconciliation WHERE code = ? AND status = 'active' FOR UPDATE", code)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if row == nil {
		return DataResult[map[string]any]{}, notFound("active reconciliation not found")
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE finance_reconciliation
		SET status = 'reversed', reversed_at = NOW(), reversed_by = ?, reverse_reason = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, nilString(bodyValue(body, "reversedBy", "reversed_by")), nilString(bodyValue(body, "reverseReason", "reverse_reason")), row["id"]); err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := a.updateReceiptReconciliationState(ctx, tx, row["receipt_id"]); err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := a.recalculateContractSummary(ctx, tx, row["contract_code"]); err != nil {
		return DataResult[map[string]any]{}, err
	}
	updated, err := queryOneMap(ctx, tx, "SELECT * FROM finance_reconciliation WHERE code = ?", code)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := tx.Commit(); err != nil {
		return DataResult[map[string]any]{}, err
	}
	return resultData(updated), nil
}

func valueFrom(row map[string]any, key string) any {
	if row == nil {
		return nil
	}
	return row[key]
}

func amountAsFloat(value any) float64 {
	parsed, _ := strconv.ParseFloat(cleanStringValue(value), 64)
	return parsed
}

func timeNowSQL() string {
	return time.Now().UTC().Format("2006-01-02 15:04:05")
}
