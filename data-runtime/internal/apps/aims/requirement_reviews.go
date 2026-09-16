package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type requirementReviewBatch struct {
	ID                 int64                    `json:"id"`
	BatchType          string                   `json:"batchType"`
	Title              string                   `json:"title"`
	Description        *string                  `json:"description"`
	RequirementIDs     []int64                  `json:"requirementIds"`
	Requirements       []requirementReviewBrief `json:"requirements"`
	Status             string                   `json:"status"`
	WorkflowInstanceID *string                  `json:"workflowInstanceId"`
	SubmittedBy        string                   `json:"submittedBy"`
	SubmittedAt        string                   `json:"submittedAt"`
	ClosedAt           *string                  `json:"closedAt"`
}

type requirementReviewBrief struct {
	ID                  int64   `json:"id"`
	ItemKind            string  `json:"itemKind"`
	ParentRequirementID *int64  `json:"parentRequirementId"`
	MilestoneID         *int64  `json:"milestoneId"`
	MilestoneName       *string `json:"milestoneName"`
	ReqCode             string  `json:"reqCode"`
	Title               string  `json:"title"`
	Status              string  `json:"status"`
	Priority            string  `json:"priority"`
	ChangeReason        *string `json:"changeReason"`
	ScopeNote           *string `json:"scopeNote"`
}

type requirementReviewCandidate struct {
	ID                  int64
	Status              string
	ItemKind            string
	ParentRequirementID sql.NullInt64
	MilestoneID         sql.NullInt64
	MilestoneName       sql.NullString
}

type requirementReviewMilestoneGroup struct {
	MilestoneID   sql.NullInt64
	MilestoneName sql.NullString
	Count         int64
}

func (a *Adapter) projectRequirementReviews(ctx context.Context, projectID string, query url.Values) (map[string]any, error) {
	if err := requireCurrentUser(query); err != nil {
		return nil, err
	}
	if err := a.requireProjectReadAccess(ctx, projectID, query); err != nil {
		return nil, err
	}
	projectID, err := normalizeRequiredID(projectID, "project_id")
	if err != nil {
		return nil, err
	}

	batches, allRequirementIDs, err := a.requirementReviewBatches(ctx, projectID)
	if err != nil {
		return nil, err
	}
	requirementMap, err := a.requirementReviewRequirementMap(ctx, projectID, allRequirementIDs)
	if err != nil {
		return nil, err
	}

	for index := range batches {
		requirements := make([]requirementReviewBrief, 0, len(batches[index].RequirementIDs))
		for _, requirementID := range batches[index].RequirementIDs {
			if requirement, ok := requirementMap[requirementID]; ok {
				requirements = append(requirements, requirement)
			}
		}
		batches[index].Requirements = requirements
	}

	return map[string]any{
		"batches": batches,
	}, nil
}

func (a *Adapter) requirementReviewBatchDetail(ctx context.Context, rawBatchID string, query url.Values) (map[string]any, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	batchID, err := parseReviewBatchID(rawBatchID)
	if err != nil {
		return nil, err
	}
	batch, err := a.loadRequirementReviewBatch(ctx, batchID)
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectMemberOrScopedAdmin(ctx, batch.projectID, uid, query); err != nil {
		return nil, err
	}

	return map[string]any{
		"id":                   batch.id,
		"projectId":            batch.projectID,
		"project_id":           batch.projectID,
		"title":                batch.title,
		"batchType":            batch.batchType,
		"batch_type":           batch.batchType,
		"status":               batch.status,
		"workflowInstanceId":   batch.workflowInstanceID,
		"workflow_instance_id": batch.workflowInstanceID,
		"submittedBy":          batch.submittedBy,
		"submitted_by":         batch.submittedBy,
		"requirementIds":       batch.requirementIDs,
		"requirement_ids":      batch.requirementIDs,
	}, nil
}

