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
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type decomposeSubmitSourceItem struct {
	ID             int64
	ProjectID      int64
	ProjectCode    string
	MilestoneID    int64
	ItemKey        string
	Title          string
	Priority       string
	TemplateKey    *string
	ReviewLevel    int64
	ApprovalStatus string
	Status         string
}

type decomposeSubmitTaskAnchor struct {
	HeadingAnchor string
	HeadingDepth  int64
}

type decomposeSubmitTask struct {
	Title           string
	SourceAnchors   []decomposeSubmitTaskAnchor
	Priority        string
	AssigneeUID     *string
	EstimatedHours  *float64
	DeliverableType string
}

type decomposeSubmitItem struct {
	Category       *string
	Kind           string
	Title          string
	HeadingAnchor  string
	HeadingDepth   int64
	Priority       string
	AssigneeUID    *string
	EstimatedHours *float64
	Tasks          []decomposeSubmitTask
}

type decomposeSubmitPayload struct {
	Mode                string
	SourceDocumentUUID  string
	SourceDocumentTitle string
	WorkHours           float64
	SubmitNote          string
	Items               []decomposeSubmitItem
}

type decomposeCreatedWorkItem struct {
	ID      int64  `json:"id"`
	ItemKey string `json:"itemKey"`
	Tier    string `json:"tier"`
	Type    string `json:"type"`
	Role    string `json:"role"`
}

