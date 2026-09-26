package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type deliverableBatchOwnerKind string

const (
	deliverableOwnerProject   deliverableBatchOwnerKind = "project"
	deliverableOwnerMilestone deliverableBatchOwnerKind = "milestone"
	deliverableOwnerTarget    deliverableBatchOwnerKind = "target"
	deliverableOwnerMatter    deliverableBatchOwnerKind = "matter"
)

type deliverableBatchProjectContext struct {
	ProjectID   int64
	ProjectCode sql.NullString
}

type deliverableBatchRow struct {
	OwnerKind        deliverableBatchOwnerKind
	OwnerID          int64
	ProjectOwnerID   any
	MilestoneOwnerID any
	TargetID         any
	MatterID         any
	Name             string
	Description      any
	Acceptance       any
	DeliverableType  string
	Required         int
	SortOrder        int64
	ProjectID        int64
	ProjectCode      any
	CreatedBy        string
	TemplateKey      any
}

func (a *Adapter) createDeliverablesBatch(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		uid = strings.TrimSpace(query.Get("operator_uid"))
	}
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	rawItems, ok := body["items"].([]any)
	if !ok || len(rawItems) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "items_required", "items 不能为空")
	}

	rows := make([]deliverableBatchRow, 0, len(rawItems))
	authorizedProjects := make(map[int64]bool)
	for _, raw := range rawItems {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		row, err := a.deliverableBatchRow(ctx, item, uid)
		if err != nil {
			return nil, err
		}
		if row == nil {
			continue
		}
		if row.MilestoneOwnerID != nil {
			if milestoneID, ok := row.MilestoneOwnerID.(int64); ok {
				if err := a.requireMilestoneCompletionUnlocked(ctx, milestoneID); err != nil {
					return nil, err
				}
			}
		}
		for _, owner := range []any{row.TargetID, row.MatterID} {
			if workItemID, ok := owner.(int64); ok {
				if err := a.requireWorkItemMilestoneCompletionUnlocked(ctx, workItemID); err != nil {
					return nil, err
				}
			}
		}
		if !authorizedProjects[row.ProjectID] {
			if err := a.requireProjectManagerOrScopedAdmin(ctx, row.ProjectID, uid, query); err != nil {
				return nil, err
			}
			authorizedProjects[row.ProjectID] = true
		}
		rows = append(rows, *row)
	}

	if len(rows) == 0 {
		return map[string]any{"created": 0}, nil
	}
	if err := ensureDistinctDeliverableBatchRows(rows); err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := lockDeliverableBatchProjects(ctx, tx, rows); err != nil {
		return nil, err
	}
	for _, row := range rows {
		if row.OwnerKind == deliverableOwnerMatter {
			if err := lockMatterDeliverableWriteTx(ctx, tx, row.ProjectID, row.OwnerID); err != nil {
				return nil, err
			}
		}
	}
	for _, row := range rows {
		if err := ensureDeliverableBatchNameAvailable(ctx, tx, row); err != nil {
			return nil, err
		}
	}

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO deliverables
			(project_owner_id, milestone_owner_id, target_id, matter_id,
			 name, description, acceptance_criteria, deliverable_type, `+"`required`"+`, sort_order,
			 status, project_id, project_code, created_by, template_key)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
	`)
	if err != nil {
		return nil, err
	}
	defer stmt.Close()

	for _, row := range rows {
		if _, err := stmt.ExecContext(ctx,
			row.ProjectOwnerID,
			row.MilestoneOwnerID,
			row.TargetID,
			row.MatterID,
			row.Name,
			row.Description,
			row.Acceptance,
			row.DeliverableType,
			row.Required,
			row.SortOrder,
			row.ProjectID,
			row.ProjectCode,
			row.CreatedBy,
			row.TemplateKey,
		); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{"created": len(rows)}, nil
}

func (a *Adapter) deliverableBatchRow(ctx context.Context, item map[string]any, uid string) (*deliverableBatchRow, error) {
	entityType := firstBodyText(item, "entityType", "entity_type")
	name := strings.TrimSpace(firstBodyText(item, "name"))
	if entityType == "" || name == "" {
		return nil, nil
	}
	entityID, err := bodyInt64(item, "entityId", "entity_id")
	if err != nil || entityID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_entity_id", "无效的实体ID")
	}
	kind, err := normalizeDeliverableBatchOwnerKind(entityType)
	if err != nil {
		return nil, err
	}
	if entityType == "work_item" || entityType == "task" {
		if err := a.requireDeliverableBatchTargetTier(ctx, entityID); err != nil {
			return nil, err
		}
	}

	projectContext, err := a.resolveDeliverableBatchProjectContext(ctx, kind, entityID)
	if err != nil {
		return nil, err
	}
	if projectContext.ProjectID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "project_context_required", "无法解析交付物所属项目: "+entityType)
	}

	required := 1
	if hasAnyBodyKey(item, "required") && !truthyBodyValue(item["required"]) {
		required = 0
	}
	sortOrder, err := bodyInt64(item, "sortOrder", "sort_order")
	if err != nil {
		sortOrder = 0
	}

	row := &deliverableBatchRow{
		OwnerKind:        kind,
		OwnerID:          entityID,
		ProjectOwnerID:   nil,
		MilestoneOwnerID: nil,
		TargetID:         nil,
		MatterID:         nil,
		Name:             name,
		Description:      nullableText(firstBodyText(item, "description")),
		Acceptance:       nullableText(firstBodyText(item, "acceptanceCriteria", "acceptance_criteria")),
		DeliverableType:  firstNonEmpty(firstBodyText(item, "deliverableType", "deliverable_type"), "document"),
		Required:         required,
		SortOrder:        sortOrder,
		ProjectID:        projectContext.ProjectID,
		ProjectCode:      nullableText(projectContext.ProjectCode.String),
		CreatedBy:        uid,
		TemplateKey:      nullableText(firstBodyText(item, "templateKey", "template_key")),
	}
	switch kind {
	case deliverableOwnerProject:
		row.ProjectOwnerID = entityID
	case deliverableOwnerMilestone:
		row.MilestoneOwnerID = entityID
	case deliverableOwnerTarget:
		row.TargetID = entityID
	case deliverableOwnerMatter:
		row.MatterID = entityID
	}
	return row, nil
}

func ensureDistinctDeliverableBatchRows(rows []deliverableBatchRow) error {
	seen := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		key := fmt.Sprintf("%d:%s:%d:%s", row.ProjectID, row.OwnerKind, row.OwnerID, strings.ToLower(strings.TrimSpace(row.Name)))
		if _, exists := seen[key]; exists {
			return deliverableNameConflict(row.Name)
		}
		seen[key] = struct{}{}
	}
	return nil
}

func lockDeliverableBatchProjects(ctx context.Context, tx *sql.Tx, rows []deliverableBatchRow) error {
	projectSet := make(map[int64]struct{}, len(rows))
	for _, row := range rows {
		projectSet[row.ProjectID] = struct{}{}
	}
	projectIDs := make([]int64, 0, len(projectSet))
	for projectID := range projectSet {
		projectIDs = append(projectIDs, projectID)
	}
	sort.Slice(projectIDs, func(i, j int) bool { return projectIDs[i] < projectIDs[j] })
	for _, projectID := range projectIDs {
		var lockedID int64
		if err := tx.QueryRowContext(ctx, "SELECT id FROM aims_projects WHERE id = ? FOR UPDATE", projectID).Scan(&lockedID); err != nil {
			return err
		}
	}
	return nil
}

func ensureDeliverableBatchNameAvailable(ctx context.Context, tx *sql.Tx, row deliverableBatchRow) error {
	condition := ""
	switch row.OwnerKind {
	case deliverableOwnerProject:
		condition = "project_owner_id = ?"
	case deliverableOwnerMilestone:
		condition = "milestone_owner_id = ?"
	case deliverableOwnerTarget:
		condition = "target_id = ?"
	case deliverableOwnerMatter:
		condition = "matter_id = ? AND target_id IS NULL"
	default:
		return httperror.New(http.StatusBadRequest, "unsupported_entity_type", "不支持的成果归属")
	}

	var existingID int64
	err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM deliverables
		WHERE project_id = ?
		  AND LOWER(TRIM(name)) = LOWER(?)
		  AND `+condition+`
		LIMIT 1
	`, row.ProjectID, strings.TrimSpace(row.Name), row.OwnerID).Scan(&existingID)
	if err == nil {
		return deliverableNameConflict(row.Name)
	}
	if err != sql.ErrNoRows {
		return err
	}
	return nil
}

