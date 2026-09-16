package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type projectRequirementCreateInput struct {
	projectID                   int64
	uid                         string
	title                       string
	reqType                     string
	category                    any
	priority                    string
	source                      string
	milestoneID                 any
	workItemID                  sql.NullInt64
	scopeNote                   any
	contentIDs                  []int64
	createContentKind           string
	createContentParentID       sql.NullInt64
	createContentHeadingDepth   sql.NullInt64
	createContentMarkdown       string
	resolvedContentParentID     any
	resolvedContentHeadingDepth int64
}

type requirementContentParentRow struct {
	id            int64
	projectID     int64
	parentID      sql.NullInt64
	headingDepth  int64
	versionStatus string
}

func (a *Adapter) createProjectRequirement(ctx context.Context, rawProjectID string, query url.Values, body map[string]any) (map[string]any, error) {
	uid, err := requireReviewActionUser(query)
	if err != nil {
		return nil, err
	}
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectUpdateAccess(ctx, "/v1/aims/projects/"+rawProjectID+"/requirements", query, body, rawProjectID); err != nil {
		return nil, err
	}
	if err := a.assertProjectActiveByID(ctx, projectID); err != nil {
		return nil, err
	}

	input, err := parseProjectRequirementCreateInput(projectID, uid, body)
	if err != nil {
		return nil, err
	}

	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		data, err := a.createProjectRequirementAttempt(ctx, input)
		if err == nil {
			return data, nil
		}
		lastErr = err
		if !isRequirementCreateRetryableErr(err) || attempt == 3 {
			break
		}
		time.Sleep(time.Duration(attempt) * 120 * time.Millisecond)
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, httperror.New(http.StatusInternalServerError, "requirement_create_failed", "创建需求项失败，请重试")
}

func parseProjectRequirementCreateInput(projectID int64, uid string, body map[string]any) (projectRequirementCreateInput, error) {
	title := strings.TrimSpace(firstBodyText(body, "title"))
	if title == "" {
		return projectRequirementCreateInput{}, httperror.New(http.StatusBadRequest, "invalid_title", "需求标题不能为空")
	}

	reqType := "functional"
	if firstBodyText(body, "type") == "non_functional" {
		reqType = "non_functional"
	}
	priority := firstBodyText(body, "priority")
	if !containsString([]string{"P0", "P1", "P2", "P3"}, priority) {
		priority = "P2"
	}
	source := firstBodyText(body, "source")
	if !containsString([]string{"customer", "internal", "compliance", "regulation", "other"}, source) {
		source = "internal"
	}

	input := projectRequirementCreateInput{
		projectID:   projectID,
		uid:         uid,
		title:       title,
		reqType:     reqType,
		category:    nullableText(firstBodyText(body, "category")),
		priority:    priority,
		source:      source,
		milestoneID: nullableOptionalID(body, "milestoneId", "milestone_id"),
		scopeNote:   truncateNullableRequirementScopeNote(firstBodyText(body, "scopeNote", "scope_note")),
		contentIDs:  positiveInt64List(body["contentIds"]),
	}
	if workItemID, ok, err := optionalBodyID(body, "workItemId", "work_item_id"); err == nil && ok && workItemID > 0 {
		input.workItemID = sql.NullInt64{Int64: workItemID, Valid: true}
	}

	contentPayload, _ := body["content"].(map[string]any)
	if contentPayload != nil {
		switch firstBodyText(contentPayload, "kind") {
		case "module":
			input.createContentKind = "module"
		case "item":
			input.createContentKind = "item"
		}
		if parentID, ok, err := optionalRequirementContentBodyInt(contentPayload, "parentId", "parent_id"); err != nil {
			return projectRequirementCreateInput{}, httperror.New(http.StatusBadRequest, "invalid_parent_id", "新增章节的父节点无效")
		} else if ok && parentID > 0 {
			input.createContentParentID = sql.NullInt64{Int64: parentID, Valid: true}
		}
		if headingDepth, err := requiredRequirementContentBodyInt(contentPayload, "headingDepth", "heading_depth"); err == nil && headingDepth >= 2 && headingDepth <= 6 {
			input.createContentHeadingDepth = sql.NullInt64{Int64: headingDepth, Valid: true}
			input.resolvedContentHeadingDepth = headingDepth
		}
		input.createContentMarkdown = strings.TrimSpace(rawRequirementContentBodyString(contentPayload, "contentMd", "content_md"))
	}

	if input.createContentKind != "" && len(input.contentIDs) > 0 {
		return projectRequirementCreateInput{}, httperror.New(http.StatusBadRequest, "content_conflict", "不能同时关联已有章节并创建新章节")
	}
	if input.createContentKind != "" && !input.createContentHeadingDepth.Valid {
		return projectRequirementCreateInput{}, httperror.New(http.StatusBadRequest, "heading_depth_required", "缺少新增章节标题层级")
	}
	if input.createContentKind == "item" && !input.createContentParentID.Valid {
		return projectRequirementCreateInput{}, httperror.New(http.StatusBadRequest, "parent_required", "新增功能项必须选择所属功能模块")
	}

	return input, nil
}

