package aims

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type directProjectDocumentAccess struct {
	projectID int64
	createdBy string
	isFolder  bool
}

func (a *Adapter) loadDirectProjectDocumentAccess(ctx context.Context, documentID int64) (directProjectDocumentAccess, error) {
	var access directProjectDocumentAccess
	var projectID sql.NullInt64
	var createdBy sql.NullString
	var isFolder sql.NullInt64
	err := a.DB().QueryRowContext(ctx, `
		SELECT COALESCE(d.project_id, m.project_id, wi.project_id) AS project_id,
		       d.created_by,
		       d.is_folder
		FROM project_documents d
		LEFT JOIN milestones m ON m.id = d.milestone_id
		LEFT JOIN work_items wi ON wi.id = d.work_item_id
		WHERE d.id = ?
	`, documentID).Scan(&projectID, &createdBy, &isFolder)
	if err == sql.ErrNoRows {
		return access, httperror.New(http.StatusNotFound, "document_not_found", "document not found")
	}
	if err != nil {
		return access, err
	}
	if !projectID.Valid || projectID.Int64 <= 0 {
		return access, httperror.New(http.StatusForbidden, "document_project_required", "document project context is required")
	}
	access.projectID = projectID.Int64
	access.createdBy = strings.TrimSpace(createdBy.String)
	access.isFolder = isFolder.Valid && isFolder.Int64 != 0
	return access, nil
}

func (a *Adapter) requireDirectProjectDocumentMemberOrScopedAdmin(ctx context.Context, rawDocumentID string, query url.Values) error {
	documentID, err := parseID(rawDocumentID, "document_id")
	if err != nil {
		return err
	}
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	access, err := a.loadDirectProjectDocumentAccess(ctx, documentID)
	if err != nil {
		return err
	}
	return a.requireProjectMemberOrScopedAdmin(ctx, access.projectID, uid, query)
}

func (a *Adapter) requireDirectProjectDocumentDeleteAccess(ctx context.Context, rawDocumentID string, query url.Values) error {
	documentID, err := parseID(rawDocumentID, "document_id")
	if err != nil {
		return err
	}
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	access, err := a.loadDirectProjectDocumentAccess(ctx, documentID)
	if err != nil {
		return err
	}
	if !access.isFolder && access.createdBy == uid {
		return nil
	}
	return a.requireProjectManagerOrScopedAdmin(ctx, access.projectID, uid, query)
}

type directApprovalRecord struct {
	projectID          int64
	projectOwnerID     sql.NullInt64
	milestoneOwnerID   sql.NullInt64
	workItemOwnerID    sql.NullInt64
	requestNo          string
	workflowInstanceID sql.NullString
	transition         string
	reviewerUID        string
	status             string
}