func deliverableNameConflict(name string) error {
	return httperror.New(
		http.StatusConflict,
		"deliverable_name_conflict",
		"同一归属下已存在同名成果："+strings.TrimSpace(name),
	)
}

func normalizeDeliverableBatchOwnerKind(entityType string) (deliverableBatchOwnerKind, error) {
	switch strings.TrimSpace(entityType) {
	case "project":
		return deliverableOwnerProject, nil
	case "milestone":
		return deliverableOwnerMilestone, nil
	case "target":
		return deliverableOwnerTarget, nil
	case "matter":
		return deliverableOwnerMatter, nil
	case "task", "work_item":
		return deliverableOwnerTarget, nil
	default:
		return "", httperror.New(http.StatusBadRequest, "unsupported_entity_type", "不支持的 entityType: "+entityType)
	}
}

func (a *Adapter) requireDeliverableBatchTargetTier(ctx context.Context, entityID int64) error {
	var tier string
	err := a.DB().QueryRowContext(ctx, "SELECT tier FROM work_items WHERE id = ?", entityID).Scan(&tier)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusNotFound, "work_item_not_found", "工作项不存在")
	}
	if err != nil {
		return err
	}
	if strings.TrimSpace(tier) != "target" {
		return httperror.New(http.StatusBadRequest, "work_item_not_target", "work_item 不是目标层，中间产物请通过任务分解接口创建")
	}
	return nil
}