func (a *Adapter) createProjectRequirementAttempt(ctx context.Context, input projectRequirementCreateInput) (map[string]any, error) {
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	data, err := a.createProjectRequirementTx(ctx, tx, input)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return data, nil
}

// createProjectRequirementTx joins the caller's transaction so product handoff
// can atomically persist the draft, source link, audit and idempotency receipt.
// The caller owns authorization, project eligibility, retry and commit/rollback.
func (a *Adapter) createProjectRequirementTx(ctx context.Context, tx *sql.Tx, input projectRequirementCreateInput) (map[string]any, error) {
	if err := a.resolveRequirementCreateContentParent(ctx, tx, &input); err != nil {
		return nil, err
	}
	if err := a.ensureRequirementCreateContentsUnlocked(ctx, tx, input.contentIDs); err != nil {
		return nil, err
	}

	reqNumber, reqCode, err := nextRequirementCode(ctx, tx, input.projectID)
	if err != nil {
		return nil, err
	}

	workItemID := any(nil)
	if input.workItemID.Valid {
		workItemID = input.workItemID.Int64
	} else {
		baselineID, err := requirementBaselineWorkItemID(ctx, tx, input.projectID)
		if err != nil {
			return nil, err
		}
		if baselineID.Valid {
			workItemID = baselineID.Int64
		}
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO requirement_items
		 (project_id, req_number, req_code, title, type, category, priority, source, milestone_id, work_item_id, scope_note, status, created_by)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
	`, input.projectID, reqNumber, reqCode, input.title, input.reqType, input.category, input.priority, input.source, input.milestoneID, workItemID, input.scopeNote, input.uid)
	if err != nil {
		return nil, err
	}
	requirementID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}

	if input.createContentKind != "" {
		contentID, err := a.insertRequirementInlineContent(ctx, tx, input)
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO requirement_item_contents
			 (requirement_id, content_id, relation_type, sort_order, created_by)
			VALUES (?, ?, 'baseline', 0, ?)
		`, requirementID, contentID, input.uid); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE project_documents
			SET import_status = 'imported_dirty'
			WHERE project_id = ?
			  AND doc_category = 'requirement_spec'
			  AND import_status IN ('imported_clean', 'imported_locked')
		`, input.projectID); err != nil {
			return nil, err
		}
	} else if len(input.contentIDs) > 0 {
		for index, contentID := range input.contentIDs {
			if _, err := tx.ExecContext(ctx, `
				INSERT IGNORE INTO requirement_item_contents
				 (requirement_id, content_id, relation_type, sort_order, created_by)
				VALUES (?, ?, 'baseline', ?, ?)
			`, requirementID, contentID, index, input.uid); err != nil {
				return nil, err
			}
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE project_documents
			SET import_status = 'imported_dirty'
			WHERE project_id = ?
			  AND doc_category = 'requirement_spec'
			  AND import_status = 'imported_clean'
		`, input.projectID); err != nil {
			return nil, err
		}
	}

	return map[string]any{
		"id":        requirementID,
		"reqNumber": reqNumber,
		"reqCode":   reqCode,
		"title":     input.title,
		"type":      input.reqType,
		"priority":  input.priority,
		"source":    input.source,
		"status":    "draft",
	}, nil
}

func (a *Adapter) resolveRequirementCreateContentParent(ctx context.Context, tx *sql.Tx, input *projectRequirementCreateInput) error {
	input.resolvedContentParentID = nil
	if input.createContentKind == "" {
		return nil
	}
	if !input.createContentParentID.Valid {
		return nil
	}

	var parent requirementContentParentRow
	err := tx.QueryRowContext(ctx, `
		SELECT id, project_id, parent_id, heading_depth, version_status
		FROM requirement_contents
		WHERE id = ?
		LIMIT 1
	`, input.createContentParentID.Int64).Scan(&parent.id, &parent.projectID, &parent.parentID, &parent.headingDepth, &parent.versionStatus)
	if err == sql.ErrNoRows || parent.projectID != input.projectID || parent.versionStatus != "draft" {
		return httperror.New(http.StatusBadRequest, "invalid_parent_content", "新增章节的父节点无效")
	}
	if err != nil {
		return err
	}

	var lockedCount int64
	err = tx.QueryRowContext(ctx, `
		WITH RECURSIVE parent_scope AS (
			SELECT id, parent_id
			FROM requirement_contents
			WHERE id = ?
			UNION ALL
			SELECT p.id, p.parent_id
			FROM requirement_contents p
			INNER JOIN parent_scope s ON s.parent_id = p.id
		)
		SELECT COUNT(*) AS cnt
		FROM parent_scope ps
		INNER JOIN requirement_item_contents ric ON ric.content_id = ps.id
		INNER JOIN requirement_items r ON r.id = ric.requirement_id
		WHERE r.status IN ('in_review', 'baselined', 'change_pending')
	`, input.createContentParentID.Int64).Scan(&lockedCount)
	if err != nil {
		return err
	}
	if lockedCount > 0 {
		return httperror.New(http.StatusConflict, "parent_requirement_locked", "所属模块已进入评审批次，无法新增需求")
	}

	resolvedParentID := input.createContentParentID
	if input.createContentKind == "module" && input.createContentHeadingDepth.Valid {
		if parent.headingDepth == input.createContentHeadingDepth.Int64-1 {
			resolvedParentID = sql.NullInt64{Int64: parent.id, Valid: true}
		} else if parent.headingDepth == input.createContentHeadingDepth.Int64 {
			resolvedParentID = parent.parentID
		} else {
			resolvedParentID = parent.parentID
		}
	}
	if resolvedParentID.Valid {
		input.resolvedContentParentID = resolvedParentID.Int64
	}
	return nil
}

