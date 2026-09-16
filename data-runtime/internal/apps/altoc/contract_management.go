package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const contractAmountEpsilon = 0.005

type contractFinancialSummary struct {
	ContractAmount           float64
	ReceivablePlanTotal      float64
	ReceivedTotal            float64
	InvoiceTotal             float64
	ReceivableBase           float64
	OutstandingAmount        float64
	ContractUnreceivedAmount float64
	TerminationBadDebtAmount float64
	InvoiceBalance           float64
	PaymentCount             int
	InvoiceCount             int
	ReceivablePlanCount      int
}

func (a *Adapter) manageContract(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	action := firstBodyText(body, "action")
	switch action {
	case "force_complete":
		return a.forceCompleteContract(ctx, identifier, body)
	case "terminate":
		return a.terminateContract(ctx, identifier, body)
	case "invalidate":
		return a.invalidateContract(ctx, identifier, body)
	default:
		return nil, httperror.New(http.StatusBadRequest, "invalid_management_action", "unsupported contract management action")
	}
}

func (a *Adapter) forceCompleteContract(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	tx, contract, summary, operator, err := a.beginContractManagementTx(ctx, identifier, body)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	dueDate := contractDueDate(contract)
	oldValue := contractAuditOldValue(contract, summary)

	var paymentCode string
	if moneyPositive(summary.OutstandingAmount) {
		paymentCode, err = a.createFinanceReceipt(ctx, contract, summary.OutstandingAmount, dueDate, "", "force_complete", "系统管理员强制完成合同自动补记回款", operator)
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE receivable_plan
			SET received_amount = amount,
			    unreceived_amount = 0,
			    status = 'received',
			    planned_payment_date = COALESCE(planned_payment_date, ?),
			    updated_by = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE contract_id = ?
			  AND deleted_at IS NULL
		`, dueDate, operator, contract["id"]); err != nil {
			return nil, err
		}
	}

	var invoiceCode string
	if moneyPositive(summary.InvoiceBalance) {
		invoiceType := firstNonEmptyText(firstBodyText(body, "invoiceType", "invoice_type"), "general_vat")
		invoiceCode, err = a.createFinanceIssuedInvoice(ctx, contract, summary, dueDate, invoiceType, operator)
		if err != nil {
			return nil, err
		}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE contract
		SET status = 'completed',
		    completed_at = CONCAT(?, ' 00:00:00'),
		    last_status_changed_at = CURRENT_TIMESTAMP,
		    last_status_changed_by = ?,
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, dueDate, operator, operator, contract["id"]); err != nil {
		return nil, err
	}

	newValue := map[string]any{
		"management_action": "force_complete",
		"status":            "completed",
		"effective_date":    dueDate,
		"payment_amount":    moneyText(summary.OutstandingAmount),
		"payment_code":      paymentCode,
		"invoice_amount":    moneyText(summary.InvoiceBalance),
		"invoice_code":      invoiceCode,
	}
	if err := insertContractManagementAuditTx(ctx, tx, contract["id"], "force_complete", oldValue, newValue, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	updated, err := a.getContract(ctx, fmt.Sprint(contract["id"]))
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"contract":      updated,
		"paymentCode":   paymentCode,
		"invoiceCode":   invoiceCode,
		"paymentAmount": moneyText(summary.OutstandingAmount),
		"invoiceAmount": moneyText(summary.InvoiceBalance),
		"effectiveDate": dueDate,
	}, nil
}

func (a *Adapter) terminateContract(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	reason := firstBodyText(body, "reason")
	if reason == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_reason", "termination reason is required")
	}

	tx, contract, summary, operator, err := a.beginContractManagementTx(ctx, identifier, body)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if !moneyPositive(summary.ReceivedTotal) {
		return nil, httperror.New(http.StatusConflict, "contract_not_partially_received", "contract has no received payment; use invalidation instead")
	}
	if !moneyPositive(summary.TerminationBadDebtAmount) {
		return nil, httperror.New(http.StatusConflict, "contract_no_unreceived_amount", "contract has no unreceived amount to terminate")
	}

	oldValue := contractAuditOldValue(contract, summary)
	if err := markContractReceivablesBadDebtTx(ctx, tx, contract, summary, operator); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE contract
		SET status = 'terminated',
		    terminated_at = CURRENT_TIMESTAMP,
		    last_status_changed_at = CURRENT_TIMESTAMP,
		    last_status_changed_by = ?,
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, operator, operator, contract["id"]); err != nil {
		return nil, err
	}

	newValue := map[string]any{
		"management_action": "terminate",
		"status":            "terminated",
		"reason":            reason,
		"bad_debt_amount":   moneyText(summary.TerminationBadDebtAmount),
		"received_total":    moneyText(summary.ReceivedTotal),
	}
	if err := insertContractManagementAuditTx(ctx, tx, contract["id"], "terminate", oldValue, newValue, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	updated, err := a.getContract(ctx, fmt.Sprint(contract["id"]))
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"contract":      updated,
		"badDebtAmount": moneyText(summary.TerminationBadDebtAmount),
	}, nil
}

func (a *Adapter) invalidateContract(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	reason := firstBodyText(body, "reason")
	if reason == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_reason", "invalidation reason is required")
	}

	tx, contract, summary, operator, err := a.beginContractManagementTx(ctx, identifier, body)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if moneyPositive(summary.ReceivedTotal) || summary.PaymentCount > 0 {
		return nil, httperror.New(http.StatusConflict, "contract_has_payment", "contract with payment records cannot be invalidated")
	}
	if moneyPositive(summary.InvoiceTotal) || summary.InvoiceCount > 0 {
		return nil, httperror.New(http.StatusConflict, "contract_has_invoice", "contract with invoice records cannot be invalidated")
	}

	oldValue := contractAuditOldValue(contract, summary)
	plansResult, err := tx.ExecContext(ctx, `
		UPDATE receivable_plan
		SET deleted_at = CURRENT_TIMESTAMP,
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE contract_id = ?
		  AND deleted_at IS NULL
	`, operator, contract["id"])
	if err != nil {
		return nil, err
	}
	invalidatedPlans, _ := plansResult.RowsAffected()

	if _, err := tx.ExecContext(ctx, `
		UPDATE contract
		SET status = 'invalid',
		    last_status_changed_at = CURRENT_TIMESTAMP,
		    last_status_changed_by = ?,
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, operator, operator, contract["id"]); err != nil {
		return nil, err
	}

	newValue := map[string]any{
		"management_action":            "invalidate",
		"status":                       "invalid",
		"reason":                       reason,
		"invalidated_receivable_plans": invalidatedPlans,
	}
	if err := insertContractManagementAuditTx(ctx, tx, contract["id"], "invalidate", oldValue, newValue, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	updated, err := a.getContract(ctx, fmt.Sprint(contract["id"]))
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"contract":                   updated,
		"invalidatedReceivablePlans": invalidatedPlans,
	}, nil
}

