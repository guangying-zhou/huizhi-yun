package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) updateRequirementMetadata(ctx context.Context, rawRequirementID string, query url.Values, body map[string]any) (map[string]any, error) {
	uid, err := requireReviewActionUser(query)
	if err != nil {
		return nil, err
	}
	requirementID, err := parseID(rawRequirementID, "requirement_id")
	if err != nil {
		return nil, err
	}
	if err := a.requireRequirementProjectManagerOrScopedAdmin(ctx, requirementID, uid, query); err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var id int64
	var projectID int64
	var status string
	err = tx.QueryRowContext(ctx, `
		SELECT id, project_id, status
		FROM requirement_items
		WHERE id = ?
		FOR UPDATE
	`, requirementID).Scan(&id, &projectID, &status)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "requirement_not_found", "需求不存在")
	}
	if err != nil {
		return nil, err
	}

	switch status {
	case "in_review", "change_pending":
		return nil, httperror.New(http.StatusConflict, "requirement_locked", "评审中的需求不允许编辑")
	case "deprecated":
		return nil, httperror.New(http.StatusConflict, "requirement_deprecated", "已废弃的需求不允许编辑")
	}

	updates, args, err := requirementMetadataUpdates(body)
	if err != nil {
		return nil, err
	}
	if len(updates) == 0 {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"changed": false}, nil
	}

	updates = append(updates, "updated_by = ?")
	args = append(args, uid)
	if status == "baselined" {
		updates = append(updates, "status = 'change_pending'")
	}
	args = append(args, requirementID)

	if _, err := tx.ExecContext(ctx, `
		UPDATE requirement_items
		SET `+strings.Join(updates, ", ")+`
		WHERE id = ?
	`, args...); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE project_documents
		SET import_status = 'imported_dirty'
		WHERE project_id = ?
		  AND doc_category = 'requirement_spec'
		  AND import_status = 'imported_clean'
	`, projectID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	newStatus := status
	if status == "baselined" {
		newStatus = "change_pending"
	}
	return map[string]any{"changed": true, "newStatus": newStatus}, nil
}

func (a *Adapter) deleteRequirement(ctx context.Context, rawRequirementID string, query url.Values) (map[string]any, error) {
	uid, err := requireReviewActionUser(query)
	if err != nil {
		return nil, err
	}
	requirementID, err := parseID(rawRequirementID, "requirement_id")
	if err != nil {
		return nil, err
	}
	if err := a.requireRequirementProjectManagerOrScopedAdmin(ctx, requirementID, uid, query); err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var id int64
	var projectID int64
	var status string
	var itemKind string
	var parentRequirementID sql.NullInt64
	err = tx.QueryRowContext(ctx, `
		SELECT id, project_id, status, item_kind, parent_requirement_id
		FROM requirement_items
		WHERE id = ?
		FOR UPDATE
	`, requirementID).Scan(&id, &projectID, &status, &itemKind, &parentRequirementID)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "requirement_not_found", "需求不存在")
	}
	if err != nil {
		return nil, err
	}

	switch status {
	case "baselined":
		return nil, httperror.New(http.StatusConflict, "requirement_baselined", "已基线的需求不允许删除或废弃")
	case "in_review", "change_pending":
		return nil, httperror.New(http.StatusConflict, "requirement_locked", "评审中的需求不允许删除")
	}

	if itemKind == "change" && parentRequirementID.Valid {
		if _, err := tx.ExecContext(ctx, `
			DELETE c
			FROM requirement_contents c
			INNER JOIN requirement_item_contents ric
			  ON ric.content_id = c.id
			 AND ric.requirement_id = ?
			 AND ric.relation_type = 'change'
			LEFT JOIN requirement_item_contents parent_ric
			  ON parent_ric.requirement_id = ?
			 AND parent_ric.content_id = c.id
			 AND parent_ric.relation_type = 'baseline'
			WHERE parent_ric.id IS NULL
			  AND c.version_status IN ('change_draft', 'in_review', 'archived')
		`, requirementID, parentRequirementID.Int64); err != nil {
			return nil, err
		}
	}

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM requirement_item_contents
		WHERE requirement_id = ?
	`, requirementID); err != nil {
		return nil, err
	}

	deleted := status == "draft"
	if deleted {
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM requirement_items
			WHERE id = ?
		`, requirementID); err != nil {
			return nil, err
		}
	} else {
		if _, err := tx.ExecContext(ctx, `
			UPDATE requirement_items
			SET status = 'deprecated', updated_by = ?
			WHERE id = ?
		`, uid, requirementID); err != nil {
			return nil, err
		}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE project_documents
		SET import_status = 'imported_dirty'
		WHERE project_id = ?
		  AND doc_category = 'requirement_spec'
		  AND import_status = 'imported_clean'
	`, projectID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"deleted":    deleted,
		"deprecated": !deleted,
	}, nil
}