func (a *Adapter) ensureRequirementCreateContentsUnlocked(ctx context.Context, tx *sql.Tx, contentIDs []int64) error {
	if len(contentIDs) == 0 {
		return nil
	}
	var lockedCount int64
	query := `
		SELECT COUNT(*) AS cnt
		FROM requirement_item_contents ric
		INNER JOIN requirement_contents c ON c.id = ric.content_id
		INNER JOIN requirement_items r ON r.id = ric.requirement_id
		WHERE c.id IN (` + placeholders(len(contentIDs)) + `)
		  AND r.status IN ('in_review', 'baselined', 'change_pending')`
	args := make([]any, 0, len(contentIDs))
	for _, id := range contentIDs {
		args = append(args, id)
	}
	if err := tx.QueryRowContext(ctx, query, args...).Scan(&lockedCount); err != nil {
		return err
	}
	if lockedCount > 0 {
		return httperror.New(http.StatusConflict, "content_requirement_locked", "所选章节已关联评审中的需求，无法重新关联")
	}
	return nil
}

func (a *Adapter) insertRequirementInlineContent(ctx context.Context, tx *sql.Tx, input projectRequirementCreateInput) (int64, error) {
	sortOrder, err := a.nextRequirementContentSortOrder(ctx, tx, input.projectID, sqlNullInt64FromAny(input.resolvedContentParentID))
	if err != nil {
		return 0, err
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO requirement_contents
		 (content_original_id, version_no, version_status, project_id, parent_id, heading_depth,
		  title, content_md, sort_order, status, created_by, updated_by)
		VALUES (NULL, 1, 'draft', ?, ?, ?, ?, ?, ?, 'modified', ?, ?)
	`, input.projectID, input.resolvedContentParentID, input.resolvedContentHeadingDepth, input.title, nullableText(input.createContentMarkdown), sortOrder, input.uid, input.uid)
	if err != nil {
		return 0, err
	}
	contentID, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE requirement_contents SET content_original_id = ? WHERE id = ?", contentID, contentID); err != nil {
		return 0, err
	}
	return contentID, nil
}

func requirementBaselineWorkItemID(ctx context.Context, tx *sql.Tx, projectID int64) (sql.NullInt64, error) {
	var id sql.NullInt64
	err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM work_items
		WHERE project_id = ?
		  AND tier = 'target'
		  AND type = 'requirement'
		ORDER BY (template_key = 'requirement_baseline') DESC,
		         created_at ASC,
		         id ASC
		LIMIT 1
	`, projectID).Scan(&id)
	if err == sql.ErrNoRows {
		return sql.NullInt64{}, nil
	}
	return id, err
}

func positiveInt64List(value any) []int64 {
	rawItems, ok := value.([]any)
	if !ok {
		return nil
	}
	items := make([]int64, 0, len(rawItems))
	for _, raw := range rawItems {
		id, err := parseRequirementContentBodyInt(raw)
		if err == nil && id > 0 {
			items = append(items, id)
		}
	}
	return items
}

func truncateNullableRequirementScopeNote(text string) any {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	runes := []rune(text)
	if len(runes) > 2000 {
		runes = runes[:2000]
	}
	return string(runes)
}

func sqlNullInt64FromAny(value any) sql.NullInt64 {
	switch typed := value.(type) {
	case int64:
		return sql.NullInt64{Int64: typed, Valid: true}
	case int:
		return sql.NullInt64{Int64: int64(typed), Valid: true}
	default:
		return sql.NullInt64{}
	}
}

func isRequirementCreateRetryableErr(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToUpper(fmt.Sprint(err))
	return strings.Contains(text, "ER_LOCK_WAIT_TIMEOUT") ||
		strings.Contains(text, "ER_LOCK_DEADLOCK") ||
		strings.Contains(text, "ER_DUP_ENTRY")
}
