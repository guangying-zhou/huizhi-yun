package aims

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Port of aims/server/api/v1/work-items/[id]/{breakdown.put,append-tasks,confirm-append,
// reject-append,confirm-distribute,revoke-distribute}.post.ts
// 任务分解/追加/分发确认链路。
//
// 归属模型（target_id / matter_id 拆分）：
//   - 目标成果行（target_id=T, matter_id=null）被 subtask 承接时 UPDATE matter_id 共用同一行
//   - subtask 自有中间产物 INSERT 新行（target_id=null, matter_id=M）

var projectReadonlyReason = map[string]string{
	"draft":            "项目尚未立项，需完成立项审批后方可执行此操作",
	"approval_pending": "项目立项审批中，请等待审批通过",
	"paused":           "项目已暂停，恢复后可继续操作",
	"completed":        "项目已完成",
	"archived":         "项目已归档",
}

// assertProjectActiveByWorkItem 通过工作项反查项目并断言 active。
func (a *Adapter) assertProjectActiveByWorkItem(ctx context.Context, workItemID int64) error {
	var status string
	err := a.DB().QueryRowContext(ctx, `
		SELECT p.lifecycle_status
		FROM work_items wi
		JOIN aims_projects p ON p.id = wi.project_id
		WHERE wi.id = ?`, workItemID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return httperror.New(http.StatusNotFound, "work_item_not_found", "工作项或其所属项目不存在")
	}
	if err != nil {
		return err
	}
	if status != "active" {
		reason := projectReadonlyReason[status]
		if reason == "" {
			reason = "项目当前状态不允许此操作"
		}
		return httperror.New(http.StatusConflict, "project_not_active", reason)
	}
	return nil
}

var (
	startDateColumnOnce   sync.Once
	startDateColumnExists bool
	startDateColumnErr    error
)

func (a *Adapter) hasWorkItemStartDateColumn(ctx context.Context) (bool, error) {
	startDateColumnOnce.Do(func() {
		var count int64
		startDateColumnErr = a.DB().QueryRowContext(ctx, `
			SELECT COUNT(*)
			FROM information_schema.COLUMNS
			WHERE TABLE_SCHEMA = DATABASE()
			  AND TABLE_NAME = 'work_items'
			  AND COLUMN_NAME = 'start_date'`).Scan(&count)
		startDateColumnExists = count > 0
	})
	return startDateColumnExists, startDateColumnErr
}

var distributionDatePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func normalizeDistributionDate(value any) *string {
	if value == nil {
		return nil
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" {
		return nil
	}
	if len(text) > 10 {
		text = text[:10]
	}
	if !distributionDatePattern.MatchString(text) {
		return nil
	}
	return &text
}

func normalizeDistributionText(value any) *string {
	text, ok := value.(string)
	if !ok {
		return nil
	}
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func normalizeDistributionHours(value any) (*float64, error) {
	if value == nil {
		return nil, nil
	}
	var num float64
	switch typed := value.(type) {
	case float64:
		num = typed
	case int64:
		num = float64(typed)
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil, nil
		}
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if err != nil {
			return nil, httperror.New(http.StatusBadRequest, "invalid_hours", "预计工时必须为非负数")
		}
		num = parsed
	default:
		return nil, httperror.New(http.StatusBadRequest, "invalid_hours", "预计工时必须为非负数")
	}
	if math.IsNaN(num) || math.IsInf(num, 0) || num < 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_hours", "预计工时必须为非负数")
	}
	rounded := math.Round(num*100) / 100
	return &rounded, nil
}

// YYYY-MM-DD 字符串可直接按字典序比较
func assertDistributionRange(startDate, dueDate *string, label string) error {
	if startDate == nil || dueDate == nil {
		return httperror.New(http.StatusBadRequest, "date_range_required", label+"必须同时填写开始日期和结束日期")
	}
	if strings.Compare(*startDate, *dueDate) > 0 {
		return httperror.New(http.StatusBadRequest, "date_range_invalid", label+"开始日期不能晚于结束日期")
	}
	return nil
}

type distributionTargetRow struct {
	id                 int64
	projectID          int64
	projectCode        string
	milestoneID        int64
	itemKey            string
	title              string
	priority           string
	status             string
	tier               string
	itemType           string
	startDate          *string
	dueDate            *string
	estimatedHours     *float64
	milestoneStartDate *string
	milestoneEndDate   *string
}

