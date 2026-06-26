package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type altocQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func (a *Adapter) activateContractDelivery(ctx context.Context, contractCode string, body map[string]any) (map[string]any, error) {
	contractCode = strings.TrimSpace(contractCode)
	if contractCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_contract_code", "contractCode is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	contract, err := altocQueryOneMap(ctx, tx, `
		SELECT
		  ct.*,
		  cu.code AS customer_code,
		  cu.name AS customer_name,
		  op.code AS opportunity_code,
		  op.name AS opportunity_name
		FROM contract ct
		LEFT JOIN customer cu ON cu.id = ct.customer_id
		LEFT JOIN opportunity op ON op.id = ct.opportunity_id
		WHERE ct.code = ?
		  AND ct.deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, contractCode)
	if err != nil {
		return nil, err
	}
	if contract == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract not found")
	}
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}
	if err := altocRequireRecordWrite(body, "contract", contract, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}

	operator := firstBodyText(body, "operatorUid", "operator_uid", "updatedBy", "updated_by", "current_user")
	status := strings.TrimSpace(fmt.Sprint(contract["status"]))
	normalizedStatus := altocNormalizeContractStatus(status)
	if normalizedStatus == "terminated" || normalizedStatus == "invalid" {
		return nil, httperror.New(http.StatusConflict, "invalid_contract_status", "terminated or invalid contract cannot be activated")
	}
	statusChanged := false
	if status != "effective" && normalizedStatus != "completed" {
		if _, err := tx.ExecContext(ctx, `
			UPDATE contract
			SET status = 'effective',
			    effective_date = COALESCE(effective_date, CURRENT_DATE),
			    last_status_changed_at = CURRENT_TIMESTAMP,
			    last_status_changed_by = COALESCE(?, last_status_changed_by),
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, nullableText(operator), nullableText(operator), contract["id"]); err != nil {
			return nil, err
		}
		statusChanged = true
	}

	createdPlans, err := a.generateReceivablePlansForStageTx(ctx, tx, contract, "contract_signed", operator)
	if err != nil {
		return nil, err
	}

	contract, err = altocQueryOneMap(ctx, tx, `
		SELECT
		  ct.*,
		  cu.code AS customer_code,
		  cu.name AS customer_name,
		  op.code AS opportunity_code,
		  op.name AS opportunity_name
		FROM contract ct
		LEFT JOIN customer cu ON cu.id = ct.customer_id
		LEFT JOIN opportunity op ON op.id = ct.opportunity_id
		WHERE ct.code = ?
		  AND ct.deleted_at IS NULL
		LIMIT 1
	`, contractCode)
	if err != nil {
		return nil, err
	}
	terms, err := a.contractPaymentTerms(ctx, tx, contract["id"])
	if err != nil {
		return nil, err
	}
	plans, err := a.contractReceivablePlans(ctx, tx, contract["id"])
	if err != nil {
		return nil, err
	}
	obligations, err := a.contractObligations(ctx, tx, contract["id"])
	if err != nil {
		return nil, err
	}
	billingSchedules, err := a.contractBillingSchedules(ctx, tx, contract["id"])
	if err != nil {
		return nil, err
	}
	deliveryAssetPlans, err := a.contractDeliveryAssetPlans(ctx, tx, contract["id"])
	if err != nil {
		return nil, err
	}
	serviceAgreements, err := a.contractServiceAgreements(ctx, tx, contract["id"])
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"contract":               contract,
		"paymentTerms":           terms,
		"receivablePlans":        plans,
		"obligations":            obligations,
		"billingSchedules":       billingSchedules,
		"deliveryAssetPlans":     deliveryAssetPlans,
		"serviceAgreements":      serviceAgreements,
		"createdReceivablePlans": createdPlans,
		"statusChanged":          statusChanged,
		"idempotent":             !statusChanged && createdPlans == 0,
	}, nil
}