func (a *Adapter) updateRequirementContent(ctx context.Context, rawContentID string, query url.Values, body map[string]any) (map[string]any, error) {
	uid, err := requireReviewActionUser(query)
	if err != nil {
		return nil, err
	}
	contentID, err := parseID(rawContentID, "content_id")
	if err != nil {
		return nil, err
	}
	if err := a.requireRequirementContentProjectManagerOrScopedAdmin(ctx, contentID, uid, query); err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var id int64
	var projectID int64
	var status string
	err = tx.QueryRowContext(ctx, `
		SELECT id, project_id, status
		FROM requirement_contents
		WHERE id = ?
		FOR UPDATE
	`, contentID).Scan(&id, &projectID, &status)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "content_not_found", "章节不存在")
	}
	if err != nil {
		return nil, err
	}
	if status == "deprecated" {
		return nil, httperror.New(http.StatusConflict, "content_deprecated", "已废弃的章节不允许编辑")
	}

	titleValue, hasTitle := bodyValueByAnyKey(body, "title")
	contentValue, hasContent := bodyValueByAnyKey(body, "contentMd", "content_md")
	if hasTitle || hasContent {
		var lockedCount int64
		err = tx.QueryRowContext(ctx, `
			WITH RECURSIVE descendants AS (
				SELECT id, parent_id
				FROM requirement_contents
				WHERE id = ?
				UNION ALL
				SELECT c.id, c.parent_id
				FROM requirement_contents c
				INNER JOIN descendants t ON c.parent_id = t.id
			),
			ancestors AS (
				SELECT id, parent_id
				FROM requirement_contents
				WHERE id = ?
				UNION ALL
				SELECT p.id, p.parent_id
				FROM requirement_contents p
				INNER JOIN ancestors t ON t.parent_id = p.id
			),
			content_scope AS (
				SELECT id FROM descendants
				UNION
				SELECT id FROM ancestors
			)
			SELECT COUNT(*) AS cnt
			FROM content_scope ct
			INNER JOIN requirement_item_contents ric ON ric.content_id = ct.id
			INNER JOIN requirement_items r ON r.id = ric.requirement_id
			WHERE r.status IN ('in_review', 'baselined', 'change_pending')
		`, contentID, contentID).Scan(&lockedCount)
		if err != nil {
			return nil, err
		}
		if lockedCount > 0 {
			return nil, httperror.New(http.StatusConflict, "requirement_locked", "需求已进入评审批次，对应章节不允许编辑或取消关联")
		}
	}

	updates := make([]string, 0, 4)
	args := make([]any, 0, 4)
	if hasTitle {
		title := strings.TrimSpace(fmt.Sprint(titleValue))
		if title == "" || title == "<nil>" {
			return nil, httperror.New(http.StatusBadRequest, "invalid_title", "标题不能为空")
		}
		updates = append(updates, "title = ?")
		args = append(args, title)
	}
	if hasContent {
		updates = append(updates, "content_md = ?")
		args = append(args, contentValue)
	}
	if len(updates) == 0 {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"changed": false}, nil
	}

	updates = append(updates, "status = 'modified'", "updated_by = ?")
	args = append(args, uid, contentID)
	if _, err := tx.ExecContext(ctx, `
		UPDATE requirement_contents
		SET `+strings.Join(updates, ", ")+`
		WHERE id = ?
	`, args...); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE project_documents
		SET import_status = 'imported_dirty'
		WHERE project_id = ?
		  AND doc_category = 'requirement_spec'
		  AND import_status = 'imported_clean'
	`, projectID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"changed": true}, nil
}

func (a *Adapter) deleteRequirementContent(ctx context.Context, rawContentID string, query url.Values) (map[string]any, error) {
	uid, err := requireReviewActionUser(query)
	if err != nil {
		return nil, err
	}
	contentID, err := parseID(rawContentID, "content_id")
	if err != nil {
		return nil, err
	}
	if err := a.requireRequirementContentProjectManagerOrScopedAdmin(ctx, contentID, uid, query); err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var id int64
	var projectID int64
	var status string
	var versionStatus string
	err = tx.QueryRowContext(ctx, `
		SELECT id, project_id, status, version_status
		FROM requirement_contents
		WHERE id = ?
		FOR UPDATE
	`, contentID).Scan(&id, &projectID, &status, &versionStatus)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "content_not_found", "章节不存在")
	}
	if err != nil {
		return nil, err
	}

	if err := a.assertProjectActiveByID(ctx, projectID); err != nil {
		return nil, err
	}

	if status == "deprecated" {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"changed": false, "markedCount": int64(0)}, nil
	}
	if !containsString([]string{"draft", "baselined"}, versionStatus) {
		return nil, httperror.New(http.StatusConflict, "content_delete_not_allowed", "当前章节状态不允许删除")
	}

	var linkedCount int64
	err = tx.QueryRowContext(ctx, `
		WITH RECURSIVE subtree AS (
			SELECT id, parent_id
			FROM requirement_contents
			WHERE id = ? AND project_id = ?
			UNION ALL
			SELECT child.id, child.parent_id
			FROM requirement_contents child
			INNER JOIN subtree t ON child.parent_id = t.id
			WHERE child.project_id = ?
		)
		SELECT COUNT(*) AS cnt
		FROM subtree t
		INNER JOIN requirement_item_contents ric ON ric.content_id = t.id
	`, contentID, projectID, projectID).Scan(&linkedCount)
	if err != nil {
		return nil, err
	}
	if linkedCount > 0 {
		return nil, httperror.New(http.StatusConflict, "content_linked_to_requirement", "已设为需求项的功能模块/功能项不允许删除")
	}

	result, err := tx.ExecContext(ctx, `
		WITH RECURSIVE subtree AS (
			SELECT id, parent_id
			FROM requirement_contents
			WHERE id = ? AND project_id = ?
			UNION ALL
			SELECT child.id, child.parent_id
			FROM requirement_contents child
			INNER JOIN subtree t ON child.parent_id = t.id
			WHERE child.project_id = ?
		)
		UPDATE requirement_contents c
		INNER JOIN subtree t ON t.id = c.id
		SET c.status = 'deprecated', c.updated_by = ?
		WHERE c.status != 'deprecated'
	`, contentID, projectID, projectID, uid)
	if err != nil {
		return nil, err
	}
	markedCount, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE project_documents
		SET import_status = 'imported_dirty'
		WHERE project_id = ?
		  AND doc_category = 'requirement_spec'
		  AND import_status = 'imported_clean'
	`, projectID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"changed":     markedCount > 0,
		"markedCount": markedCount,
	}, nil
}