func (a *Adapter) loadDistributionTarget(ctx context.Context, workItemID int64, supportsStartDate bool) (distributionTargetRow, error) {
	startDateExpr := "NULL"
	if supportsStartDate {
		startDateExpr = "DATE_FORMAT(wi.start_date, '%Y-%m-%d')"
	}

	var row distributionTargetRow
	var estimatedHours sql.NullFloat64
	err := a.DB().QueryRowContext(ctx, `
		SELECT
		    wi.id, wi.project_id, p.project_code, wi.milestone_id, wi.item_key,
		    wi.title, wi.priority, wi.status, wi.tier, wi.type,
		    `+startDateExpr+`,
		    DATE_FORMAT(wi.due_date, '%Y-%m-%d'),
		    wi.estimated_hours,
		    DATE_FORMAT(m.start_date, '%Y-%m-%d'),
		    DATE_FORMAT(m.end_date, '%Y-%m-%d')
		FROM work_items wi
		JOIN aims_projects p ON p.id = wi.project_id
		JOIN milestones m ON m.id = wi.milestone_id
		WHERE wi.id = ?`, workItemID).
		Scan(&row.id, &row.projectID, &row.projectCode, &row.milestoneID, &row.itemKey,
			&row.title, &row.priority, &row.status, &row.tier, &row.itemType,
			&row.startDate, &row.dueDate, &estimatedHours,
			&row.milestoneStartDate, &row.milestoneEndDate)
	if errors.Is(err, sql.ErrNoRows) {
		return row, httperror.New(http.StatusNotFound, "work_item_not_found", "工作项不存在")
	}
	if err != nil {
		return row, err
	}
	if estimatedHours.Valid {
		row.estimatedHours = &estimatedHours.Float64
	}
	return row, nil
}

type distributionDeliverable struct {
	id                  *int64
	name                string
	description         *string
	acceptanceCriteria  *string
	deliverableType     string
	sourceDeliverableID *int64
}

type distributionSubtask struct {
	id             *int64
	assigneeUID    string
	title          string
	description    *string
	startDate      *string
	dueDate        *string
	estimatedHours *float64
	deliverables   []distributionDeliverable
}

func bodyOptionalInt64(value any) *int64 {
	switch typed := value.(type) {
	case float64:
		if typed > 0 {
			id := int64(typed)
			return &id
		}
	case int64:
		if typed > 0 {
			return &typed
		}
	case string:
		if parsed, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64); err == nil && parsed > 0 {
			return &parsed
		}
	}
	return nil
}