func (a *Adapter) syncContractFinanceSummary(ctx context.Context, contractCode string, body map[string]any) (map[string]any, error) {
	contractCode = strings.TrimSpace(contractCode)
	if contractCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_contract_code", "contractCode is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	contract, err := altocQueryOneMap(ctx, tx, `
		SELECT id, code
		FROM contract
		WHERE code = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, contractCode)
	if err != nil {
		return nil, err
	}
	if contract == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract not found")
	}
	if err := altocRequireActionScope(body, "contract", "finance-summary:sync"); err != nil {
		return nil, err
	}

	planSummary := nestedMap(body, "receivablePlanSummary", "receivable_plan_summary")
	planCode := firstNonEmptyText(
		firstBodyText(planSummary, "receivablePlanCode", "receivable_plan_code"),
		firstBodyText(body, "receivablePlanCode", "receivable_plan_code"),
		firstBodyText(nestedMap(body, "reconciliation", "sourceReconciliation", "source_reconciliation"), "receivablePlanCode", "receivable_plan_code"),
	)

	changed := false
	var updatedPlan map[string]any
	if planCode != "" {
		updatedPlan, changed, err = a.syncReceivablePlanFinanceSummaryTx(ctx, tx, contract["id"], planCode, planSummary, body)
		if err != nil {
			return nil, err
		}
	}

	plans, err := a.contractReceivablePlans(ctx, tx, contract["id"])
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"contractCode":       contractCode,
		"receivablePlan":     updatedPlan,
		"receivablePlans":    plans,
		"changed":            changed,
		"idempotent":         !changed,
		"financeSummary":     nestedMap(body, "contractSummary", "contract_summary"),
		"receivablePlanCode": planCode,
	}, nil
}

func (a *Adapter) syncReceivablePlanFinanceSummaryTx(
	ctx context.Context,
	tx *sql.Tx,
	contractID any,
	planCode string,
	planSummary map[string]any,
	body map[string]any,
) (map[string]any, bool, error) {
	plan, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM receivable_plan
		WHERE contract_id = ?
		  AND code = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, contractID, planCode)
	if err != nil {
		return nil, false, err
	}
	if plan == nil {
		return nil, false, httperror.New(http.StatusNotFound, "record_not_found", "receivable plan not found")
	}
	status := strings.TrimSpace(fmt.Sprint(plan["status"]))
	if status == "bad_debt" {
		return plan, false, nil
	}

	receivedAmount := amountForFinanceSync(planSummary, "receivedAmount", "received_amount", "reconciledAmount", "reconciled_amount")
	planAmount := moneyValue(plan["amount"])
	unreceivedAmount := planAmount - receivedAmount
	if unreceivedAmount < 0 {
		unreceivedAmount = 0
	}
	nextStatus := status
	if receivedAmount >= planAmount && planAmount > 0 {
		nextStatus = "received"
	} else if receivedAmount > 0 {
		nextStatus = "partially_received"
	} else if status == "" || status == "<nil>" {
		nextStatus = "pending"
	}

	currentReceived := moneyValue(plan["received_amount"])
	currentUnreceived := moneyValue(plan["unreceived_amount"])
	changed := fmt.Sprintf("%.2f", currentReceived) != fmt.Sprintf("%.2f", receivedAmount) ||
		fmt.Sprintf("%.2f", currentUnreceived) != fmt.Sprintf("%.2f", unreceivedAmount) ||
		status != nextStatus
	if !changed {
		return plan, false, nil
	}

	operator := firstBodyText(body, "operatorUid", "operator_uid", "updatedBy", "updated_by", "current_user")
	if _, err := tx.ExecContext(ctx, `
		UPDATE receivable_plan
		SET received_amount = ?,
		    unreceived_amount = ?,
		    status = ?,
		    updated_by = COALESCE(?, updated_by),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, fmt.Sprintf("%.2f", receivedAmount), fmt.Sprintf("%.2f", unreceivedAmount), nextStatus, nullableText(operator), plan["id"]); err != nil {
		return nil, false, err
	}

	updated, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM receivable_plan
		WHERE id = ?
		LIMIT 1
	`, plan["id"])
	return updated, true, err
}

func (a *Adapter) prepareContractInvoiceRequest(ctx context.Context, contractID string, body map[string]any) (map[string]any, error) {
	contractID = strings.TrimSpace(contractID)
	if contractID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_contract_id", "contractID is required")
	}

	contract, err := a.contractForInvoiceRequest(ctx, a.DB(), contractID, false)
	if err != nil {
		return nil, err
	}
	if contract == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract not found")
	}
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}
	if err := altocRequireRecordWrite(body, "contract", contract, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}

	contractCode := strings.TrimSpace(fmt.Sprint(contract["code"]))
	contractAmount := moneyValue(contract["amount_tax_inclusive"])
	summary, err := a.financeSummaryForContract(ctx, contractCode)
	if err != nil {
		return nil, err
	}
	invoiceBalance := contractAmount - moneyValue(summary.InvoiceAmount)
	if invoiceBalance < 0 {
		invoiceBalance = 0
	}
	if invoiceBalance <= 0 {
		return nil, httperror.New(http.StatusConflict, "invoice_balance_empty", "contract has no invoice balance")
	}

	requestedAmount := amountForFinanceSync(body, "requestedAmount", "requested_amount", "amount")
	if requestedAmount <= 0 {
		requestedAmount = invoiceBalance
	}
	if requestedAmount <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_requested_amount", "requestedAmount must be greater than 0")
	}
	if invoiceBalance > 0 && requestedAmount > invoiceBalance+0.01 {
		return nil, httperror.New(http.StatusBadRequest, "requested_amount_exceeds_balance", "requestedAmount exceeds invoice balance")
	}

	operator := firstBodyText(body, "operatorUid", "operator_uid", "requestedBy", "requested_by", "createdBy", "created_by", "current_user")
	sourceBizCode := firstNonEmptyText(
		firstBodyText(body, "sourceBizCode", "source_biz_code"),
		fmt.Sprintf("%s:%s", contractCode, time.Now().UTC().Format("20060102150405")),
	)
	idempotencyKey := firstNonEmptyText(
		firstBodyText(body, "idempotencyKey", "idempotency_key"),
		fmt.Sprintf("altoc:contract:%s:invoice-request:%s", contractCode, sourceBizCode),
	)
	invoiceItem := firstNonEmptyText(
		firstBodyText(body, "invoiceItem", "invoice_item"),
		strings.TrimSpace(fmt.Sprint(contract["name"])),
		"合同开票",
	)
	invoiceType := firstNonEmptyText(
		firstBodyText(body, "invoiceType", "invoice_type"),
		strings.TrimSpace(fmt.Sprint(contract["invoice_type"])),
		"general_vat",
	)
	invoiceMedium := firstNonEmptyText(firstBodyText(body, "invoiceMedium", "invoice_medium"), "electronic")

	billingInfo := nestedMap(body, "billingInfo", "billing_info")
	invoiceRequest := map[string]any{
		"sourceApp":       "altoc",
		"sourceBizType":   "contract",
		"sourceBizCode":   sourceBizCode,
		"customerCode":    contract["customer_code"],
		"customerName":    contract["customer_name"],
		"contractCode":    contractCode,
		"invoiceType":     invoiceType,
		"invoiceMedium":   invoiceMedium,
		"invoiceItem":     invoiceItem,
		"requestedAmount": fmt.Sprintf("%.2f", requestedAmount),
		"taxRate":         contract["tax_rate"],
		"taxpayerName":    firstNonEmptyText(firstBodyText(body, "taxpayerName", "taxpayer_name"), firstBodyText(billingInfo, "taxpayer_name", "taxpayerName"), strings.TrimSpace(fmt.Sprint(contract["customer_name"]))),
		"taxpayerNo":      firstNonEmptyText(firstBodyText(body, "taxpayerNo", "taxpayer_no"), firstBodyText(billingInfo, "taxpayer_no", "taxpayerNo")),
		"status":          firstNonEmptyText(firstBodyText(body, "status"), "pending_approval"),
		"requestedBy":     operator,
		"createdBy":       operator,
		"updatedBy":       operator,
		"remark":          firstNonEmptyText(firstBodyText(body, "remark"), fmt.Sprintf("Altoc 合同 %s 发起开票申请", contractCode)),
	}
	if len(billingInfo) > 0 {
		invoiceRequest["billingInfo"] = billingInfo
	}

	return map[string]any{
		"contract":       contract,
		"financeSummary": summary,
		"invoiceRequest": invoiceRequest,
		"idempotencyKey": idempotencyKey,
		"invoiceBalance": fmt.Sprintf("%.2f", invoiceBalance),
	}, nil
}

func (a *Adapter) recordContractInvoiceRequest(ctx context.Context, contractID string, body map[string]any) (map[string]any, error) {
	contractID = strings.TrimSpace(contractID)
	if contractID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_contract_id", "contractID is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	contract, err := a.contractForInvoiceRequest(ctx, tx, contractID, true)
	if err != nil {
		return nil, err
	}
	if contract == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract not found")
	}
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}
	if err := altocRequireRecordWrite(body, "contract", contract, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}

	operator := firstNonEmptyText(firstBodyText(body, "operatorUid", "operator_uid", "current_user"), "system")
	invoiceRequest := nestedMap(body, "invoiceRequest", "invoice_request")
	idempotencyKey := firstBodyText(body, "idempotencyKey", "idempotency_key")
	oldValue, _ := json.Marshal(map[string]any{
		"status":               contract["status"],
		"amount_tax_inclusive": contract["amount_tax_inclusive"],
	})
	newValue, _ := json.Marshal(map[string]any{
		"bridge":         "altoc.contract.invoice_request",
		"idempotencyKey": idempotencyKey,
		"invoiceRequest": invoiceRequest,
	})
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO audit_log (
		  entity_type, entity_id, action, old_value, new_value, operator_id
		) VALUES (?, ?, ?, ?, ?, ?)
	`, "contract", contract["id"], "update", oldValue, newValue, operator); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"contract":       contract,
		"invoiceRequest": invoiceRequest,
		"recorded":       true,
	}, nil
}

