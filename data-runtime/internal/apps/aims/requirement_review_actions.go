package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Port of aims/server/api/v1/requirement-reviews/[batchId]/{approve,reject,withdraw,create-tasks,append-requirements}.post.ts
// 评审批次动作：通过（基线/变更落版本）、拒绝（回退状态）、撤回（删除批次）、
// 批量生成任务、向待审批次追加需求。

type requirementReviewBatchRow struct {
	id                 int64
	projectID          int64
	title              string
	batchType          string
	status             string
	workflowInstanceID *string
	submittedBy        *string
	requirementIDs     []int64
}

func requireReviewActionUser(query url.Values) (string, error) {
	currentUser := strings.TrimSpace(query.Get("current_user"))
	if currentUser == "" {
		return "", httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	return currentUser, nil
}

func parseReviewBatchID(raw string) (int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || id <= 0 {
		return 0, httperror.New(http.StatusBadRequest, "invalid_batch_id", "无效的批次ID")
	}
	return id, nil
}

func (a *Adapter) loadRequirementReviewBatch(ctx context.Context, batchID int64) (requirementReviewBatchRow, error) {
	var batch requirementReviewBatchRow
	var rawIDs []byte
	err := a.DB().QueryRowContext(ctx, `
		SELECT id, project_id, title, batch_type, status, workflow_instance_id, submitted_by, requirement_ids_json
		FROM requirement_review_batches
		WHERE id = ?
		LIMIT 1`, batchID).
		Scan(&batch.id, &batch.projectID, &batch.title, &batch.batchType, &batch.status, &batch.workflowInstanceID, &batch.submittedBy, &rawIDs)
	if errors.Is(err, sql.ErrNoRows) {
		return batch, httperror.New(http.StatusNotFound, "batch_not_found", "评审批次不存在")
	}
	if err != nil {
		return batch, err
	}
	batch.requirementIDs = parseRequirementIDListJSON(rawIDs)
	return batch, nil
}

func int64Args(ids []int64, extra ...any) []any {
	args := make([]any, 0, len(ids)+len(extra))
	for _, id := range ids {
		args = append(args, id)
	}
	return append(args, extra...)
}

// approveRequirementReviewBatch 评审通过回调。
func (a *Adapter) approveRequirementReviewBatch(ctx context.Context, rawBatchID string, query url.Values, body map[string]any) (map[string]any, error) {
	uid, err := requireReviewActionUser(query)
	if err != nil {
		return nil, err
	}
	batchID, err := parseReviewBatchID(rawBatchID)
	if err != nil {
		return nil, err
	}
	batch, err := a.loadRequirementReviewBatch(ctx, batchID)
	if err != nil {
		return nil, err
	}
	if batch.status != "pending" {
		return nil, httperror.New(http.StatusConflict, "batch_closed", "该批次已处理")
	}

	workflowInstanceID := optionalBodyString(body, "workflowInstanceId", "workflow_instance_id")
	changeReason := optionalBodyString(body, "changeReason", "change_reason")
	changeCode := optionalBodyString(body, "changeCode", "change_code")
	approvedBy := uid
	if value := optionalBodyString(body, "approvedBy", "approved_by"); value != nil && strings.TrimSpace(*value) != "" {
		approvedBy = strings.TrimSpace(*value)
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		"UPDATE requirement_review_batches SET status = 'approved', workflow_instance_id = COALESCE(?, workflow_instance_id), closed_at = NOW() WHERE id = ?",
		nullableStringValue(workflowInstanceID), batchID); err != nil {
		return nil, err
	}

	for _, reqID := range batch.requirementIDs {
		var req struct {
			id                  int64
			itemKind            string
			parentRequirementID *int64
			title               string
			reqType             string
			priority            string
			source              *string
			scopeNote           *string
			milestoneID         *int64
			currentVersion      int64
		}
		err := tx.QueryRowContext(ctx, `
			SELECT id, item_kind, parent_requirement_id, title, type, priority, source, scope_note,
			       milestone_id, current_version
			FROM requirement_items WHERE id = ?`, reqID).
			Scan(&req.id, &req.itemKind, &req.parentRequirementID, &req.title, &req.reqType, &req.priority, &req.source, &req.scopeNote, &req.milestoneID, &req.currentVersion)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}

		if batch.batchType == "change" && req.itemKind == "change" && req.parentRequirementID != nil {
			if err := a.approveChangeRequirement(ctx, tx, batch, req.id, *req.parentRequirementID, uid, approvedBy, batchID, workflowInstanceID, changeReason, changeCode); err != nil {
				return nil, err
			}
			continue
		}

		// Use MAX(version_no)+1 to robustly avoid unique-key conflicts even if current_version is stale
		var existingMax sql.NullInt64
		if err := tx.QueryRowContext(ctx,
			"SELECT MAX(version_no) FROM requirement_versions WHERE requirement_id = ?", reqID).Scan(&existingMax); err != nil {
			return nil, err
		}
		newVersion := req.currentVersion + 1
		if existingMax.Valid && existingMax.Int64 >= req.currentVersion {
			newVersion = existingMax.Int64 + 1
		}

		contentIDs, err := reviewBaselineContentIDs(ctx, tx, reqID)
		if err != nil {
			return nil, err
		}

		snapshot := map[string]any{
			"title":              req.title,
			"type":               req.reqType,
			"priority":           req.priority,
			"source":             req.source,
			"scope_note":         req.scopeNote,
			"milestone_id":       req.milestoneID,
			"linked_content_ids": contentIDs,
		}
		snapshotJSON, err := json.Marshal(snapshot)
		if err != nil {
			return nil, err
		}

		changeType := "modify"
		if batch.batchType == "baseline" {
			changeType = "baseline"
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO requirement_versions
			  (requirement_id, version_no, snapshot_json, change_type, change_reason, batch_id,
			   approval_workflow_id, approved_by, approved_at, created_by)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
			reqID, newVersion, string(snapshotJSON), changeType,
			nullableStringValue(changeReason), batchID,
			nullableStringValue(workflowInstanceID), approvedBy, uid); err != nil {
			return nil, err
		}

		updateFields := "status = 'baselined', current_version = ?"
		if batch.batchType == "baseline" {
			updateFields = "status = 'baselined', current_version = ?, baselined_at = COALESCE(baselined_at, NOW())"
		}
		if _, err := tx.ExecContext(ctx,
			"UPDATE requirement_items SET "+updateFields+" WHERE id = ?", newVersion, reqID); err != nil {
			return nil, err
		}

		if batch.batchType == "baseline" && len(contentIDs) > 0 {
			if _, err := tx.ExecContext(ctx,
				"UPDATE requirement_contents SET version_status = 'baselined' WHERE id IN ("+placeholders(len(contentIDs))+")",
				int64Args(contentIDs)...); err != nil {
				return nil, err
			}
		}
	}

	// 基线评审通过后锁定项目的"基线 target"（优先 template_key，其次最早创建的 requirement target）
	if batch.batchType == "baseline" {
		var baselineTargetID sql.NullInt64
		err := tx.QueryRowContext(ctx, `
			SELECT id FROM work_items
			WHERE project_id = ?
			  AND tier = 'target'
			  AND type = 'requirement'
			ORDER BY (template_key = 'requirement_baseline') DESC,
			         created_at ASC,
			         id ASC
			LIMIT 1`, batch.projectID).Scan(&baselineTargetID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if baselineTargetID.Valid {
			if _, err := tx.ExecContext(ctx,
				"UPDATE work_items SET status = 'completed' WHERE id = ? AND status <> 'completed'",
				baselineTargetID.Int64); err != nil {
				return nil, err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"batchId":             batchID,
		"approved":            true,
		"requirementsUpdated": len(batch.requirementIDs),
	}, nil
}

// approveChangeRequirement 变更需求通过：把变更内容合入父需求基线并落新版本。
func (a *Adapter) approveChangeRequirement(
	ctx context.Context,
	tx *sql.Tx,
	batch requirementReviewBatchRow,
	changeReqID int64,
	parentReqID int64,
	uid string,
	approvedBy string,
	batchID int64,
	workflowInstanceID *string,
	changeReason *string,
	changeCode *string,
) error {
	type changeContent struct {
		id                int64
		contentOriginalID int64
		sortOrder         int64
		versionStatus     string
		parentRelationID  *int64
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT c.id, c.content_original_id, c.sort_order, c.version_status,
		       parent_ric.id AS parent_relation_id
		FROM requirement_item_contents ric
		INNER JOIN requirement_contents c ON c.id = ric.content_id
		LEFT JOIN requirement_item_contents parent_ric
		  ON parent_ric.requirement_id = ?
		 AND parent_ric.content_id = c.id
		 AND parent_ric.relation_type = 'baseline'
		WHERE ric.requirement_id = ?
		  AND ric.relation_type = 'change'
		ORDER BY ric.sort_order, c.id`, parentReqID, changeReqID)
	if err != nil {
		return err
	}
	var changeContents []changeContent
	for rows.Next() {
		var content changeContent
		var contentOriginalID sql.NullInt64
		if err := rows.Scan(&content.id, &contentOriginalID, &content.sortOrder, &content.versionStatus, &content.parentRelationID); err != nil {
			rows.Close()
			return err
		}
		content.contentOriginalID = contentOriginalID.Int64
		changeContents = append(changeContents, content)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, content := range changeContents {
		if content.parentRelationID != nil {
			if content.versionStatus == "in_review" {
				if _, err := tx.ExecContext(ctx,
					"UPDATE requirement_contents SET version_status = 'baselined' WHERE id = ?", content.id); err != nil {
					return err
				}
			}
			continue
		}
		if content.versionStatus != "change_draft" && content.versionStatus != "in_review" {
			continue
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE requirement_contents
			SET version_status = 'archived'
			WHERE content_original_id = ?
			  AND version_status = 'baselined'`, content.contentOriginalID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			"UPDATE requirement_contents SET version_status = 'baselined' WHERE id = ?", content.id); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE requirement_item_contents ric
			INNER JOIN requirement_contents c ON c.id = ric.content_id
			SET ric.relation_type = 'archived'
			WHERE ric.requirement_id = ?
			  AND ric.relation_type = 'baseline'
			  AND c.content_original_id = ?`, parentReqID, content.contentOriginalID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT IGNORE INTO requirement_item_contents
			  (requirement_id, content_id, relation_type, sort_order, created_by)
			VALUES (?, ?, 'baseline', ?, ?)`, parentReqID, content.id, content.sortOrder, uid); err != nil {
			return err
		}
	}

	var parent struct {
		title          string
		reqType        string
		priority       string
		source         *string
		scopeNote      *string
		milestoneID    *int64
		currentVersion int64
	}
	err = tx.QueryRowContext(ctx, `
		SELECT title, type, priority, source, scope_note, milestone_id, current_version
		FROM requirement_items WHERE id = ?`, parentReqID).
		Scan(&parent.title, &parent.reqType, &parent.priority, &parent.source, &parent.scopeNote, &parent.milestoneID, &parent.currentVersion)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil {
		var existingMax sql.NullInt64
		if err := tx.QueryRowContext(ctx,
			"SELECT MAX(version_no) FROM requirement_versions WHERE requirement_id = ?", parentReqID).Scan(&existingMax); err != nil {
			return err
		}
		newVersion := parent.currentVersion + 1
		if existingMax.Valid && existingMax.Int64 >= parent.currentVersion {
			newVersion = existingMax.Int64 + 1
		}

		contentIDs, err := reviewBaselineContentIDsOrdered(ctx, tx, parentReqID)
		if err != nil {
			return err
		}

		snapshot := map[string]any{
			"title":                   parent.title,
			"type":                    parent.reqType,
			"priority":                parent.priority,
			"source":                  parent.source,
			"scope_note":              parent.scopeNote,
			"milestone_id":            parent.milestoneID,
			"linked_content_ids":      contentIDs,
			"change_requirement_id":   changeReqID,
			"change_requirement_code": changeCode,
		}
		snapshotJSON, err := json.Marshal(snapshot)
		if err != nil {
			return err
		}

		if _, err := tx.ExecContext(ctx, `
			INSERT INTO requirement_versions
			  (requirement_id, version_no, snapshot_json, change_type, change_reason, batch_id,
			   approval_workflow_id, approved_by, approved_at, created_by)
			VALUES (?, ?, ?, 'modify', ?, ?, ?, ?, NOW(), ?)`,
			parentReqID, newVersion, string(snapshotJSON),
			nullableStringValue(changeReason), batchID,
			nullableStringValue(workflowInstanceID), approvedBy, uid); err != nil {
			return err
		}

		if _, err := tx.ExecContext(ctx,
			"UPDATE requirement_items SET status = 'baselined', current_version = ? WHERE id = ?",
			newVersion, parentReqID); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx,
		"UPDATE requirement_items SET status = 'baselined' WHERE id = ?", changeReqID); err != nil {
		return err
	}
	return nil
}

// reviewBaselineContentIDs：MIN(sort_order) 去重排序（对应 approve 普通分支的 GROUP BY 查询）。
func reviewBaselineContentIDs(ctx context.Context, tx *sql.Tx, requirementID int64) ([]int64, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT ric.content_id AS id, MIN(ric.sort_order) AS sort_order
		FROM requirement_item_contents ric
		WHERE ric.requirement_id = ?
		  AND ric.relation_type = 'baseline'
		GROUP BY ric.content_id
		ORDER BY sort_order, ric.content_id`, requirementID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id, sortOrder int64
		if err := rows.Scan(&id, &sortOrder); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// reviewBaselineContentIDsOrdered：sort_order, content_id 排序（对应变更分支父需求快照查询）。
func reviewBaselineContentIDsOrdered(ctx context.Context, tx *sql.Tx, requirementID int64) ([]int64, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT content_id
		FROM requirement_item_contents
		WHERE requirement_id = ?
		  AND relation_type = 'baseline'
		ORDER BY sort_order, content_id`, requirementID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// rejectRequirementReviewBatch 评审拒绝回调。
func (a *Adapter) rejectRequirementReviewBatch(ctx context.Context, rawBatchID string, query url.Values) (map[string]any, error) {
	if _, err := requireReviewActionUser(query); err != nil {
		return nil, err
	}
	batchID, err := parseReviewBatchID(rawBatchID)
	if err != nil {
		return nil, err
	}
	batch, err := a.loadRequirementReviewBatch(ctx, batchID)
	if err != nil {
		return nil, err
	}
	if batch.status != "pending" {
		return nil, httperror.New(http.StatusConflict, "batch_closed", "该批次已处理")
	}

	revertStatus := "baselined"
	if batch.batchType == "baseline" {
		revertStatus = "draft"
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		"UPDATE requirement_review_batches SET status = 'rejected', closed_at = NOW() WHERE id = ?", batchID); err != nil {
		return nil, err
	}

	if len(batch.requirementIDs) > 0 {
		if batch.batchType == "change" {
			if err := revertChangeRequirementContents(ctx, tx, batch.requirementIDs, "archived"); err != nil {
				return nil, err
			}
			if _, err := tx.ExecContext(ctx,
				"UPDATE requirement_items SET status = 'deprecated' WHERE id IN ("+placeholders(len(batch.requirementIDs))+")",
				int64Args(batch.requirementIDs)...); err != nil {
				return nil, err
			}
		} else {
			if _, err := tx.ExecContext(ctx,
				"UPDATE requirement_items SET status = ? WHERE id IN ("+placeholders(len(batch.requirementIDs))+")",
				append([]any{revertStatus}, int64Args(batch.requirementIDs)...)...); err != nil {
				return nil, err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"batchId":    batchID,
		"rejected":   true,
		"revertedTo": revertStatus,
	}, nil
}

// withdrawRequirementReviewBatch 取消评审准备：恢复需求状态并删除批次。
func (a *Adapter) withdrawRequirementReviewBatch(ctx context.Context, rawBatchID string, query url.Values) (map[string]any, error) {
	if _, err := requireReviewActionUser(query); err != nil {
		return nil, err
	}
	batchID, err := parseReviewBatchID(rawBatchID)
	if err != nil {
		return nil, err
	}
	batch, err := a.loadRequirementReviewBatch(ctx, batchID)
	if err != nil {
		return nil, err
	}
	if batch.status != "pending" {
		return nil, httperror.New(http.StatusConflict, "batch_closed", "该批次已处理，无法撤回")
	}
	if batch.workflowInstanceID != nil && strings.TrimSpace(*batch.workflowInstanceID) != "" {
		return nil, httperror.New(http.StatusConflict, "batch_in_workflow", "该批次已提交审批，不能直接取消准备")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if len(batch.requirementIDs) > 0 {
		if batch.batchType == "change" {
			if err := revertChangeRequirementContents(ctx, tx, batch.requirementIDs, "change_draft"); err != nil {
				return nil, err
			}
		}
		if _, err := tx.ExecContext(ctx,
			"UPDATE requirement_items SET status = 'draft' WHERE id IN ("+placeholders(len(batch.requirementIDs))+")",
			int64Args(batch.requirementIDs)...); err != nil {
			return nil, err
		}
	}

	if _, err := tx.ExecContext(ctx,
		"DELETE FROM requirement_review_batches WHERE id = ?", batchID); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"batchId":    batchID,
		"deleted":    true,
		"revertedTo": "draft",
	}, nil
}

// revertChangeRequirementContents 处理 change 批次回退/撤回时的内容版本状态：
//   - 父需求基线侧已存在关系的内容：in_review → baselined
//   - 父需求基线侧不存在关系的内容：change_draft/in_review → newStatusForOrphan
//
// reject 时 orphanStatus='archived'（命中 change_draft/in_review），
// withdraw 时 orphanStatus='change_draft'（仅命中 in_review）。
// 同时把涉及需求的父需求恢复为 baselined。
func revertChangeRequirementContents(ctx context.Context, tx *sql.Tx, requirementIDs []int64, orphanStatus string) error {
	ph := placeholders(len(requirementIDs))

	rows, err := tx.QueryContext(ctx,
		"SELECT parent_requirement_id FROM requirement_items WHERE id IN ("+ph+")",
		int64Args(requirementIDs)...)
	if err != nil {
		return err
	}
	var parentIDs []int64
	for rows.Next() {
		var parentID sql.NullInt64
		if err := rows.Scan(&parentID); err != nil {
			rows.Close()
			return err
		}
		if parentID.Valid && parentID.Int64 > 0 {
			parentIDs = append(parentIDs, parentID.Int64)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	if len(parentIDs) > 0 {
		if _, err := tx.ExecContext(ctx,
			"UPDATE requirement_items SET status = 'baselined' WHERE id IN ("+placeholders(len(parentIDs))+")",
			int64Args(parentIDs)...); err != nil {
			return err
		}
	}

	orphanVersionStatuses := "'change_draft', 'in_review'"
	if orphanStatus == "change_draft" {
		orphanVersionStatuses = "'in_review'"
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE requirement_contents c
		INNER JOIN requirement_item_contents ric ON ric.content_id = c.id
		INNER JOIN requirement_items change_req ON change_req.id = ric.requirement_id
		LEFT JOIN requirement_item_contents parent_ric
		  ON parent_ric.requirement_id = change_req.parent_requirement_id
		 AND parent_ric.content_id = c.id
		 AND parent_ric.relation_type = 'baseline'
		SET c.version_status = ?
		WHERE ric.requirement_id IN (`+ph+`)
		  AND ric.relation_type = 'change'
		  AND parent_ric.id IS NULL
		  AND c.version_status IN (`+orphanVersionStatuses+`)`,
		append([]any{orphanStatus}, int64Args(requirementIDs)...)...); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE requirement_contents c
		INNER JOIN requirement_item_contents ric ON ric.content_id = c.id
		INNER JOIN requirement_items change_req ON change_req.id = ric.requirement_id
		INNER JOIN requirement_item_contents parent_ric
		  ON parent_ric.requirement_id = change_req.parent_requirement_id
		 AND parent_ric.content_id = c.id
		 AND parent_ric.relation_type = 'baseline'
		SET c.version_status = 'baselined'
		WHERE ric.requirement_id IN (`+ph+`)
		  AND ric.relation_type = 'change'
		  AND c.version_status = 'in_review'`,
		int64Args(requirementIDs)...); err != nil {
		return err
	}
	return nil
}

// appendRequirementsToReviewBatch 向未提交审批的基线评审批次追加需求。
func (a *Adapter) appendRequirementsToReviewBatch(ctx context.Context, rawBatchID string, query url.Values, body map[string]any) (map[string]any, error) {
	if _, err := requireReviewActionUser(query); err != nil {
		return nil, err
	}
	batchID, err := parseReviewBatchID(rawBatchID)
	if err != nil {
		return nil, err
	}

	rawIDs, _ := body["requirementIds"].([]any)
	seen := map[int64]bool{}
	var requirementIDs []int64
	for _, raw := range rawIDs {
		var id int64
		switch value := raw.(type) {
		case float64:
			id = int64(value)
		case string:
			parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
			if err != nil {
				continue
			}
			id = parsed
		case json.Number:
			parsed, err := value.Int64()
			if err != nil {
				continue
			}
			id = parsed
		default:
			continue
		}
		if id > 0 && !seen[id] {
			seen[id] = true
			requirementIDs = append(requirementIDs, id)
		}
	}
	if len(requirementIDs) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "requirement_ids_required", "请选择至少一条需求")
	}

	batch, err := a.loadRequirementReviewBatch(ctx, batchID)
	if err != nil {
		return nil, err
	}
	if batch.batchType != "baseline" {
		return nil, httperror.New(http.StatusConflict, "batch_not_baseline", "仅支持向基线评审批次追加需求")
	}
	if batch.status != "pending" {
		return nil, httperror.New(http.StatusConflict, "batch_closed", "该批次已处理，无法追加")
	}
	if batch.workflowInstanceID != nil && strings.TrimSpace(*batch.workflowInstanceID) != "" {
		return nil, httperror.New(http.StatusConflict, "batch_in_workflow", "该批次已提交审批，无法追加需求")
	}

	existingIDSet := map[int64]bool{}
	for _, id := range batch.requirementIDs {
		existingIDSet[id] = true
	}
	var newIDs []int64
	for _, id := range requirementIDs {
		if !existingIDSet[id] {
			newIDs = append(newIDs, id)
		}
	}
	if len(newIDs) == 0 {
		return nil, httperror.New(http.StatusConflict, "already_in_batch", "所选需求均已在该批次中")
	}

	rows, err := a.DB().QueryContext(ctx,
		`SELECT id, status, item_kind FROM requirement_items
		 WHERE id IN (`+placeholders(len(newIDs))+`) AND project_id = ?`,
		int64Args(newIDs, batch.projectID)...)
	if err != nil {
		return nil, err
	}
	matched := 0
	valid := true
	for rows.Next() {
		var id int64
		var status, itemKind string
		if err := rows.Scan(&id, &status, &itemKind); err != nil {
			rows.Close()
			return nil, err
		}
		matched++
		if itemKind != "baseline" || status != "draft" {
			valid = false
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if matched != len(newIDs) {
		return nil, httperror.New(http.StatusBadRequest, "requirement_mismatch", "部分需求不存在或不属于当前项目")
	}
	if !valid {
		return nil, httperror.New(http.StatusConflict, "requirement_not_draft_baseline", "只能追加草稿态的基线需求")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	mergedIDs := append(append([]int64(nil), batch.requirementIDs...), newIDs...)
	mergedJSON, err := json.Marshal(mergedIDs)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE requirement_review_batches SET requirement_ids_json = ? WHERE id = ?",
		string(mergedJSON), batchID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE requirement_items SET status = 'in_review' WHERE id IN ("+placeholders(len(newIDs))+")",
		int64Args(newIDs)...); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"batchId":       batchID,
		"appendedCount": len(newIDs),
		"totalCount":    len(mergedIDs),
	}, nil
}

// createTasksForReviewBatch 为已通过的批次批量生成任务。
func (a *Adapter) createTasksForReviewBatch(ctx context.Context, rawBatchID string, query url.Values) (map[string]any, error) {
	uid, err := requireReviewActionUser(query)
	if err != nil {
		return nil, err
	}
	batchID, err := parseReviewBatchID(rawBatchID)
	if err != nil {
		return nil, err
	}
	batch, err := a.loadRequirementReviewBatch(ctx, batchID)
	if err != nil {
		return nil, err
	}
	if batch.status != "approved" {
		return nil, httperror.New(http.StatusConflict, "batch_not_approved", "仅已评审通过的批次可批量生成任务")
	}
	if len(batch.requirementIDs) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "no_requirements", "该批次没有可生成任务的需求项")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var created []map[string]any
	var skipped []map[string]any
	for _, requirementID := range batch.requirementIDs {
		result, err := createRequirementTaskFromRequirement(ctx, tx, requirementTaskOptions{
			requirementID:    requirementID,
			uid:              uid,
			status:           "planning",
			skipIfTaskExists: true,
		})
		if err != nil {
			var httpErr httperror.Error
			if errors.As(err, &httpErr) && (httpErr.Status == http.StatusBadRequest || httpErr.Status == http.StatusNotFound || httpErr.Status == http.StatusConflict) {
				message := httpErr.Message
				if message == "" {
					message = "该需求暂不满足生成任务条件"
				}
				skipped = append(skipped, map[string]any{
					"requirementId": requirementID,
					"reason":        "invalid_requirement",
					"message":       message,
				})
				continue
			}
			return nil, err
		}

		if result.Created {
			created = append(created, map[string]any{
				"requirementId": result.RequirementID,
				"taskId":        result.TaskID,
				"itemKey":       result.ItemKey,
			})
		} else {
			skipped = append(skipped, map[string]any{
				"requirementId": result.RequirementID,
				"reason":        result.SkipReason,
				"message":       result.SkipMessage,
			})
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	if created == nil {
		created = []map[string]any{}
	}
	if skipped == nil {
		skipped = []map[string]any{}
	}
	return map[string]any{
		"batchId":      batchID,
		"title":        batch.title,
		"createdCount": len(created),
		"skippedCount": len(skipped),
		"created":      created,
		"skipped":      skipped,
	}, nil
}
