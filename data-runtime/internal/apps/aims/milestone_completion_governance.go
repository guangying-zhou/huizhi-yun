package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const milestoneCompletionRequestPrefix = "MCR"

type milestoneCompletionRequest struct {
	ID                 int64
	RequestNo          string
	RequestVersion     int64
	MilestoneID        int64
	ProjectID          int64
	ProjectCode        string
	RequestedBy        string
	ReviewerUID        string
	Status             string
	SnapshotSHA256     string
	WorkflowInstanceID sql.NullString
}

func (a *Adapter) handleMilestoneCompletionGovernanceRuntime(
	ctx context.Context,
	method string,
	path string,
	query url.Values,
	body map[string]any,
) (any, string, bool, error) {
	if milestoneID, ok := pathParam(path, "/v1/aims/milestones/", "/completion-requests"); ok {
		if method != http.MethodPost {
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
		data, err := a.createMilestoneCompletionRequest(ctx, milestoneID, query, body)
		return data, "aims.milestone_completion_requests.create", true, err
	}
	if requestID, ok := commandPathID(path, "/v1/aims/milestone-completion-requests/", ":bind-workflow"); ok {
		if method != http.MethodPost {
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
		data, err := a.bindMilestoneCompletionWorkflow(ctx, requestID, query, body)
		return data, "aims.milestone_completion_requests.bind_workflow", true, err
	}
	if path == "/v1/aims/service/workflow/callback" {
		if method != http.MethodPost {
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
		data, operation, err := a.applyAimsWorkflowCallback(ctx, query, body)
		return data, operation, true, err
	}
	return nil, "", false, nil
}

func (a *Adapter) applyAimsWorkflowCallback(
	ctx context.Context,
	query url.Values,
	body map[string]any,
) (map[string]any, string, error) {
	resourceCode := strings.TrimSpace(firstBodyText(body, "resource_code", "resourceCode"))
	actionCode := strings.TrimSpace(firstBodyText(body, "action_code", "actionCode"))
	if resourceCode == "projects" && actionCode == "initiation" {
		data, err := a.applyProjectInitiationWorkflowCallback(ctx, query, body)
		return data, "aims.projects.initiation.workflow_callback", err
	}
	data, err := a.applyMilestoneCompletionWorkflowCallback(ctx, query, body)
	return data, "aims.milestone_completion_requests.workflow_callback", err
}

func (a *Adapter) enforceMilestoneCompletionLockForMutation(ctx context.Context, method, path string) error {
	if method != http.MethodPost && method != http.MethodPut && method != http.MethodPatch && method != http.MethodDelete {
		return nil
	}
	trimmed := strings.TrimPrefix(path, "/v1/aims/work-items/")
	if trimmed == path || trimmed == "" || trimmed == "batch" {
		return nil
	}
	parts := strings.Split(trimmed, "/")
	if len(parts) == 0 {
		return nil
	}
	for _, allowed := range []string{"/comments", "/time-entries", "/commits", "/documents"} {
		if strings.Contains("/"+strings.Join(parts[1:], "/"), allowed) {
			return nil
		}
	}
	workItemID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || workItemID <= 0 {
		return nil
	}
	return a.requireWorkItemMilestoneCompletionUnlocked(ctx, workItemID)
}

func (a *Adapter) createMilestoneCompletionRequest(
	ctx context.Context,
	rawMilestoneID string,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	if !truthyQuery(query, "current_user_completion_request_authorized") {
		return nil, httperror.New(http.StatusForbidden, "milestone_completion_request_permission_required", "milestone completion request permission is required")
	}
	actor := strings.TrimSpace(query.Get("current_user"))
	if actor == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	milestoneID, err := parseID(rawMilestoneID, "milestone_id")
	if err != nil {
		return nil, err
	}
	directorUID := strings.TrimSpace(firstBodyText(body, "projectDirectorUid", "project_director_uid"))
	directorRevision, err := bodyPositiveInt64(body, "projectDirectorRevision", "project_director_revision")
	if directorUID == "" || err != nil || directorRevision <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "project_director_binding_required", "current project director uid and revision are required")
	}
	if strings.TrimSpace(query.Get("trusted_project_director_uid")) != directorUID ||
		strings.TrimSpace(query.Get("trusted_project_director_revision")) != strconv.FormatInt(directorRevision, 10) {
		return nil, httperror.New(http.StatusForbidden, "project_director_binding_untrusted", "project director binding is not trusted")
	}

	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var projectID, sortOrder int64
	var status, name, projectCode string
	var lockID sql.NullInt64
	err = tx.QueryRowContext(ctx, `
		SELECT m.project_id, m.status, m.sort_order, m.name, m.completion_lock_request_id, p.project_code
		FROM milestones m
		JOIN aims_projects p ON p.id = m.project_id
		WHERE m.id = ?
		FOR UPDATE
	`, milestoneID).Scan(&projectID, &status, &sortOrder, &name, &lockID, &projectCode)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "milestone_not_found", "里程碑不存在")
	}
	if err != nil {
		return nil, err
	}
	if status != "active" {
		return nil, httperror.New(http.StatusConflict, "milestone_not_active", "仅当前活动里程碑可以申请完成")
	}
	if err := requireCurrentProjectManagerResponsibilityTx(ctx, tx, projectID, actor); err != nil {
		return nil, err
	}
	if lockID.Valid {
		existing, err := loadMilestoneCompletionRequestTx(ctx, tx, lockID.Int64)
		if err != nil {
			return nil, err
		}
		if existing.Status == "pending" && existing.MilestoneID == milestoneID && existing.RequestedBy == actor {
			if !existing.WorkflowInstanceID.Valid {
				if _, err := tx.ExecContext(ctx, `
					UPDATE approval_records
					SET reviewer_uid = ?, reviewer_role_code = 'project_director', reviewer_role_revision = ?
					WHERE id = ? AND status = 'pending' AND workflow_instance_id IS NULL
				`, directorUID, directorRevision, existing.ID); err != nil {
					return nil, err
				}
				existing.ReviewerUID = directorUID
			}
			return milestoneCompletionRequestPayload(existing, directorRevision, true), tx.Commit()
		}
		return nil, httperror.New(http.StatusConflict, "milestone_completion_request_locked", "里程碑已有未完成的完成申请")
	}

	snapshot, err := milestoneCompletionSnapshotTx(ctx, tx, milestoneID, projectID, projectCode, name, sortOrder)
	if err != nil {
		return nil, err
	}
	snapshotJSON, err := canonicalJSON(snapshot)
	if err != nil {
		return nil, err
	}
	snapshotHash := sha256Hex(snapshotJSON)

	var version int64
	if err := tx.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(request_version), 0) + 1
		FROM approval_records
		WHERE milestone_owner_id = ?
		  AND request_no LIKE ?
	`, milestoneID, milestoneCompletionRequestPrefix+"-%").Scan(&version); err != nil {
		return nil, err
	}
	requestNo := fmt.Sprintf("%s-%d-V%d", milestoneCompletionRequestPrefix, milestoneID, version)
	idempotencyKey := fmt.Sprintf("milestone-completion:%d:v%d:%s", milestoneID, version, snapshotHash)
	comment := strings.TrimSpace(firstBodyText(body, "comment", "requestComment", "request_comment"))
	result, err := tx.ExecContext(ctx, `
		INSERT INTO approval_records (
		  request_no, request_version, milestone_owner_id, entity_code, transition, title,
		  requested_by, request_comment, snapshot_json, snapshot_sha256, idempotency_key, locked_at,
		  reviewer_uid, reviewer_role_code, reviewer_role_revision, status, project_id, project_code
		) VALUES (?, ?, ?, ?, 'active→completed', ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?, 'project_director', ?, 'pending', ?, ?)
	`, requestNo, version, milestoneID, fmt.Sprintf("%s/M%d", projectCode, milestoneID),
		"里程碑「"+name+"」完成审批", actor, nullableText(comment), string(snapshotJSON), snapshotHash,
		idempotencyKey, directorUID, directorRevision, projectID, projectCode)
	if err != nil {
		return nil, err
	}
	requestID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE milestones
		SET completion_lock_request_id = ?
		WHERE id = ? AND completion_lock_request_id IS NULL
	`, requestID, milestoneID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	request := milestoneCompletionRequest{
		ID: requestID, RequestNo: requestNo, RequestVersion: version, MilestoneID: milestoneID,
		ProjectID: projectID, ProjectCode: projectCode, RequestedBy: actor, ReviewerUID: directorUID,
		Status: "pending", SnapshotSHA256: snapshotHash,
	}
	return milestoneCompletionRequestPayload(request, directorRevision, false), nil
}