func (a *Adapter) saveCustomerInvoiceInfo(ctx context.Context, customerID string, body map[string]any) (map[string]any, error) {
	customerID = strings.TrimSpace(customerID)
	if customerID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_customer_id", "customerID is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	customer, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM customer
		WHERE id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, customerID)
	if err != nil {
		return nil, err
	}
	if customer == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "customer not found")
	}
	if err := altocRequireActionScope(body, "customer", "edit"); err != nil {
		return nil, err
	}
	if err := altocRequireRecordWrite(body, "customer", customer, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}

	existing, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM customer_invoice_info
		WHERE customer_id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, customer["id"])
	if err != nil {
		return nil, err
	}

	operator := firstNonEmptyText(firstBodyText(body, "operatorUid", "operator_uid", "updatedBy", "updated_by", "createdBy", "created_by", "current_user"), "system")
	fields := map[string]any{
		"taxpayer_name":      nullableText(firstNonEmptyText(firstBodyText(body, "taxpayerName", "taxpayer_name"), strings.TrimSpace(fmt.Sprint(customer["name"])))),
		"taxpayer_no":        nullableText(firstBodyText(body, "taxpayerNo", "taxpayer_no")),
		"registered_address": nullableText(firstBodyText(body, "registeredAddress", "registered_address")),
		"registered_phone":   nullableText(firstBodyText(body, "registeredPhone", "registered_phone")),
		"bank_name":          nullableText(firstBodyText(body, "bankName", "bank_name")),
		"bank_account":       nullableText(firstBodyText(body, "bankAccount", "bank_account")),
		"invoice_type":       firstNonEmptyText(firstBodyText(body, "invoiceType", "invoice_type"), "special_vat"),
		"invoice_email":      nullableText(firstBodyText(body, "invoiceEmail", "invoice_email")),
		"receiver_name":      nullableText(firstBodyText(body, "receiverName", "receiver_name")),
		"receiver_phone":     nullableText(firstBodyText(body, "receiverPhone", "receiver_phone")),
		"receiver_address":   nullableText(firstBodyText(body, "receiverAddress", "receiver_address")),
		"remark":             nullableText(firstBodyText(body, "remark")),
	}

	if existing == nil {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO customer_invoice_info (
			  customer_id, taxpayer_name, taxpayer_no, registered_address, registered_phone,
			  bank_name, bank_account, invoice_type, invoice_email, receiver_name,
			  receiver_phone, receiver_address, is_default, status, remark, created_by, updated_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, ?)
		`, customer["id"], fields["taxpayer_name"], fields["taxpayer_no"], fields["registered_address"], fields["registered_phone"], fields["bank_name"], fields["bank_account"], fields["invoice_type"], fields["invoice_email"], fields["receiver_name"], fields["receiver_phone"], fields["receiver_address"], fields["remark"], nullableText(operator), nullableText(operator))
	} else {
		_, err = tx.ExecContext(ctx, `
			UPDATE customer_invoice_info
			SET taxpayer_name = ?,
			    taxpayer_no = ?,
			    registered_address = ?,
			    registered_phone = ?,
			    bank_name = ?,
			    bank_account = ?,
			    invoice_type = ?,
			    invoice_email = ?,
			    receiver_name = ?,
			    receiver_phone = ?,
			    receiver_address = ?,
			    is_default = 1,
			    status = 'active',
			    remark = ?,
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, fields["taxpayer_name"], fields["taxpayer_no"], fields["registered_address"], fields["registered_phone"], fields["bank_name"], fields["bank_account"], fields["invoice_type"], fields["invoice_email"], fields["receiver_name"], fields["receiver_phone"], fields["receiver_address"], fields["remark"], nullableText(operator), existing["id"])
	}
	if err != nil {
		return nil, err
	}

	updated, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM customer_invoice_info
		WHERE customer_id = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, customer["id"])
	if err != nil {
		return nil, err
	}
	oldValue, _ := json.Marshal(map[string]any{
		"invoiceInfo": existing,
	})
	newValue, _ := json.Marshal(map[string]any{
		"invoiceInfo": updated,
	})
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO audit_log (
		  entity_type, entity_id, action, old_value, new_value, operator_id
		) VALUES (?, ?, ?, ?, ?, ?)
	`, "customer", customer["id"], "update", oldValue, newValue, operator); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"customer":    customer,
		"invoiceInfo": updated,
		"created":     existing == nil,
	}, nil
}

func (a *Adapter) contractForInvoiceRequest(ctx context.Context, conn altocQueryer, identifier string, lock bool) (map[string]any, error) {
	identifier = strings.TrimSpace(identifier)
	where := "ct.code = ?"
	args := []any{identifier}
	if _, err := strconv.ParseInt(identifier, 10, 64); err == nil {
		where = "ct.id = ?"
		args = []any{identifier}
	}
	lockSQL := ""
	if lock {
		lockSQL = " FOR UPDATE"
	}
	return altocQueryOneMap(ctx, conn, `
		SELECT
		  ct.*,
		  cu.code AS customer_code,
		  cu.name AS customer_name
		FROM contract ct
		LEFT JOIN customer cu ON cu.id = ct.customer_id
		WHERE `+where+`
		  AND ct.deleted_at IS NULL
		LIMIT 1`+lockSQL, args...)
}

func (a *Adapter) prepareReceivablePlanInvoiceRequest(ctx context.Context, receivablePlanCode string, body map[string]any) (map[string]any, error) {
	receivablePlanCode = strings.TrimSpace(receivablePlanCode)
	if receivablePlanCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_receivable_plan_code", "receivablePlanCode is required")
	}

	plan, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  rp.*,
		  ct.code AS contract_code,
		  ct.name AS contract_name,
		  ct.tax_rate AS contract_tax_rate,
		  cu.code AS customer_code,
		  cu.name AS customer_name
		FROM receivable_plan rp
		LEFT JOIN contract ct ON ct.id = rp.contract_id
		LEFT JOIN customer cu ON cu.id = rp.customer_id
		WHERE rp.code = ?
		  AND rp.deleted_at IS NULL
		LIMIT 1
	`, receivablePlanCode)
	if err != nil {
		return nil, err
	}
	if plan == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "receivable plan not found")
	}
	if err := altocRequireActionScope(body, "receivable", "edit"); err != nil {
		return nil, err
	}
	if err := altocRequireRecordWrite(body, "receivable", plan, "owner_user_id", ""); err != nil {
		return nil, err
	}

	status := strings.TrimSpace(fmt.Sprint(plan["status"]))
	if status == "bad_debt" || status == "received" {
		return nil, httperror.New(http.StatusConflict, "invalid_receivable_plan_status", "receivable plan cannot create invoice request in current status")
	}
	if status != "to_invoice" && status != "to_receive" && status != "partially_received" {
		return nil, httperror.New(http.StatusConflict, "receivable_plan_not_billable", "receivable plan is not billable")
	}

	requestedAmount := amountForFinanceSync(body, "requestedAmount", "requested_amount", "amount")
	if requestedAmount <= 0 {
		requestedAmount = moneyValue(plan["unreceived_amount"])
	}
	if requestedAmount <= 0 {
		requestedAmount = moneyValue(plan["amount"]) - moneyValue(plan["received_amount"])
	}
	if requestedAmount <= 0 {
		requestedAmount = moneyValue(plan["amount"])
	}
	if requestedAmount <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_requested_amount", "requestedAmount must be greater than 0")
	}

	operator := firstBodyText(body, "operatorUid", "operator_uid", "requestedBy", "requested_by", "createdBy", "created_by", "current_user")
	idempotencyKey := firstNonEmptyText(
		firstBodyText(body, "idempotencyKey", "idempotency_key"),
		fmt.Sprintf("altoc:receivable:%s:invoice-request:v1", receivablePlanCode),
	)
	invoiceItem := firstNonEmptyText(
		firstBodyText(body, "invoiceItem", "invoice_item"),
		strings.TrimSpace(fmt.Sprint(plan["plan_name"])),
		strings.TrimSpace(fmt.Sprint(plan["contract_name"])),
	)
	invoiceType := firstNonEmptyText(
		firstBodyText(body, "invoiceType", "invoice_type"),
	)
	if invoiceType == "" || invoiceType == "<nil>" {
		invoiceType = "general_vat"
	}

	invoiceRequest := map[string]any{
		"sourceApp":          "altoc",
		"sourceBizType":      "receivable_plan",
		"sourceBizCode":      receivablePlanCode,
		"customerCode":       plan["customer_code"],
		"customerName":       plan["customer_name"],
		"contractCode":       plan["contract_code"],
		"receivablePlanCode": receivablePlanCode,
		"invoiceType":        invoiceType,
		"invoiceItem":        invoiceItem,
		"requestedAmount":    fmt.Sprintf("%.2f", requestedAmount),
		"taxRate":            plan["contract_tax_rate"],
		"taxpayerName":       firstNonEmptyText(firstBodyText(body, "taxpayerName", "taxpayer_name"), strings.TrimSpace(fmt.Sprint(plan["customer_name"]))),
		"taxpayerNo":         firstBodyText(body, "taxpayerNo", "taxpayer_no"),
		"status":             "draft",
		"requestedBy":        operator,
		"createdBy":          operator,
		"updatedBy":          operator,
		"remark":             firstNonEmptyText(firstBodyText(body, "remark"), fmt.Sprintf("Altoc 回款计划 %s 发起开票申请", receivablePlanCode)),
	}
	if billingInfo := nestedMap(body, "billingInfo", "billing_info"); len(billingInfo) > 0 {
		invoiceRequest["billingInfo"] = billingInfo
	}

	return map[string]any{
		"receivablePlan": plan,
		"invoiceRequest": invoiceRequest,
		"idempotencyKey": idempotencyKey,
	}, nil
}

