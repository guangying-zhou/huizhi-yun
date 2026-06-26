package finance

import (
	"context"
	"database/sql"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type approvalTarget struct {
	BizType         string
	Table           string
	CodePrefix      string
	NotFoundMessage string
}

var approvalTargets = map[string]approvalTarget{
	"invoice_request":         {"invoice_request", "invoice_request", "IR", "invoice request not found"},
	"expense_claim":           {"expense_claim", "expense_claim", "CLM", "expense claim not found"},
	"project_expense_request": {"project_expense_request", "project_expense_request", "PER", "project expense request not found"},
	"payment_request":         {"payment_request", "payment_request", "PAY", "payment request not found"},
}

func (a *Adapter) SubmitApprovalByPath(ctx context.Context, path string, body jsonBody) (DataResult[map[string]any], string, error) {
	prefixToTarget := map[string]string{
		"/v1/finance/invoice-requests/":         "invoice_request",
		"/v1/finance/expense-claims/":           "expense_claim",
		"/v1/finance/project-expense-requests/": "project_expense_request",
		"/v1/finance/payment-requests/":         "payment_request",
	}
	for prefix, targetName := range prefixToTarget {
		if strings.HasPrefix(path, prefix) && strings.HasSuffix(path, "/submit") {
			code := strings.TrimSuffix(strings.TrimPrefix(path, prefix), "/submit")
			result, err := a.SubmitApproval(ctx, approvalTargets[targetName], code, body)
			return result, "finance." + strings.ReplaceAll(targetName, "_", ".") + ".submit", err
		}
	}
	return DataResult[map[string]any]{}, "finance.approval.submit", httperror.New(http.StatusNotFound, "not_found", "Route not found")
}

func (a *Adapter) SubmitApproval(ctx context.Context, target approvalTarget, code string, body jsonBody) (DataResult[map[string]any], error) {
	if err := requireCodePath(code); err != nil {
		return DataResult[map[string]any]{}, err
	}
	row, err := queryOneMap(ctx, a.db, "SELECT * FROM "+target.Table+" WHERE code = ? AND deleted_at IS NULL", code)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if row == nil {
		return DataResult[map[string]any]{}, notFound(target.NotFoundMessage)
	}
	if isApplicantRequestTable(target.Table) {
		if err := requireApplicantRequestBodyAccess(body, row); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}
	if err := ensureEditableStatus(row["status"], "only draft or rejected documents can be submitted"); err != nil {
		return DataResult[map[string]any]{}, err
	}

	workflowInstanceID := cleanStringValue(bodyValue(body, "workflowInstanceId", "workflow_instance_id"))
	externalInstanceID := cleanStringValue(bodyValue(body, "externalInstanceId", "external_instance_id"))
	platform := firstNonEmpty(cleanStringValue(bodyValue(body, "workflowPlatform", "workflow_platform", "externalPlatform", "external_platform")), "workflow")
	status := firstNonEmpty(cleanStringValue(bodyValue(body, "workflowStatus", "workflow_status")), "running")
	errorMessage := nilString(bodyValue(body, "workflowErrorMessage", "workflow_error_message", "errorMessage", "error_message"))
	if workflowInstanceID == "" {
		workflowInstanceID = "finance-" + target.BizType + "-" + code
		platform = "local"
		status = "pending"
		errorMessage = "Workflow submission is handled by the cloud app before Data Runtime Agent proxying"
	}
	submittedBy := nilString(bodyValue(body, "submittedBy", "submitted_by"))

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		UPDATE `+target.Table+`
		SET status = 'pending_approval',
		    workflow_instance_id = ?,
		    submitted_at = NOW(),
		    updated_by = COALESCE(?, updated_by),
		    updated_at = CURRENT_TIMESTAMP
		WHERE code = ? AND deleted_at IS NULL
	`, workflowInstanceID, submittedBy, code); err != nil {
		return DataResult[map[string]any]{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO external_approval_instance (
		  biz_type, biz_code, workflow_instance_id, external_platform, external_instance_id,
		  status, submitted_by, submitted_at, last_synced_at, error_message
		) VALUES (?, ?, ?, ?, ?, 'pending', ?, NOW(), NOW(), ?)
		ON DUPLICATE KEY UPDATE
		  workflow_instance_id = VALUES(workflow_instance_id),
		  external_platform = VALUES(external_platform),
		  external_instance_id = VALUES(external_instance_id),
		  status = 'pending',
		  submitted_by = VALUES(submitted_by),
		  submitted_at = NOW(),
		  last_synced_at = NOW(),
		  error_message = VALUES(error_message)
	`, target.BizType, code, workflowInstanceID, platform, externalInstanceID, submittedBy, errorMessage); err != nil {
		return DataResult[map[string]any]{}, err
	}
	if status == "approved" {
		if err := a.applyApprovalResultTx(ctx, tx, target, code, "approved", approvalOptions{WorkflowInstanceID: workflowInstanceID, Operator: cleanStringValue(submittedBy), ApprovalActorUIDs: approvalActorUIDsFromBody(body)}); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}
	updated, err := queryOneMap(ctx, tx, "SELECT * FROM "+target.Table+" WHERE code = ? AND deleted_at IS NULL", code)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := tx.Commit(); err != nil {
		return DataResult[map[string]any]{}, err
	}
	return resultData(updated), nil
}

