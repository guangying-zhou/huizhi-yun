package aims

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Port of aims/server/api/v1/{requirements/[reqId]/create-task,
// requirement-contents/[contentId]/restore,requirements/[reqId]/changes/index}.post.ts
// 需求建任务、规格书章节恢复、需求变更草稿创建。

// createRequirementTask 为需求创建关联任务（status=todo，存在任务时 409）。
func (a *Adapter) createRequirementTask(ctx context.Context, rawReqID string, query url.Values, body map[string]any) (map[string]any, error) {
	uid, err := requireReviewActionUser(query)
	if err != nil {
		return nil, err
	}
	reqID, err := parseDistributionWorkItemID(rawReqID)
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_requirement_id", "无效的需求ID")
	}

	options := requirementTaskOptions{
		requirementID: reqID,
		uid:           uid,
		title:         optionalBodyString(body, "title"),
		description:   optionalBodyString(body, "description"),
		assigneeUID:   optionalBodyString(body, "assigneeUid", "assignee_uid"),
		priority:      optionalBodyString(body, "priority"),
		startDate:     normalizeDistributionDate(body["startDate"]),
		dueDate:       normalizeDistributionDate(body["dueDate"]),
		status:        "todo",
	}
	if milestoneID, err := bodyInt64(body, "milestoneId", "milestone_id"); err == nil && milestoneID > 0 {
		options.milestoneID = &milestoneID
	}
	if reviewLevel, err := bodyInt64(body, "reviewLevel", "review_level"); err == nil {
		options.reviewLevel = &reviewLevel
	}
	options.estimatedHours = optionalBodyFloat(body, "estimatedHours", "estimated_hours")

	rawDeliverables, _ := body["deliverables"].([]any)
	for _, raw := range rawDeliverables {
		deliverableMap, _ := raw.(map[string]any)
		if deliverableMap == nil {
			continue
		}
		deliverable := requirementTaskDeliverable{Required: deliverableMap["required"] != false}
		if value := normalizeDistributionText(deliverableMap["name"]); value != nil {
			deliverable.Name = *value
		}
		if value := normalizeDistributionText(deliverableMap["deliverableType"]); value != nil {
			deliverable.DeliverableType = *value
		}
		if value := normalizeDistributionText(deliverableMap["description"]); value != nil {
			deliverable.Description = *value
		}
		if value := normalizeDistributionText(deliverableMap["acceptanceCriteria"]); value != nil {
			deliverable.AcceptanceCriteria = *value
		}
		options.deliverables = append(options.deliverables, deliverable)
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	result, err := createRequirementTaskFromRequirement(ctx, tx, options)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"taskId":      result.TaskID,
		"itemKey":     result.ItemKey,
		"title":       result.Title,
		"milestoneId": result.MilestoneID,
		"status":      "todo",
	}, nil
}

