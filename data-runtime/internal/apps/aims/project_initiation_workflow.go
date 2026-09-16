package aims

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) applyProjectInitiationWorkflowCallback(
	ctx context.Context,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	if !truthyQuery(query, "workflow_callback_verified") {
		return nil, httperror.New(http.StatusForbidden, "workflow_callback_verification_required", "trusted workflow callback is required")
	}
	if strings.TrimSpace(firstBodyText(body, "event")) != "flow_completed" ||
		strings.TrimSpace(firstBodyText(body, "app_code", "appCode")) != "aims" ||
		strings.TrimSpace(firstBodyText(body, "resource_code", "resourceCode")) != "projects" ||
		strings.TrimSpace(firstBodyText(body, "action_code", "actionCode")) != "initiation" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_project_initiation_callback", "callback identity does not match project initiation")
	}

	status := strings.TrimSpace(firstBodyText(body, "status"))
	if status != "approved" && status != "rejected" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_project_initiation_callback_status", "callback status must be approved or rejected")
	}
	projectID, err := parseID(strings.TrimSpace(firstBodyText(body, "biz_id", "bizId")), "project_id")
	if err != nil {
		return nil, err
	}
	instanceID := strings.TrimSpace(firstBodyText(body, "instance_id", "instanceId"))
	if instanceID == "" {
		return nil, httperror.New(http.StatusBadRequest, "project_initiation_callback_binding_required", "callback workflow instance binding is required")
	}
	formData, _ := body["form_data"].(map[string]any)
	callbackProjectID, callbackErr := bodyPositiveInt64(formData, "projectId", "project_id")
	if callbackErr != nil || callbackProjectID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "project_initiation_callback_binding_required", "callback project form binding is required")
	}
	if callbackProjectID != projectID {
		return nil, httperror.New(http.StatusConflict, "project_initiation_callback_biz_mismatch", "callback project does not match form data")
	}

	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var lifecycleStatus, category string
	err = tx.QueryRowContext(ctx, `
		SELECT lifecycle_status, category
		FROM aims_projects
		WHERE id = ?
		FOR UPDATE
	`, projectID).Scan(&lifecycleStatus, &category)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "project_not_found", "project not found")
	}
	if err != nil {
		return nil, err
	}
	if err := validateProjectInitiationLifecycle(category, "approval_pending"); err != nil {
		return nil, err
	}

	alreadyApplied := false
	if status == "rejected" {
		switch lifecycleStatus {
		case "draft":
			alreadyApplied = true
		case "approval_pending":
			if _, err := tx.ExecContext(ctx, "UPDATE aims_projects SET lifecycle_status = 'draft' WHERE id = ?", projectID); err != nil {
				return nil, err
			}
			if err := appendProjectLifecycleEventTx(ctx, tx, strconv.FormatInt(projectID, 10), "draft", "workflow"); err != nil {
				return nil, err
			}
		default:
			return nil, httperror.New(http.StatusConflict, "project_initiation_callback_state_conflict", "project is no longer awaiting initiation approval")
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{
			"projectId": projectID, "status": "rejected", "lifecycleStatus": "draft", "alreadyApplied": alreadyApplied,
		}, nil
	}

	switch lifecycleStatus {
	case "active":
		// Older clients may have applied the project state before the trusted callback.
		// Still repair the missing milestone activation in the same transaction.
		alreadyApplied = true
	case "approval_pending":
		if _, err := tx.ExecContext(ctx, "UPDATE aims_projects SET lifecycle_status = 'active' WHERE id = ?", projectID); err != nil {
			return nil, err
		}
		if err := appendProjectLifecycleEventTx(ctx, tx, strconv.FormatInt(projectID, 10), "active", "workflow"); err != nil {
			return nil, err
		}
	default:
		return nil, httperror.New(http.StatusConflict, "project_initiation_callback_state_conflict", "project is no longer awaiting initiation approval")
	}

	if err := initializeProjectMilestoneStatusesOnActivationTx(ctx, tx, projectID); err != nil {
		return nil, err
	}
	var activeMilestoneID int64
	err = tx.QueryRowContext(ctx, `
		SELECT id
		FROM milestones
		WHERE project_id = ? AND status = 'active'
		ORDER BY sort_order ASC, start_date ASC, id ASC
		LIMIT 1
	`, projectID).Scan(&activeMilestoneID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusConflict, "project_milestone_required", "project initiation requires at least one milestone")
	}
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"projectId":            projectID,
		"status":               "approved",
		"lifecycleStatus":      "active",
		"activatedMilestoneId": activeMilestoneID,
		"alreadyApplied":       alreadyApplied,
		"workflowInstanceId":   instanceID,
		"workflowBizId":        strconv.FormatInt(projectID, 10),
	}, nil
}
