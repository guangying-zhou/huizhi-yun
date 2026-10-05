package altoc

import (
	"context"
	"database/sql"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) approveQuotation(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	quotationID, err := altocIdentifierID(identifier, "quotation_id")
	if err != nil {
		return nil, err
	}
	action, err := quotationApprovalAction(body)
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	quotation, err := a.lockQuotationTx(ctx, tx, quotationID)
	if err != nil {
		return nil, err
	}
	if quotation == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "quotation not found")
	}
	if err := altocRequireRecordWrite(body, "quotation", quotation, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "quotation", "approve"); err != nil {
		return nil, err
	}
	if altocMapText(quotation, "status") != "pending_approval" {
		return nil, httperror.New(http.StatusConflict, "invalid_quotation_status", "only pending approval quotations can be approved or rejected")
	}

	operator := altocActor(body)
	reason := firstBodyText(body, "reason", "reject_reason", "rejectReason")
	columns, err := altocTableColumns(ctx, tx, "quotation")
	if err != nil {
		return nil, err
	}
	set, args, err := quotationApprovalSetParts(columns, action, reason, operator)
	if err != nil {
		return nil, err
	}
	args = append(args, quotationID)
	if _, err := tx.ExecContext(ctx, "UPDATE quotation SET "+strings.Join(set, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, err
	}

	newValue := map[string]any{"status": quotationApprovalTargetStatus(action)}
	if action == "reject" {
		newValue["reject_reason"] = nullableText(reason)
	}
	if err := insertAltocAuditTx(ctx, tx, "quotation", quotationID, action, map[string]any{
		"status": quotation["status"],
	}, newValue, operator); err != nil {
		return nil, err
	}

	updated, err := a.quotationByIDTx(ctx, tx, quotationID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"quotation": updated,
		"action":    action,
		"changed":   true,
	}, nil
}

func (a *Adapter) changeQuotationStatus(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	quotationID, err := altocIdentifierID(identifier, "quotation_id")
	if err != nil {
		return nil, err
	}
	action, err := quotationStatusAction(body)
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	quotation, err := a.lockQuotationTx(ctx, tx, quotationID)
	if err != nil {
		return nil, err
	}
	if quotation == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "quotation not found")
	}
	if err := altocRequireRecordWrite(body, "quotation", quotation, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "quotation", "edit"); err != nil {
		return nil, err
	}
	currentStatus := altocMapText(quotation, "status")
	if !quotationStatusActionAllowed(action, currentStatus) {
		return nil, httperror.New(http.StatusConflict, "invalid_quotation_status", "quotation status does not allow this action")
	}

	operator := altocActor(body)
	columns, err := altocTableColumns(ctx, tx, "quotation")
	if err != nil {
		return nil, err
	}
	set, args, err := quotationStatusSetParts(columns, action, operator)
	if err != nil {
		return nil, err
	}
	args = append(args, quotationID)
	if _, err := tx.ExecContext(ctx, "UPDATE quotation SET "+strings.Join(set, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, err
	}

	targetStatus := quotationStatusTargetStatus(action)
	if err := insertAltocAuditTx(ctx, tx, "quotation", quotationID, "status_change", map[string]any{
		"status": currentStatus,
	}, map[string]any{
		"action": action,
		"status": targetStatus,
	}, operator); err != nil {
		return nil, err
	}

	updated, err := a.quotationByIDTx(ctx, tx, quotationID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"quotation": updated,
		"action":    action,
		"changed":   true,
	}, nil
}

func quotationApprovalAction(body map[string]any) (string, error) {
	action := strings.TrimSpace(firstBodyText(body, "action"))
	switch action {
	case "approve", "reject":
		return action, nil
	default:
		return "", httperror.New(http.StatusBadRequest, "invalid_approval_action", "action must be approve or reject")
	}
}

func quotationStatusAction(body map[string]any) (string, error) {
	action := strings.TrimSpace(firstBodyText(body, "action"))
	switch action {
	case "submit", "submit_approval":
		return "submit", nil
	case "send", "mark_sent":
		return "send", nil
	case "accept", "mark_accepted":
		return "accept", nil
	default:
		return "", httperror.New(http.StatusBadRequest, "invalid_status_action", "action must be submit, send, or accept")
	}
}

func quotationApprovalTargetStatus(action string) string {
	if action == "approve" {
		return "approved"
	}
	return "rejected"
}

func quotationStatusTargetStatus(action string) string {
	switch action {
	case "submit":
		return "pending_approval"
	case "send":
		return "sent"
	case "accept":
		return "accepted"
	default:
		return ""
	}
}

func quotationStatusActionAllowed(action string, currentStatus string) bool {
	switch action {
	case "submit":
		return currentStatus == "draft" || currentStatus == "rejected"
	case "send":
		return currentStatus == "approved"
	case "accept":
		return currentStatus == "sent"
	default:
		return false
	}
}