// restoreRequirementContent 恢复已删除规格书章节（含子树与祖先链），置为 modified。
func (a *Adapter) restoreRequirementContent(ctx context.Context, rawContentID string, query url.Values) (map[string]any, error) {
	uid, err := requireReviewActionUser(query)
	if err != nil {
		return nil, err
	}
	contentID, err := parseDistributionWorkItemID(rawContentID)
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_content_id", "无效的章节ID")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var projectID int64
	var status string
	err = tx.QueryRowContext(ctx,
		"SELECT project_id, status FROM requirement_contents WHERE id = ? FOR UPDATE", contentID).
		Scan(&projectID, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "content_not_found", "章节不存在")
	}
	if err != nil {
		return nil, err
	}

	if err := a.assertProjectActiveByID(ctx, projectID); err != nil {
		return nil, err
	}

	if status != "deprecated" {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"changed": false, "restoredCount": 0}, nil
	}

	updateResult, err := tx.ExecContext(ctx, `
		WITH RECURSIVE subtree AS (
		  SELECT id, parent_id
		  FROM requirement_contents
		  WHERE id = ? AND project_id = ?
		  UNION ALL
		  SELECT child.id, child.parent_id
		  FROM requirement_contents child
		  INNER JOIN subtree t ON child.parent_id = t.id
		  WHERE child.project_id = ?
		),
		ancestors AS (
		  SELECT id, parent_id
		  FROM requirement_contents
		  WHERE id = ? AND project_id = ?
		  UNION ALL
		  SELECT p.id, p.parent_id
		  FROM requirement_contents p
		  INNER JOIN ancestors t ON t.parent_id = p.id
		  WHERE p.project_id = ?
		),
		restore_scope AS (
		  SELECT id FROM subtree
		  UNION
		  SELECT id FROM ancestors
		)
		UPDATE requirement_contents c
		INNER JOIN restore_scope t ON t.id = c.id
		SET c.status = 'modified', c.updated_by = ?
		WHERE c.status = 'deprecated'`,
		contentID, projectID, projectID, contentID, projectID, projectID, uid)
	if err != nil {
		return nil, err
	}
	restored, err := updateResult.RowsAffected()
	if err != nil {
		return nil, err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE project_documents
		SET import_status = 'imported_dirty'
		WHERE project_id = ?
		  AND doc_category = 'requirement_spec'
		  AND import_status = 'imported_clean'`, projectID); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"changed": restored > 0, "restoredCount": restored}, nil
}

var changeTitlePrefixPattern = regexp.MustCompile(`^\[变更\d+\]\s*`)

// createRequirementChangeDraft 创建需求变更草稿（item_kind=change 的变更需求 + 变更章节版本）。
func (a *Adapter) createRequirementChangeDraft(ctx context.Context, rawReqID string, query url.Values, body map[string]any) (map[string]any, error) {
	uid, err := requireReviewActionUser(query)
	if err != nil {
		return nil, err
	}
	reqID, err := parseDistributionWorkItemID(rawReqID)
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_requirement_id", "无效的需求ID")
	}

	rawContents, _ := body["contents"].([]any)
	if len(rawContents) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "contents_required", "请至少提供一个变更章节")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var parent struct {
		projectID   int64
		reqCode     string
		title       string
		reqType     string
		category    sql.NullString
		priority    string
		source      string
		milestoneID sql.NullInt64
		workItemID  sql.NullInt64
		status      string
		itemKind    string
		scopeNote   sql.NullString
	}
	err = tx.QueryRowContext(ctx, `
		SELECT project_id, req_code, title, type, category, priority, source,
		       milestone_id, work_item_id, status, item_kind, scope_note
		FROM requirement_items
		WHERE id = ?
		FOR UPDATE`, reqID).
		Scan(&parent.projectID, &parent.reqCode, &parent.title, &parent.reqType, &parent.category,
			&parent.priority, &parent.source, &parent.milestoneID, &parent.workItemID,
			&parent.status, &parent.itemKind, &parent.scopeNote)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "requirement_not_found", "需求不存在")
	}
	if err != nil {
		return nil, err
	}
	if parent.itemKind != "baseline" || parent.status != "baselined" {
		return nil, httperror.New(http.StatusConflict, "requirement_not_baselined", "只有已基线需求可以发起变更")
	}

	var activeChangeID int64
	err = tx.QueryRowContext(ctx, `
		SELECT id
		FROM requirement_items
		WHERE parent_requirement_id = ?
		  AND item_kind = 'change'
		  AND status IN ('draft', 'in_review', 'change_pending')
		LIMIT 1`, reqID).Scan(&activeChangeID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if activeChangeID > 0 {
		return nil, httperror.New(http.StatusConflict, "change_in_progress", "该需求已有未完成的变更")
	}

	var maxChangeNo sql.NullInt64
	if err := tx.QueryRowContext(ctx,
		"SELECT MAX(change_no) FROM requirement_items WHERE parent_requirement_id = ?", reqID).
		Scan(&maxChangeNo); err != nil {
		return nil, err
	}
	changeNo := maxChangeNo.Int64 + 1
	changeCode := fmt.Sprintf("%s-%02d", parent.reqCode, changeNo)

	rawTitle := parent.title
	if value := optionalBodyString(body, "title"); value != nil && strings.TrimSpace(*value) != "" {
		rawTitle = strings.TrimSpace(*value)
	}
	titledChange := fmt.Sprintf("[变更%d]%s", changeNo, changeTitlePrefixPattern.ReplaceAllString(rawTitle, ""))

	reqNumber, _, err := nextRequirementCode(ctx, tx, parent.projectID)
	if err != nil {
		return nil, err
	}

	// 允许指定挂接的"需求变更 target"；未指定则沿用原需求的 work_item_id
	var resolvedWorkItemID any
	if parent.workItemID.Valid {
		resolvedWorkItemID = parent.workItemID.Int64
	}
	if bodyWorkItemID, err := bodyInt64(body, "workItemId", "work_item_id"); err == nil && bodyWorkItemID > 0 {
		var targetID int64
		err := tx.QueryRowContext(ctx, `
			SELECT id FROM work_items
			WHERE id = ? AND project_id = ? AND tier = 'target' AND type = 'requirement'
			LIMIT 1`, bodyWorkItemID, parent.projectID).Scan(&targetID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, httperror.New(http.StatusBadRequest, "invalid_change_target", "指定的需求变更 target 不存在")
		}
		if err != nil {
			return nil, err
		}
		resolvedWorkItemID = bodyWorkItemID
	}

	var milestoneValue any
	if parent.milestoneID.Valid {
		milestoneValue = parent.milestoneID.Int64
	}
	var categoryValue any
	if parent.category.Valid {
		categoryValue = parent.category.String
	}
	var scopeNoteValue any
	if parent.scopeNote.Valid && parent.scopeNote.String != "" {
		scopeNoteValue = parent.scopeNote.String
	}
	changeReason := optionalBodyString(body, "reason")

	changeResult, err := tx.ExecContext(ctx, `
		INSERT INTO requirement_items
		  (item_kind, parent_requirement_id, change_no, change_reason, scope_note,
		   project_id, req_number, req_code, title, type, category, priority, source,
		   milestone_id, work_item_id, status, created_by)
		VALUES ('change', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
		reqID, changeNo, nullableStringValue(changeReason), scopeNoteValue,
		parent.projectID, reqNumber, changeCode, titledChange, parent.reqType, categoryValue,
		parent.priority, parent.source, milestoneValue, resolvedWorkItemID, uid)
	if err != nil {
		return nil, err
	}
	changeReqID, err := changeResult.LastInsertId()
	if err != nil {
		return nil, err
	}

	for index, raw := range rawContents {
		itemMap, _ := raw.(map[string]any)
		if itemMap == nil {
			itemMap = map[string]any{}
		}
		contentID, err := bodyInt64(itemMap, "contentId", "content_id")
		if err != nil || contentID <= 0 {
			return nil, httperror.New(http.StatusBadRequest, "invalid_content_id", "无效的章节ID")
		}

		var base struct {
			id                int64
			projectID         int64
			parentID          sql.NullInt64
			headingDepth      int64
			title             string
			contentMD         sql.NullString
			sortOrder         int64
			contentOriginalID sql.NullInt64
			versionNo         int64
			versionStatus     string
		}
		err = tx.QueryRowContext(ctx, `
			WITH RECURSIVE req_content_scope AS (
			  SELECT c.id
			  FROM requirement_contents c
			  LEFT JOIN requirement_item_contents ric
			    ON ric.content_id = c.id AND ric.requirement_id = ? AND ric.relation_type = 'baseline'
			  WHERE c.project_id = ?
			    AND ric.id IS NOT NULL
			  UNION ALL
			  SELECT child.id
			  FROM requirement_contents child
			  INNER JOIN req_content_scope scope ON child.parent_id = scope.id
			  WHERE child.project_id = ?
			)
			SELECT c.id, c.project_id, c.parent_id, c.heading_depth, c.title, c.content_md,
			       c.sort_order, c.content_original_id, c.version_no, c.version_status
			FROM requirement_contents c
			INNER JOIN req_content_scope scope ON scope.id = c.id
			WHERE c.id = ?
			  AND c.project_id = ?
			  AND c.version_status IN ('draft', 'baselined')
			LIMIT 1`,
			reqID, parent.projectID, parent.projectID, contentID, parent.projectID).
			Scan(&base.id, &base.projectID, &base.parentID, &base.headingDepth, &base.title,
				&base.contentMD, &base.sortOrder, &base.contentOriginalID, &base.versionNo, &base.versionStatus)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, httperror.New(http.StatusBadRequest, "content_not_baseline", "章节不是该需求的当前基线内容")
		}
		if err != nil {
			return nil, err
		}

		contentOriginalID := base.id
		if base.contentOriginalID.Valid && base.contentOriginalID.Int64 > 0 {
			contentOriginalID = base.contentOriginalID.Int64
		}
		if !base.contentOriginalID.Valid || base.versionStatus != "baselined" {
			if _, err := tx.ExecContext(ctx, `
				UPDATE requirement_contents
				SET content_original_id = COALESCE(content_original_id, id),
				    version_status = 'baselined'
				WHERE id = ?`, base.id); err != nil {
				return nil, err
			}
		}

		var maxVersion sql.NullInt64
		if err := tx.QueryRowContext(ctx,
			"SELECT MAX(version_no) FROM requirement_contents WHERE content_original_id = ?",
			contentOriginalID).Scan(&maxVersion); err != nil {
			return nil, err
		}
		baseVersion := maxVersion.Int64
		if baseVersion == 0 {
			baseVersion = base.versionNo
			if baseVersion == 0 {
				baseVersion = 1
			}
		}
		nextVersion := baseVersion + 1

		nextTitle := base.title
		if value := normalizeDistributionText(itemMap["title"]); value != nil {
			nextTitle = *value
		}
		var nextContent *string
		if base.contentMD.Valid {
			value := base.contentMD.String
			nextContent = &value
		}
		if rawContent, exists := itemMap["contentMd"]; exists && rawContent != nil {
			if text, ok := rawContent.(string); ok {
				nextContent = &text
			}
		}

		titleChanged := nextTitle != base.title
		baseCompare := ""
		if base.contentMD.Valid {
			baseCompare = base.contentMD.String
		}
		nextCompare := ""
		if nextContent != nil {
			nextCompare = *nextContent
		}
		contentChanged := nextCompare != baseCompare
		changeContentID := base.id

		if titleChanged || contentChanged {
			var parentValue any
			if base.parentID.Valid {
				parentValue = base.parentID.Int64
			}
			contentResult, err := tx.ExecContext(ctx, `
				INSERT INTO requirement_contents
				  (content_original_id, version_no, version_status, project_id, parent_id,
				   heading_depth, title, content_md, sort_order, status, created_by)
				VALUES (?, ?, 'change_draft', ?, ?, ?, ?, ?, ?, 'modified', ?)`,
				contentOriginalID, nextVersion, base.projectID, parentValue,
				base.headingDepth, nextTitle, nullableDistributionString(nextContent), base.sortOrder, uid)
			if err != nil {
				return nil, err
			}
			changeContentID, err = contentResult.LastInsertId()
			if err != nil {
				return nil, err
			}
		}

		if _, err := tx.ExecContext(ctx, `
			INSERT INTO requirement_item_contents
			  (requirement_id, content_id, relation_type, sort_order, created_by)
			VALUES (?, ?, 'change', ?, ?)`,
			changeReqID, changeContentID, index, uid); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"id":                  changeReqID,
		"reqCode":             changeCode,
		"parentRequirementId": reqID,
		"changeNo":            changeNo,
		"status":              "draft",
	}, nil
}