// parseDistributionSubtasks 归一化与校验 subtasks payload。
// label 形如「任务」或「追加任务」；requireSource=false 时 sourceDeliverableId 被忽略。
func parseDistributionSubtasks(
	body map[string]any,
	item distributionTargetRow,
	label string,
	allowSource bool,
	targetDeliverableIDs map[int64]bool,
) ([]distributionSubtask, error) {
	rawSubtasks, _ := body["subtasks"].([]any)
	parentStartDate := item.startDate
	if parentStartDate == nil {
		parentStartDate = item.milestoneStartDate
	}
	parentDueDate := item.dueDate
	if parentDueDate == nil {
		parentDueDate = item.milestoneEndDate
	}

	subtasks := make([]distributionSubtask, 0, len(rawSubtasks))
	for index, raw := range rawSubtasks {
		subtaskMap, _ := raw.(map[string]any)
		if subtaskMap == nil {
			subtaskMap = map[string]any{}
		}
		rowLabel := fmt.Sprintf("%s %d", label, index+1)

		assigneeUID := normalizeDistributionText(subtaskMap["assigneeUid"])
		if assigneeUID == nil {
			return nil, httperror.New(http.StatusBadRequest, "assignee_required", rowLabel+" 缺少负责人")
		}

		title := item.title
		if value := normalizeDistributionText(subtaskMap["title"]); value != nil {
			title = *value
		}
		description := normalizeDistributionText(subtaskMap["description"])

		startDate := normalizeDistributionDate(subtaskMap["startDate"])
		if startDate == nil {
			startDate = parentStartDate
		}
		dueDate := normalizeDistributionDate(subtaskMap["dueDate"])
		if dueDate == nil {
			dueDate = parentDueDate
		}
		if err := assertDistributionRange(startDate, dueDate, rowLabel); err != nil {
			return nil, err
		}
		if parentStartDate != nil && parentDueDate != nil && startDate != nil && dueDate != nil {
			if strings.Compare(*startDate, *parentStartDate) < 0 || strings.Compare(*dueDate, *parentDueDate) > 0 {
				return nil, httperror.New(http.StatusBadRequest, "date_out_of_range", rowLabel+" 日期不能超出目标范围")
			}
		}

		estimatedHours, err := normalizeDistributionHours(subtaskMap["estimatedHours"])
		if err != nil {
			return nil, err
		}

		rawDeliverables, _ := subtaskMap["deliverables"].([]any)
		if len(rawDeliverables) == 0 {
			return nil, httperror.New(http.StatusBadRequest, "deliverables_required", rowLabel+" 至少需要 1 条成果")
		}
		deliverables := make([]distributionDeliverable, 0, len(rawDeliverables))
		for dIndex, rawDeliverable := range rawDeliverables {
			deliverableMap, _ := rawDeliverable.(map[string]any)
			if deliverableMap == nil {
				deliverableMap = map[string]any{}
			}
			name := normalizeDistributionText(deliverableMap["name"])
			if name == nil {
				return nil, httperror.New(http.StatusBadRequest, "deliverable_name_required",
					fmt.Sprintf("%s 的第 %d 条成果缺少名称", rowLabel, dIndex+1))
			}
			deliverableType := "document"
			if value := normalizeDistributionText(deliverableMap["deliverableType"]); value != nil {
				deliverableType = *value
			}

			deliverable := distributionDeliverable{
				id:                 bodyOptionalInt64(deliverableMap["id"]),
				name:               *name,
				description:        normalizeDistributionText(deliverableMap["description"]),
				acceptanceCriteria: normalizeDistributionText(deliverableMap["acceptanceCriteria"]),
				deliverableType:    deliverableType,
			}
			if allowSource {
				deliverable.sourceDeliverableID = bodyOptionalInt64(deliverableMap["sourceDeliverableId"])
				if deliverable.sourceDeliverableID != nil && !targetDeliverableIDs[*deliverable.sourceDeliverableID] {
					return nil, httperror.New(http.StatusBadRequest, "invalid_source_deliverable",
						rowLabel+" 的成果引用了不存在的目标成果")
				}
			}
			deliverables = append(deliverables, deliverable)
		}

		subtasks = append(subtasks, distributionSubtask{
			id:             bodyOptionalInt64(subtaskMap["id"]),
			assigneeUID:    *assigneeUID,
			title:          title,
			description:    description,
			startDate:      startDate,
			dueDate:        dueDate,
			estimatedHours: estimatedHours,
			deliverables:   deliverables,
		})
	}
	return subtasks, nil
}

func nullableDistributionString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableDistributionFloat(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}