func milestoneCompletionSnapshotTx(
	ctx context.Context,
	tx *sql.Tx,
	milestoneID, projectID int64,
	projectCode, milestoneName string,
	sortOrder int64,
) (map[string]any, error) {
	workItems, err := completionQueryMaps(ctx, tx, `
		SELECT id, item_key, tier, type, title, status,
		       COALESCE(assignee_uid, '') AS assignee_uid,
		       COALESCE(DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s.%fZ'), '') AS updated_at
		FROM work_items
		WHERE project_id = ? AND milestone_id = ?
		ORDER BY id
	`, projectID, milestoneID)
	if err != nil {
		return nil, err
	}
	incomplete := make([]string, 0)
	for _, item := range workItems {
		if completionText(item["status"]) != "completed" {
			incomplete = append(incomplete, completionText(item["item_key"]))
		}
	}
	if len(incomplete) > 0 {
		return nil, httperror.New(http.StatusConflict, "milestone_work_items_incomplete", fmt.Sprintf("里程碑仍有 %d 个工作项未完成", len(incomplete)))
	}

	deliverables, err := completionQueryMaps(ctx, tx, `
		SELECT d.id, d.name, d.deliverable_type, d.required, d.status, d.quality_status,
		       d.current_submission_id, d.document_uuid,
		       COALESCE(d.milestone_owner_id, wi.milestone_id) AS effective_milestone_id,
		       waiver.id AS active_waiver_id
		FROM deliverables d
		LEFT JOIN work_items wi
		  ON wi.project_id = d.project_id
		 AND wi.id = COALESCE(d.matter_id, d.target_id)
		LEFT JOIN deliverable_waivers waiver
		  ON waiver.deliverable_id = d.id
		 AND waiver.revoked_at IS NULL
		WHERE d.project_id = ?
		  AND COALESCE(d.milestone_owner_id, wi.milestone_id) = ?
		ORDER BY d.id
	`, projectID, milestoneID)
	if err != nil {
		return nil, err
	}
	for _, item := range deliverables {
		if !truthyBodyValue(item["required"]) {
			continue
		}
		if completionText(item["status"]) != "approved" {
			return nil, httperror.New(http.StatusConflict, "milestone_required_deliverable_not_approved", "所有必交成果必须审核通过后才能申请完成里程碑")
		}
		if completionText(item["deliverable_type"]) == "document" {
			quality := completionText(item["quality_status"])
			if quality != "passed" && quality != "waived" {
				return nil, httperror.New(http.StatusConflict, "milestone_required_document_quality_incomplete", "所有必交文档必须通过质量检查或获得项目总监豁免")
			}
		}
	}

	return map[string]any{
		"schema": "aims.milestone-completion-request.v1",
		"project": map[string]any{
			"id": projectID, "code": projectCode,
		},
		"milestone": map[string]any{
			"id": milestoneID, "name": milestoneName, "status": "active", "sortOrder": sortOrder,
		},
		"workItems":    workItems,
		"deliverables": deliverables,
	}, nil
}