func (a *Adapter) createRequirementReviewBatch(ctx context.Context, rawProjectID string, query url.Values, body map[string]any) (map[string]any, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		uid = strings.TrimSpace(query.Get("operator_uid"))
	}
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectUpdateAccess(ctx, "/v1/aims/projects/"+strings.TrimSpace(rawProjectID)+"/requirement-reviews", query, map[string]any{}, rawProjectID); err != nil {
		return nil, err
	}

	batchType := "baseline"
	if strings.TrimSpace(firstBodyText(body, "batch_type", "batchType")) == "change" {
		batchType = "change"
	}
	requirementIDs, err := requirementReviewBodyIDs(body, "requirement_ids", "requirementIds")
	if err != nil {
		return nil, err
	}
	if len(requirementIDs) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_requirement_ids", "请选择至少一条需求")
	}

	requirements, err := a.requirementReviewCandidates(ctx, projectID, requirementIDs)
	if err != nil {
		return nil, err
	}
	if len(requirements) != len(requirementIDs) {
		return nil, httperror.New(http.StatusBadRequest, "requirement_not_found", "部分需求不存在或不属于当前项目")
	}
	if err := validateRequirementReviewCandidates(batchType, requirements); err != nil {
		return nil, err
	}
	activeMilestoneID, activeMilestoneName, err := a.activeRequirementReviewMilestone(ctx, projectID, "当前没有活动里程碑，暂不可创建需求评审批次")
	if err != nil {
		return nil, err
	}
	if err := a.validateRequirementReviewMilestone(ctx, projectID, requirementIDs, activeMilestoneID, activeMilestoneName, "所选需求"); err != nil {
		return nil, err
	}
	if batchType == "change" {
		if err := a.validateChangeReviewParents(ctx, projectID, requirements); err != nil {
			return nil, err
		}
	}
	if batchType == "baseline" {
		var count int64
		if err := a.DB().QueryRowContext(ctx, `
			SELECT COUNT(*) AS cnt
			FROM requirement_review_batches
			WHERE project_id = ?
			  AND batch_type = 'baseline'
			  AND status = 'pending'
			  AND workflow_instance_id IS NULL
		`, projectID).Scan(&count); err != nil {
			return nil, err
		}
		if count > 0 {
			return nil, httperror.New(http.StatusConflict, "baseline_review_batch_pending", "存在尚未提交审批的基线评审批次，请先并入或取消当前批次")
		}
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var existingBatchCount int64
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*) AS cnt
		FROM requirement_review_batches
		WHERE project_id = ? AND batch_type = ?
	`, projectID, batchType).Scan(&existingBatchCount); err != nil {
		return nil, err
	}
	batchNo := existingBatchCount + 1
	title := strings.TrimSpace(firstBodyText(body, "title"))
	if title == "" {
		if batchType == "baseline" {
			if batchNo == 1 {
				title = "需求基线评审"
			} else {
				title = fmt.Sprintf("需求变更评审 B%d", batchNo)
			}
		} else {
			title = fmt.Sprintf("需求变更评审 RC%d", batchNo)
		}
	}
	requirementJSON, err := json.Marshal(requirementIDs)
	if err != nil {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO requirement_review_batches
		  (project_id, batch_type, title, description, requirement_ids_json, status, submitted_by)
		VALUES (?, ?, ?, ?, ?, 'pending', ?)
	`, projectID, batchType, title, nullableText(firstBodyText(body, "description")), string(requirementJSON), uid)
	if err != nil {
		return nil, err
	}
	batchID, _ := result.LastInsertId()

	newStatus := "in_review"
	if batchType == "change" {
		newStatus = "change_pending"
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE requirement_items SET status = ?
		WHERE id IN (`+placeholders(len(requirementIDs))+`)
	`, append([]any{newStatus}, int64SliceArgs(requirementIDs)...)...); err != nil {
		return nil, err
	}
	if batchType == "change" {
		parentIDs := requirementReviewParentIDs(requirements)
		if len(parentIDs) > 0 {
			if _, err := tx.ExecContext(ctx, `
				UPDATE requirement_items SET status = 'change_pending'
				WHERE id IN (`+placeholders(len(parentIDs))+`)
			`, int64SliceArgs(parentIDs)...); err != nil {
				return nil, err
			}
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE requirement_contents c
			INNER JOIN requirement_item_contents ric ON ric.content_id = c.id
			SET c.version_status = 'in_review'
			WHERE ric.requirement_id IN (`+placeholders(len(requirementIDs))+`)
			  AND ric.relation_type = 'change'
			  AND c.version_status = 'change_draft'
		`, int64SliceArgs(requirementIDs)...); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"batchId":          batchID,
		"batchType":        batchType,
		"title":            title,
		"requirementCount": len(requirementIDs),
		"status":           "pending",
	}, nil
}