func (a *Adapter) workItemDecomposeSubmit(ctx context.Context, workItemID string, query url.Values, body map[string]any) (map[string]any, error) {
	workItemID = strings.TrimSpace(workItemID)
	if workItemID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_work_item_id", "work item id is required")
	}

	uid := currentUserFrom(query, body)
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	payload, err := parseDecomposeSubmitPayload(body)
	if err != nil {
		return nil, err
	}

	item, err := a.decomposeSubmitSourceItem(ctx, workItemID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, httperror.New(http.StatusNotFound, "work_item_not_found", "工作项不存在")
	}
	if err := a.requireProjectManagerOrScopedAdmin(ctx, item.ProjectID, uid, query); err != nil {
		return nil, err
	}
	// The independent Aims lane keeps its original pre-transaction validation.
	// Host receipt replay must pass through current authorization before business
	// preconditions that a successful earlier command has already changed.
	if !validDeliverableReceiptIdentity(ctx) {
		if !allowedDecomposeTemplateKeys[stringValue(item.TemplateKey)] {
			return nil, httperror.New(http.StatusBadRequest, "unsupported_decompose_item", "当前工作项不支持需求分解")
		}
		if item.ApprovalStatus == "pending" {
			return nil, httperror.New(http.StatusBadRequest, "approval_pending", "当前分解任务已提交审批，无法再次提交")
		}
		conflicts, err := a.decomposeSubmitAnchorConflicts(ctx, payload, item.ProjectID)
		if err != nil {
			return nil, err
		}
		if len(conflicts) > 0 {
			parts := make([]string, 0, len(conflicts))
			for _, conflict := range conflicts {
				parts = append(parts, fmt.Sprintf("%s(%s)", conflict["headingAnchor"], conflict["workItemKey"]))
			}
			return nil, httperror.New(http.StatusConflict, "duplicate_decompose_anchor", "以下章节已被分解："+strings.Join(parts, ", ")+"，请刷新页面后重试")
		}
	}
	tx, repo, err := a.beginDeliverableWrite(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	identity, _ := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if err := requireEnterpriseProjectCommandScopeTx(ctx, tx, identity, strconv.FormatInt(item.ProjectID, 10), workItemID, "decompose-submit"); err != nil {
		return nil, err
	}
	if identity.CommandScope != nil {
		var leader string
		if err := tx.QueryRowContext(ctx, "SELECT COALESCE(leader_uid,'') FROM aims_projects WHERE id=? FOR UPDATE", item.ProjectID).Scan(&leader); err != nil {
			return nil, err
		}
		if err := requireEnterpriseProjectManagerTx(ctx, tx, identity, strconv.FormatInt(item.ProjectID, 10), leader); err != nil {
			return nil, err
		}
	}
	lockedItem, err := decomposeSubmitSourceItemFrom(ctx, tx, workItemID, true)
	if err != nil {
		return nil, err
	}
	if lockedItem == nil || lockedItem.ProjectID != item.ProjectID {
		return nil, httperror.New(http.StatusConflict, "work_item_project_changed", "工作项归属已变化")
	}
	item = lockedItem
	write := func(writeCtx context.Context) (map[string]any, error) {
		if !allowedDecomposeTemplateKeys[stringValue(item.TemplateKey)] || item.ApprovalStatus == "pending" {
			return nil, httperror.New(http.StatusConflict, "decompose_source_changed", "分解源已变化，请刷新后重试")
		}
		conflicts, err := a.decomposeSubmitAnchorConflicts(writeCtx, payload, item.ProjectID)
		if err != nil {
			return nil, err
		}
		if len(conflicts) > 0 {
			parts := make([]string, 0, len(conflicts))
			for _, conflict := range conflicts {
				parts = append(parts, fmt.Sprintf("%s(%s)", conflict["headingAnchor"], conflict["workItemKey"]))
			}
			return nil, httperror.New(http.StatusConflict, "duplicate_decompose_anchor", "以下章节已被分解："+strings.Join(parts, ", ")+"，请刷新页面后重试")
		}
		return a.finishDecomposeSubmit(writeCtx, tx, item, payload, uid)
	}
	var result map[string]any
	if repo == nil {
		result, err = write(ctx)
	} else {
		result, err = executeLegacyWorkItemReceipt(ctx, tx, repo, legacyWorkItemReceiptConfig[map[string]any]{Action: "decompose-submit", Capability: "aims:work-item-decomposition:edit", BizType: "work-item-decomposition", Command: map[string]any{"workItemId": workItemID, "payload": body}, BizCode: func(value map[string]any) string { return fmt.Sprint(value["executionId"]) }, Replay: func(ctx context.Context, code string) (map[string]any, error) {
			return replayDecomposeSubmit(ctx, tx, item.ProjectID, item.ID, code)
		}, Decorate: func(value map[string]any, receipt string, existing bool) map[string]any {
			out := decorateLegacyWorkItemMap(value, receipt, existing)
			out["replayed"] = existing
			return out
		}}, write)
	}
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func (a *Adapter) finishDecomposeSubmit(ctx context.Context, tx *sql.Tx, item *decomposeSubmitSourceItem, payload decomposeSubmitPayload, uid string) (map[string]any, error) {
	created := make([]decomposeCreatedWorkItem, 0)
	for _, payloadItem := range payload.Items {
		targetNumber, err := nextDecomposeItemNumber(ctx, tx, item.ProjectID)
		if err != nil {
			return nil, err
		}
		targetKey := fmt.Sprintf("%s-%d", item.ProjectCode, targetNumber)
		targetResult, err := tx.ExecContext(ctx, `
			INSERT INTO work_items
				(project_id, milestone_id, item_number, item_key, tier, type,
				 requirement_category, title, status, priority, weight,
				 assignee_uid, reporter_uid, estimated_hours, parent_id, sort_order,
				 decomposition_source_id)
			VALUES (?, ?, ?, ?, 'target', 'requirement',
					?, ?, 'planning', ?, 1,
					?, ?, ?, NULL, 0,
					?)
		`, item.ProjectID, item.MilestoneID, targetNumber, targetKey, payloadItem.Category, payloadItem.Title,
			firstNonEmpty(payloadItem.Priority, item.Priority), nullableStringValue(payloadItem.AssigneeUID), uid, nullableFloatValue(payloadItem.EstimatedHours), item.ID)
		if err != nil {
			return nil, err
		}
		targetID, err := targetResult.LastInsertId()
		if err != nil {
			return nil, err
		}
		created = append(created, decomposeCreatedWorkItem{ID: targetID, ItemKey: targetKey, Tier: "target", Type: "requirement", Role: "target"})

		if _, err := tx.ExecContext(ctx, `
			INSERT INTO work_item_source_anchors
				(work_item_id, source_document_uuid, source_document_title, heading_anchor, heading_depth, sort_order)
			VALUES (?, ?, ?, ?, ?, 0)
		`, targetID, payload.SourceDocumentUUID, payload.SourceDocumentTitle, payloadItem.HeadingAnchor, payloadItem.HeadingDepth); err != nil {
			return nil, err
		}

		for _, task := range payloadItem.Tasks {
			taskNumber, err := nextDecomposeItemNumber(ctx, tx, item.ProjectID)
			if err != nil {
				return nil, err
			}
			taskKey, err := nextDecomposeChildItemKey(ctx, tx, targetKey)
			if err != nil {
				return nil, err
			}
			taskResult, err := tx.ExecContext(ctx, `
				INSERT INTO work_items
					(project_id, milestone_id, item_number, item_key, tier, type,
					 requirement_category, title, status, priority, weight,
					 assignee_uid, reporter_uid, estimated_hours, parent_id, sort_order,
					 decomposition_source_id)
				VALUES (?, ?, ?, ?, 'matter', 'task',
						?, ?, 'todo', ?, 1,
						?, ?, ?, ?, 0,
						?)
			`, item.ProjectID, item.MilestoneID, taskNumber, taskKey, payloadItem.Category, task.Title,
				firstNonEmpty(task.Priority, payloadItem.Priority, item.Priority), nullableStringValue(task.AssigneeUID), uid, nullableFloatValue(task.EstimatedHours), targetID, item.ID)
			if err != nil {
				return nil, err
			}
			taskID, err := taskResult.LastInsertId()
			if err != nil {
				return nil, err
			}
			created = append(created, decomposeCreatedWorkItem{ID: taskID, ItemKey: taskKey, Tier: "matter", Type: "task", Role: "task"})

			for idx, anchor := range task.SourceAnchors {
				if _, err := tx.ExecContext(ctx, `
					INSERT INTO work_item_source_anchors
						(work_item_id, source_document_uuid, source_document_title, heading_anchor, heading_depth, sort_order)
					VALUES (?, ?, ?, ?, ?, ?)
				`, taskID, payload.SourceDocumentUUID, payload.SourceDocumentTitle, anchor.HeadingAnchor, anchor.HeadingDepth, idx); err != nil {
					return nil, err
				}
			}
		}
	}

	timeDescription := fmt.Sprintf("需求分解（生成 %d 条工作项）", len(created))
	if strings.TrimSpace(payload.SubmitNote) != "" {
		timeDescription = "需求分解：" + strings.TrimSpace(payload.SubmitNote)
	}
	timeResult, err := tx.ExecContext(ctx, `
		INSERT INTO time_entries (project_id, work_item_id, uid, entry_date, hours, description)
		VALUES (?, ?, ?, ?, ?, ?)
	`, item.ProjectID, item.ID, uid, time.Now().UTC().Format("2006-01-02"), payload.WorkHours, timeDescription)
	if err != nil {
		return nil, err
	}
	timeEntryID, err := timeResult.LastInsertId()
	if err != nil {
		return nil, err
	}

	nextStatus := "in_review"
	nextApproval := "pending"
	if item.ReviewLevel == 0 {
		nextStatus = "completed"
		nextApproval = "approved"
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE work_items
		SET status = ?, approval_status = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, nextStatus, nextApproval, item.ID); err != nil {
		return nil, err
	}
	var executionID int64
	if identity, enterprise := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity); enterprise && identity.IdempotencyKey != "" {
		ids := make([]int64, 0, len(created))
		for _, child := range created {
			ids = append(ids, child.ID)
		}
		changes, err := json.Marshal(map[string]any{"createdIds": ids, "timeEntryId": timeEntryID})
		if err != nil {
			return nil, err
		}
		log, err := tx.ExecContext(ctx, "INSERT INTO project_activity_logs(project_id,object_type,object_code,action,actor_uid,changes,request_id) VALUES(?,'work_item',?,'decompose-submit',?,?,?)", item.ProjectID, item.ID, uid, changes, identity.IdempotencyKey)
		if err != nil {
			return nil, err
		}
		executionID, err = log.LastInsertId()
		if err != nil {
			return nil, err
		}
	}

	result := map[string]any{
		"createdWorkItems":             created,
		"timeEntryId":                  timeEntryID,
		"sourceWorkItemStatus":         nextStatus,
		"sourceWorkItemApprovalStatus": nextApproval,
	}
	if executionID > 0 {
		result["executionId"] = executionID
	}
	return result, nil
}

