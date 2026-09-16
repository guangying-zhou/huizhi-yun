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

type batchWorkItemRow struct {
	ID               int64
	ProjectID        int64
	ProjectCode      string
	LifecycleStatus  string
	Tier             string
	Type             string
	Status           string
	Priority         string
	AssigneeUID      sql.NullString
	MilestoneID      sql.NullInt64
	SourceTicketCode sql.NullString
}

type workItemBatchChange struct {
	bodyKey string
	column  string
	value   any
}

func (a *Adapter) batchUpdateWorkItems(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		uid = strings.TrimSpace(query.Get("operator_uid"))
	}
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	ids, err := bodyIDList(body, "ids")
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_work_item_ids", "ids 不能为空")
	}
	changesBody := bodyMap(body, "changes")
	if changesBody == nil {
		return nil, httperror.New(http.StatusBadRequest, "missing_changes", "changes 不能为空")
	}
	changes, err := normalizeWorkItemBatchChanges(changesBody)
	if err != nil {
		return nil, err
	}

	items, err := a.batchWorkItemRows(ctx, ids)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, httperror.New(http.StatusNotFound, "work_item_not_found", "工作项不存在")
	}

	projectSeen := map[int64]bool{}
	for _, item := range items {
		if item.MilestoneID.Valid {
			if err := a.requireMilestoneCompletionUnlocked(ctx, item.MilestoneID.Int64); err != nil {
				return nil, err
			}
		}
		if projectSeen[item.ProjectID] {
			continue
		}
		projectSeen[item.ProjectID] = true
		if err := a.requireProjectMemberOrScopedAdmin(ctx, item.ProjectID, uid, query); err != nil {
			return nil, err
		}
		if strings.TrimSpace(item.LifecycleStatus) != "active" {
			return nil, httperror.New(
				http.StatusConflict,
				"project_not_active",
				fmt.Sprintf("项目当前状态（%s）不允许批量修改工作项", item.LifecycleStatus),
			)
		}
	}
	for _, change := range changes {
		if change.bodyKey == "milestoneId" && change.value != nil {
			if milestoneID, ok := change.value.(int64); ok {
				if err := a.requireMilestoneCompletionUnlocked(ctx, milestoneID); err != nil {
					return nil, err
				}
			}
		}
	}

	if statusChange, ok := batchStatusChange(changes); ok {
		for _, item := range items {
			if item.Status == statusChange {
				continue
			}
			valid, err := a.validateWorkItemStatusTransition(ctx, item.ProjectID, item.Tier, item.Status, statusChange)
			if err != nil {
				return nil, err
			}
			if !valid {
				return nil, httperror.New(
					http.StatusBadRequest,
					"invalid_work_item_transition",
					fmt.Sprintf("工作项 #%d 不允许从 %q 转换到 %q", item.ID, item.Status, statusChange),
				)
			}
		}
	}

	if len(changes) == 0 {
		return map[string]any{"updated": 0}, nil
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	setClauses := make([]string, 0, len(changes))
	updateArgs := make([]any, 0, len(changes)+len(items))
	for _, change := range changes {
		setClauses = append(setClauses, change.column+" = ?")
		updateArgs = append(updateArgs, change.value)
	}
	foundIDs := make([]int64, 0, len(items))
	for _, item := range items {
		foundIDs = append(foundIDs, item.ID)
	}
	updateArgs = append(updateArgs, int64SliceArgs(foundIDs)...)
	if _, err := tx.ExecContext(ctx, `
		UPDATE work_items SET `+strings.Join(setClauses, ", ")+`
		WHERE id IN (`+placeholders(len(foundIDs))+`)
	`, updateArgs...); err != nil {
		return nil, err
	}

	changelogArgs := make([]any, 0)
	changelogPlaceholders := make([]string, 0)
	for _, item := range items {
		for _, change := range changes {
			oldText := batchWorkItemOldValue(item, change.bodyKey)
			newText := batchWorkItemNewValue(change.value)
			if nullableTextEqual(oldText, newText) {
				continue
			}
			changelogPlaceholders = append(changelogPlaceholders, "(?, ?, ?, ?, ?)")
			changelogArgs = append(changelogArgs, item.ID, change.bodyKey, nullableStringValue(oldText), nullableStringValue(newText), uid)
		}
	}
	if len(changelogPlaceholders) > 0 {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO work_item_changelog (work_item_id, field_name, old_value, new_value, changed_by)
			VALUES `+strings.Join(changelogPlaceholders, ", "), changelogArgs...); err != nil {
			return nil, err
		}
	}

	if statusChange, ok := batchStatusChange(changes); ok {
		operationBody := batchServiceTicketDeliveryBody(body, statusChange)
		for _, item := range items {
			if !item.SourceTicketCode.Valid || strings.TrimSpace(item.SourceTicketCode.String) == "" {
				continue
			}
			if _, err := a.enqueueServiceTicketDeliveryOperationTx(ctx, tx, strconv.FormatInt(item.ID, 10), operationBody); err != nil {
				return nil, err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"updated": len(items)}, nil
}

func (a *Adapter) batchWorkItemRows(ctx context.Context, ids []int64) ([]batchWorkItemRow, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			wi.id,
			wi.project_id,
			p.project_code,
			p.lifecycle_status,
			wi.tier,
			wi.type,
			wi.status,
			wi.priority,
			wi.assignee_uid,
			wi.milestone_id,
			wse.source_ticket_code
		FROM work_items wi
		JOIN aims_projects p ON p.id = wi.project_id
		LEFT JOIN work_item_service_ext wse ON wse.work_item_id = wi.id
		WHERE wi.id IN (`+placeholders(len(ids))+`)
	`, int64SliceArgs(ids)...)
	if err != nil {
		return nil, fmt.Errorf("query batch work items: %w", err)
	}
	defer rows.Close()

	items := make([]batchWorkItemRow, 0)
	for rows.Next() {
		var item batchWorkItemRow
		if err := rows.Scan(
			&item.ID,
			&item.ProjectID,
			&item.ProjectCode,
			&item.LifecycleStatus,
			&item.Tier,
			&item.Type,
			&item.Status,
			&item.Priority,
			&item.AssigneeUID,
			&item.MilestoneID,
			&item.SourceTicketCode,
		); err != nil {
			return nil, fmt.Errorf("scan batch work item: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

// batchServiceTicketDeliveryBody copies authenticated runtime context from the
// batch request while deriving the delivery status exclusively from the
// normalized batch change. Browser-supplied top-level status must not alter the
// frozen operation command.
func batchServiceTicketDeliveryBody(body map[string]any, status string) map[string]any {
	result := make(map[string]any, len(body)+1)
	for key, value := range body {
		result[key] = value
	}
	result["status"] = status
	return result
}

func normalizeWorkItemBatchChanges(body map[string]any) ([]workItemBatchChange, error) {
	mapping := []struct {
		bodyKey string
		column  string
	}{
		{bodyKey: "status", column: "status"},
		{bodyKey: "priority", column: "priority"},
		{bodyKey: "assigneeUid", column: "assignee_uid"},
		{bodyKey: "milestoneId", column: "milestone_id"},
	}

	changes := make([]workItemBatchChange, 0, len(mapping))
	for _, field := range mapping {
		value, ok := body[field.bodyKey]
		if !ok {
			continue
		}
		normalized, err := normalizeWorkItemBatchValue(field.bodyKey, value)
		if err != nil {
			return nil, err
		}
		changes = append(changes, workItemBatchChange{
			bodyKey: field.bodyKey,
			column:  field.column,
			value:   normalized,
		})
	}
	return changes, nil
}

func normalizeWorkItemBatchValue(field string, value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	if field == "milestoneId" {
		text := strings.TrimSpace(fmt.Sprint(value))
		if text == "" || text == "<nil>" {
			return nil, nil
		}
		id, err := strconv.ParseInt(text, 10, 64)
		if err != nil || id <= 0 {
			return nil, httperror.New(http.StatusBadRequest, "invalid_milestone_id", "milestoneId must be a positive integer")
		}
		return id, nil
	}
	return fmt.Sprint(value), nil
}

func batchStatusChange(changes []workItemBatchChange) (string, bool) {
	for _, change := range changes {
		if change.bodyKey == "status" {
			return strings.TrimSpace(fmt.Sprint(change.value)), true
		}
	}
	return "", false
}

func (a *Adapter) validateWorkItemStatusTransition(ctx context.Context, projectID int64, entityType string, fromStatus string, toStatus string) (bool, error) {
	var ruleID int64
	err := a.DB().QueryRowContext(ctx, `
		SELECT id
		FROM workflow_transitions
		WHERE project_id = ? AND entity_type = ? AND from_status = ? AND to_status = ?
		LIMIT 1
	`, projectID, entityType, fromStatus, toStatus).Scan(&ruleID)
	if err == nil {
		return true, nil
	}
	if err != sql.ErrNoRows {
		return false, err
	}

	err = a.DB().QueryRowContext(ctx, `
		SELECT id
		FROM workflow_transitions
		WHERE project_id = ? AND entity_type = ?
		LIMIT 1
	`, projectID, entityType).Scan(&ruleID)
	if err == nil {
		return false, nil
	}
	if err != sql.ErrNoRows {
		return false, err
	}

	err = a.DB().QueryRowContext(ctx, `
		SELECT id
		FROM workflow_transitions
		WHERE project_id IS NULL AND entity_type = ? AND from_status = ? AND to_status = ?
		LIMIT 1
	`, entityType, fromStatus, toStatus).Scan(&ruleID)
	if err == nil {
		return true, nil
	}
	if err == sql.ErrNoRows {
		return false, nil
	}
	return false, err
}

func batchWorkItemOldValue(item batchWorkItemRow, bodyKey string) *string {
	switch bodyKey {
	case "status":
		value := item.Status
		return &value
	case "priority":
		value := item.Priority
		return &value
	case "assigneeUid":
		if !item.AssigneeUID.Valid {
			return nil
		}
		value := item.AssigneeUID.String
		return &value
	case "milestoneId":
		if !item.MilestoneID.Valid {
			return nil
		}
		value := strconv.FormatInt(item.MilestoneID.Int64, 10)
		return &value
	default:
		return nil
	}
}

func batchWorkItemNewValue(value any) *string {
	if value == nil {
		return nil
	}
	text := fmt.Sprint(value)
	return &text
}

func nullableTextEqual(left *string, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}