func (a *Adapter) resolveDeliverableBatchProjectContext(ctx context.Context, kind deliverableBatchOwnerKind, entityID int64) (deliverableBatchProjectContext, error) {
	var contextRow deliverableBatchProjectContext
	var err error
	switch kind {
	case deliverableOwnerProject:
		err = a.DB().QueryRowContext(ctx, "SELECT id, project_code FROM aims_projects WHERE id = ?", entityID).Scan(&contextRow.ProjectID, &contextRow.ProjectCode)
	case deliverableOwnerMilestone:
		err = a.DB().QueryRowContext(ctx, `
			SELECT m.project_id, p.project_code
			FROM milestones m
			JOIN aims_projects p ON p.id = m.project_id
			WHERE m.id = ?
		`, entityID).Scan(&contextRow.ProjectID, &contextRow.ProjectCode)
	case deliverableOwnerTarget, deliverableOwnerMatter:
		err = a.DB().QueryRowContext(ctx, `
			SELECT wi.project_id, p.project_code
			FROM work_items wi
			JOIN aims_projects p ON p.id = wi.project_id
			WHERE wi.id = ?
		`, entityID).Scan(&contextRow.ProjectID, &contextRow.ProjectCode)
	default:
		return contextRow, httperror.New(http.StatusBadRequest, "unsupported_entity_type", "unsupported entity type")
	}
	if err == sql.ErrNoRows {
		return contextRow, httperror.New(http.StatusNotFound, "deliverable_owner_not_found", "交付物归属对象不存在")
	}
	return contextRow, err
}

func truthyBodyValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case int:
		return typed != 0
	case int64:
		return typed != 0
	case float64:
		return typed != 0
	case string:
		text := strings.ToLower(strings.TrimSpace(typed))
		return text != "" && text != "0" && text != "false" && text != "no"
	default:
		return value != nil
	}
}