func replayDecomposeSubmit(ctx context.Context, tx *sql.Tx, expectedProjectID, sourceID int64, code string) (map[string]any, error) {
	executionID, err := strconv.ParseInt(code, 10, 64)
	if err != nil || executionID <= 0 {
		return nil, httperror.New(409, "receipt_result_unavailable", "Work item receipt result is unavailable")
	}
	identity, ok := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if !ok || identity.IdempotencyKey == "" {
		return nil, httperror.New(409, "receipt_result_unavailable", "Work item receipt result is unavailable")
	}
	var changes []byte
	var projectID int64
	var actor, requestID string
	err = tx.QueryRowContext(ctx, "SELECT project_id,actor_uid,request_id,changes FROM project_activity_logs WHERE id=? AND object_type='work_item' AND object_code=? AND action='decompose-submit'", executionID, sourceID).Scan(&projectID, &actor, &requestID, &changes)
	if err == sql.ErrNoRows {
		return nil, httperror.New(409, "receipt_result_unavailable", "Work item receipt result is unavailable")
	}
	if err != nil {
		return nil, err
	}
	if projectID != expectedProjectID || actor != identity.ActorUID || requestID != identity.IdempotencyKey {
		return nil, httperror.New(409, "receipt_result_unavailable", "Work item receipt result is unavailable")
	}
	var saved struct {
		CreatedIDs  []int64 `json:"createdIds"`
		TimeEntryID int64   `json:"timeEntryId"`
	}
	if err := json.Unmarshal(changes, &saved); err != nil || saved.TimeEntryID <= 0 || len(saved.CreatedIDs) == 0 {
		return nil, httperror.New(409, "receipt_result_unavailable", "Work item receipt result is unavailable")
	}
	seen := map[int64]bool{}
	for _, childID := range saved.CreatedIDs {
		if childID <= 0 || seen[childID] {
			return nil, httperror.New(409, "receipt_result_unavailable", "Work item receipt result is unavailable")
		}
		seen[childID] = true
	}
	created := make([]decomposeCreatedWorkItem, 0, len(saved.CreatedIDs))
	for _, childID := range saved.CreatedIDs {
		var child decomposeCreatedWorkItem
		err := tx.QueryRowContext(ctx, "SELECT id,item_key,tier,type FROM work_items WHERE id=? AND project_id=? AND decomposition_source_id=?", childID, projectID, sourceID).Scan(&child.ID, &child.ItemKey, &child.Tier, &child.Type)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return nil, err
		}
		child.Role = child.Tier
		created = append(created, child)
	}
	var status, approval string
	if err := tx.QueryRowContext(ctx, "SELECT status,approval_status FROM work_items WHERE id=? AND project_id=?", sourceID, projectID).Scan(&status, &approval); err != nil {
		return nil, err
	}
	var timeEntryProject int64
	err = tx.QueryRowContext(ctx, "SELECT project_id FROM time_entries WHERE id=?", saved.TimeEntryID).Scan(&timeEntryProject)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	var timeEntryID any
	if err == nil && timeEntryProject == projectID {
		timeEntryID = saved.TimeEntryID
	}
	return map[string]any{"executionId": executionID, "createdWorkItems": created, "timeEntryId": timeEntryID, "sourceWorkItemStatus": status, "sourceWorkItemApprovalStatus": approval}, nil
}