func (a *Adapter) bindMilestoneCompletionWorkflow(
	ctx context.Context,
	rawRequestID string,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	if !truthyQuery(query, "current_user_completion_request_authorized") {
		return nil, httperror.New(http.StatusForbidden, "milestone_completion_request_permission_required", "milestone completion request permission is required")
	}
	actor := strings.TrimSpace(query.Get("current_user"))
	requestID, err := parseID(rawRequestID, "completion_request_id")
	if err != nil {
		return nil, err
	}
	instanceID := strings.TrimSpace(firstBodyText(body, "workflowInstanceId", "workflow_instance_id"))
	if instanceID == "" {
		return nil, httperror.New(http.StatusBadRequest, "workflow_instance_id_required", "workflow instance id is required")
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	request, err := loadMilestoneCompletionRequestTx(ctx, tx, requestID)
	if err != nil {
		return nil, err
	}
	if request.RequestedBy != actor {
		return nil, httperror.New(http.StatusForbidden, "milestone_completion_request_owner_required", "only the request owner can bind the workflow instance")
	}
	if request.WorkflowInstanceID.Valid && request.WorkflowInstanceID.String != instanceID {
		return nil, httperror.New(http.StatusConflict, "workflow_instance_binding_conflict", "completion request is already bound to another workflow instance")
	}
	if request.Status != "pending" {
		if request.WorkflowInstanceID.Valid && request.WorkflowInstanceID.String == instanceID {
			return map[string]any{
				"requestId": requestID, "workflowInstanceId": instanceID,
				"bound": true, "alreadyTerminal": true,
			}, tx.Commit()
		}
		return nil, httperror.New(http.StatusConflict, "milestone_completion_request_not_pending", "completion request is not pending")
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE approval_records
		SET workflow_instance_id = ?
		WHERE id = ? AND status = 'pending'
	`, instanceID, requestID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"requestId": requestID, "workflowInstanceId": instanceID, "bound": true}, nil
}

func (a *Adapter) applyMilestoneCompletionWorkflowCallback(
	ctx context.Context,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	if !truthyQuery(query, "workflow_callback_verified") {
		return nil, httperror.New(http.StatusForbidden, "workflow_callback_verification_required", "trusted workflow callback is required")
	}
	if strings.TrimSpace(firstBodyText(body, "event")) != "flow_completed" ||
		strings.TrimSpace(firstBodyText(body, "app_code", "appCode")) != "aims" ||
		strings.TrimSpace(firstBodyText(body, "resource_code", "resourceCode")) != "milestones" ||
		strings.TrimSpace(firstBodyText(body, "action_code", "actionCode")) != "milestone_completion" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_milestone_completion_callback", "callback identity does not match milestone completion")
	}
	status := strings.TrimSpace(firstBodyText(body, "status"))
	if status != "approved" && status != "rejected" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_milestone_completion_callback_status", "callback status must be approved or rejected")
	}
	instanceID := strings.TrimSpace(firstBodyText(body, "instance_id", "instanceId"))
	bizID := strings.TrimSpace(firstBodyText(body, "biz_id", "bizId"))
	formData, _ := body["form_data"].(map[string]any)
	requestID, err := bodyPositiveInt64(formData, "completionRequestId", "completion_request_id")
	if err != nil || requestID <= 0 || instanceID == "" {
		return nil, httperror.New(http.StatusBadRequest, "milestone_completion_callback_binding_required", "callback request and workflow instance binding are required")
	}

	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	request, err := loadMilestoneCompletionRequestTx(ctx, tx, requestID)
	if err != nil {
		return nil, err
	}
	if bizID != strconv.FormatInt(request.MilestoneID, 10) {
		return nil, httperror.New(http.StatusConflict, "milestone_completion_callback_biz_mismatch", "callback milestone does not match completion request")
	}
	if strings.TrimSpace(firstBodyText(body, "initiator_uid", "initiatorUid")) != request.RequestedBy ||
		strings.TrimSpace(firstBodyText(formData, "requestNo", "request_no")) != request.RequestNo ||
		strings.TrimSpace(firstBodyText(formData, "snapshotSha256", "snapshot_sha256")) != request.SnapshotSHA256 ||
		strings.TrimSpace(firstBodyText(formData, "projectDirectorRoleCode", "project_director_role_code")) != "project_director" {
		return nil, httperror.New(http.StatusConflict, "milestone_completion_callback_snapshot_mismatch", "callback does not match the immutable completion request")
	}
	if request.WorkflowInstanceID.Valid && request.WorkflowInstanceID.String != instanceID {
		return nil, httperror.New(http.StatusConflict, "workflow_instance_binding_conflict", "callback workflow instance does not match completion request")
	}
	if request.Status != "pending" {
		if request.Status != status {
			return nil, httperror.New(http.StatusConflict, "milestone_completion_callback_status_conflict", "completion request already reached another terminal status")
		}
		return map[string]any{
			"requestId": request.ID, "requestNo": request.RequestNo, "milestoneId": request.MilestoneID,
			"status": request.Status, "alreadyApplied": true,
		}, tx.Commit()
	}

	var milestoneStatus string
	var lockID sql.NullInt64
	var sortOrder int64
	var paymentTermID sql.NullInt64
	var projectCode, contractCode sql.NullString
	err = tx.QueryRowContext(ctx, `
		SELECT m.status, m.completion_lock_request_id, m.sort_order, m.payment_term_id,
		       p.project_code, p.contract_code
		FROM milestones m
		JOIN aims_projects p ON p.id = m.project_id
		WHERE m.id = ?
		FOR UPDATE
	`, request.MilestoneID).Scan(&milestoneStatus, &lockID, &sortOrder, &paymentTermID, &projectCode, &contractCode)
	if err != nil {
		return nil, err
	}
	if !lockID.Valid || lockID.Int64 != request.ID {
		return nil, httperror.New(http.StatusConflict, "milestone_completion_lock_mismatch", "milestone completion lock no longer matches the request")
	}
	callbackDirectorRevision, _ := bodyPositiveInt64(formData, "projectDirectorRevision", "project_director_revision")
	if _, err := tx.ExecContext(ctx, `
		UPDATE approval_records
		SET workflow_instance_id = ?, status = ?,
		    reviewer_uid = COALESCE(NULLIF(?, ''), reviewer_uid),
		    reviewer_role_code = 'project_director',
		    reviewer_role_revision = COALESCE(NULLIF(?, 0), reviewer_role_revision),
		    reviewed_at = UTC_TIMESTAMP(6), review_comment = ?
		WHERE id = ? AND status = 'pending'
	`, instanceID, status, strings.TrimSpace(firstBodyText(formData, "projectDirectorUid", "project_director_uid")),
		callbackDirectorRevision,
		"Workflow "+status, request.ID); err != nil {
		return nil, err
	}

	if status == "rejected" {
		if _, err := tx.ExecContext(ctx, `
			UPDATE milestones SET completion_lock_request_id = NULL
			WHERE id = ? AND completion_lock_request_id = ?
		`, request.MilestoneID, request.ID); err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{
			"requestId": request.ID, "requestNo": request.RequestNo, "milestoneId": request.MilestoneID,
			"status": "rejected",
		}, nil
	}
	if milestoneStatus != "active" && milestoneStatus != "completed" {
		return nil, httperror.New(http.StatusConflict, "milestone_not_active", "only active milestone can be completed")
	}

	var nextMilestoneID sql.NullInt64
	if milestoneStatus == "active" {
		if _, err := tx.ExecContext(ctx, `
			UPDATE milestones SET status = 'completed', completion_lock_request_id = NULL
			WHERE id = ? AND completion_lock_request_id = ?
		`, request.MilestoneID, request.ID); err != nil {
			return nil, err
		}
		err = tx.QueryRowContext(ctx, `
			SELECT id
			FROM milestones
			WHERE project_id = ? AND status != 'completed'
			  AND (sort_order > ? OR (sort_order = ? AND id > ?))
			ORDER BY sort_order, id
			LIMIT 1
		`, request.ProjectID, sortOrder, sortOrder, request.MilestoneID).Scan(&nextMilestoneID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if nextMilestoneID.Valid {
			if _, err := tx.ExecContext(ctx, `UPDATE milestones SET status = 'active' WHERE id = ?`, nextMilestoneID.Int64); err != nil {
				return nil, err
			}
		}
	}
	trustedOperationBody := make(map[string]any, len(body)+1)
	for key, value := range body {
		trustedOperationBody[key] = value
	}
	trustedOperationBody["current_user"] = firstNonEmptyText(
		strings.TrimSpace(firstBodyText(formData, "projectDirectorUid", "project_director_uid")),
		request.ReviewerUID,
	)
	operation, err := a.enqueueMilestoneReceivableBillableOperationTx(
		ctx, tx, request.MilestoneID, paymentTermID, projectCode, contractCode, trustedOperationBody,
	)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	var next any
	if nextMilestoneID.Valid {
		next = nextMilestoneID.Int64
	}
	return map[string]any{
		"requestId": request.ID, "requestNo": request.RequestNo, "milestoneId": request.MilestoneID,
		"status": "approved", "nextMilestoneId": next, "receivableBillable": operation,
	}, nil
}

func loadMilestoneCompletionRequestTx(ctx context.Context, tx *sql.Tx, requestID int64) (milestoneCompletionRequest, error) {
	var request milestoneCompletionRequest
	err := tx.QueryRowContext(ctx, `
		SELECT id, request_no, request_version, milestone_owner_id, project_id, COALESCE(project_code, ''),
		       requested_by, COALESCE(reviewer_uid, ''), status, COALESCE(snapshot_sha256, ''), workflow_instance_id
		FROM approval_records
		WHERE id = ? AND request_no LIKE ?
		FOR UPDATE
	`, requestID, milestoneCompletionRequestPrefix+"-%").Scan(
		&request.ID, &request.RequestNo, &request.RequestVersion, &request.MilestoneID,
		&request.ProjectID, &request.ProjectCode, &request.RequestedBy, &request.ReviewerUID,
		&request.Status, &request.SnapshotSHA256, &request.WorkflowInstanceID,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return request, httperror.New(http.StatusNotFound, "milestone_completion_request_not_found", "milestone completion request not found")
	}
	return request, err
}

func milestoneCompletionRequestPayload(request milestoneCompletionRequest, directorRevision int64, existing bool) map[string]any {
	return map[string]any{
		"id": request.ID, "requestId": request.ID, "requestNo": request.RequestNo,
		"requestVersion": request.RequestVersion, "milestoneId": request.MilestoneID,
		"projectId": request.ProjectID, "projectCode": request.ProjectCode,
		"requestedBy": request.RequestedBy, "projectDirectorUid": request.ReviewerUID,
		"projectDirectorRevision": directorRevision, "status": request.Status,
		"snapshotSha256": request.SnapshotSHA256, "existing": existing,
	}
}

func bodyPositiveInt64(body map[string]any, keys ...string) (int64, error) {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case float64:
			if typed > 0 && typed == float64(int64(typed)) {
				return int64(typed), nil
			}
		case int:
			if typed > 0 {
				return int64(typed), nil
			}
		case int64:
			if typed > 0 {
				return typed, nil
			}
		case json.Number:
			return strconv.ParseInt(string(typed), 10, 64)
		default:
			return strconv.ParseInt(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
		}
		return 0, fmt.Errorf("invalid positive integer")
	}
	return 0, fmt.Errorf("positive integer is required")
}

func requireCurrentProjectManagerResponsibilityTx(ctx context.Context, tx *sql.Tx, projectID int64, actor string) error {
	var responsibleUID string
	err := tx.QueryRowContext(ctx, `
		SELECT COALESCE((
		  SELECT delegation.delegate_uid
		  FROM project_manager_delegations delegation
		  WHERE delegation.project_id = project.id
		    AND delegation.revoked_at IS NULL
		    AND delegation.starts_at <= UTC_TIMESTAMP(6)
		    AND delegation.ends_at > UTC_TIMESTAMP(6)
		  ORDER BY delegation.starts_at DESC, delegation.id DESC
		  LIMIT 1
		), project.leader_uid)
		FROM aims_projects project
		WHERE project.id = ?
	`, projectID).Scan(&responsibleUID)
	if errors.Is(err, sql.ErrNoRows) {
		return httperror.New(http.StatusNotFound, "project_not_found", "project not found")
	}
	if err != nil {
		return err
	}
	if strings.TrimSpace(responsibleUID) != strings.TrimSpace(actor) {
		return httperror.New(http.StatusForbidden, "project_manager_responsibility_required", "current project manager responsibility is required")
	}
	return nil
}

func (a *Adapter) requireMilestoneCompletionUnlocked(ctx context.Context, milestoneID int64) error {
	var lockID sql.NullInt64
	err := a.DB().QueryRowContext(ctx, `SELECT completion_lock_request_id FROM milestones WHERE id = ?`, milestoneID).Scan(&lockID)
	if errors.Is(err, sql.ErrNoRows) {
		return httperror.New(http.StatusNotFound, "milestone_not_found", "milestone not found")
	}
	if err != nil {
		return err
	}
	if lockID.Valid {
		return httperror.New(http.StatusLocked, "milestone_completion_request_locked", "里程碑完成审批期间不可修改验收事实")
	}
	return nil
}

func requireMilestoneCompletionUnlockedTx(ctx context.Context, tx *sql.Tx, milestoneID int64) error {
	var lockID sql.NullInt64
	err := tx.QueryRowContext(ctx, `
		SELECT completion_lock_request_id
		FROM milestones
		WHERE id = ?
		FOR UPDATE
	`, milestoneID).Scan(&lockID)
	if errors.Is(err, sql.ErrNoRows) {
		return httperror.New(http.StatusNotFound, "milestone_not_found", "milestone not found")
	}
	if err != nil {
		return err
	}
	if lockID.Valid {
		return httperror.New(http.StatusLocked, "milestone_completion_request_locked", "里程碑完成审批期间不可修改验收事实")
	}
	return nil
}

func requireWorkItemMilestoneCompletionUnlockedTx(ctx context.Context, tx *sql.Tx, workItemID int64) error {
	var milestoneID int64
	err := tx.QueryRowContext(ctx, `
		SELECT wi.milestone_id
		FROM work_items wi
		WHERE wi.id = ?
		FOR UPDATE
	`, workItemID).Scan(&milestoneID)
	if errors.Is(err, sql.ErrNoRows) {
		return httperror.New(http.StatusNotFound, "work_item_not_found", "work item not found")
	}
	if err != nil {
		return err
	}
	return requireMilestoneCompletionUnlockedTx(ctx, tx, milestoneID)
}

func (a *Adapter) requireWorkItemMilestoneCompletionUnlocked(ctx context.Context, workItemID int64) error {
	var milestoneID sql.NullInt64
	err := a.DB().QueryRowContext(ctx, `SELECT milestone_id FROM work_items WHERE id = ?`, workItemID).Scan(&milestoneID)
	if errors.Is(err, sql.ErrNoRows) {
		return httperror.New(http.StatusNotFound, "work_item_not_found", "work item not found")
	}
	if err != nil {
		return err
	}
	if milestoneID.Valid {
		return a.requireMilestoneCompletionUnlocked(ctx, milestoneID.Int64)
	}
	return nil
}

func (a *Adapter) requireDeliverableMilestoneCompletionUnlocked(ctx context.Context, deliverableID int64) error {
	var milestoneID sql.NullInt64
	err := a.DB().QueryRowContext(ctx, `
		SELECT COALESCE(d.milestone_owner_id, matter.milestone_id, target.milestone_id)
		FROM deliverables d
		LEFT JOIN work_items matter ON matter.id = d.matter_id
		LEFT JOIN work_items target ON target.id = d.target_id
		WHERE d.id = ?
	`, deliverableID).Scan(&milestoneID)
	if errors.Is(err, sql.ErrNoRows) {
		return httperror.New(http.StatusNotFound, "deliverable_not_found", "deliverable not found")
	}
	if err != nil {
		return err
	}
	if milestoneID.Valid {
		return a.requireMilestoneCompletionUnlocked(ctx, milestoneID.Int64)
	}
	return nil
}

func completionQueryMaps(ctx context.Context, tx *sql.Tx, query string, args ...any) ([]map[string]any, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0)
	for rows.Next() {
		values := make([]any, len(columns))
		destinations := make([]any, len(columns))
		for index := range values {
			destinations[index] = &values[index]
		}
		if err := rows.Scan(destinations...); err != nil {
			return nil, err
		}
		item := make(map[string]any, len(columns))
		for index, column := range columns {
			value := values[index]
			if bytes, ok := value.([]byte); ok {
				value = string(bytes)
			}
			item[column] = value
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func completionText(value any) string {
	if value == nil {
		return ""
	}
	if bytes, ok := value.([]byte); ok {
		return strings.TrimSpace(string(bytes))
	}
	return strings.TrimSpace(fmt.Sprint(value))
}