func (a *Adapter) syncRequirementReviewWorkflow(ctx context.Context, rawBatchID string, query url.Values, body map[string]any) (map[string]any, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		uid = strings.TrimSpace(query.Get("operator_uid"))
	}
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	batchID, err := parseReviewBatchID(rawBatchID)
	if err != nil {
		return nil, err
	}
	batch, err := a.loadRequirementReviewBatch(ctx, batchID)
	if err != nil {
		return nil, err
	}
	projectIDText := strconv.FormatInt(batch.projectID, 10)
	if err := a.requireProjectUpdateAccess(ctx, "/v1/aims/projects/"+projectIDText+"/requirement-reviews", query, map[string]any{}, projectIDText); err != nil {
		return nil, err
	}
	if batch.workflowInstanceID != nil && strings.TrimSpace(*batch.workflowInstanceID) != "" {
		return map[string]any{"alreadySynced": true, "workflowInstanceId": strings.TrimSpace(*batch.workflowInstanceID)}, nil
	}
	if len(batch.requirementIDs) == 0 {
		return nil, httperror.New(http.StatusConflict, "review_batch_empty", "该评审批次没有关联需求项，无法提交审批")
	}
	activeMilestoneID, activeMilestoneName, err := a.activeRequirementReviewMilestone(ctx, batch.projectID, "当前没有活动里程碑，暂不可提交需求评审")
	if err != nil {
		return nil, err
	}
	if err := a.validateRequirementReviewMilestone(ctx, batch.projectID, batch.requirementIDs, activeMilestoneID, activeMilestoneName, "该评审批次"); err != nil {
		return nil, err
	}

	workflowInstanceID := strings.TrimSpace(firstBodyText(body, "workflowInstanceId", "workflow_instance_id"))
	if workflowInstanceID != "" {
		if _, err := a.DB().ExecContext(ctx, `
			UPDATE requirement_review_batches
			SET workflow_instance_id = ?
			WHERE id = ?
		`, workflowInstanceID, batchID); err != nil {
			return nil, err
		}
		return map[string]any{"synced": true, "workflowInstanceId": workflowInstanceID}, nil
	}

	actionCode := "requirement_change"
	if batch.batchType == "baseline" {
		actionCode = "requirement_baseline"
	}
	return map[string]any{
		"synced":         false,
		"ready":          true,
		"batchId":        batchID,
		"projectId":      batch.projectID,
		"batchType":      batch.batchType,
		"actionCode":     actionCode,
		"requirementIds": batch.requirementIDs,
	}, nil
}