func (a *Adapter) processDirectApprovalDecision(ctx context.Context, rawApprovalID string, query url.Values, body map[string]any) (map[string]any, error) {
	approvalID, err := parseID(rawApprovalID, "approval_id")
	if err != nil {
		return nil, err
	}
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if strings.TrimSpace(query.Get("current_user_approval_decision_authorized")) != "1" {
		return nil, httperror.New(http.StatusForbidden, "approval_permission_required", "approval decision permission required")
	}

	status := strings.TrimSpace(cleanBodyText(body, "status"))
	if status != "approved" && status != "rejected" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_approval_status", "status must be approved or rejected")
	}
	reviewComment := strings.TrimSpace(cleanBodyText(body, "reviewComment", "review_comment"))

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	approval, err := loadDirectApprovalRecordTx(ctx, tx, approvalID)
	if err != nil {
		return nil, err
	}
	if approval.status != "pending" {
		return nil, httperror.New(http.StatusBadRequest, "approval_already_processed", "approval has already been processed")
	}
	if strings.HasPrefix(approval.requestNo, milestoneCompletionRequestPrefix+"-") {
		return nil, httperror.New(http.StatusConflict, "workflow_decision_required", "milestone completion must be decided through Workflow")
	}
	if approval.workItemOwnerID.Valid {
		if err := requireWorkItemMilestoneCompletionUnlockedTx(ctx, tx, approval.workItemOwnerID.Int64); err != nil {
			return nil, err
		}
	}
	if approval.reviewerUID != "" && approval.reviewerUID != uid {
		return nil, httperror.New(http.StatusForbidden, "approval_reviewer_mismatch", "current user is not the assigned reviewer")
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE approval_records
		SET status = ?, reviewer_uid = ?, reviewed_at = NOW(), review_comment = ?
		WHERE id = ? AND status = 'pending'
	`, status, uid, nullableText(reviewComment), approvalID); err != nil {
		return nil, err
	}

	if err := applyApprovalDecisionEntityStateTx(ctx, tx, approval, status); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{"id": approvalID, "status": status}, nil
}

func loadDirectApprovalRecordTx(ctx context.Context, tx *sql.Tx, approvalID int64) (directApprovalRecord, error) {
	var approval directApprovalRecord
	var transition sql.NullString
	var reviewerUID sql.NullString
	err := tx.QueryRowContext(ctx, `
		SELECT project_id, project_owner_id, milestone_owner_id, work_item_owner_id,
		       COALESCE(request_no, ''), workflow_instance_id, transition, reviewer_uid, status
		FROM approval_records
		WHERE id = ?
		FOR UPDATE
	`, approvalID).Scan(
		&approval.projectID,
		&approval.projectOwnerID,
		&approval.milestoneOwnerID,
		&approval.workItemOwnerID,
		&approval.requestNo,
		&approval.workflowInstanceID,
		&transition,
		&reviewerUID,
		&approval.status,
	)
	if err == sql.ErrNoRows {
		return approval, httperror.New(http.StatusNotFound, "approval_not_found", "approval not found")
	}
	if err != nil {
		return approval, err
	}
	approval.transition = strings.TrimSpace(transition.String)
	approval.reviewerUID = strings.TrimSpace(reviewerUID.String)
	return approval, nil
}

func applyApprovalDecisionEntityStateTx(ctx context.Context, tx *sql.Tx, approval directApprovalRecord, status string) error {
	if status == "approved" {
		if approval.projectOwnerID.Valid {
			if _, err := tx.ExecContext(ctx, "UPDATE aims_projects SET lifecycle_status = 'active' WHERE id = ?", approval.projectOwnerID.Int64); err != nil {
				return err
			}
			return initializeProjectMilestoneStatusesOnActivationTx(ctx, tx, approval.projectOwnerID.Int64)
		}
		if approval.milestoneOwnerID.Valid {
			_, err := tx.ExecContext(ctx, "UPDATE milestones SET status = 'completed' WHERE id = ?", approval.milestoneOwnerID.Int64)
			return err
		}
		if approval.workItemOwnerID.Valid {
			if approval.transition == "complete" {
				_, err := tx.ExecContext(ctx, "UPDATE work_items SET approval_status = 'approved', status = 'completed' WHERE id = ?", approval.workItemOwnerID.Int64)
				return err
			}
			_, err := tx.ExecContext(ctx, "UPDATE work_items SET approval_status = 'approved' WHERE id = ?", approval.workItemOwnerID.Int64)
			return err
		}
		return nil
	}

	if approval.projectOwnerID.Valid {
		_, err := tx.ExecContext(ctx, "UPDATE aims_projects SET lifecycle_status = 'draft' WHERE id = ?", approval.projectOwnerID.Int64)
		return err
	}
	if approval.workItemOwnerID.Valid {
		if approval.transition == "complete" {
			_, err := tx.ExecContext(ctx, "UPDATE work_items SET approval_status = 'rejected', status = 'in_progress' WHERE id = ?", approval.workItemOwnerID.Int64)
			return err
		}
		_, err := tx.ExecContext(ctx, "UPDATE work_items SET approval_status = 'rejected' WHERE id = ?", approval.workItemOwnerID.Int64)
		return err
	}
	return nil
}

func initializeProjectMilestoneStatusesOnActivationTx(ctx context.Context, tx *sql.Tx, projectID int64) error {
	var activeMilestoneID int64
	err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM milestones
		WHERE project_id = ? AND status = 'active'
		ORDER BY sort_order ASC, start_date ASC, id ASC
		LIMIT 1
	`, projectID).Scan(&activeMilestoneID)
	if err != nil && err != sql.ErrNoRows {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE milestones
		SET status = 'todo'
		WHERE project_id = ? AND status = 'planning'
	`, projectID); err != nil {
		return err
	}

	if activeMilestoneID > 0 {
		return nil
	}
	_, err = tx.ExecContext(ctx, `
		UPDATE milestones
		SET status = 'active'
		WHERE id = (
			SELECT id FROM (
				SELECT id
				FROM milestones
				WHERE project_id = ? AND status = 'todo'
				ORDER BY sort_order ASC, start_date ASC, id ASC
				LIMIT 1
			) AS t
		)
	`, projectID)
	return err
}