func (a *Adapter) recordReceivablePlanInvoiceRequest(ctx context.Context, receivablePlanCode string, body map[string]any) (map[string]any, error) {
	receivablePlanCode = strings.TrimSpace(receivablePlanCode)
	if receivablePlanCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_receivable_plan_code", "receivablePlanCode is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	plan, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM receivable_plan
		WHERE code = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, receivablePlanCode)
	if err != nil {
		return nil, err
	}
	if plan == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "receivable plan not found")
	}
	if err := altocRequireActionScope(body, "receivable", "edit"); err != nil {
		return nil, err
	}
	if err := altocRequireRecordWrite(body, "receivable", plan, "owner_user_id", ""); err != nil {
		return nil, err
	}

	operator := firstNonEmptyText(firstBodyText(body, "operatorUid", "operator_uid", "current_user"), "system")
	invoiceRequest := nestedMap(body, "invoiceRequest", "invoice_request")
	submitResult := nestedMap(body, "financeSubmit", "finance_submit")
	submitError := nestedMap(body, "financeSubmitError", "finance_submit_error")
	idempotencyKey := firstBodyText(body, "idempotencyKey", "idempotency_key")
	oldValue, _ := json.Marshal(map[string]any{
		"status":          plan["status"],
		"received_amount": plan["received_amount"],
	})
	newValue, _ := json.Marshal(map[string]any{
		"bridge":             "altoc.receivable.invoice_request",
		"idempotencyKey":     idempotencyKey,
		"invoiceRequest":     invoiceRequest,
		"financeSubmit":      submitResult,
		"financeSubmitError": submitError,
	})
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO audit_log (
		  entity_type, entity_id, action, old_value, new_value, operator_id
		) VALUES (?, ?, ?, ?, ?, ?)
	`, "receivable_plan", plan["id"], "update", oldValue, newValue, operator); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"receivablePlan": plan,
		"invoiceRequest": invoiceRequest,
		"recorded":       true,
	}, nil
}

func (a *Adapter) markReceivablePlanBillable(ctx context.Context, receivablePlanCode string, body map[string]any) (map[string]any, error) {
	receivablePlanCode = strings.TrimSpace(receivablePlanCode)
	if receivablePlanCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_receivable_plan_code", "receivablePlanCode is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	plan, err := altocQueryOneMap(ctx, tx, `
		SELECT
		  rp.*,
		  c.code AS contract_code,
		  c.name AS contract_name,
		  cu.code AS customer_code,
		  cu.name AS customer_name
		FROM receivable_plan rp
		JOIN contract c ON c.id = rp.contract_id
		JOIN customer cu ON cu.id = rp.customer_id
		WHERE rp.code = ?
		  AND rp.deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, receivablePlanCode)
	if err != nil {
		return nil, err
	}
	if plan == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "receivable plan not found")
	}
	if err := altocRequireActionScope(body, "receivable", "mark-billable"); err != nil {
		return nil, err
	}

	status := strings.TrimSpace(fmt.Sprint(plan["status"]))
	if isReceivablePlanBillableOrLater(status) {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"receivablePlan": plan, "changed": false, "idempotent": true}, nil
	}
	if status == "bad_debt" {
		return nil, httperror.New(http.StatusConflict, "invalid_receivable_plan_status", "bad debt receivable plan cannot be marked billable")
	}

	operator := firstBodyText(body, "operatorUid", "operator_uid", "updatedBy", "updated_by", "current_user")
	if _, err := tx.ExecContext(ctx, `
		UPDATE receivable_plan
		SET status = 'to_invoice',
		    updated_by = COALESCE(?, updated_by),
		    updated_at = CURRENT_TIMESTAMP
		WHERE code = ?
		  AND deleted_at IS NULL
	`, nullableText(operator), receivablePlanCode); err != nil {
		return nil, err
	}

	updated, err := altocQueryOneMap(ctx, tx, `
		SELECT
		  rp.*,
		  c.code AS contract_code,
		  c.name AS contract_name,
		  cu.code AS customer_code,
		  cu.name AS customer_name
		FROM receivable_plan rp
		JOIN contract c ON c.id = rp.contract_id
		JOIN customer cu ON cu.id = rp.customer_id
		WHERE rp.code = ?
		  AND rp.deleted_at IS NULL
		LIMIT 1
	`, receivablePlanCode)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"receivablePlan": updated, "changed": true, "idempotent": false}, nil
}