func (a *Adapter) requirementReviewBatches(ctx context.Context, projectID string) ([]requirementReviewBatch, []int64, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			id,
			batch_type,
			title,
			description,
			requirement_ids_json,
			status,
			workflow_instance_id,
			submitted_by,
			DATE_FORMAT(submitted_at, '%Y-%m-%d %H:%i:%s') AS submitted_at,
			DATE_FORMAT(closed_at, '%Y-%m-%d %H:%i:%s') AS closed_at
		FROM requirement_review_batches
		WHERE project_id = ?
		  AND status != 'withdrawn'
		ORDER BY submitted_at DESC, id DESC
	`, projectID)
	if err != nil {
		return nil, nil, fmt.Errorf("query requirement review batches: %w", err)
	}
	defer rows.Close()

	batches := make([]requirementReviewBatch, 0)
	seenIDs := make(map[int64]bool)
	allRequirementIDs := make([]int64, 0)
	for rows.Next() {
		var batch requirementReviewBatch
		var description, requirementIDsJSON, workflowInstanceID, submittedAt, closedAt sql.NullString
		if err := rows.Scan(
			&batch.ID,
			&batch.BatchType,
			&batch.Title,
			&description,
			&requirementIDsJSON,
			&batch.Status,
			&workflowInstanceID,
			&batch.SubmittedBy,
			&submittedAt,
			&closedAt,
		); err != nil {
			return nil, nil, fmt.Errorf("scan requirement review batch: %w", err)
		}
		batch.Description = nullableString(description)
		batch.RequirementIDs = parseRequirementReviewIDs(nullStringOr(requirementIDsJSON, ""))
		batch.WorkflowInstanceID = nullableString(workflowInstanceID)
		batch.SubmittedAt = nullStringOr(submittedAt, "")
		batch.ClosedAt = nullableString(closedAt)
		batch.Requirements = []requirementReviewBrief{}

		for _, requirementID := range batch.RequirementIDs {
			if !seenIDs[requirementID] {
				seenIDs[requirementID] = true
				allRequirementIDs = append(allRequirementIDs, requirementID)
			}
		}

		batches = append(batches, batch)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return batches, allRequirementIDs, nil
}

func requirementReviewBodyIDs(body map[string]any, keys ...string) ([]int64, error) {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		rawItems, ok := value.([]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "invalid_requirement_ids", "requirement_ids must be an array")
		}
		ids := make([]int64, 0, len(rawItems))
		for _, raw := range rawItems {
			var id int64
			switch typed := raw.(type) {
			case float64:
				id = int64(typed)
			case float32:
				id = int64(typed)
			case int:
				id = int64(typed)
			case int64:
				id = typed
			default:
				parsed, err := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(raw)), 10, 64)
				if err != nil {
					return nil, httperror.New(http.StatusBadRequest, "invalid_requirement_ids", "requirement_ids contains invalid id")
				}
				id = parsed
			}
			if id <= 0 {
				return nil, httperror.New(http.StatusBadRequest, "invalid_requirement_ids", "requirement_ids contains invalid id")
			}
			ids = append(ids, id)
		}
		return ids, nil
	}
	return nil, nil
}

func (a *Adapter) requirementReviewCandidates(ctx context.Context, projectID int64, requirementIDs []int64) ([]requirementReviewCandidate, error) {
	args := append(int64SliceArgs(requirementIDs), projectID)
	rows, err := a.DB().QueryContext(ctx, `
		SELECT r.id, r.status, r.item_kind, r.parent_requirement_id, r.milestone_id,
		       m.name AS milestone_name
		FROM requirement_items r
		LEFT JOIN milestones m ON m.id = r.milestone_id
		WHERE r.id IN (`+placeholders(len(requirementIDs))+`) AND r.project_id = ?
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]requirementReviewCandidate, 0)
	for rows.Next() {
		var item requirementReviewCandidate
		if err := rows.Scan(&item.ID, &item.Status, &item.ItemKind, &item.ParentRequirementID, &item.MilestoneID, &item.MilestoneName); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func validateRequirementReviewCandidates(batchType string, requirements []requirementReviewCandidate) error {
	for _, requirement := range requirements {
		if batchType == "baseline" {
			if requirement.ItemKind != "baseline" || requirement.Status != "draft" {
				return httperror.New(http.StatusConflict, "invalid_baseline_review_requirements", "只能对草稿态的基线需求提交基线评审")
			}
			continue
		}
		if requirement.ItemKind != "change" || requirement.Status != "draft" || !requirement.ParentRequirementID.Valid {
			return httperror.New(http.StatusConflict, "invalid_change_review_requirements", "只能对草稿态的变更需求提交变更评审")
		}
	}
	return nil
}

func (a *Adapter) activeRequirementReviewMilestone(ctx context.Context, projectID int64, missingMessage string) (int64, string, error) {
	var id int64
	var name string
	err := a.DB().QueryRowContext(ctx, `
		SELECT id, name
		FROM milestones
		WHERE project_id = ? AND status = 'active'
		ORDER BY sort_order ASC, id ASC
		LIMIT 1
	`, projectID).Scan(&id, &name)
	if err == sql.ErrNoRows {
		return 0, "", httperror.New(http.StatusConflict, "active_milestone_required", missingMessage)
	}
	if err != nil {
		return 0, "", err
	}
	return id, name, nil
}

func (a *Adapter) validateRequirementReviewMilestone(ctx context.Context, projectID int64, requirementIDs []int64, activeMilestoneID int64, activeMilestoneName string, subject string) error {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT r.milestone_id, m.name AS milestone_name, COUNT(*) AS req_count
		FROM requirement_items r
		LEFT JOIN milestones m ON m.id = r.milestone_id
		WHERE r.project_id = ? AND r.id IN (`+placeholders(len(requirementIDs))+`)
		GROUP BY r.milestone_id, m.name
	`, append([]any{projectID}, int64SliceArgs(requirementIDs)...)...)
	if err != nil {
		return err
	}
	defer rows.Close()

	groups := make([]requirementReviewMilestoneGroup, 0)
	for rows.Next() {
		var group requirementReviewMilestoneGroup
		if err := rows.Scan(&group.MilestoneID, &group.MilestoneName, &group.Count); err != nil {
			return err
		}
		groups = append(groups, group)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(groups) == 0 {
		return httperror.New(http.StatusConflict, "review_milestone_missing", subject+"没有可识别的里程碑信息，无法提交审批")
	}

	var missingCount int64
	for _, group := range groups {
		if !group.MilestoneID.Valid {
			missingCount += group.Count
		}
	}
	if missingCount > 0 {
		return httperror.New(http.StatusConflict, "review_milestone_required", fmt.Sprintf("%s有 %d 条需求未绑定里程碑，无法提交审批", subject, missingCount))
	}
	if len(groups) != 1 || !groups[0].MilestoneID.Valid || groups[0].MilestoneID.Int64 != activeMilestoneID {
		names := make([]string, 0, len(groups))
		for _, group := range groups {
			if group.MilestoneName.Valid && strings.TrimSpace(group.MilestoneName.String) != "" {
				names = append(names, strings.TrimSpace(group.MilestoneName.String))
			} else if group.MilestoneID.Valid {
				names = append(names, fmt.Sprintf("里程碑#%d", group.MilestoneID.Int64))
			}
		}
		return httperror.New(http.StatusConflict, "review_milestone_not_active", fmt.Sprintf("仅当前活动里程碑「%s」的需求可创建评审批次，%s关联里程碑：%s", activeMilestoneName, subject, strings.Join(names, "、")))
	}
	return nil
}

func (a *Adapter) validateChangeReviewParents(ctx context.Context, projectID int64, requirements []requirementReviewCandidate) error {
	parentIDs := requirementReviewParentIDs(requirements)
	if len(parentIDs) == 0 {
		return httperror.New(http.StatusConflict, "invalid_change_review_parent", "原需求不是已基线状态，无法提交变更评审")
	}
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, status, item_kind, parent_requirement_id
		FROM requirement_items
		WHERE id IN (`+placeholders(len(parentIDs))+`)
		  AND project_id = ?
	`, append(int64SliceArgs(parentIDs), projectID)...)
	if err != nil {
		return err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var id int64
		var status, itemKind string
		var parentID sql.NullInt64
		if err := rows.Scan(&id, &status, &itemKind, &parentID); err != nil {
			return err
		}
		count++
		if itemKind != "baseline" || status != "baselined" {
			return httperror.New(http.StatusConflict, "invalid_change_review_parent", "原需求不是已基线状态，无法提交变更评审")
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if count != len(parentIDs) {
		return httperror.New(http.StatusConflict, "invalid_change_review_parent", "原需求不是已基线状态，无法提交变更评审")
	}
	return nil
}

func requirementReviewParentIDs(requirements []requirementReviewCandidate) []int64 {
	seen := map[int64]bool{}
	result := make([]int64, 0)
	for _, requirement := range requirements {
		if requirement.ParentRequirementID.Valid && requirement.ParentRequirementID.Int64 > 0 && !seen[requirement.ParentRequirementID.Int64] {
			seen[requirement.ParentRequirementID.Int64] = true
			result = append(result, requirement.ParentRequirementID.Int64)
		}
	}
	return result
}

func int64SliceArgs(values []int64) []any {
	args := make([]any, 0, len(values))
	for _, value := range values {
		args = append(args, value)
	}
	return args
}

func (a *Adapter) requirementReviewRequirementMap(ctx context.Context, projectID string, requirementIDs []int64) (map[int64]requirementReviewBrief, error) {
	result := make(map[int64]requirementReviewBrief)
	if len(requirementIDs) == 0 {
		return result, nil
	}

	args := make([]any, 0, len(requirementIDs)+1)
	args = append(args, projectID)
	for _, id := range requirementIDs {
		args = append(args, id)
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			r.id,
			r.item_kind,
			r.parent_requirement_id,
			r.milestone_id,
			m.name AS milestone_name,
			r.req_code,
			r.title,
			r.status,
			r.priority,
			r.change_reason,
			r.scope_note
		FROM requirement_items r
		LEFT JOIN milestones m ON m.id = r.milestone_id
		WHERE r.project_id = ?
		  AND r.id IN (`+placeholders(len(requirementIDs))+`)
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("query requirement review requirements: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var requirement requirementReviewBrief
		var parentRequirementID, milestoneID sql.NullInt64
		var milestoneName, changeReason, scopeNote sql.NullString
		if err := rows.Scan(
			&requirement.ID,
			&requirement.ItemKind,
			&parentRequirementID,
			&milestoneID,
			&milestoneName,
			&requirement.ReqCode,
			&requirement.Title,
			&requirement.Status,
			&requirement.Priority,
			&changeReason,
			&scopeNote,
		); err != nil {
			return nil, fmt.Errorf("scan requirement review requirement: %w", err)
		}
		requirement.ParentRequirementID = nullableInt64(parentRequirementID)
		requirement.MilestoneID = nullableInt64(milestoneID)
		requirement.MilestoneName = nullableString(milestoneName)
		requirement.ChangeReason = nullableString(changeReason)
		requirement.ScopeNote = nullableString(scopeNote)
		result[requirement.ID] = requirement
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func parseRequirementReviewIDs(raw string) []int64 {
	if strings.TrimSpace(raw) == "" {
		return []int64{}
	}

	var ids []int64
	if err := json.Unmarshal([]byte(raw), &ids); err == nil {
		return ids
	}

	var mixed []any
	if err := json.Unmarshal([]byte(raw), &mixed); err != nil {
		return []int64{}
	}
	parsed := make([]int64, 0, len(mixed))
	for _, item := range mixed {
		switch value := item.(type) {
		case float64:
			parsed = append(parsed, int64(value))
		case int64:
			parsed = append(parsed, value)
		case string:
			if id, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64); err == nil && id > 0 {
				parsed = append(parsed, id)
			}
		}
	}
	return parsed
}