func insertDistributionChild(
	ctx context.Context,
	tx *sql.Tx,
	item distributionTargetRow,
	subtask distributionSubtask,
	uid string,
	parentID int64,
	supportsStartDate bool,
) (int64, error) {
	itemNumber, err := nextDecomposeItemNumber(ctx, tx, item.projectID)
	if err != nil {
		return 0, err
	}
	itemKey, err := nextDecomposeChildItemKey(ctx, tx, item.itemKey)
	if err != nil {
		return 0, err
	}

	startDateColumn := ""
	startDatePlaceholder := ""
	args := []any{
		item.projectID, item.milestoneID, itemNumber, itemKey,
		subtask.title, nullableDistributionString(subtask.description),
	}
	if supportsStartDate {
		startDateColumn = "start_date,"
		startDatePlaceholder = "?, "
		args = append(args, nullableDistributionString(subtask.startDate))
	}
	args = append(args,
		item.priority, subtask.assigneeUID, uid,
		nullableDistributionString(subtask.dueDate), nullableDistributionFloat(subtask.estimatedHours), parentID,
	)

	result, err := tx.ExecContext(ctx, `
		INSERT INTO work_items
		  (project_id, milestone_id, item_number, item_key, tier, type, title, description,
		   `+startDateColumn+`
		   status, priority, severity, weight, assignee_uid, reporter_uid,
		   due_date, estimated_hours, parent_id, sort_order)
		VALUES (?, ?, ?, ?, 'matter', 'task', ?, ?, `+startDatePlaceholder+`'planning', ?, NULL, 1, ?, ?, ?, ?, ?, 0)`,
		args...)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func insertOwnDeliverable(
	ctx context.Context,
	tx *sql.Tx,
	item distributionTargetRow,
	matterID int64,
	deliverable distributionDeliverable,
	sortOrder int,
	uid string,
) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO deliverables
		  (project_owner_id, milestone_owner_id, target_id, matter_id,
		   name, description, acceptance_criteria, deliverable_type, `+"`required`"+`, sort_order,
		   status, project_id, project_code, created_by)
		VALUES (NULL, NULL, NULL, ?, ?, ?, ?, ?, 1, ?, 'pending', ?, ?, ?)`,
		matterID, deliverable.name,
		nullableDistributionString(deliverable.description),
		nullableDistributionString(deliverable.acceptanceCriteria),
		deliverable.deliverableType, sortOrder,
		item.projectID, item.projectCode, uid)
	return err
}

// appendWorkItemTasks 保存"追加任务"草稿（target 执行中追加，保存为 planning 待审批）。
func (a *Adapter) appendWorkItemTasks(ctx context.Context, rawWorkItemID string, query url.Values, body map[string]any) (map[string]any, error) {
	uid, err := requireReviewActionUser(query)
	if err != nil {
		return nil, err
	}
	workItemID, err := parseDistributionWorkItemID(rawWorkItemID)
	if err != nil {
		return nil, err
	}
	if err := a.assertProjectActiveByWorkItem(ctx, workItemID); err != nil {
		return nil, err
	}

	rawSubtasks, _ := body["subtasks"].([]any)
	if len(rawSubtasks) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "subtasks_required", "至少需要 1 个追加任务")
	}

	supportsStartDate, err := a.hasWorkItemStartDateColumn(ctx)
	if err != nil {
		return nil, err
	}

	item, err := a.loadDistributionTarget(ctx, workItemID, supportsStartDate)
	if err != nil {
		return nil, err
	}
	if item.tier != "target" {
		return nil, httperror.New(http.StatusConflict, "not_target", "仅目标（target）层支持追加任务")
	}
	if item.itemType == "requirement" {
		return nil, httperror.New(http.StatusConflict, "requirement_flow", "需求工作项不走该流程")
	}
	if !containsString([]string{"in_progress", "in_review", "completed"}, item.status) {
		return nil, httperror.New(http.StatusConflict, "target_not_executing", "目标尚未进入执行阶段，不支持追加任务")
	}

	subtasks, err := parseDistributionSubtasks(body, item, "追加任务", false, nil)
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// 清理本 target 下已有的 planning 态追加草稿（避免重复提交产生垃圾）
	planningIDs, err := planningChildIDs(ctx, tx, workItemID)
	if err != nil {
		return nil, err
	}
	for _, childID := range planningIDs {
		// 追加草稿的成果都是自有（target_id IS NULL），随 matter 删除时需要显式清理
		if _, err := tx.ExecContext(ctx, "DELETE FROM deliverables WHERE matter_id = ? AND target_id IS NULL", childID); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM work_items WHERE id = ?", childID); err != nil {
			return nil, err
		}
	}

	createdIDs := make([]int64, 0, len(subtasks))
	for _, subtask := range subtasks {
		childID, err := insertDistributionChild(ctx, tx, item, subtask, uid, workItemID, supportsStartDate)
		if err != nil {
			return nil, err
		}
		createdIDs = append(createdIDs, childID)
		for index, deliverable := range subtask.deliverables {
			if err := insertOwnDeliverable(ctx, tx, item, childID, deliverable, index, uid); err != nil {
				return nil, err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "createdIds": createdIDs}, nil
}

func parseDistributionWorkItemID(raw string) (int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || id <= 0 {
		return 0, httperror.New(http.StatusBadRequest, "invalid_work_item_id", "无效的工作项ID")
	}
	return id, nil
}

func planningChildIDs(ctx context.Context, tx *sql.Tx, targetID int64) ([]int64, error) {
	rows, err := tx.QueryContext(ctx,
		"SELECT id FROM work_items WHERE parent_id = ? AND tier = 'matter' AND status = 'planning'", targetID)
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

type distributionTargetBrief struct {
	id        int64
	projectID int64
	tier      string
	itemType  string
	status    string
}

func (a *Adapter) loadDistributionTargetBrief(ctx context.Context, targetID int64) (distributionTargetBrief, error) {
	var brief distributionTargetBrief
	err := a.DB().QueryRowContext(ctx,
		"SELECT id, project_id, tier, type, status FROM work_items WHERE id = ?", targetID).
		Scan(&brief.id, &brief.projectID, &brief.tier, &brief.itemType, &brief.status)
	if errors.Is(err, sql.ErrNoRows) {
		return brief, httperror.New(http.StatusNotFound, "target_not_found", "目标不存在")
	}
	return brief, err
}

// confirmAppendWorkItems 确认追加任务（审批通过回调）：planning 态追加子任务置为 todo。
func (a *Adapter) confirmAppendWorkItems(ctx context.Context, rawTargetID string, query url.Values) (map[string]any, error) {
	if _, err := requireReviewActionUser(query); err != nil {
		return nil, err
	}
	targetID, err := parseDistributionTargetID(rawTargetID)
	if err != nil {
		return nil, err
	}
	if err := a.assertProjectActiveByWorkItem(ctx, targetID); err != nil {
		return nil, err
	}
	target, err := a.loadDistributionTargetBrief(ctx, targetID)
	if err != nil {
		return nil, err
	}
	if target.tier != "target" {
		return nil, httperror.New(http.StatusConflict, "not_target", "仅 target 层工作项支持此操作")
	}
	if target.itemType == "requirement" {
		return nil, httperror.New(http.StatusConflict, "requirement_flow", "需求工作项请走需求评审流程")
	}

	var planningCount int64
	if err := a.DB().QueryRowContext(ctx,
		"SELECT COUNT(*) FROM work_items WHERE parent_id = ? AND tier = 'matter' AND status = 'planning'",
		targetID).Scan(&planningCount); err != nil {
		return nil, err
	}
	if planningCount == 0 {
		return nil, httperror.New(http.StatusConflict, "no_planning_children", "没有待确认的追加任务")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx,
		"UPDATE work_items SET status = 'todo' WHERE parent_id = ? AND tier = 'matter' AND status = 'planning'",
		targetID)
	if err != nil {
		return nil, err
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"targetId": targetID, "mattersUpdated": updated}, nil
}

func parseDistributionTargetID(raw string) (int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || id <= 0 {
		return 0, httperror.New(http.StatusBadRequest, "invalid_target_id", "无效的目标ID")
	}
	return id, nil
}

// rejectAppendWorkItems 拒绝追加任务（审批拒绝回调）：清理 planning 态追加草稿。
func (a *Adapter) rejectAppendWorkItems(ctx context.Context, rawTargetID string, query url.Values) (map[string]any, error) {
	if _, err := requireReviewActionUser(query); err != nil {
		return nil, err
	}
	targetID, err := parseDistributionTargetID(rawTargetID)
	if err != nil {
		return nil, err
	}
	if err := a.assertProjectActiveByWorkItem(ctx, targetID); err != nil {
		return nil, err
	}
	target, err := a.loadDistributionTargetBrief(ctx, targetID)
	if err != nil {
		return nil, err
	}
	if target.tier != "target" {
		return nil, httperror.New(http.StatusConflict, "not_target", "仅 target 层工作项支持此操作")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	planningIDs, err := planningChildIDs(ctx, tx, targetID)
	if err != nil {
		return nil, err
	}
	if len(planningIDs) == 0 {
		return map[string]any{"targetId": targetID, "removed": 0}, nil
	}

	var removed int64
	for _, childID := range planningIDs {
		if _, err := tx.ExecContext(ctx, "DELETE FROM deliverables WHERE matter_id = ? AND target_id IS NULL", childID); err != nil {
			return nil, err
		}
		result, err := tx.ExecContext(ctx, "DELETE FROM work_items WHERE id = ?", childID)
		if err != nil {
			return nil, err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return nil, err
		}
		removed += affected
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"targetId": targetID, "removed": removed}, nil
}

// confirmDistributeWorkItems 确认任务分配：所有 planning 态 matter 置为 todo。
func (a *Adapter) confirmDistributeWorkItems(ctx context.Context, rawTargetID string, query url.Values) (map[string]any, error) {
	if _, err := requireReviewActionUser(query); err != nil {
		return nil, err
	}
	targetID, err := parseDistributionTargetID(rawTargetID)
	if err != nil {
		return nil, err
	}
	if err := a.assertProjectActiveByWorkItem(ctx, targetID); err != nil {
		return nil, err
	}
	target, err := a.loadDistributionTargetBrief(ctx, targetID)
	if err != nil {
		return nil, err
	}
	if target.tier != "target" {
		return nil, httperror.New(http.StatusConflict, "not_target", "仅 target 层工作项支持此操作")
	}
	if target.itemType == "requirement" {
		return nil, httperror.New(http.StatusConflict, "requirement_flow", "需求工作项请走需求评审流程")
	}

	// 校验：所有子 matter 必须都在 planning 态（一致性要求，且必须有子任务）
	var total, nonPlanning int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(SUM(status <> 'planning'), 0)
		FROM work_items WHERE parent_id = ? AND tier = 'matter'`, targetID).
		Scan(&total, &nonPlanning); err != nil {
		return nil, err
	}
	if total == 0 {
		return nil, httperror.New(http.StatusConflict, "no_children", "尚未分配任何任务，无法确认分配")
	}
	if nonPlanning > 0 {
		return nil, httperror.New(http.StatusConflict, "children_locked",
			fmt.Sprintf("存在 %d 个非规划态的子任务，任务分配已在生效中", nonPlanning))
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// 批量将 planning 态 matter 置为 todo；target 自身状态由其执行流程决定，不在此处变更
	result, err := tx.ExecContext(ctx,
		"UPDATE work_items SET status = 'todo' WHERE parent_id = ? AND tier = 'matter' AND status = 'planning'",
		targetID)
	if err != nil {
		return nil, err
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"targetId": targetID, "mattersUpdated": updated}, nil
}