type approvalOptions struct {
	WorkflowInstanceID string
	ApprovedAmount     any
	RejectReason       any
	Operator           string
	ApprovalActorUIDs  []string
}

func (a *Adapter) WorkflowCallback(ctx context.Context, body jsonBody) (DataResult[map[string]any], error) {
	workflowInstanceID := cleanStringValue(bodyValue(body, "workflowInstanceId", "workflow_instance_id", "instance_id"))
	bizType := cleanStringValue(bodyValue(body, "bizType", "biz_type"))
	bizCode := cleanStringValue(bodyValue(body, "bizCode", "biz_code", "bizId", "biz_id"))
	externalPlatform := firstNonEmpty(cleanStringValue(bodyValue(body, "externalPlatform", "external_platform")), "workflow")
	requestID := firstNonEmpty(cleanStringValue(bodyValue(body, "requestId", "request_id")), cleanStringValue(bodyValue(body, "eventId", "event_id")), workflowInstanceID+"-"+bizType+"-"+bizCode)
	eventType := firstNonEmpty(cleanStringValue(bodyValue(body, "eventType", "event_type", "event")), "approval_result")

	approvalInstance, err := a.findApprovalInstance(ctx, workflowInstanceID, bizType, bizCode)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if approvalInstance != nil {
		bizType = cleanStringValue(approvalInstance["biz_type"])
		bizCode = cleanStringValue(approvalInstance["biz_code"])
		if workflowInstanceID == "" {
			workflowInstanceID = cleanStringValue(approvalInstance["workflow_instance_id"])
		}
	}
	target, ok := approvalTargets[bizType]
	if !ok {
		return DataResult[map[string]any]{}, httperror.New(http.StatusBadRequest, "unsupported_biz_type", "unsupported bizType")
	}

	existingLog, err := queryOneMap(ctx, a.db, "SELECT id, process_status FROM approval_callback_log WHERE external_platform = ? AND request_id = ?", externalPlatform, requestID)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if cleanStringValue(valueFrom(existingLog, "process_status")) == "processed" {
		return resultData(map[string]any{"ignored": true, "reason": "duplicate callback", "requestId": requestID}), nil
	}
	payload, err := jsonOrNil(body)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	approvalInstanceID := valueFrom(approvalInstance, "id")
	if _, err := a.db.ExecContext(ctx, `
		INSERT INTO approval_callback_log (
		  approval_instance_id, workflow_instance_id, external_platform, event_type,
		  request_id, payload_json, process_status, received_at
		) VALUES (?, ?, ?, ?, ?, ?, 'received', NOW())
		ON DUPLICATE KEY UPDATE
		  approval_instance_id = VALUES(approval_instance_id),
		  workflow_instance_id = VALUES(workflow_instance_id),
		  payload_json = VALUES(payload_json),
		  process_status = 'received',
		  error_message = NULL
	`, approvalInstanceID, workflowInstanceID, externalPlatform, eventType, requestID, payload); err != nil {
		return DataResult[map[string]any]{}, err
	}

	result, err := normalizeApprovalResult(bodyValue(body, "status", "result", "approvalStatus", "approval_status"))
	if err == nil {
		approvedAmount, amountErr := moneyStringValue(bodyValue(body, "approvedAmount", "approved_amount"), "approvedAmount", false, false)
		if amountErr != nil {
			err = amountErr
		} else {
			tx, txErr := a.db.BeginTx(ctx, nil)
			if txErr != nil {
				err = txErr
			} else {
				err = a.applyApprovalResultTx(ctx, tx, target, bizCode, result, approvalOptions{
					WorkflowInstanceID: workflowInstanceID,
					ApprovedAmount:     approvedAmount,
					RejectReason:       nilString(bodyValue(body, "rejectReason", "reject_reason", "reason")),
					Operator:           cleanStringValue(bodyValue(body, "operator", "updatedBy", "updated_by", "approvalOperatorUid", "approval_operator_uid")),
					ApprovalActorUIDs:  approvalActorUIDsFromBody(body),
				})
				if err == nil {
					err = tx.Commit()
				} else {
					_ = tx.Rollback()
				}
			}
		}
	}
	if err != nil {
		_, _ = a.db.ExecContext(ctx, "UPDATE approval_callback_log SET process_status = 'failed', processed_at = NOW(), error_message = ? WHERE external_platform = ? AND request_id = ?", err.Error(), externalPlatform, requestID)
		return DataResult[map[string]any]{}, err
	}
	_, _ = a.db.ExecContext(ctx, "UPDATE approval_callback_log SET process_status = 'processed', processed_at = NOW(), error_message = NULL WHERE external_platform = ? AND request_id = ?", externalPlatform, requestID)
	row, err := queryOneMap(ctx, a.db, "SELECT * FROM "+target.Table+" WHERE code = ? AND deleted_at IS NULL", bizCode)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	return resultData(row), nil
}