func (a *Adapter) decomposeSubmitSourceItem(ctx context.Context, workItemID string) (*decomposeSubmitSourceItem, error) {
	return decomposeSubmitSourceItemFrom(ctx, a.DB(), workItemID, false)
}

type decomposeSubmitQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func decomposeSubmitSourceItemFrom(ctx context.Context, db decomposeSubmitQuerier, workItemID string, lock bool) (*decomposeSubmitSourceItem, error) {
	query := `
		SELECT
			wi.id, wi.project_id, p.project_code, wi.milestone_id, wi.item_key, wi.title,
			wi.priority, wi.template_key, wi.review_level, wi.approval_status, wi.status
		FROM work_items wi
		JOIN aims_projects p ON p.id = wi.project_id
		WHERE wi.id = ?
	`
	if lock {
		query += " FOR UPDATE"
	}
	row := db.QueryRowContext(ctx, query, workItemID)

	var item decomposeSubmitSourceItem
	var templateKey, approvalStatus sql.NullString
	var reviewLevel sql.NullInt64
	if err := row.Scan(&item.ID, &item.ProjectID, &item.ProjectCode, &item.MilestoneID, &item.ItemKey, &item.Title,
		&item.Priority, &templateKey, &reviewLevel, &approvalStatus, &item.Status); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	item.TemplateKey = nullableString(templateKey)
	item.ReviewLevel = nullInt64Or(reviewLevel, 1)
	item.ApprovalStatus = nullStringOr(approvalStatus, "not_required")
	return &item, nil
}

