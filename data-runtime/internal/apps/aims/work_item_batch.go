package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
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

	identity, scoped := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	var tx *sql.Tx
	var repo *iop.ReceiptRepository
	var projects []int64
	if scoped {
		seen := map[int64]bool{}
		for _, id := range ids {
			if seen[id] {
				return nil, httperror.New(http.StatusBadRequest, "duplicate_work_item_id", "工作项标识重复")
			}
			seen[id] = true
		}
		if identity.CommandScope == nil || identity.ActorUID != uid {
			return nil, httperror.New(http.StatusForbidden, "enterprise_project_command_scope_invalid", "Batch scope is invalid")
		}
		// Discover only the owning IDs before locking. Recheck every item's owner
		// after locking rows; a concurrent move must fail the whole batch.
		projects, err = a.batchOwningProjects(ctx, ids)
		if err != nil {
			return nil, err
		}
		tx, repo, err = a.beginDeliverableWrite(ctx)
		if err != nil {
			return nil, err
		}
		defer tx.Rollback()
		for _, projectID := range projects {
			if err := requireEnterpriseProjectCommandScopeTx(ctx, tx, identity, strconv.FormatInt(projectID, 10), "", "batch-edit"); err != nil {
				return nil, err
			}
		}
	}
	var items []batchWorkItemRow
	if scoped {
		items, err = a.batchWorkItemRowsFrom(ctx, tx, ids, true)
	} else {
		items, err = a.batchWorkItemRows(ctx, ids)
	}
	if err != nil {
		return nil, err
	}
	if len(items) == 0 || (scoped && len(items) != len(ids)) {
		return nil, httperror.New(http.StatusNotFound, "work_item_not_found", "工作项不存在")
	}
	if scoped {
		allowed := map[int64]bool{}
		for _, projectID := range projects {
			allowed[projectID] = true
		}
		for _, item := range items {
			if !allowed[item.ProjectID] {
				return nil, httperror.New(http.StatusConflict, "work_item_project_changed", "工作项归属已变化")
			}
		}
	}

	if !scoped {
		return a.finishBatchUpdateWorkItems(ctx, tx, scoped, items, changes, uid, query, body)
	}
	seenProjects := map[int64]bool{}
	for _, item := range items {
		if seenProjects[item.ProjectID] {
			continue
		}
		seenProjects[item.ProjectID] = true
		if err := requireBatchProjectMemberOrScopedAdminTx(ctx, tx, item.ProjectID, uid, query); err != nil {
			return nil, err
		}
	}
	write := func(writeCtx context.Context) (map[string]any, error) {
		return a.finishBatchUpdateWorkItems(writeCtx, tx, true, items, changes, uid, query, body)
	}
	var result map[string]any
	if repo == nil {
		result, err = write(ctx)
	} else {
		result, err = executeLegacyWorkItemReceipt(ctx, tx, repo, legacyWorkItemReceiptConfig[map[string]any]{Action: "batch-update", Capability: "aims:work-item-batch:edit", BizType: "work-item-batch", Command: map[string]any{"payload": body}, BizCode: func(value map[string]any) string { return fmt.Sprint(value["updated"]) }, Replay: func(_ context.Context, code string) (map[string]any, error) {
			n, err := strconv.Atoi(code)
			if err != nil {
				return nil, httperror.New(503, "work_item_receipt_corrupt", "Work item receipt is invalid")
			}
			return map[string]any{"updated": n}, nil
		}, Decorate: decorateLegacyWorkItemMap}, write)
	}
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func (a *Adapter) finishBatchUpdateWorkItems(ctx context.Context, tx *sql.Tx, scoped bool, items []batchWorkItemRow, changes []workItemBatchChange, uid string, query url.Values, body map[string]any) (map[string]any, error) {
	var err error
	projectSeen := map[int64]bool{}
	for _, item := range items {
		if item.MilestoneID.Valid {
			var lockErr error
			if scoped {
				lockErr = requireMilestoneCompletionUnlockedTx(ctx, tx, item.MilestoneID.Int64)
			} else {
				lockErr = a.requireMilestoneCompletionUnlocked(ctx, item.MilestoneID.Int64)
			}
			if err := lockErr; err != nil {
				return nil, err
			}
		}
		if projectSeen[item.ProjectID] {
			continue
		}
		projectSeen[item.ProjectID] = true
		var memberErr error
		if scoped {
			memberErr = requireBatchProjectMemberOrScopedAdminTx(ctx, tx, item.ProjectID, uid, query)
		} else {
			memberErr = a.requireProjectMemberOrScopedAdmin(ctx, item.ProjectID, uid, query)
		}
		if err := memberErr; err != nil {
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
				var lockErr error
				if scoped {
					lockErr = requireMilestoneCompletionUnlockedTx(ctx, tx, milestoneID)
				} else {
					lockErr = a.requireMilestoneCompletionUnlocked(ctx, milestoneID)
				}
				if err := lockErr; err != nil {
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
			var valid bool
			if scoped {
				valid, err = validateWorkItemStatusTransitionFrom(ctx, tx, item.ProjectID, item.Tier, item.Status, statusChange)
			} else {
				valid, err = a.validateWorkItemStatusTransition(ctx, item.ProjectID, item.Tier, item.Status, statusChange)
			}
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

	if !scoped {
		tx, err = a.DB().BeginTx(ctx, nil)
		if err != nil {
			return nil, err
		}
		defer tx.Rollback()
	}

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

	if !scoped {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
	}
	return map[string]any{"updated": len(items)}, nil
}

func (a *Adapter) batchWorkItemRows(ctx context.Context, ids []int64) ([]batchWorkItemRow, error) {
	return a.batchWorkItemRowsFrom(ctx, a.DB(), ids, false)
}

type batchQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (a *Adapter) batchOwningProjects(ctx context.Context, ids []int64) ([]int64, error) {
	rows, err := a.DB().QueryContext(ctx, "SELECT DISTINCT project_id FROM work_items WHERE id IN ("+placeholders(len(ids))+") ORDER BY project_id", int64SliceArgs(ids)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	projects := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		projects = append(projects, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Slice(projects, func(i, j int) bool { return projects[i] < projects[j] })
	return projects, nil
}

func requireBatchProjectMemberOrScopedAdminTx(ctx context.Context, tx *sql.Tx, projectID int64, uid string, query url.Values) error {
	if hasProjectAdminFlag(query) {
		return nil
	}
	adminWhere, adminArgs := projectScopedAdminWhere(query, "p")
	args := append([]any{uid, projectID, uid}, adminArgs...)
	var count int64
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM aims_projects p LEFT JOIN aims_project_members pm ON pm.project_id=p.id AND pm.uid=? AND COALESCE(pm.status,'active')='active' WHERE p.id=? AND (p.leader_uid=? OR pm.id IS NOT NULL OR `+adminWhere+`)`, args...).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return httperror.New(http.StatusForbidden, "project_member_required", "project member access required")
	}
	return nil
}

func (a *Adapter) batchWorkItemRowsFrom(ctx context.Context, q batchQueryer, ids []int64, lock bool) ([]batchWorkItemRow, error) {
	suffix := ""
	if lock {
		suffix = " ORDER BY wi.id FOR UPDATE"
	}
	rows, err := q.QueryContext(ctx, `
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
		WHERE wi.id IN (`+placeholders(len(ids))+`)`+suffix, int64SliceArgs(ids)...)
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
	return validateWorkItemStatusTransitionFrom(ctx, a.DB(), projectID, entityType, fromStatus, toStatus)
}

func validateWorkItemStatusTransitionFrom(ctx context.Context, q batchQueryer, projectID int64, entityType string, fromStatus string, toStatus string) (bool, error) {
	var ruleID int64
	err := q.QueryRowContext(ctx, `
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

	err = q.QueryRowContext(ctx, `
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

	err = q.QueryRowContext(ctx, `
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