func (a *Adapter) markReceivablePlansBillableByPaymentTerm(ctx context.Context, rawPaymentTermID string, body map[string]any) (map[string]any, error) {
	paymentTermID, err := strconv.ParseInt(strings.TrimSpace(rawPaymentTermID), 10, 64)
	if err != nil || paymentTermID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_payment_term_id", "paymentTermId is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `
		SELECT
		  rp.*,
		  c.code AS contract_code,
		  c.name AS contract_name,
		  cu.code AS customer_code,
		  cu.name AS customer_name
		FROM receivable_plan rp
		JOIN contract c ON c.id = rp.contract_id
		JOIN customer cu ON cu.id = rp.customer_id
		WHERE rp.payment_term_id = ?
		  AND rp.deleted_at IS NULL
		ORDER BY rp.planned_payment_date ASC, rp.id ASC
		FOR UPDATE
	`, paymentTermID)
	if err != nil {
		return nil, err
	}
	plans, err := altocRowsToMaps(rows)
	rows.Close()
	if err != nil {
		return nil, err
	}
	if len(plans) == 0 {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "receivable plan not found for payment term")
	}
	if err := altocRequireActionScope(body, "receivable", "mark-billable"); err != nil {
		return nil, err
	}

	for _, plan := range plans {
		if strings.TrimSpace(fmt.Sprint(plan["status"])) == "bad_debt" {
			return nil, httperror.New(http.StatusConflict, "invalid_receivable_plan_status", "bad debt receivable plan cannot be marked billable")
		}
	}

	toUpdate := make([]any, 0, len(plans))
	for _, plan := range plans {
		status := strings.TrimSpace(fmt.Sprint(plan["status"]))
		if isReceivablePlanBillableOrLater(status) {
			continue
		}
		toUpdate = append(toUpdate, plan["id"])
	}

	operator := firstBodyText(body, "operatorUid", "operator_uid", "updatedBy", "updated_by", "current_user")
	for _, planID := range toUpdate {
		if _, err := tx.ExecContext(ctx, `
			UPDATE receivable_plan
			SET status = 'to_invoice',
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
			  AND deleted_at IS NULL
		`, nullableText(operator), planID); err != nil {
			return nil, err
		}
	}

	rows, err = tx.QueryContext(ctx, `
		SELECT
		  rp.*,
		  c.code AS contract_code,
		  c.name AS contract_name,
		  cu.code AS customer_code,
		  cu.name AS customer_name
		FROM receivable_plan rp
		JOIN contract c ON c.id = rp.contract_id
		JOIN customer cu ON cu.id = rp.customer_id
		WHERE rp.payment_term_id = ?
		  AND rp.deleted_at IS NULL
		ORDER BY rp.planned_payment_date ASC, rp.id ASC
	`, paymentTermID)
	if err != nil {
		return nil, err
	}
	updated, err := altocRowsToMaps(rows)
	rows.Close()
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	var firstPlan any
	if len(updated) > 0 {
		firstPlan = updated[0]
	}
	return map[string]any{
		"paymentTermId":   paymentTermID,
		"receivablePlan":  firstPlan,
		"receivablePlans": updated,
		"changed":         len(toUpdate) > 0,
		"changedCount":    len(toUpdate),
		"idempotent":      len(toUpdate) == 0,
	}, nil
}