// revokeDistributeWorkItems 撤回任务分配：todo 态 matter 回 planning（严格模式）。
func (a *Adapter) revokeDistributeWorkItems(ctx context.Context, rawTargetID string, query url.Values) (map[string]any, error) {
	if _, err := requireReviewActionUser(query); err != nil {
		return nil, err
	}
	targetID, err := parseDistributionTargetID(rawTargetID)
	if err != nil {
		return nil, err
	}
	if err := a.assertProjectActiveByWorkItem(ctx, targetID); err != nil {
		return nil, err
	}
	target, err := a.loadDistributionTargetBrief(ctx, targetID)
	if err != nil {
		return nil, err
	}
	if target.tier != "target" {
		return nil, httperror.New(http.StatusConflict, "not_target", "仅 target 层工作项支持此操作")
	}

	rows, err := a.DB().QueryContext(ctx,
		"SELECT id, item_key, status FROM work_items WHERE parent_id = ? AND tier = 'matter'", targetID)
	if err != nil {
		return nil, err
	}
	type matterBrief struct {
		itemKey string
		status  string
	}
	var matters []matterBrief
	for rows.Next() {
		var matter matterBrief
		var id int64
		if err := rows.Scan(&id, &matter.itemKey, &matter.status); err != nil {
			rows.Close()
			return nil, err
		}
		matters = append(matters, matter)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(matters) == 0 {
		return nil, httperror.New(http.StatusConflict, "no_children", "尚无子任务，无需撤回")
	}
	var nonTodo []matterBrief
	for _, matter := range matters {
		if matter.status != "todo" {
			nonTodo = append(nonTodo, matter)
		}
	}
	if len(nonTodo) > 0 {
		samples := make([]string, 0, 3)
		for index, matter := range nonTodo {
			if index >= 3 {
				break
			}
			samples = append(samples, fmt.Sprintf("%s[%s]", matter.itemKey, matter.status))
		}
		return nil, httperror.New(http.StatusConflict, "children_not_todo",
			fmt.Sprintf("存在 %d 个子任务不在待办态（%s），无法撤回分配", len(nonTodo), strings.Join(samples, ", ")))
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// 只把 matter 从 todo 回 planning；target 状态不变
	result, err := tx.ExecContext(ctx,
		"UPDATE work_items SET status = 'planning' WHERE parent_id = ? AND tier = 'matter' AND status = 'todo'",
		targetID)
	if err != nil {
		return nil, err
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"targetId": targetID, "mattersUpdated": updated}, nil
}

// saveWorkItemBreakdown 保存工作项任务分解（PUT /work-items/{id}/breakdown）。
func (a *Adapter) saveWorkItemBreakdown(ctx context.Context, rawWorkItemID string, query url.Values, body map[string]any) (map[string]any, error) {
	uid, err := requireReviewActionUser(query)
	if err != nil {
		return nil, err
	}
	workItemID, err := parseDistributionWorkItemID(rawWorkItemID)
	if err != nil {
		return nil, err
	}
	if err := a.assertProjectActiveByWorkItem(ctx, workItemID); err != nil {
		return nil, err
	}

	supportsStartDate, err := a.hasWorkItemStartDateColumn(ctx)
	if err != nil {
		return nil, err
	}

	item, err := a.loadDistributionTarget(ctx, workItemID, supportsStartDate)
	if err != nil {
		return nil, err
	}

	// 加载目标的成果要求（用于覆盖校验和填充 subtask 默认）
	type targetDeliverable struct {
		id   int64
		name string
	}
	deliverableRows, err := a.DB().QueryContext(ctx, `
		SELECT id, name FROM deliverables
		WHERE target_id = ?
		ORDER BY sort_order ASC, created_at ASC`, workItemID)
	if err != nil {
		return nil, err
	}
	var targetDeliverables []targetDeliverable
	for deliverableRows.Next() {
		var deliverable targetDeliverable
		if err := deliverableRows.Scan(&deliverable.id, &deliverable.name); err != nil {
			deliverableRows.Close()
			return nil, err
		}
		targetDeliverables = append(targetDeliverables, deliverable)
	}
	deliverableRows.Close()
	if err := deliverableRows.Err(); err != nil {
		return nil, err
	}
	if len(targetDeliverables) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "target_deliverables_required", "目标尚未配置成果要求，请先在目标规划中添加")
	}
	targetDeliverableIDs := map[int64]bool{}
	for _, deliverable := range targetDeliverables {
		targetDeliverableIDs[deliverable.id] = true
	}

	// 加载已有 child matters；任一不在 planning 则整体锁定
	childRows, err := a.DB().QueryContext(ctx,
		"SELECT id, status FROM work_items WHERE project_id = ? AND parent_id = ?", item.projectID, workItemID)
	if err != nil {
		return nil, err
	}
	existingChildren := map[int64]string{}
	for childRows.Next() {
		var id int64
		var status string
		if err := childRows.Scan(&id, &status); err != nil {
			childRows.Close()
			return nil, err
		}
		existingChildren[id] = status
	}
	childRows.Close()
	if err := childRows.Err(); err != nil {
		return nil, err
	}
	for _, status := range existingChildren {
		if status != "planning" {
			return nil, httperror.New(http.StatusConflict, "distribution_locked",
				"任务分配已确认或任务已开始执行，无法修改。如需调整请先在流程面板点击\"撤回任务分配\"")
		}
	}

	subtasks, err := parseDistributionSubtasks(body, item, "任务", true, targetDeliverableIDs)
	if err != nil {
		return nil, err
	}

	// 覆盖 + 唯一承接校验：目标每条成果有且只有一个 subtask 的 deliverable 承接
	claimCount := map[int64]int{}
	for _, subtask := range subtasks {
		for _, deliverable := range subtask.deliverables {
			if deliverable.sourceDeliverableID != nil {
				claimCount[*deliverable.sourceDeliverableID]++
			}
		}
	}
	if len(subtasks) > 0 {
		var uncovered []string
		for _, deliverable := range targetDeliverables {
			if claimCount[deliverable.id] == 0 {
				uncovered = append(uncovered, deliverable.name)
			}
		}
		if len(uncovered) > 0 {
			return nil, httperror.New(http.StatusBadRequest, "targets_uncovered",
				"目标成果未完全覆盖："+strings.Join(uncovered, "、"))
		}
	}
	var duplicated []string
	for _, deliverable := range targetDeliverables {
		if claimCount[deliverable.id] > 1 {
			duplicated = append(duplicated, deliverable.name)
		}
	}
	if len(duplicated) > 0 {
		return nil, httperror.New(http.StatusBadRequest, "targets_duplicated",
			"目标成果被重复承接："+strings.Join(duplicated, "、")+"（同一成果只能由一个任务承接）")
	}

	// 工时校验：单任务 ≤ 目标控制工时；任务之和 ≤ 目标控制工时
	if item.estimatedHours != nil && *item.estimatedHours > 0 {
		controlHours := *item.estimatedHours
		totalHours := 0.0
		for index, subtask := range subtasks {
			if subtask.estimatedHours == nil {
				continue
			}
			if *subtask.estimatedHours > controlHours {
				return nil, httperror.New(http.StatusBadRequest, "hours_exceeded",
					fmt.Sprintf("任务 %d 的计划工时 %sh 超出目标控制工时 %sh",
						index+1, formatHours(*subtask.estimatedHours), formatHours(controlHours)))
			}
			totalHours += *subtask.estimatedHours
		}
		if totalHours-controlHours > 0.0001 {
			return nil, httperror.New(http.StatusBadRequest, "total_hours_exceeded",
				fmt.Sprintf("所有任务计划工时之和 %sh 超出目标控制工时 %sh",
					formatHours(math.Round(totalHours*100)/100), formatHours(controlHours)))
		}
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// 1) 删除不在 payload 里的已有 child matters；先解除承接（matter_id=null）避免级联删 target 行
	incoming := map[int64]bool{}
	for _, subtask := range subtasks {
		if subtask.id != nil {
			incoming[*subtask.id] = true
		}
	}
	for childID := range existingChildren {
		if incoming[childID] {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE deliverables SET matter_id = NULL, status = 'pending', evidence_url = NULL, evidence_note = NULL,
			       document_uuid = NULL, document_title = NULL, submitted_by = NULL, submitted_at = NULL
			WHERE matter_id = ? AND target_id IS NOT NULL`, childID); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM work_items WHERE id = ?", childID); err != nil {
			return nil, err
		}
	}

	// 2) 逐个 upsert subtask
	for _, subtask := range subtasks {
		var childID int64
		if subtask.id != nil {
			childID = *subtask.id
			setClauses := "title = ?, description = ?, assignee_uid = ?, "
			args := []any{
				subtask.title, nullableDistributionString(subtask.description), subtask.assigneeUID,
			}
			if supportsStartDate {
				setClauses += "start_date = ?, "
				args = append(args, nullableDistributionString(subtask.startDate))
			}
			setClauses += "due_date = ?, estimated_hours = ?, priority = ?, updated_at = CURRENT_TIMESTAMP"
			args = append(args,
				nullableDistributionString(subtask.dueDate), nullableDistributionFloat(subtask.estimatedHours),
				item.priority, childID)
			if _, err := tx.ExecContext(ctx, "UPDATE work_items SET "+setClauses+" WHERE id = ?", args...); err != nil {
				return nil, err
			}
		} else {
			childID, err = insertDistributionChild(ctx, tx, item, subtask, uid, workItemID, supportsStartDate)
			if err != nil {
				return nil, err
			}
		}

		// 重建 deliverables：解除旧承接 → 删除旧自有产物 → 按新 payload 重建
		if _, err := tx.ExecContext(ctx,
			"UPDATE deliverables SET matter_id = NULL WHERE matter_id = ? AND target_id IS NOT NULL", childID); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx,
			"DELETE FROM deliverables WHERE matter_id = ? AND target_id IS NULL", childID); err != nil {
			return nil, err
		}
		for index, deliverable := range subtask.deliverables {
			if deliverable.sourceDeliverableID != nil {
				if _, err := tx.ExecContext(ctx, `
					UPDATE deliverables
					SET matter_id = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
					WHERE id = ? AND target_id = ?`,
					childID, index, *deliverable.sourceDeliverableID, workItemID); err != nil {
					return nil, err
				}
			} else {
				if err := insertOwnDeliverable(ctx, tx, item, childID, deliverable, index, uid); err != nil {
					return nil, err
				}
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true}, nil
}

// formatHours 与 JS Number 显示一致：去掉无意义的小数尾零。
func formatHours(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}