func (a *Adapter) decomposeSubmitAnchorConflicts(ctx context.Context, payload decomposeSubmitPayload, projectID int64) ([]map[string]string, error) {
	seen := make(map[string]bool)
	anchors := make([]any, 0)
	addAnchor := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		anchors = append(anchors, value)
	}
	for _, item := range payload.Items {
		addAnchor(item.HeadingAnchor)
		for _, task := range item.Tasks {
			for _, anchor := range task.SourceAnchors {
				addAnchor(anchor.HeadingAnchor)
			}
		}
	}
	if len(anchors) == 0 {
		return []map[string]string{}, nil
	}

	args := append([]any{payload.SourceDocumentUUID, projectID}, anchors...)
	rows, err := a.DB().QueryContext(ctx, `
		SELECT a.heading_anchor, wi.item_key AS work_item_key
		FROM work_item_source_anchors a
		JOIN work_items wi ON wi.id = a.work_item_id
		WHERE a.source_document_uuid = ?
		  AND wi.project_id = ?
		  AND a.heading_anchor IN (`+placeholders(len(anchors))+`)
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	conflicts := make([]map[string]string, 0)
	for rows.Next() {
		var anchor, itemKey string
		if err := rows.Scan(&anchor, &itemKey); err != nil {
			return nil, err
		}
		conflicts = append(conflicts, map[string]string{"headingAnchor": anchor, "workItemKey": itemKey})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return conflicts, nil
}

func parseDecomposeSubmitPayload(body map[string]any) (decomposeSubmitPayload, error) {
	var payload decomposeSubmitPayload
	payload.Mode = firstBodyText(body, "mode")
	if payload.Mode != "category" && payload.Mode != "flat" {
		return payload, httperror.New(http.StatusBadRequest, "invalid_mode", "mode 必须是 category 或 flat")
	}
	payload.SourceDocumentUUID = firstBodyText(body, "sourceDocumentUuid", "source_document_uuid")
	if payload.SourceDocumentUUID == "" {
		return payload, httperror.New(http.StatusBadRequest, "missing_source_document_uuid", "缺少 sourceDocumentUuid")
	}
	payload.SourceDocumentTitle = firstBodyText(body, "sourceDocumentTitle", "source_document_title")
	if payload.SourceDocumentTitle == "" {
		return payload, httperror.New(http.StatusBadRequest, "missing_source_document_title", "缺少 sourceDocumentTitle")
	}
	hours, err := bodyFloat(body, "workHours")
	if err != nil || hours <= 0 || hours > 24 {
		return payload, httperror.New(http.StatusBadRequest, "invalid_work_hours", "工时必须在 0 到 24 之间")
	}
	payload.WorkHours = hours
	payload.SubmitNote = firstBodyText(body, "submitNote", "submit_note")

	rawItems, ok := body["items"].([]any)
	if !ok || len(rawItems) == 0 {
		return payload, httperror.New(http.StatusBadRequest, "missing_items", "请至少勾选一个章节")
	}
	payload.Items = make([]decomposeSubmitItem, 0, len(rawItems))
	for _, rawItem := range rawItems {
		itemMap, ok := rawItem.(map[string]any)
		if !ok {
			return payload, httperror.New(http.StatusBadRequest, "invalid_item", "存在无效的分解条目")
		}
		item, err := parseDecomposeSubmitItem(payload.Mode, itemMap)
		if err != nil {
			return payload, err
		}
		payload.Items = append(payload.Items, item)
	}
	return payload, nil
}

func parseDecomposeSubmitItem(mode string, itemMap map[string]any) (decomposeSubmitItem, error) {
	item := decomposeSubmitItem{
		Kind:           firstBodyText(itemMap, "kind"),
		Title:          firstBodyText(itemMap, "title"),
		HeadingAnchor:  firstBodyText(itemMap, "headingAnchor", "heading_anchor"),
		Priority:       normalizeDecomposePriority(firstBodyText(itemMap, "priority")),
		AssigneeUID:    optionalBodyString(itemMap, "assigneeUid", "assignee_uid"),
		EstimatedHours: optionalBodyFloat(itemMap, "estimatedHours", "estimated_hours"),
	}
	if item.Title == "" || item.HeadingAnchor == "" {
		return item, httperror.New(http.StatusBadRequest, "invalid_item", "存在标题或锚点缺失的条目")
	}
	if item.Kind != "target_with_tasks" && item.Kind != "direct_task" {
		return item, httperror.New(http.StatusBadRequest, "invalid_item_kind", "无效的 kind: "+item.Kind)
	}
	headingDepth, err := bodyInt64(itemMap, "headingDepth", "heading_depth")
	if err != nil || (headingDepth != 2 && headingDepth != 3) {
		return item, httperror.New(http.StatusBadRequest, "invalid_heading_depth", "无效的 headingDepth")
	}
	item.HeadingDepth = headingDepth

	category := optionalBodyString(itemMap, "category")
	if category != nil && *category != "functional" && *category != "non_functional" {
		return item, httperror.New(http.StatusBadRequest, "invalid_category", "无效的 category: "+*category)
	}
	if mode == "category" && category == nil {
		return item, httperror.New(http.StatusBadRequest, "missing_category", "分类模式下每个需求必须指定 category")
	}
	if mode == "flat" && category != nil {
		return item, httperror.New(http.StatusBadRequest, "invalid_category", "平铺模式下 category 必须为 null")
	}
	item.Category = category

	rawTasks, ok := itemMap["tasks"].([]any)
	if !ok || len(rawTasks) == 0 {
		return item, httperror.New(http.StatusBadRequest, "missing_tasks", "需求「"+item.Title+"」至少需要一个任务")
	}
	item.Tasks = make([]decomposeSubmitTask, 0, len(rawTasks))
	for _, rawTask := range rawTasks {
		taskMap, ok := rawTask.(map[string]any)
		if !ok {
			return item, httperror.New(http.StatusBadRequest, "invalid_task", "存在无效的任务")
		}
		task, err := parseDecomposeSubmitTask(taskMap)
		if err != nil {
			return item, err
		}
		item.Tasks = append(item.Tasks, task)
	}
	return item, nil
}

func parseDecomposeSubmitTask(taskMap map[string]any) (decomposeSubmitTask, error) {
	task := decomposeSubmitTask{
		Title:           firstBodyText(taskMap, "title"),
		Priority:        normalizeDecomposePriority(firstBodyText(taskMap, "priority")),
		AssigneeUID:     optionalBodyString(taskMap, "assigneeUid", "assignee_uid"),
		EstimatedHours:  optionalBodyFloat(taskMap, "estimatedHours", "estimated_hours"),
		DeliverableType: firstNonEmpty(firstBodyText(taskMap, "deliverableType", "deliverable_type"), "task"),
	}
	if task.Title == "" {
		return task, httperror.New(http.StatusBadRequest, "invalid_task_title", "存在未命名的任务")
	}
	if !containsString([]string{"code", "document", "artifact", "task"}, task.DeliverableType) {
		return task, httperror.New(http.StatusBadRequest, "invalid_deliverable_type", "任务「"+task.Title+"」的交付物类型无效")
	}
	rawAnchors, ok := taskMap["sourceAnchors"].([]any)
	if !ok {
		rawAnchors, ok = taskMap["source_anchors"].([]any)
	}
	if !ok || len(rawAnchors) == 0 {
		return task, httperror.New(http.StatusBadRequest, "missing_task_anchors", "任务「"+task.Title+"」缺少源锚点")
	}
	task.SourceAnchors = make([]decomposeSubmitTaskAnchor, 0, len(rawAnchors))
	for _, rawAnchor := range rawAnchors {
		anchorMap, ok := rawAnchor.(map[string]any)
		if !ok {
			return task, httperror.New(http.StatusBadRequest, "invalid_task_anchor", "存在无效的任务锚点")
		}
		anchor := decomposeSubmitTaskAnchor{HeadingAnchor: firstBodyText(anchorMap, "headingAnchor", "heading_anchor")}
		depth, err := bodyInt64(anchorMap, "headingDepth", "heading_depth")
		if err != nil || (depth != 3 && depth != 4) {
			return task, httperror.New(http.StatusBadRequest, "invalid_task_anchor_depth", "任务「"+task.Title+"」存在无效的源标题层级")
		}
		anchor.HeadingDepth = depth
		if anchor.HeadingAnchor == "" {
			return task, httperror.New(http.StatusBadRequest, "invalid_task_anchor", "任务「"+task.Title+"」缺少源锚点")
		}
		task.SourceAnchors = append(task.SourceAnchors, anchor)
	}
	return task, nil
}

func nextDecomposeItemNumber(ctx context.Context, tx *sql.Tx, projectID int64) (int64, error) {
	if _, err := tx.ExecContext(ctx, "UPDATE project_counters SET counter = LAST_INSERT_ID(counter + 1) WHERE project_id = ?", projectID); err != nil {
		return 0, err
	}
	var next int64
	if err := tx.QueryRowContext(ctx, "SELECT LAST_INSERT_ID() AS next_number").Scan(&next); err != nil {
		return 0, err
	}
	if next == 0 {
		return 0, fmt.Errorf("generate work item number failed")
	}
	return next, nil
}

func nextDecomposeChildItemKey(ctx context.Context, tx *sql.Tx, parentItemKey string) (string, error) {
	rows, err := tx.QueryContext(ctx, "SELECT item_key FROM work_items WHERE item_key LIKE CONCAT(?, '-%')", parentItemKey)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	used := make(map[int64]bool)
	prefix := parentItemKey + "-"
	for rows.Next() {
		var itemKey string
		if err := rows.Scan(&itemKey); err != nil {
			return "", err
		}
		suffix := strings.TrimPrefix(itemKey, prefix)
		if value, err := strconv.ParseInt(suffix, 10, 64); err == nil && value > 0 {
			used[value] = true
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	seq := int64(1)
	for used[seq] {
		seq++
	}
	return fmt.Sprintf("%s-%d", parentItemKey, seq), nil
}

func bodyInt64(body map[string]any, keys ...string) (int64, error) {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return int64(typed), nil
		case float32:
			return int64(typed), nil
		case int:
			return int64(typed), nil
		case int64:
			return typed, nil
		case jsonNumber:
			return strconv.ParseInt(string(typed), 10, 64)
		default:
			return strconv.ParseInt(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
		}
	}
	return 0, fmt.Errorf("missing int64")
}

func optionalBodyString(body map[string]any, keys ...string) *string {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text != "" && text != "<nil>" {
			return &text
		}
	}
	return nil
}

func optionalBodyFloat(body map[string]any, keys ...string) *float64 {
	for _, key := range keys {
		if _, ok := body[key]; !ok {
			continue
		}
		value, err := bodyFloat(body, key)
		if err != nil {
			return nil
		}
		return &value
	}
	return nil
}

func nullableStringValue(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}

func nullableFloatValue(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func normalizeDecomposePriority(value string) string {
	value = strings.TrimSpace(value)
	if containsString([]string{"P0", "P1", "P2", "P3"}, value) {
		return value
	}
	return ""
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