func (a *Adapter) generateReceivablePlansForStageTx(ctx context.Context, tx *sql.Tx, contract map[string]any, stageType string, operator string) (int, error) {
	contractID := contract["id"]
	rows, err := tx.QueryContext(ctx, `
		SELECT *
		FROM contract_payment_term
		WHERE contract_id = ?
		  AND (
		    trigger_stage_type = ?
		    OR (COALESCE(trigger_stage_type, '') = '' AND ? = 'contract_signed')
		  )
		ORDER BY sort_no ASC, id ASC
	`, contractID, stageType, stageType)
	if err != nil {
		return 0, err
	}
	terms, err := altocRowsToMaps(rows)
	rows.Close()
	if err != nil {
		return 0, err
	}

	created := 0
	contractAmount := moneyValue(contract["amount_tax_inclusive"])
	fallbackDate := firstNonEmptyDate(contract["effective_date"], contract["sign_date"], time.Now().UTC().Format("2006-01-02"))
	for _, term := range terms {
		amount := amountForPaymentTerm(term, contractAmount)
		if amount <= 0 {
			continue
		}

		if strings.TrimSpace(fmt.Sprint(term["billing_mode"])) == "annual" {
			count, err := a.insertAnnualReceivablePlans(ctx, tx, contract, term, amount, fallbackDate, operator)
			if err != nil {
				return 0, err
			}
			created += count
			continue
		}

		planName := firstNonEmptyText(fmt.Sprint(term["term_name"]), "付款条款")
		plannedDate := firstNonEmptyDate(term["expected_date"], fallbackDate)
		inserted, err := a.insertReceivablePlanIfMissing(ctx, tx, contract, term, planName, paymentTermType(term), amount, plannedDate, operator)
		if err != nil {
			return 0, err
		}
		if inserted {
			created++
		}
	}
	return created, nil
}