func requirementMetadataUpdates(body map[string]any) ([]string, []any, error) {
	updates := make([]string, 0)
	args := make([]any, 0)

	if hasAnyBodyKey(body, "title") {
		title := strings.TrimSpace(fmt.Sprint(body["title"]))
		if title == "" || title == "<nil>" {
			return nil, nil, httperror.New(http.StatusBadRequest, "invalid_title", "标题不能为空")
		}
		updates = append(updates, "title = ?")
		args = append(args, title)
	}
	if hasAnyBodyKey(body, "type") {
		reqType := "functional"
		if strings.TrimSpace(fmt.Sprint(body["type"])) == "non_functional" {
			reqType = "non_functional"
		}
		updates = append(updates, "type = ?")
		args = append(args, reqType)
	}
	if hasAnyBodyKey(body, "category") {
		updates = append(updates, "category = ?")
		args = append(args, nullableRequirementText(body["category"]))
	}
	if hasAnyBodyKey(body, "priority") {
		priority := strings.TrimSpace(fmt.Sprint(body["priority"]))
		if containsString([]string{"P0", "P1", "P2", "P3"}, priority) {
			updates = append(updates, "priority = ?")
			args = append(args, priority)
		}
	}
	if hasAnyBodyKey(body, "source") {
		source := strings.TrimSpace(fmt.Sprint(body["source"]))
		if containsString([]string{"customer", "internal", "compliance", "regulation", "other"}, source) {
			updates = append(updates, "source = ?")
			args = append(args, source)
		}
	}
	if hasAnyBodyKey(body, "milestoneId", "milestone_id") {
		milestoneID, err := optionalRequirementBodyID(body, "milestoneId", "milestone_id")
		if err != nil {
			return nil, nil, httperror.New(http.StatusBadRequest, "invalid_milestone_id", "无效的里程碑ID")
		}
		updates = append(updates, "milestone_id = ?")
		args = append(args, milestoneID)
	}

	return updates, args, nil
}

func bodyValueByAnyKey(body map[string]any, keys ...string) (any, bool) {
	for _, key := range keys {
		value, ok := body[key]
		if ok {
			return value, true
		}
	}
	return nil, false
}

func nullableRequirementText(value any) any {
	if value == nil {
		return nil
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" {
		return nil
	}
	return text
}

func optionalRequirementBodyID(body map[string]any, keys ...string) (any, error) {
	for _, key := range keys {
		value, ok := body[key]
		if !ok {
			continue
		}
		if value == nil {
			return nil, nil
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text == "" || text == "<nil>" {
			return nil, nil
		}
		switch typed := value.(type) {
		case float64:
			if typed <= 0 {
				return nil, nil
			}
			return int64(typed), nil
		case float32:
			if typed <= 0 {
				return nil, nil
			}
			return int64(typed), nil
		case int:
			if typed <= 0 {
				return nil, nil
			}
			return int64(typed), nil
		case int64:
			if typed <= 0 {
				return nil, nil
			}
			return typed, nil
		case jsonNumber:
			id, err := strconv.ParseInt(string(typed), 10, 64)
			if err != nil {
				return nil, err
			}
			if id <= 0 {
				return nil, nil
			}
			return id, nil
		default:
			id, err := strconv.ParseInt(text, 10, 64)
			if err != nil {
				return nil, err
			}
			if id <= 0 {
				return nil, nil
			}
			return id, nil
		}
	}
	return nil, nil
}