func (a *Adapter) beginContractManagementTx(
	ctx context.Context,
	identifier string,
	body map[string]any,
) (*sql.Tx, map[string]any, contractFinancialSummary, string, error) {
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, contractFinancialSummary{}, "", err
	}

	where, args := altocIdentityWhere("ct", identifier)
	contract, err := altocQueryOneMap(ctx, tx, `
		SELECT
		  ct.*,
		  cu.code AS customer_code,
		  cu.name AS customer_name
		FROM contract ct
		LEFT JOIN customer cu ON cu.id = ct.customer_id
		WHERE `+where+`
		  AND ct.deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, args...)
	if err != nil {
		tx.Rollback()
		return nil, nil, contractFinancialSummary{}, "", err
	}
	if contract == nil {
		tx.Rollback()
		return nil, nil, contractFinancialSummary{}, "", httperror.New(http.StatusNotFound, "record_not_found", "contract not found")
	}
	if err := altocRequireActionScope(body, "contract", "admin"); err != nil {
		tx.Rollback()
		return nil, nil, contractFinancialSummary{}, "", err
	}
	if err := altocRequireRecordWrite(body, "contract", contract, "owner_user_id", "owner_dept_code"); err != nil {
		tx.Rollback()
		return nil, nil, contractFinancialSummary{}, "", err
	}

	summary, err := a.contractFinancialSummaryForTx(ctx, tx, contract, moneyValue(contract["amount_tax_inclusive"]))
	if err != nil {
		tx.Rollback()
		return nil, nil, contractFinancialSummary{}, "", err
	}

	operator := firstNonEmptyText(firstBodyText(body, "operatorUid", "operator_uid", "updatedBy", "updated_by", "current_user"), "system")
	return tx, contract, summary, operator, nil
}

func (a *Adapter) contractFinancialSummaryForTx(ctx context.Context, tx *sql.Tx, contract map[string]any, contractAmount float64) (contractFinancialSummary, error) {
	contractID := contract["id"]
	row, err := altocQueryOneMap(ctx, tx, `
		SELECT
		  COALESCE((SELECT SUM(amount) FROM receivable_plan WHERE contract_id = ? AND deleted_at IS NULL), 0) AS receivable_plan_total,
		  COALESCE((SELECT COUNT(*) FROM receivable_plan WHERE contract_id = ? AND deleted_at IS NULL), 0) AS receivable_plan_count
	`, contractID, contractID)
	if err != nil {
		return contractFinancialSummary{}, err
	}
	if row == nil {
		row = map[string]any{}
	}

	planTotal := moneyValue(row["receivable_plan_total"])
	planCount := numberValue(row["receivable_plan_count"], 0)
	financeSummary, err := a.financeSummaryForContract(ctx, strings.TrimSpace(fmt.Sprint(contract["code"])))
	if err != nil {
		return contractFinancialSummary{}, err
	}
	invoiceTotal := moneyValue(financeSummary.InvoiceAmount)
	receivedTotal := contractFinanceReceivedAmount(financeSummary)
	receivableBase := invoiceTotal
	if planCount > 0 {
		receivableBase = planTotal
	}
	outstanding := math.Max(receivableBase-receivedTotal, 0)
	contractUnreceived := math.Max(contractAmount-receivedTotal, 0)
	terminationBadDebtAmount := contractManagementBadDebtAmount(contractAmount, receivedTotal, outstanding)
	invoiceBalance := math.Max(contractAmount-invoiceTotal, 0)

	return contractFinancialSummary{
		ContractAmount:           contractAmount,
		ReceivablePlanTotal:      planTotal,
		ReceivedTotal:            receivedTotal,
		InvoiceTotal:             invoiceTotal,
		ReceivableBase:           receivableBase,
		OutstandingAmount:        outstanding,
		ContractUnreceivedAmount: contractUnreceived,
		TerminationBadDebtAmount: terminationBadDebtAmount,
		InvoiceBalance:           invoiceBalance,
		PaymentCount:             int(financeSummary.ReceiptCount),
		InvoiceCount:             int(financeSummary.InvoiceCount),
		ReceivablePlanCount:      planCount,
	}, nil
}

func contractManagementBadDebtAmount(contractAmount float64, receivedTotal float64, outstandingAmount float64) float64 {
	contractUnreceived := math.Max(contractAmount-receivedTotal, 0)
	return math.Max(contractUnreceived, math.Max(outstandingAmount, 0))
}

func (a *Adapter) createFinanceReceipt(
	ctx context.Context,
	contract map[string]any,
	amount float64,
	receivedAt string,
	receivablePlanCode string,
	sourceAction string,
	note string,
	operator string,
) (string, error) {
	financeSvc, err := a.requireFinanceBridge()
	if err != nil {
		return "", err
	}
	contractCode := strings.TrimSpace(fmt.Sprint(contract["code"]))
	if contractCode == "" || contractCode == "<nil>" {
		return "", httperror.New(http.StatusBadRequest, "missing_contract_code", "contract code is required for finance receipt")
	}
	customerName := firstNonEmptyText(strings.TrimSpace(fmt.Sprint(contract["customer_name"])), strings.TrimSpace(fmt.Sprint(contract["name"])))
	body := map[string]any{
		"customerCode":         firstNonEmptyText(strings.TrimSpace(fmt.Sprint(contract["customer_code"]))),
		"customerName":         customerName,
		"contractCode":         contractCode,
		"projectCode":          firstNonEmptyText(strings.TrimSpace(fmt.Sprint(contract["project_code"]))),
		"receivablePlanCode":   strings.TrimSpace(receivablePlanCode),
		"receiptSourceType":    "contract",
		"accountingObjectType": "contract",
		"accountingObjectCode": contractCode,
		"receivedAmount":       moneyText(amount),
		"unreconciledAmount":   moneyText(amount),
		"receivedAt":           receivedAt,
		"payerName":            customerName,
		"status":               "confirmed",
		"sourceRefs": map[string]any{
			"source_app":        "altoc",
			"source_biz_type":   "contract_management",
			"source_biz_action": sourceAction,
			"contract_id":       contract["id"],
			"contract_code":     contractCode,
			"receivable_plan":   strings.TrimSpace(receivablePlanCode),
		},
		"note":        note,
		"confirmedBy": operator,
		"confirmedAt": altocDateTimeText(receivedAt),
		"createdBy":   operator,
		"updatedBy":   operator,
	}
	result, _, err := financeSvc.HandleMutation(ctx, http.MethodPost, "/v1/finance/receipts", body)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(fmt.Sprint(result.Data["code"])), nil
}

func (a *Adapter) createFinanceIssuedInvoice(
	ctx context.Context,
	contract map[string]any,
	summary contractFinancialSummary,
	invoiceDate string,
	invoiceType string,
	operator string,
) (string, error) {
	financeSvc, err := a.requireFinanceBridge()
	if err != nil {
		return "", err
	}
	contractCode := strings.TrimSpace(fmt.Sprint(contract["code"]))
	customerName := firstNonEmptyText(strings.TrimSpace(fmt.Sprint(contract["customer_name"])))
	body := map[string]any{
		"customerCode":  firstNonEmptyText(strings.TrimSpace(fmt.Sprint(contract["customer_code"]))),
		"customerName":  customerName,
		"contractCode":  contractCode,
		"projectCode":   firstNonEmptyText(strings.TrimSpace(fmt.Sprint(contract["project_code"]))),
		"invoiceType":   invoiceType,
		"invoiceItem":   firstNonEmptyText(strings.TrimSpace(fmt.Sprint(contract["name"])), "合同补开发票"),
		"invoiceAmount": moneyText(summary.InvoiceBalance),
		"invoiceDate":   invoiceDate,
		"status":        "issued",
		"taxpayerName":  customerName,
		"receiverName":  customerName,
		"sourceRefs": map[string]any{
			"source_app":        "altoc",
			"source_biz_type":   "contract_management",
			"source_biz_action": "force_complete",
			"contract_id":       contract["id"],
			"contract_code":     contractCode,
		},
		"remark":    "系统管理员强制完成合同自动补记开票",
		"createdBy": operator,
		"updatedBy": operator,
	}
	result, _, err := financeSvc.HandleMutation(ctx, http.MethodPost, "/v1/finance/invoices", body)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(fmt.Sprint(result.Data["code"])), nil
}

func markContractReceivablesBadDebtTx(
	ctx context.Context,
	tx *sql.Tx,
	contract map[string]any,
	summary contractFinancialSummary,
	operator string,
) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT id, amount
		FROM receivable_plan
		WHERE contract_id = ?
		  AND deleted_at IS NULL
		ORDER BY planned_payment_date ASC, id ASC
		FOR UPDATE
	`, contract["id"])
	if err != nil {
		return err
	}
	plans, err := altocRowsToMaps(rows)
	rows.Close()
	if err != nil {
		return err
	}

	if len(plans) == 0 {
		if !moneyPositive(summary.TerminationBadDebtAmount) {
			return nil
		}
		code, err := nextAltocCode(ctx, tx, "RP", "receivable_plan")
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO receivable_plan (
			  code, contract_id, payment_term_id, customer_id, opportunity_id,
			  plan_name, plan_type, status, amount, planned_payment_date,
			  received_amount, unreceived_amount, owner_user_id, created_by, updated_by
			) VALUES (?, ?, NULL, ?, ?, ?, 'milestone', 'bad_debt', ?, ?, 0, ?, ?, ?, ?)
		`,
			code,
			contract["id"],
			contract["customer_id"],
			contract["opportunity_id"],
			"合同终止坏账",
			moneyText(summary.TerminationBadDebtAmount),
			contractDueDate(contract),
			moneyText(summary.TerminationBadDebtAmount),
			contract["owner_user_id"],
			nullableText(operator),
			nullableText(operator),
		)
		return err
	}

	remainingReceived := summary.ReceivedTotal
	planBadDebtAmount := 0.0
	for _, plan := range plans {
		amount := math.Max(moneyValue(plan["amount"]), 0)
		allocatedReceived := 0.0
		if remainingReceived > 0 {
			allocatedReceived = math.Min(amount, remainingReceived)
		}
		remainingReceived -= allocatedReceived
		unreceived := math.Max(amount-allocatedReceived, 0)
		nextStatus := "bad_debt"
		if !moneyPositive(unreceived) {
			nextStatus = "received"
		}
		planBadDebtAmount += unreceived
		if _, err := tx.ExecContext(ctx, `
			UPDATE receivable_plan
			SET received_amount = ?,
			    unreceived_amount = ?,
			    status = ?,
			    updated_by = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, moneyText(allocatedReceived), moneyText(unreceived), nextStatus, operator, plan["id"]); err != nil {
			return err
		}
	}

	extraBadDebtAmount := math.Max(summary.TerminationBadDebtAmount-planBadDebtAmount, 0)
	if !moneyPositive(extraBadDebtAmount) {
		return nil
	}
	code, err := nextAltocCode(ctx, tx, "RP", "receivable_plan")
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO receivable_plan (
		  code, contract_id, payment_term_id, customer_id, opportunity_id,
		  plan_name, plan_type, status, amount, planned_payment_date,
		  received_amount, unreceived_amount, owner_user_id, created_by, updated_by
		) VALUES (?, ?, NULL, ?, ?, ?, 'milestone', 'bad_debt', ?, ?, 0, ?, ?, ?, ?)
	`,
		code,
		contract["id"],
		contract["customer_id"],
		contract["opportunity_id"],
		"合同终止坏账",
		moneyText(extraBadDebtAmount),
		contractDueDate(contract),
		moneyText(extraBadDebtAmount),
		contract["owner_user_id"],
		nullableText(operator),
		nullableText(operator),
	)
	return err
}

func contractAuditOldValue(contract map[string]any, summary contractFinancialSummary) map[string]any {
	return map[string]any{
		"status":                contract["status"],
		"amount_tax_inclusive":  contract["amount_tax_inclusive"],
		"received_total":        moneyText(summary.ReceivedTotal),
		"invoice_total":         moneyText(summary.InvoiceTotal),
		"outstanding_amount":    moneyText(summary.OutstandingAmount),
		"contract_unreceived":   moneyText(summary.ContractUnreceivedAmount),
		"bad_debt_amount":       moneyText(summary.TerminationBadDebtAmount),
		"invoice_balance":       moneyText(summary.InvoiceBalance),
		"receivable_plan_count": summary.ReceivablePlanCount,
	}
}

func insertContractManagementAuditTx(
	ctx context.Context,
	tx *sql.Tx,
	contractID any,
	action string,
	oldValue map[string]any,
	newValue map[string]any,
	operator string,
) error {
	oldJSON, _ := json.Marshal(oldValue)
	newJSON, _ := json.Marshal(newValue)
	_, err := tx.ExecContext(ctx, `
		INSERT INTO audit_log (
		  entity_type, entity_id, action, old_value, new_value, operator_id
		) VALUES (?, ?, ?, ?, ?, ?)
	`, "contract", contractID, action, oldJSON, newJSON, operator)
	return err
}

func contractDueDate(contract map[string]any) string {
	if dueDate := firstNonEmptyDate(contract["end_date"]); dueDate != "" {
		return dueDate
	}
	return time.Now().Format("2006-01-02")
}

func moneyPositive(value float64) bool {
	return value > contractAmountEpsilon
}

func moneyText(value float64) string {
	if math.Abs(value) <= contractAmountEpsilon {
		value = 0
	}
	return fmt.Sprintf("%.2f", value)
}