func (a *Adapter) insertAnnualReceivablePlans(
	ctx context.Context,
	tx *sql.Tx,
	contract map[string]any,
	term map[string]any,
	amount float64,
	fallbackDate string,
	operator string,
) (int, error) {
	serviceStart := firstNonEmptyDate(term["service_start_date"], contract["effective_date"], contract["sign_date"], fallbackDate)
	serviceEnd := firstNonEmptyDate(term["service_end_date"], contract["end_date"])
	start, err := time.Parse("2006-01-02", serviceStart)
	if err != nil {
		return 0, nil
	}
	end := start.AddDate(1, 0, 0)
	if serviceEnd != "" {
		if parsed, err := time.Parse("2006-01-02", serviceEnd); err == nil {
			end = parsed
		}
	}
	month := clampInt(numberValue(term["recurrence_month"], int(start.Month())), 1, 12)
	day := clampInt(numberValue(term["recurrence_day"], start.Day()), 1, 31)
	created := 0
	for year := start.Year(); year <= end.Year(); year++ {
		due := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
		if due.Before(start) || due.After(end) {
			continue
		}
		planName := fmt.Sprintf("%s-%d", firstNonEmptyText(fmt.Sprint(term["term_name"]), "年度服务费"), year)
		inserted, err := a.insertReceivablePlanIfMissing(ctx, tx, contract, term, planName, paymentTermType(term), amount, due.Format("2006-01-02"), operator)
		if err != nil {
			return 0, err
		}
		if inserted {
			created++
		}
	}
	return created, nil
}