func (a *Adapter) findApprovalInstance(ctx context.Context, workflowInstanceID string, bizType string, bizCode string) (map[string]any, error) {
	if workflowInstanceID != "" {
		row, err := queryOneMap(ctx, a.db, "SELECT * FROM external_approval_instance WHERE workflow_instance_id = ? LIMIT 1", workflowInstanceID)
		if err != nil || row != nil {
			return row, err
		}
	}
	if bizType != "" && bizCode != "" {
		return queryOneMap(ctx, a.db, "SELECT * FROM external_approval_instance WHERE biz_type = ? AND biz_code = ? LIMIT 1", bizType, bizCode)
	}
	return nil, nil
}

func normalizeApprovalResult(value any) (string, error) {
	status := strings.ToLower(cleanStringValue(value))
	switch status {
	case "approved", "approve", "passed":
		return "approved", nil
	case "rejected", "reject", "failed":
		return "rejected", nil
	case "canceled", "cancelled", "withdrawn":
		return "canceled", nil
	default:
		return "", httperror.New(http.StatusBadRequest, "unsupported_approval_result", "unsupported approval result")
	}
}

func (a *Adapter) applyApprovalResultTx(ctx context.Context, tx *sql.Tx, target approvalTarget, code string, result string, options approvalOptions) error {
	row, err := queryOneMap(ctx, tx, "SELECT * FROM "+target.Table+" WHERE code = ? AND deleted_at IS NULL FOR UPDATE", code)
	if err != nil {
		return err
	}
	if row == nil {
		return notFound(target.NotFoundMessage)
	}
	if err := requireApprovalDutySeparation(target, row, result, options); err != nil {
		return err
	}

	if result == "approved" {
		if target.BizType == "invoice_request" {
			if err := a.approveInvoiceRequest(ctx, tx, row, options); err != nil {
				return err
			}
		} else if err := a.approveExpenseLikeRequest(ctx, tx, target, row, options); err != nil {
			return err
		}
	} else if result == "rejected" {
		if _, err := tx.ExecContext(ctx, `
			UPDATE `+target.Table+`
			SET status = 'rejected',
			    workflow_instance_id = COALESCE(?, workflow_instance_id),
			    rejected_at = NOW(),
			    reject_reason = ?,
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, nullableStringArg(options.WorkflowInstanceID), options.RejectReason, nullableStringArg(options.Operator), row["id"]); err != nil {
			return err
		}
	} else {
		if _, err := tx.ExecContext(ctx, `
			UPDATE `+target.Table+`
			SET status = 'canceled',
			    workflow_instance_id = COALESCE(?, workflow_instance_id),
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, nullableStringArg(options.WorkflowInstanceID), nullableStringArg(options.Operator), row["id"]); err != nil {
			return err
		}
	}

	_, err = tx.ExecContext(ctx, `
		UPDATE external_approval_instance
		SET status = ?,
		    workflow_instance_id = COALESCE(?, workflow_instance_id),
		    completed_at = CASE WHEN ? IN ('approved', 'rejected', 'canceled') THEN NOW() ELSE completed_at END,
		    last_synced_at = NOW()
		WHERE biz_type = ? AND biz_code = ?
	`, result, nullableStringArg(options.WorkflowInstanceID), result, target.BizType, code)
	return err
}