func quotationApprovalSetParts(columns map[string]bool, action string, reason string, operator string) ([]string, []any, error) {
	targetStatus := quotationApprovalTargetStatus(action)
	set := make([]string, 0, 10)
	args := make([]any, 0, 8)
	if columns["status"] {
		set = append(set, "`status` = ?")
		args = append(args, targetStatus)
	}

	switch action {
	case "approve":
		if columns["approved_at"] {
			set = append(set, "`approved_at` = CURRENT_TIMESTAMP")
		}
		if columns["approved_by"] {
			set = append(set, "`approved_by` = ?")
			args = append(args, operator)
		}
		if columns["rejected_at"] {
			set = append(set, "`rejected_at` = ?")
			args = append(args, nil)
		}
		if columns["rejected_by"] {
			set = append(set, "`rejected_by` = ?")
			args = append(args, nil)
		}
		if columns["reject_reason"] {
			set = append(set, "`reject_reason` = ?")
			args = append(args, nil)
		}
	case "reject":
		if columns["rejected_at"] {
			set = append(set, "`rejected_at` = CURRENT_TIMESTAMP")
		}
		if columns["rejected_by"] {
			set = append(set, "`rejected_by` = ?")
			args = append(args, operator)
		}
		if columns["reject_reason"] {
			set = append(set, "`reject_reason` = ?")
			args = append(args, nullableText(reason))
		}
		if columns["approved_at"] {
			set = append(set, "`approved_at` = ?")
			args = append(args, nil)
		}
		if columns["approved_by"] {
			set = append(set, "`approved_by` = ?")
			args = append(args, nil)
		}
	default:
		return nil, nil, httperror.New(http.StatusBadRequest, "invalid_approval_action", "action must be approve or reject")
	}

	if columns["last_status_changed_at"] {
		set = append(set, "`last_status_changed_at` = CURRENT_TIMESTAMP")
	}
	if columns["last_status_changed_by"] {
		set = append(set, "`last_status_changed_by` = ?")
		args = append(args, operator)
	}
	if columns["updated_by"] {
		set = append(set, "`updated_by` = ?")
		args = append(args, operator)
	}
	if columns["updated_at"] {
		set = append(set, "`updated_at` = CURRENT_TIMESTAMP")
	}
	if len(set) == 0 {
		return nil, nil, httperror.New(http.StatusBadRequest, "empty_record", "No writable fields provided")
	}
	return set, args, nil
}

func quotationStatusSetParts(columns map[string]bool, action string, operator string) ([]string, []any, error) {
	targetStatus := quotationStatusTargetStatus(action)
	if targetStatus == "" {
		return nil, nil, httperror.New(http.StatusBadRequest, "invalid_status_action", "action must be submit, send, or accept")
	}

	set := make([]string, 0, 12)
	args := make([]any, 0, 10)
	if columns["status"] {
		set = append(set, "`status` = ?")
		args = append(args, targetStatus)
	}

	switch action {
	case "submit":
		for _, column := range []string{"approved_at", "approved_by", "rejected_at", "rejected_by", "reject_reason", "sent_at", "accepted_at", "expired_at"} {
			if columns[column] {
				set = append(set, "`"+column+"` = ?")
				args = append(args, nil)
			}
		}
	case "send":
		if columns["sent_at"] {
			set = append(set, "`sent_at` = CURRENT_TIMESTAMP")
		}
		for _, column := range []string{"accepted_at", "expired_at"} {
			if columns[column] {
				set = append(set, "`"+column+"` = ?")
				args = append(args, nil)
			}
		}
	case "accept":
		if columns["accepted_at"] {
			set = append(set, "`accepted_at` = CURRENT_TIMESTAMP")
		}
	default:
		return nil, nil, httperror.New(http.StatusBadRequest, "invalid_status_action", "action must be submit, send, or accept")
	}

	if columns["last_status_changed_at"] {
		set = append(set, "`last_status_changed_at` = CURRENT_TIMESTAMP")
	}
	if columns["last_status_changed_by"] {
		set = append(set, "`last_status_changed_by` = ?")
		args = append(args, operator)
	}
	if columns["updated_by"] {
		set = append(set, "`updated_by` = ?")
		args = append(args, operator)
	}
	if columns["updated_at"] {
		set = append(set, "`updated_at` = CURRENT_TIMESTAMP")
	}
	if len(set) == 0 {
		return nil, nil, httperror.New(http.StatusBadRequest, "empty_record", "No writable fields provided")
	}
	return set, args, nil
}

func (a *Adapter) lockQuotationTx(ctx context.Context, tx *sql.Tx, quotationID int64) (map[string]any, error) {
	return altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM quotation
		WHERE id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, quotationID)
}

func (a *Adapter) quotationByIDTx(ctx context.Context, tx *sql.Tx, quotationID any) (map[string]any, error) {
	return altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM quotation
		WHERE id = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, quotationID)
}