func (a *Adapter) insertReceivablePlanIfMissing(
	ctx context.Context,
	tx *sql.Tx,
	contract map[string]any,
	term map[string]any,
	planName string,
	planType string,
	amount float64,
	plannedDate string,
	operator string,
) (bool, error) {
	var existing int64
	err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM receivable_plan
		WHERE contract_id = ?
		  AND payment_term_id = ?
		  AND plan_name = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, contract["id"], term["id"], planName).Scan(&existing)
	if err != nil && err != sql.ErrNoRows {
		return false, err
	}
	if existing > 0 {
		return false, nil
	}

	code, err := nextAltocCode(ctx, tx, "RP", "receivable_plan")
	if err != nil {
		return false, err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO receivable_plan (
		  code, contract_id, payment_term_id, customer_id, opportunity_id,
		  plan_name, plan_type, status, amount, planned_payment_date,
		  unreceived_amount, owner_user_id, created_by, updated_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
	`, code,
		contract["id"],
		term["id"],
		contract["customer_id"],
		contract["opportunity_id"],
		planName,
		planType,
		fmt.Sprintf("%.2f", amount),
		nullableText(plannedDate),
		fmt.Sprintf("%.2f", amount),
		contract["owner_user_id"],
		nullableText(operator),
		nullableText(operator))
	if err != nil {
		return false, err
	}
	return true, nil
}

func (a *Adapter) contractPaymentTerms(ctx context.Context, conn altocQueryer, contractID any) ([]map[string]any, error) {
	rows, err := conn.QueryContext(ctx, `
		SELECT
		  cpt.*,
		  rp.code AS receivable_plan_code,
		  rp.status AS receivable_plan_status
		FROM contract_payment_term cpt
		LEFT JOIN receivable_plan rp
		  ON rp.payment_term_id = cpt.id
		 AND rp.contract_id = cpt.contract_id
		 AND rp.deleted_at IS NULL
		WHERE cpt.contract_id = ?
		ORDER BY cpt.sort_no ASC, cpt.id ASC, rp.id ASC
	`, contractID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return altocRowsToMaps(rows)
}

func (a *Adapter) contractReceivablePlans(ctx context.Context, conn altocQueryer, contractID any) ([]map[string]any, error) {
	rows, err := conn.QueryContext(ctx, `
		SELECT *
		FROM receivable_plan
		WHERE contract_id = ?
		  AND deleted_at IS NULL
		ORDER BY planned_payment_date ASC, id ASC
	`, contractID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return altocRowsToMaps(rows)
}

func altocQueryOneMap(ctx context.Context, conn altocQueryer, query string, args ...any) (map[string]any, error) {
	rows, err := conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := altocRowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, nil
	}
	return items[0], nil
}

func altocRowsToMaps(rows *sql.Rows) ([]map[string]any, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	values := make([]any, len(columns))
	targets := make([]any, len(columns))
	for i := range values {
		targets[i] = &values[i]
	}
	result := make([]map[string]any, 0)
	for rows.Next() {
		if err := rows.Scan(targets...); err != nil {
			return nil, err
		}
		item := make(map[string]any, len(columns))
		for i, column := range columns {
			item[column] = normalizeAltocSQLValue(values[i])
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func normalizeAltocSQLValue(value any) any {
	switch typed := value.(type) {
	case nil:
		return nil
	case []byte:
		return string(typed)
	case time.Time:
		return typed.UTC().Format("2006-01-02 15:04:05")
	default:
		return typed
	}
}

func nextAltocCode(ctx context.Context, tx *sql.Tx, prefix string, table string) (string, error) {
	for index := 0; index < 20; index++ {
		code := prefix + time.Now().UTC().Format("20060102150405") + fmt.Sprintf("%02d", index)
		var count int64
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE code = ?", code).Scan(&count); err != nil {
			return "", err
		}
		if count == 0 {
			return code, nil
		}
	}
	return "", httperror.New(http.StatusConflict, "code_generation_failed", "unable to generate code")
}

func amountForPaymentTerm(term map[string]any, contractAmount float64) float64 {
	amount := moneyValue(term["amount"])
	if amount > 0 {
		return amount
	}
	ratio := moneyValue(term["ratio"])
	if ratio > 0 && contractAmount > 0 {
		return contractAmount * ratio / 100
	}
	return 0
}

func amountForFinanceSync(source map[string]any, primaryKeys ...string) float64 {
	for _, key := range primaryKeys {
		amount := moneyValue(source[key])
		if amount > 0 {
			return amount
		}
	}
	return 0
}

func moneyValue(value any) float64 {
	switch typed := value.(type) {
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case float64:
		return typed
	case []byte:
		parsed, _ := strconv.ParseFloat(string(typed), 64)
		return parsed
	case string:
		parsed, _ := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(typed), ",", ""), 64)
		return parsed
	default:
		parsed, _ := strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(value)), 64)
		return parsed
	}
}

func numberValue(value any, fallback int) int {
	text := strings.TrimSpace(fmt.Sprint(value))
	if value == nil || text == "" || text == "<nil>" {
		return fallback
	}
	parsed, err := strconv.Atoi(text)
	if err != nil {
		return fallback
	}
	return parsed
}

func clampInt(value int, min int, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func firstNonEmptyDate(values ...any) string {
	for _, value := range values {
		text := strings.TrimSpace(fmt.Sprint(value))
		if value == nil || text == "" || text == "<nil>" {
			continue
		}
		if len(text) >= 10 {
			text = text[:10]
		}
		if _, err := time.Parse("2006-01-02", text); err == nil {
			return text
		}
	}
	return ""
}

func firstNonEmptyText(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && value != "<nil>" {
			return value
		}
	}
	return ""
}

func nestedMap(body map[string]any, keys ...string) map[string]any {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		if typed, ok := value.(map[string]any); ok {
			return typed
		}
	}
	return map[string]any{}
}

func paymentTermType(term map[string]any) string {
	termType := strings.TrimSpace(fmt.Sprint(term["term_type"]))
	if termType == "" || termType == "<nil>" {
		return "milestone"
	}
	return termType
}

func isReceivablePlanBillableOrLater(status string) bool {
	switch strings.TrimSpace(status) {
	case "to_invoice", "to_receive", "partially_received", "received":
		return true
	default:
		return false
	}
}

func firstBodyText(body map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text != "" && text != "<nil>" {
			return text
		}
	}
	return ""
}

func nullableText(text string) any {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	return text
}