func (a *Adapter) approveInvoiceRequest(ctx context.Context, tx *sql.Tx, row map[string]any, options approvalOptions) error {
	if valueFrom(row, "issued_invoice_id") == nil {
		amount := options.ApprovedAmount
		if amount == nil {
			amount = row["requested_amount"]
		}
		amountValue, err := moneyStringValue(amount, "approvedAmount", true, true)
		if err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `
			INSERT INTO finance_invoice (
			  code, invoice_request_id, customer_code, customer_name, contract_code,
			  receivable_plan_code, invoice_type, invoice_medium, invoice_item, invoice_amount, tax_rate,
			  taxpayer_name, taxpayer_no, status, created_by, updated_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?)
		`, generateFinanceCode("INV"), row["id"], row["customer_code"], row["customer_name"], row["contract_code"], row["receivable_plan_code"], row["invoice_type"], firstNonEmpty(cleanStringValue(row["invoice_medium"]), "electronic"), row["invoice_item"], amountValue, row["tax_rate"], row["taxpayer_name"], row["taxpayer_no"], nullableStringArg(options.Operator), nullableStringArg(options.Operator))
		if err != nil {
			return err
		}
		id, err := insertID(result)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE invoice_request SET issued_invoice_id = ?, status = 'issued' WHERE id = ?", id, row["id"]); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE invoice_request
		SET status = CASE WHEN issued_invoice_id IS NULL THEN 'approved' ELSE 'issued' END,
		    workflow_instance_id = COALESCE(?, workflow_instance_id),
		    approved_at = COALESCE(approved_at, NOW()),
		    updated_by = COALESCE(?, updated_by),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, nullableStringArg(options.WorkflowInstanceID), nullableStringArg(options.Operator), row["id"]); err != nil {
		return err
	}
	return a.recalculateContractSummary(ctx, tx, row["contract_code"])
}

func (a *Adapter) approveExpenseLikeRequest(ctx context.Context, tx *sql.Tx, target approvalTarget, row map[string]any, options approvalOptions) error {
	if valueFrom(row, "generated_expense_id") == nil {
		amount := firstNonEmpty(cleanStringValue(options.ApprovedAmount), cleanStringValue(row["approved_amount"]), cleanStringValue(row["total_amount"]), cleanStringValue(row["requested_amount"]))
		amountValue, err := moneyStringValue(amount, "approvedAmount", true, true)
		if err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `
			INSERT INTO finance_expense (
			  code, expense_date, expense_amount, currency_code, project_code, contract_code,
			  customer_code, department_code, handler_user_id, payee_name, payee_account_masked,
			  payee_bank, source_request_type, source_request_code, status, description, created_by, updated_by
			) VALUES (?, CURRENT_DATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)
		`, generateFinanceCode("EXP"), amountValue, firstNonEmpty(cleanStringValue(row["currency_code"]), "CNY"), row["project_code"], row["contract_code"], row["customer_code"], row["applicant_dept_code"], row["applicant_user_id"], row["payee_name"], row["payee_account_masked"], row["payee_bank"], target.BizType, row["code"], firstNonEmpty(cleanStringValue(row["title"]), cleanStringValue(row["remark"])), nullableStringArg(options.Operator), nullableStringArg(options.Operator))
		if err != nil {
			return err
		}
		id, err := insertID(result)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE "+target.Table+" SET generated_expense_id = ? WHERE id = ?", id, row["id"]); err != nil {
			return err
		}
	}
	if target.BizType == "payment_request" {
		_, err := tx.ExecContext(ctx, `
			UPDATE payment_request
			SET status = 'approved',
			    approved_amount = COALESCE(?, approved_amount, requested_amount),
			    workflow_instance_id = COALESCE(?, workflow_instance_id),
			    approved_at = COALESCE(approved_at, NOW()),
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, options.ApprovedAmount, nullableStringArg(options.WorkflowInstanceID), nullableStringArg(options.Operator), row["id"])
		return err
	}
	_, err := tx.ExecContext(ctx, `
		UPDATE `+target.Table+`
		SET status = 'approved',
		    approved_amount = COALESCE(?, approved_amount, total_amount),
		    workflow_instance_id = COALESCE(?, workflow_instance_id),
		    approved_at = COALESCE(approved_at, NOW()),
		    updated_by = COALESCE(?, updated_by),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, options.ApprovedAmount, nullableStringArg(options.WorkflowInstanceID), nullableStringArg(options.Operator), row["id"])
	return err
}

func nullableStringArg(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func approvalActorUIDsFromBody(body jsonBody) []string {
	return uniqueCleanStrings(
		bodyValue(body, "approvalActorUids", "approval_actor_uids", "approverUids", "approver_uids"),
		bodyValue(body, "nonSelfApprovalActorUids", "non_self_approval_actor_uids"),
		bodyValue(body, "approvalOperatorUid", "approval_operator_uid"),
		bodyValue(body, "operator", "updatedBy", "updated_by"),
	)
}

func requireApprovalDutySeparation(target approvalTarget, row map[string]any, result string, options approvalOptions) error {
	if result != "approved" && result != "rejected" {
		return nil
	}
	requester := approvalRequesterUID(target, row)
	if requester == "" {
		return nil
	}
	actors := uniqueCleanStrings(options.ApprovalActorUIDs, options.Operator)
	if len(actors) == 0 {
		return approvalDutySeparationForbidden()
	}
	for _, actor := range actors {
		if actor != requester {
			return nil
		}
	}
	return approvalDutySeparationForbidden()
}

func approvalRequesterUID(target approvalTarget, row map[string]any) string {
	if target.BizType == "invoice_request" {
		return cleanStringValue(row["requested_by"])
	}
	return cleanStringValue(row["applicant_user_id"])
}

func approvalDutySeparationForbidden() error {
	return httperror.New(http.StatusForbidden, "approval_duty_separation_required", "approval result requires a non-applicant approver")
}

func uniqueCleanStrings(values ...any) []string {
	seen := map[string]bool{}
	result := make([]string, 0)
	var visit func(any)
	visit = func(value any) {
		switch typed := value.(type) {
		case nil:
			return
		case []string:
			for _, item := range typed {
				visit(item)
			}
		case []any:
			for _, item := range typed {
				visit(item)
			}
		default:
			for _, item := range strings.FieldsFunc(cleanStringValue(value), func(r rune) bool {
				return r == ',' || r == ';' || r == ' ' || r == '\n' || r == '\t'
			}) {
				text := strings.TrimSpace(item)
				if text == "" || seen[text] {
					continue
				}
				seen[text] = true
				result = append(result, text)
			}
		}
	}
	for _, value := range values {
		visit(value)
	}
	return result
}
