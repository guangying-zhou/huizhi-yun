package workflow

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

type workflowPage struct {
	page     int
	pageSize int
	offset   int
}

func (a *Adapter) HandleRuntime(ctx context.Context, method string, path string, query url.Values, rawBody map[string]any) (InstanceAPIResponse, string, error) {
	switch {
	case method == http.MethodGet && path == "/v1/workflow/actions":
		return a.listActions(ctx, query)
	case method == http.MethodGet && path == "/v1/workflow/tasks/pending":
		return a.listTasks(ctx, query, "pending")
	case method == http.MethodGet && path == "/v1/workflow/tasks/done":
		return a.listTasks(ctx, query, "done")
	case method == http.MethodGet && path == "/v1/workflow/tasks/initiated":
		return a.listInitiated(ctx, query)
	case method == http.MethodGet && strings.HasPrefix(path, "/v1/workflow/tasks/") && !strings.Contains(strings.TrimPrefix(path, "/v1/workflow/tasks/"), "/"):
		return a.taskDetail(ctx, query, pathID(path, "/v1/workflow/tasks/"))
	case method == http.MethodPost && strings.HasSuffix(path, "/approve") && strings.HasPrefix(path, "/v1/workflow/tasks/"):
		return a.approveTask(ctx, pathActionID(path, "/v1/workflow/tasks/", "/approve"), rawBody)
	case method == http.MethodPost && strings.HasSuffix(path, "/reject") && strings.HasPrefix(path, "/v1/workflow/tasks/"):
		return a.rejectTask(ctx, pathActionID(path, "/v1/workflow/tasks/", "/reject"), rawBody)
	case method == http.MethodPost && strings.HasSuffix(path, "/delegate") && strings.HasPrefix(path, "/v1/workflow/tasks/"):
		return a.delegateTask(ctx, pathActionID(path, "/v1/workflow/tasks/", "/delegate"), rawBody)
	case method == http.MethodGet && path == "/v1/workflow/instances/by-biz":
		return a.instanceByBiz(ctx, query)
	case method == http.MethodGet && path == "/v1/workflow/instances/by-biz-history":
		return a.instanceByBizHistory(ctx, query)
	case method == http.MethodGet && strings.HasPrefix(path, "/v1/workflow/instances/") && !strings.Contains(strings.TrimPrefix(path, "/v1/workflow/instances/"), "/"):
		return a.instanceDetail(ctx, query, pathID(path, "/v1/workflow/instances/"))
	case method == http.MethodPost && strings.HasSuffix(path, "/cancel") && strings.HasPrefix(path, "/v1/workflow/instances/"):
		return a.cancelInstance(ctx, pathActionID(path, "/v1/workflow/instances/", "/cancel"), rawBody)
	case method == http.MethodPost && strings.HasSuffix(path, "/resubmit") && strings.HasPrefix(path, "/v1/workflow/instances/"):
		return a.resubmitInstance(ctx, pathActionID(path, "/v1/workflow/instances/", "/resubmit"), rawBody)
	case strings.HasPrefix(path, "/v1/workflow/admin/"):
		return a.handleAdminRuntime(ctx, method, path, query, rawBody)
	default:
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "not_found", "Route not found")
	}
}

func (a *Adapter) listActions(ctx context.Context, query url.Values) (InstanceAPIResponse, string, error) {
	appCode := strings.TrimSpace(query.Get("app_code"))
	resourceCode := strings.TrimSpace(query.Get("resource_code"))
	if appCode == "" || resourceCode == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "field_required", "app_code 和 resource_code 参数必填")
	}

	rows, err := queryMaps(ctx, a.db, `
		SELECT a.id, a.app_code, a.resource_code, a.action_code, a.name, a.description, a.icon, a.form_schema_id, a.sort_order,
		       f.code AS form_code, f.name AS form_name
		FROM flow_action_defs a
		LEFT JOIN form_schemas f ON a.form_schema_id = f.id
		WHERE a.app_code = ? AND a.resource_code = ? AND a.status = 1
		ORDER BY a.sort_order ASC, a.id ASC
	`, appCode, resourceCode)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}

	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		item := map[string]any{
			"id":            row["id"],
			"resource_code": row["resource_code"],
			"action_code":   row["action_code"],
			"name":          row["name"],
			"description":   row["description"],
			"icon":          row["icon"],
			"form_schema":   nil,
		}
		if row["form_schema_id"] != nil {
			item["form_schema"] = map[string]any{
				"id":   row["form_schema_id"],
				"code": row["form_code"],
				"name": row["form_name"],
			}
		}
		items = append(items, item)
	}
	return InstanceAPIResponse{Code: 0, Data: items}, "workflow.actions.list", nil
}

func (a *Adapter) listTasks(ctx context.Context, query url.Values, listType string) (InstanceAPIResponse, string, error) {
	currentUser := strings.TrimSpace(query.Get("current_user"))
	if currentUser == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "未登录")
	}
	page := workflowPageParams(query, 20)
	appCode := strings.TrimSpace(query.Get("app_code"))

	conditions := []string{"t.assignee_uid = ?"}
	args := []any{currentUser}
	operation := "workflow.tasks.pending"
	orderColumn := "t.created_at DESC"
	if listType == "pending" {
		conditions = append(conditions, "t.status = 'pending'", "i.status = 'running'")
	} else {
		conditions = append(conditions, "t.status = 'completed'")
		operation = "workflow.tasks.done"
		orderColumn = "t.completed_at DESC"
	}
	if appCode != "" {
		conditions = append(conditions, "i.app_code = ?")
		args = append(args, appCode)
	}
	whereSQL := strings.Join(conditions, " AND ")

	var total int64
	if err := a.db.QueryRowContext(ctx, `
		SELECT COUNT(*) AS total
		FROM flow_tasks t
		INNER JOIN flow_instances i ON t.instance_id = i.id
		WHERE `+whereSQL, args...).Scan(&total); err != nil {
		return InstanceAPIResponse{}, "", err
	}

	selectCompleted := "NULL AS task_completed_at,"
	if listType == "done" {
		selectCompleted = "t.completed_at AS task_completed_at,"
	}
	rows, err := queryMaps(ctx, a.db, `
		SELECT t.id AS task_id, t.instance_id, i.instance_no,
		       i.app_code, i.resource_code, i.action_code, i.biz_title, i.biz_url,
		       i.initiator_uid, i.status AS instance_status,
		       t.node_name, t.task_type,
		       `+selectCompleted+`
		       t.created_at AS task_created_at, t.due_at,
		       a.name AS action_name
		FROM flow_tasks t
		INNER JOIN flow_instances i ON t.instance_id = i.id
		LEFT JOIN flow_action_defs a ON i.action_def_id = a.id
		WHERE `+whereSQL+`
		ORDER BY `+orderColumn+`
		LIMIT ? OFFSET ?
	`, append(args, page.pageSize, page.offset)...)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}

	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		item := map[string]any{
			"task_id":       row["task_id"],
			"instance_id":   row["instance_id"],
			"instance_no":   row["instance_no"],
			"app_code":      row["app_code"],
			"resource_code": row["resource_code"],
			"action_code":   row["action_code"],
			"action_name":   row["action_name"],
			"biz_title":     row["biz_title"],
			"biz_url":       row["biz_url"],
			"initiator_uid": row["initiator_uid"],
			"node_name":     row["node_name"],
			"task_type":     row["task_type"],
			"created_at":    row["task_created_at"],
			"due_at":        row["due_at"],
		}
		if listType == "done" {
			item["instance_status"] = row["instance_status"]
			item["completed_at"] = row["task_completed_at"]
		}
		items = append(items, item)
	}

	return InstanceAPIResponse{Code: 0, Data: map[string]any{"total": total, "items": items}}, operation, nil
}

func (a *Adapter) listInitiated(ctx context.Context, query url.Values) (InstanceAPIResponse, string, error) {
	currentUser := strings.TrimSpace(query.Get("current_user"))
	if currentUser == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "未登录")
	}
	page := workflowPageParams(query, 20)
	status := strings.TrimSpace(query.Get("status"))
	appCode := strings.TrimSpace(query.Get("app_code"))
	conditions := []string{"i.initiator_uid = ?"}
	args := []any{currentUser}
	if status != "" {
		conditions = append(conditions, "i.status = ?")
		args = append(args, status)
	}
	if appCode != "" {
		conditions = append(conditions, "i.app_code = ?")
		args = append(args, appCode)
	}
	whereSQL := strings.Join(conditions, " AND ")

	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) AS total FROM flow_instances i WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	rows, err := queryMaps(ctx, a.db, `
		SELECT i.id, i.instance_no, i.app_code, i.resource_code, i.action_code,
		       i.biz_title, i.biz_url, i.status, i.current_node,
		       i.created_at, i.completed_at,
		       a.name AS action_name
		FROM flow_instances i
		LEFT JOIN flow_action_defs a ON i.action_def_id = a.id
		WHERE `+whereSQL+`
		ORDER BY i.created_at DESC
		LIMIT ? OFFSET ?
	`, append(args, page.pageSize, page.offset)...)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}

	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		items = append(items, map[string]any{
			"instance_id":   row["id"],
			"instance_no":   row["instance_no"],
			"app_code":      row["app_code"],
			"resource_code": row["resource_code"],
			"action_code":   row["action_code"],
			"action_name":   row["action_name"],
			"biz_title":     row["biz_title"],
			"biz_url":       row["biz_url"],
			"status":        row["status"],
			"current_node":  row["current_node"],
			"created_at":    row["created_at"],
			"completed_at":  row["completed_at"],
		})
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"total": total, "items": items}}, "workflow.tasks.initiated", nil
}

func (a *Adapter) taskDetail(ctx context.Context, query url.Values, taskID string) (InstanceAPIResponse, string, error) {
	currentUser := strings.TrimSpace(query.Get("current_user"))
	if currentUser == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "未登录")
	}
	task, err := queryOneMap(ctx, a.db, "SELECT * FROM flow_tasks WHERE id = ?", taskID)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if task == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "task_not_found", "任务不存在")
	}
	instance, err := queryOneMap(ctx, a.db, "SELECT * FROM flow_instances WHERE id = ?", task["instance_id"])
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if instance == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "instance_not_found", "流程实例不存在")
	}
	if cleanAnyString(task["assignee_uid"]) != currentUser && cleanAnyString(instance["initiator_uid"]) != currentUser {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusForbidden, "forbidden", "无权查看此任务")
	}
	data, err := a.instancePayload(ctx, instance, currentUser, task, query.Get("request_app_code"))
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: taskDetailPayload(task, data)}, "workflow.tasks.detail", nil
}

func (a *Adapter) instanceDetail(ctx context.Context, query url.Values, instanceID string) (InstanceAPIResponse, string, error) {
	currentUser := strings.TrimSpace(query.Get("current_user"))
	if currentUser == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "未登录")
	}
	instance, err := queryOneMap(ctx, a.db, "SELECT * FROM flow_instances WHERE id = ?", instanceID)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if instance == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "instance_not_found", "流程实例不存在")
	}
	if cleanAnyString(instance["initiator_uid"]) != currentUser {
		related, err := queryOneMap(ctx, a.db, "SELECT id FROM flow_tasks WHERE instance_id = ? AND assignee_uid = ? LIMIT 1", instanceID, currentUser)
		if err != nil {
			return InstanceAPIResponse{}, "", err
		}
		if related == nil {
			return InstanceAPIResponse{}, "", httperror.New(http.StatusForbidden, "forbidden", "无权查看此流程")
		}
	}
	task, err := a.pendingTaskForUser(ctx, anyInt64(instance["id"]), currentUser)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	data, err := a.instancePayload(ctx, instance, currentUser, task, query.Get("request_app_code"))
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: data}, "workflow.instances.detail", nil
}

func (a *Adapter) instanceByBiz(ctx context.Context, query url.Values) (InstanceAPIResponse, string, error) {
	appCode := strings.TrimSpace(query.Get("app_code"))
	resourceCode := strings.TrimSpace(query.Get("resource_code"))
	bizID := strings.TrimSpace(query.Get("biz_id"))
	actionCode := strings.TrimSpace(query.Get("action_code"))
	if appCode == "" || resourceCode == "" || bizID == "" || actionCode == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "field_required", "缺少必填参数：app_code, resource_code, biz_id, action_code")
	}
	conditions := []string{"app_code = ?", "resource_code = ?", "biz_id = ?", "action_code = ?"}
	args := []any{appCode, resourceCode, bizID, actionCode}
	if query.Get("include_history") != "true" {
		conditions = append(conditions, "status IN ('running', 'suspended')")
	}
	instance, err := queryOneMap(ctx, a.db, `
		SELECT id, instance_no, app_code, resource_code, action_code,
		       biz_id, biz_title, biz_url, biz_context, initiator_uid,
		       status, current_node, flow_snapshot, created_at, completed_at
		FROM flow_instances
		WHERE `+strings.Join(conditions, " AND ")+`
		ORDER BY id DESC LIMIT 1
	`, args...)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if instance == nil {
		return InstanceAPIResponse{Code: 0, Data: nil}, "workflow.instances.by_biz", nil
	}
	currentUser := strings.TrimSpace(query.Get("current_user"))
	task, err := a.pendingTaskForUser(ctx, anyInt64(instance["id"]), currentUser)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	data, err := a.instancePayload(ctx, instance, currentUser, task, query.Get("request_app_code"))
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: data}, "workflow.instances.by_biz", nil
}

func (a *Adapter) instanceByBizHistory(ctx context.Context, query url.Values) (InstanceAPIResponse, string, error) {
	appCode := strings.TrimSpace(query.Get("app_code"))
	resourceCode := strings.TrimSpace(query.Get("resource_code"))
	bizID := strings.TrimSpace(query.Get("biz_id"))
	if appCode == "" || resourceCode == "" || bizID == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "field_required", "缺少必填参数：app_code, resource_code, biz_id")
	}
	instances, err := queryMaps(ctx, a.db, `
		SELECT i.id, i.instance_no, i.action_code,
		       d.name AS action_name,
		       i.biz_title, i.initiator_uid, i.status,
		       i.created_at, i.completed_at
		FROM flow_instances i
		LEFT JOIN flow_action_defs d
		  ON d.app_code = i.app_code
		 AND d.resource_code = i.resource_code
		 AND d.action_code = i.action_code
		WHERE i.app_code = ? AND i.resource_code = ? AND i.biz_id = ?
		ORDER BY i.created_at DESC
	`, appCode, resourceCode, bizID)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if len(instances) == 0 {
		return InstanceAPIResponse{Code: 0, Data: []map[string]any{}}, "workflow.instances.by_biz_history", nil
	}
	ids := make([]any, 0, len(instances))
	placeholders := make([]string, 0, len(instances))
	for _, instance := range instances {
		ids = append(ids, instance["id"])
		placeholders = append(placeholders, "?")
	}
	actions, err := queryMaps(ctx, a.db, `
		SELECT a.instance_id, a.actor_uid, a.action, a.comment, a.created_at,
		       COALESCE(t.node_name, '') AS node_name
		FROM flow_actions a
		LEFT JOIN flow_tasks t ON a.task_id = t.id
		WHERE a.instance_id IN (`+strings.Join(placeholders, ",")+`)
		ORDER BY a.created_at ASC
	`, ids...)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	actionMap := map[string][]map[string]any{}
	for _, action := range actions {
		key := cleanAnyString(action["instance_id"])
		actionMap[key] = append(actionMap[key], map[string]any{
			"actor_uid":  action["actor_uid"],
			"action":     action["action"],
			"comment":    action["comment"],
			"node_name":  action["node_name"],
			"created_at": action["created_at"],
		})
	}
	items := make([]map[string]any, 0, len(instances))
	for _, instance := range instances {
		items = append(items, map[string]any{
			"instance_id":   instance["id"],
			"instance_no":   instance["instance_no"],
			"action_code":   instance["action_code"],
			"action_name":   instance["action_name"],
			"biz_title":     instance["biz_title"],
			"initiator_uid": instance["initiator_uid"],
			"status":        instance["status"],
			"created_at":    instance["created_at"],
			"completed_at":  instance["completed_at"],
			"actions":       actionMap[cleanAnyString(instance["id"])],
		})
	}
	return InstanceAPIResponse{Code: 0, Data: items}, "workflow.instances.by_biz_history", nil
}

func (a *Adapter) approveTask(ctx context.Context, taskID string, rawBody map[string]any) (InstanceAPIResponse, string, error) {
	currentUser := cleanAnyString(rawBody["current_user"])
	if currentUser == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "未登录")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	defer func() { _ = tx.Rollback() }()

	task, err := taskForUpdate(ctx, tx, taskID)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if task == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "task_not_found", "任务不存在")
	}
	if cleanAnyString(task["assignee_uid"]) != currentUser {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusForbidden, "forbidden", "无权操作此任务")
	}
	if cleanAnyString(task["status"]) != "pending" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "task_already_handled", "任务已处理")
	}
	instance, err := queryOneMap(ctx, tx, "SELECT id, status, flow_snapshot FROM flow_instances WHERE id = ? FOR UPDATE", task["instance_id"])
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if instance == nil || cleanAnyString(instance["status"]) != "running" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "flow_not_running", "流程已结束或不存在")
	}

	if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = ?", taskID); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, attachments, created_at)
		VALUES (?, ?, ?, 'approve', ?, ?, NOW())
	`, task["instance_id"], taskID, currentUser, nilIfEmpty(cleanAnyString(rawBody["comment"])), jsonOrNil(rawBody["attachments"])); err != nil {
		return InstanceAPIResponse{}, "", err
	}

	effects, err := advanceFlowRuntime(ctx, tx, anyInt64(task["instance_id"]))
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	updated, err := queryOneMap(ctx, tx, "SELECT status, current_node, flow_snapshot FROM flow_instances WHERE id = ?", task["instance_id"])
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return InstanceAPIResponse{}, "", err
	}

	nextNode := nextNodePayload(updated)
	return InstanceAPIResponse{
		Code:    0,
		Data:    map[string]any{"task_id": parseInt64Fallback(taskID), "instance_id": task["instance_id"], "instance_status": updated["status"], "next_node": nextNode},
		Effects: effects,
	}, "workflow.tasks.approve", nil
}

func (a *Adapter) rejectTask(ctx context.Context, taskID string, rawBody map[string]any) (InstanceAPIResponse, string, error) {
	currentUser := cleanAnyString(rawBody["current_user"])
	comment := cleanAnyString(rawBody["comment"])
	if currentUser == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "未登录")
	}
	if comment == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "comment_required", "驳回意见必填")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	defer func() { _ = tx.Rollback() }()

	task, err := taskForUpdate(ctx, tx, taskID)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if task == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "task_not_found", "任务不存在")
	}
	if cleanAnyString(task["assignee_uid"]) != currentUser {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusForbidden, "forbidden", "无权操作此任务")
	}
	if cleanAnyString(task["status"]) != "pending" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "task_already_handled", "任务已处理")
	}
	instance, err := queryOneMap(ctx, tx, "SELECT * FROM flow_instances WHERE id = ? FOR UPDATE", task["instance_id"])
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if instance == nil || cleanAnyString(instance["status"]) != "running" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "flow_not_running", "流程已结束或不存在")
	}
	flowSnapshot, err := parseJSONObject(cleanAnyString(instance["flow_snapshot"]))
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	config := asStringMap(flowSnapshot["config"])
	rejectStrategy := firstNonEmptyString(cleanAnyString(config["reject_strategy"]), "to_initiator")

	if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = ?", taskID); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, created_at)
		VALUES (?, ?, ?, 'reject', ?, NOW())
	`, task["instance_id"], taskID, currentUser, comment); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'cancelled', updated_at = NOW() WHERE instance_id = ? AND node_index = ? AND status = 'pending' AND id != ?", task["instance_id"], task["node_index"], taskID); err != nil {
		return InstanceAPIResponse{}, "", err
	}

	effects := &WorkflowEffects{}
	nodeIndex := int(anyInt64(task["node_index"]))
	if rejectStrategy == "to_previous" && nodeIndex > 0 {
		prevNodeIndex := nodeIndex - 1
		nodes := asMapSlice(flowSnapshot["nodes"])
		if prevNodeIndex >= len(nodes) {
			return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "invalid_flow_snapshot", "流程快照无效")
		}
		prevNode := nodes[prevNodeIndex]
		if _, err := tx.ExecContext(ctx, "UPDATE flow_instances SET current_node = ?, updated_at = NOW() WHERE id = ?", prevNodeIndex, task["instance_id"]); err != nil {
			return InstanceAPIResponse{}, "", err
		}
		if err := createTasksForNode(ctx, tx, anyInt64(task["instance_id"]), prevNodeIndex, prevNode); err != nil {
			return InstanceAPIResponse{}, "", err
		}
		if uids := resolvedUIDs(prevNode); len(uids) > 0 {
			effects.Notifications = append(effects.Notifications, WorkflowNotification{
				ToUser:      uids,
				Title:       "审批被退回",
				Description: fmt.Sprintf("「%s」被退回至您重新审批，原因：%s", cleanAnyString(instance["biz_title"]), comment),
				URL:         cleanAnyString(instance["biz_url"]),
			})
		}
	} else {
		if _, err := tx.ExecContext(ctx, "UPDATE flow_instances SET status = 'rejected', completed_at = NOW(), updated_at = NOW() WHERE id = ?", task["instance_id"]); err != nil {
			return InstanceAPIResponse{}, "", err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'cancelled', updated_at = NOW() WHERE instance_id = ? AND status = 'pending'", task["instance_id"]); err != nil {
			return InstanceAPIResponse{}, "", err
		}
		effects.Notifications = append(effects.Notifications, WorkflowNotification{
			ToUser:      []string{cleanAnyString(instance["initiator_uid"])},
			Title:       "审批被驳回",
			Description: fmt.Sprintf("您的「%s」被%s驳回，原因：%s", cleanAnyString(instance["biz_title"]), currentUser, comment),
			URL:         cleanAnyString(instance["biz_url"]),
		})
		if callback := callbackEffect(instance, "rejected"); callback.URL != "" {
			effects.Callbacks = append(effects.Callbacks, callback)
		}
	}
	if err := tx.Commit(); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"task_id": parseInt64Fallback(taskID), "instance_id": task["instance_id"], "reject_strategy": rejectStrategy}, Effects: effects}, "workflow.tasks.reject", nil
}

func (a *Adapter) delegateTask(ctx context.Context, taskID string, rawBody map[string]any) (InstanceAPIResponse, string, error) {
	currentUser := cleanAnyString(rawBody["current_user"])
	delegateTo := cleanAnyString(rawBody["delegate_to"])
	if currentUser == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "未登录")
	}
	if delegateTo == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "delegate_required", "被委托人 UID 必填")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	defer func() { _ = tx.Rollback() }()

	task, err := taskForUpdate(ctx, tx, taskID)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if task == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "task_not_found", "任务不存在")
	}
	if cleanAnyString(task["assignee_uid"]) != currentUser {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusForbidden, "forbidden", "无权操作此任务")
	}
	if cleanAnyString(task["status"]) != "pending" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "task_already_handled", "任务已处理")
	}
	instance, err := queryOneMap(ctx, tx, "SELECT id, status, biz_title, biz_url, flow_snapshot FROM flow_instances WHERE id = ? FOR UPDATE", task["instance_id"])
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if instance == nil || cleanAnyString(instance["status"]) != "running" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "flow_not_running", "流程已结束或不存在")
	}
	flowSnapshot, err := parseJSONObject(cleanAnyString(instance["flow_snapshot"]))
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if value, ok := asStringMap(flowSnapshot["config"])["allow_delegate"].(bool); ok && !value {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "delegate_disabled", "该流程不允许委托")
	}
	if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET assignee_uid = ?, updated_at = NOW() WHERE id = ?", delegateTo, taskID); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	comment := cleanAnyString(rawBody["comment"])
	delegateName := firstNonEmptyString(cleanAnyString(rawBody["delegate_name"]), delegateTo)
	if comment == "" {
		comment = "委托给" + delegateName
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, created_at)
		VALUES (?, ?, ?, 'delegate', ?, NOW())
	`, task["instance_id"], taskID, currentUser, comment); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{
		Code: 0,
		Data: map[string]any{"task_id": parseInt64Fallback(taskID), "delegate_to": delegateTo, "delegate_name": delegateName},
		Effects: &WorkflowEffects{Notifications: []WorkflowNotification{{
			ToUser:      []string{delegateTo},
			Title:       "您收到一项委托审批",
			Description: fmt.Sprintf("%s将「%s」的审批委托给您处理", currentUser, cleanAnyString(instance["biz_title"])),
			URL:         cleanAnyString(instance["biz_url"]),
		}}},
	}, "workflow.tasks.delegate", nil
}

func (a *Adapter) cancelInstance(ctx context.Context, instanceID string, rawBody map[string]any) (InstanceAPIResponse, string, error) {
	currentUser := cleanAnyString(rawBody["current_user"])
	if currentUser == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "未登录")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	defer func() { _ = tx.Rollback() }()

	instance, err := queryOneMap(ctx, tx, "SELECT * FROM flow_instances WHERE id = ? FOR UPDATE", instanceID)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if instance == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "instance_not_found", "流程实例不存在")
	}
	if cleanAnyString(instance["initiator_uid"]) != currentUser {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusForbidden, "forbidden", "仅发起人可撤回")
	}
	if cleanAnyString(instance["status"]) != "running" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "invalid_status", "当前状态不可撤回")
	}
	flowSnapshot, err := parseJSONObject(cleanAnyString(instance["flow_snapshot"]))
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if value, ok := asStringMap(flowSnapshot["config"])["allow_withdraw"].(bool); ok && !value {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "withdraw_disabled", "该流程不允许撤回")
	}
	if hasCompleted, err := hasCompletedTaskAfterLastResubmit(ctx, tx, instanceID); err != nil {
		return InstanceAPIResponse{}, "", err
	} else if hasCompleted {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "task_already_completed", "已有审批人操作，无法撤回")
	}
	pendingTasks, err := queryMaps(ctx, tx, "SELECT DISTINCT assignee_uid FROM flow_tasks WHERE instance_id = ? AND node_index = ?", instanceID, instance["current_node"])
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'cancelled', updated_at = NOW() WHERE instance_id = ? AND status = 'pending'", instanceID); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE flow_instances SET status = 'cancelled', completed_at = NOW(), updated_at = NOW() WHERE id = ?", instanceID); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return InstanceAPIResponse{}, "", err
	}

	effects := &WorkflowEffects{}
	uids := make([]string, 0, len(pendingTasks))
	for _, task := range pendingTasks {
		if uid := cleanAnyString(task["assignee_uid"]); uid != "" {
			uids = append(uids, uid)
		}
	}
	if len(uids) > 0 {
		effects.Notifications = append(effects.Notifications, WorkflowNotification{ToUser: uids, Title: "审批已撤回", Description: fmt.Sprintf("%s已撤回「%s」", currentUser, cleanAnyString(instance["biz_title"])), URL: cleanAnyString(instance["biz_url"])})
	}
	if callback := callbackEffect(instance, "cancelled"); callback.URL != "" {
		effects.Callbacks = append(effects.Callbacks, callback)
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"instance_id": instance["id"], "status": "cancelled"}, Effects: effects}, "workflow.instances.cancel", nil
}

func (a *Adapter) resubmitInstance(ctx context.Context, instanceID string, rawBody map[string]any) (InstanceAPIResponse, string, error) {
	currentUser := cleanAnyString(rawBody["current_user"])
	if currentUser == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "未登录")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	defer func() { _ = tx.Rollback() }()

	instance, err := queryOneMap(ctx, tx, "SELECT * FROM flow_instances WHERE id = ? FOR UPDATE", instanceID)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if instance == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "instance_not_found", "流程实例不存在")
	}
	if cleanAnyString(instance["initiator_uid"]) != currentUser {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusForbidden, "forbidden", "仅发起人可重新提交")
	}
	if cleanAnyString(instance["status"]) != "rejected" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "invalid_status", "仅驳回状态可重新提交")
	}
	flowSnapshot, err := parseJSONObject(cleanAnyString(instance["flow_snapshot"]))
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	config := asStringMap(flowSnapshot["config"])
	if value, ok := config["allow_resubmit"].(bool); ok && !value {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "resubmit_disabled", "该流程不允许重新提交")
	}
	bizContext, err := parseJSONObject(cleanAnyString(instance["biz_context"]))
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	formData := map[string]any{}
	if rawBody["form_data"] != nil {
		formData = asStringMap(rawBody["form_data"])
	} else {
		formData, err = parseJSONObject(cleanAnyString(instance["form_data"]))
		if err != nil {
			return InstanceAPIResponse{}, "", err
		}
	}
	initiatorContext := asStringMap(rawBody["initiator_context"])
	fullContext := prepareFlowContext(currentUser, initiatorContext, bizContext, instance["biz_id"], cleanAnyString(instance["biz_title"]), cleanAnyString(instance["instance_no"]), formData)
	nodes, err := resolveSnapshotNodes(asMapSlice(flowSnapshot["nodes"]), fullContext)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	flowSnapshot["nodes"] = nodes
	firstNodeIndex := firstRunnableNode(nodes, fullContext)

	if _, err := tx.ExecContext(ctx, `
		UPDATE flow_instances
		SET status = 'running',
		    current_node = ?,
		    form_data = ?,
		    attachments = COALESCE(?, attachments),
		    flow_snapshot = ?,
		    completed_at = NULL,
		    updated_at = NOW()
		WHERE id = ?
	`, firstNodeIndex, mustJSON(formData), jsonOrNil(rawBody["attachments"]), mustJSON(flowSnapshot), instanceID); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'cancelled', updated_at = NOW() WHERE instance_id = ? AND status = 'pending'", instanceID); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, created_at)
		VALUES (?, NULL, ?, 'resubmit', ?, NOW())
	`, instanceID, currentUser, nilIfEmpty(cleanAnyString(rawBody["comment"]))); err != nil {
		return InstanceAPIResponse{}, "", err
	}

	effects := &WorkflowEffects{}
	if firstNodeIndex < len(nodes) {
		if err := createTasksForNode(ctx, tx, parseInt64Fallback(instanceID), firstNodeIndex, nodes[firstNodeIndex]); err != nil {
			return InstanceAPIResponse{}, "", err
		}
		autoEffects, err := maybeAutoApproveRuntime(ctx, tx, parseInt64Fallback(instanceID), firstNodeIndex, nodes[firstNodeIndex], cleanAnyString(instance["initiator_uid"]))
		if err != nil {
			return InstanceAPIResponse{}, "", err
		}
		mergeEffects(effects, autoEffects)
		if len(autoEffects.Notifications) == 0 && len(autoEffects.Callbacks) == 0 {
			if uids := resolvedUIDs(nodes[firstNodeIndex]); len(uids) > 0 {
				effects.Notifications = append(effects.Notifications, WorkflowNotification{ToUser: uids, Title: "审批重新提交", Description: fmt.Sprintf("%s重新提交了「%s」，请审批", currentUser, cleanAnyString(instance["biz_title"])), URL: cleanAnyString(instance["biz_url"])})
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"instance_id": instance["id"], "status": "running", "current_node": firstNodeIndex}, Effects: effects}, "workflow.instances.resubmit", nil
}

func (a *Adapter) handleAdminRuntime(ctx context.Context, method string, path string, query url.Values, rawBody map[string]any) (InstanceAPIResponse, string, error) {
	switch {
	case method == http.MethodGet && path == "/v1/workflow/admin/action-defs":
		return a.adminListActionDefs(ctx, query)
	case method == http.MethodPost && path == "/v1/workflow/admin/action-defs":
		return a.adminCreateActionDef(ctx, rawBody)
	case method == http.MethodPatch && strings.HasPrefix(path, "/v1/workflow/admin/action-defs/"):
		return a.adminUpdateActionDef(ctx, pathID(path, "/v1/workflow/admin/action-defs/"), rawBody)
	case method == http.MethodDelete && strings.HasPrefix(path, "/v1/workflow/admin/action-defs/"):
		return a.adminDelete(ctx, "flow_action_defs", pathID(path, "/v1/workflow/admin/action-defs/"), "动作定义不存在或已禁用", "workflow.admin.action_defs.delete")
	case method == http.MethodGet && path == "/v1/workflow/admin/flow-schemas":
		return a.adminListFlowSchemas(ctx, query)
	case method == http.MethodPost && path == "/v1/workflow/admin/flow-schemas":
		return a.adminCreateFlowSchema(ctx, rawBody)
	case method == http.MethodGet && path == "/v1/workflow/admin/flow-schemas/templates":
		return a.adminFlowSchemaTemplates(ctx)
	case method == http.MethodGet && strings.HasPrefix(path, "/v1/workflow/admin/flow-schemas/"):
		return a.adminGetJSONSchema(ctx, "flow_schemas", pathID(path, "/v1/workflow/admin/flow-schemas/"), []string{"nodes", "config"}, "流程定义不存在", "workflow.admin.flow_schemas.detail")
	case method == http.MethodPatch && strings.HasPrefix(path, "/v1/workflow/admin/flow-schemas/"):
		return a.adminUpdateFlowSchema(ctx, pathID(path, "/v1/workflow/admin/flow-schemas/"), rawBody)
	case method == http.MethodDelete && strings.HasPrefix(path, "/v1/workflow/admin/flow-schemas/"):
		return a.adminDelete(ctx, "flow_schemas", pathID(path, "/v1/workflow/admin/flow-schemas/"), "流程定义不存在或已禁用", "workflow.admin.flow_schemas.delete")
	case method == http.MethodGet && path == "/v1/workflow/admin/form-schemas":
		return a.adminListFormSchemas(ctx, query)
	case method == http.MethodPost && path == "/v1/workflow/admin/form-schemas":
		return a.adminCreateFormSchema(ctx, rawBody)
	case method == http.MethodGet && strings.HasPrefix(path, "/v1/workflow/admin/form-schemas/"):
		return a.adminGetJSONSchema(ctx, "form_schemas", pathID(path, "/v1/workflow/admin/form-schemas/"), []string{"fields"}, "表单定义不存在", "workflow.admin.form_schemas.detail")
	case method == http.MethodPatch && strings.HasPrefix(path, "/v1/workflow/admin/form-schemas/"):
		return a.adminUpdateFormSchema(ctx, pathID(path, "/v1/workflow/admin/form-schemas/"), rawBody)
	case method == http.MethodDelete && strings.HasPrefix(path, "/v1/workflow/admin/form-schemas/"):
		return a.adminDelete(ctx, "form_schemas", pathID(path, "/v1/workflow/admin/form-schemas/"), "表单定义不存在或已禁用", "workflow.admin.form_schemas.delete")
	case method == http.MethodGet && path == "/v1/workflow/admin/routes":
		return a.adminListRoutes(ctx, query)
	case method == http.MethodPost && path == "/v1/workflow/admin/routes":
		return a.adminCreateRoute(ctx, rawBody)
	case method == http.MethodPatch && strings.HasPrefix(path, "/v1/workflow/admin/routes/"):
		return a.adminUpdateRoute(ctx, pathID(path, "/v1/workflow/admin/routes/"), rawBody)
	case method == http.MethodDelete && strings.HasPrefix(path, "/v1/workflow/admin/routes/"):
		return a.adminDelete(ctx, "flow_routes", pathID(path, "/v1/workflow/admin/routes/"), "路由规则不存在或已禁用", "workflow.admin.routes.delete")
	default:
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "not_found", "Route not found")
	}
}

func (a *Adapter) adminListActionDefs(ctx context.Context, query url.Values) (InstanceAPIResponse, string, error) {
	page := workflowPageParams(query, 20)
	where, args := filteredWhere(query, map[string]string{"resource_code": "a.resource_code"}, []string{"a.action_code", "a.name"})
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) AS total FROM flow_action_defs a "+where, args...).Scan(&total); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	rows, err := queryMaps(ctx, a.db, `
		SELECT a.*, f.code AS form_code, f.name AS form_name,
		       fs.name AS flow_schema_name
		FROM flow_action_defs a
		LEFT JOIN form_schemas f ON a.form_schema_id = f.id
		LEFT JOIN flow_routes fr ON fr.action_def_id = a.id AND fr.is_default = 1 AND fr.status = 1
		LEFT JOIN flow_schemas fs ON fr.flow_schema_id = fs.id
		`+where+`
		ORDER BY a.app_code ASC, a.resource_code ASC, a.sort_order ASC, a.id ASC
		LIMIT ? OFFSET ?
	`, append(args, page.pageSize, page.offset)...)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		item := map[string]any{
			"id":                row["id"],
			"app_code":          row["app_code"],
			"resource_code":     row["resource_code"],
			"action_code":       row["action_code"],
			"name":              row["name"],
			"description":       row["description"],
			"form_schema_id":    row["form_schema_id"],
			"form_schema":       nil,
			"flow_schema_name":  row["flow_schema_name"],
			"embed_url_pattern": row["embed_url_pattern"],
			"icon":              row["icon"],
			"sort_order":        row["sort_order"],
			"source":            firstNonEmptyString(cleanAnyString(row["source"]), "manual"),
			"status":            row["status"],
			"created_by":        row["created_by"],
			"created_at":        row["created_at"],
			"updated_at":        row["updated_at"],
		}
		if row["form_schema_id"] != nil {
			item["form_schema"] = map[string]any{"id": row["form_schema_id"], "code": row["form_code"], "name": row["form_name"]}
		}
		items = append(items, item)
	}
	return pagedAdminResponse(items, total, page), "workflow.admin.action_defs.list", nil
}

func (a *Adapter) adminCreateActionDef(ctx context.Context, body map[string]any) (InstanceAPIResponse, string, error) {
	currentUser := cleanAnyString(body["current_user"])
	appCode := cleanAnyString(body["app_code"])
	resourceCode := cleanAnyString(body["resource_code"])
	actionCode := cleanAnyString(body["action_code"])
	name := cleanAnyString(body["name"])
	if currentUser == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "未登录")
	}
	if appCode == "" || resourceCode == "" || actionCode == "" || name == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "field_required", "app_code, resource_code, action_code, name 必填")
	}
	if exists, err := existsByQuery(ctx, a.db, "SELECT id FROM flow_action_defs WHERE app_code = ? AND resource_code = ? AND action_code = ?", appCode, resourceCode, actionCode); err != nil {
		return InstanceAPIResponse{}, "", err
	} else if exists {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "duplicate_action_code", "该应用资源下的动作编码已存在")
	}
	result, err := a.db.ExecContext(ctx, `
		INSERT INTO flow_action_defs
		  (app_code, resource_code, action_code, name, description, form_schema_id, icon, sort_order, status, created_by, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW(), NOW())
	`, appCode, resourceCode, actionCode, name, nilIfEmpty(cleanAnyString(body["description"])), nullableNumber(body["form_schema_id"]), nilIfEmpty(cleanAnyString(body["icon"])), intValue(body["sort_order"]), currentUser)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	id, _ := result.LastInsertId()
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": id, "resource_code": resourceCode, "action_code": actionCode, "name": name}}, "workflow.admin.action_defs.create", nil
}

func (a *Adapter) adminUpdateActionDef(ctx context.Context, id string, body map[string]any) (InstanceAPIResponse, string, error) {
	current, err := queryOneMap(ctx, a.db, "SELECT id, app_code, resource_code, action_code FROM flow_action_defs WHERE id = ?", id)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if current == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "action_def_not_found", "动作定义不存在")
	}
	checkApp := bodyValue(body, "app_code", current["app_code"])
	checkResource := bodyValue(body, "resource_code", current["resource_code"])
	checkAction := bodyValue(body, "action_code", current["action_code"])
	if _, ok := body["app_code"]; ok || body["resource_code"] != nil || body["action_code"] != nil {
		if exists, err := existsByQuery(ctx, a.db, "SELECT id FROM flow_action_defs WHERE app_code = ? AND resource_code = ? AND action_code = ? AND id != ?", checkApp, checkResource, checkAction, id); err != nil {
			return InstanceAPIResponse{}, "", err
		} else if exists {
			return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "duplicate_action_code", "该应用资源下的动作编码已存在")
		}
	}
	sets := []string{}
	args := []any{}
	addSet := func(key string, column string, transform func(any) any) {
		if value, ok := body[key]; ok {
			sets = append(sets, column+" = ?")
			args = append(args, transform(value))
		}
	}
	addSet("app_code", "app_code", identity)
	addSet("resource_code", "resource_code", identity)
	addSet("action_code", "action_code", identity)
	addSet("name", "name", identity)
	addSet("description", "description", identity)
	addSet("form_schema_id", "form_schema_id", identity)
	addSet("icon", "icon", identity)
	addSet("sort_order", "sort_order", identity)
	addSet("status", "status", identity)
	if len(sets) == 0 {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "empty_update", "没有需要更新的字段")
	}
	sets = append(sets, "updated_at = NOW()")
	args = append(args, id)
	if _, err := a.db.ExecContext(ctx, "UPDATE flow_action_defs SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": parseInt64Fallback(id)}}, "workflow.admin.action_defs.update", nil
}

func (a *Adapter) adminListFlowSchemas(ctx context.Context, query url.Values) (InstanceAPIResponse, string, error) {
	page := workflowPageParams(query, 20)
	whereParts := []string{}
	args := []any{}
	if search := strings.TrimSpace(query.Get("search")); search != "" {
		whereParts = append(whereParts, "(code LIKE ? OR name LIKE ?)")
		args = append(args, like(search), like(search))
	}
	if status := strings.TrimSpace(query.Get("status")); status != "" {
		whereParts = append(whereParts, "status = ?")
		args = append(args, status)
	}
	if isTemplate := strings.TrimSpace(query.Get("is_template")); isTemplate != "" {
		whereParts = append(whereParts, "is_template = ?")
		args = append(args, isTemplate)
	}
	whereSQL := whereSQL(whereParts)
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) AS total FROM flow_schemas "+whereSQL, args...).Scan(&total); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	rows, err := queryMaps(ctx, a.db, `
		SELECT id, code, name, description, version, status, is_template, created_by, created_at, updated_at
		FROM flow_schemas `+whereSQL+`
		ORDER BY is_template DESC, id DESC
		LIMIT ? OFFSET ?
	`, append(args, page.pageSize, page.offset)...)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return pagedAdminResponse(rows, total, page), "workflow.admin.flow_schemas.list", nil
}

func (a *Adapter) adminCreateFlowSchema(ctx context.Context, body map[string]any) (InstanceAPIResponse, string, error) {
	currentUser := cleanAnyString(body["current_user"])
	code := cleanAnyString(body["code"])
	name := cleanAnyString(body["name"])
	if currentUser == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "未登录")
	}
	if code == "" || name == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "field_required", "code, name 必填")
	}
	if exists, err := existsByQuery(ctx, a.db, "SELECT id FROM flow_schemas WHERE code = ?", code); err != nil {
		return InstanceAPIResponse{}, "", err
	} else if exists {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "duplicate_flow_code", "流程编码已存在")
	}
	nodes := body["nodes"]
	config := body["config"]
	fromTemplate := nullableNumber(body["template_id"])
	if fromTemplate != nil {
		template, err := queryOneMap(ctx, a.db, "SELECT id, nodes, config FROM flow_schemas WHERE id = ? AND is_template = 1 AND status = 1", fromTemplate)
		if err != nil {
			return InstanceAPIResponse{}, "", err
		}
		if template == nil {
			return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "template_not_found", "模板不存在或已禁用")
		}
		if nodes == nil {
			nodes, _ = parseAnyJSON(template["nodes"])
		}
		if config == nil {
			config, _ = parseAnyJSON(template["config"])
		}
	}
	if nodes == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "nodes_required", "nodes 必填（或指定 template_id）")
	}
	if config == nil {
		config = map[string]any{}
	}
	result, err := a.db.ExecContext(ctx, `
		INSERT INTO flow_schemas (code, name, description, nodes, config, version, status, is_template, created_by, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, NOW(), NOW())
	`, code, name, nilIfEmpty(cleanAnyString(body["description"])), mustJSON(nodes), mustJSON(config), boolInt(body["is_template"]), currentUser)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	id, _ := result.LastInsertId()
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": id, "code": code, "name": name, "is_template": boolInt(body["is_template"]), "from_template": fromTemplate}}, "workflow.admin.flow_schemas.create", nil
}

func (a *Adapter) adminUpdateFlowSchema(ctx context.Context, id string, body map[string]any) (InstanceAPIResponse, string, error) {
	existing, err := queryOneMap(ctx, a.db, "SELECT id, version FROM flow_schemas WHERE id = ?", id)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if existing == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "flow_schema_not_found", "流程定义不存在")
	}
	if code, ok := body["code"]; ok {
		if exists, err := existsByQuery(ctx, a.db, "SELECT id FROM flow_schemas WHERE code = ? AND id != ?", code, id); err != nil {
			return InstanceAPIResponse{}, "", err
		} else if exists {
			return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "duplicate_flow_code", "流程编码已存在")
		}
	}
	sets, args := jsonSchemaSets(body, []string{"code", "name", "description", "nodes", "config", "status"})
	if len(sets) == 0 {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "empty_update", "没有需要更新的字段")
	}
	sets = append(sets, "version = version + 1", "updated_at = NOW()")
	args = append(args, id)
	if _, err := a.db.ExecContext(ctx, "UPDATE flow_schemas SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": parseInt64Fallback(id), "version": anyInt64(existing["version"]) + 1}}, "workflow.admin.flow_schemas.update", nil
}

func (a *Adapter) adminFlowSchemaTemplates(ctx context.Context) (InstanceAPIResponse, string, error) {
	rows, err := queryMaps(ctx, a.db, `
		SELECT id, code, name, description, nodes, config
		FROM flow_schemas
		WHERE is_template = 1 AND status = 1
		ORDER BY id ASC
	`)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	for _, row := range rows {
		nodes, _ := parseAnyJSON(row["nodes"])
		config, _ := parseAnyJSON(row["config"])
		row["nodes"] = nodes
		row["config"] = config
		row["node_count"] = len(asMapSlice(nodes))
	}
	return InstanceAPIResponse{Code: 0, Data: rows}, "workflow.admin.flow_schemas.templates", nil
}

func (a *Adapter) adminListFormSchemas(ctx context.Context, query url.Values) (InstanceAPIResponse, string, error) {
	page := workflowPageParams(query, 20)
	whereParts := []string{}
	args := []any{}
	if search := strings.TrimSpace(query.Get("search")); search != "" {
		whereParts = append(whereParts, "(code LIKE ? OR name LIKE ?)")
		args = append(args, like(search), like(search))
	}
	if status := strings.TrimSpace(query.Get("status")); status != "" {
		whereParts = append(whereParts, "status = ?")
		args = append(args, status)
	}
	whereSQL := whereSQL(whereParts)
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) AS total FROM form_schemas "+whereSQL, args...).Scan(&total); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	rows, err := queryMaps(ctx, a.db, `
		SELECT id, code, name, description, version, status, created_by, created_at, updated_at
		FROM form_schemas `+whereSQL+`
		ORDER BY id DESC
		LIMIT ? OFFSET ?
	`, append(args, page.pageSize, page.offset)...)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return pagedAdminResponse(rows, total, page), "workflow.admin.form_schemas.list", nil
}

func (a *Adapter) adminCreateFormSchema(ctx context.Context, body map[string]any) (InstanceAPIResponse, string, error) {
	currentUser := cleanAnyString(body["current_user"])
	code := cleanAnyString(body["code"])
	name := cleanAnyString(body["name"])
	if currentUser == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "未登录")
	}
	if code == "" || name == "" || body["fields"] == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "field_required", "code, name, fields 必填")
	}
	if exists, err := existsByQuery(ctx, a.db, "SELECT id FROM form_schemas WHERE code = ?", code); err != nil {
		return InstanceAPIResponse{}, "", err
	} else if exists {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "duplicate_form_code", "表单编码已存在")
	}
	result, err := a.db.ExecContext(ctx, `
		INSERT INTO form_schemas (code, name, description, fields, version, status, created_by, created_at, updated_at)
		VALUES (?, ?, ?, ?, 1, 1, ?, NOW(), NOW())
	`, code, name, nilIfEmpty(cleanAnyString(body["description"])), mustJSON(body["fields"]), currentUser)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	id, _ := result.LastInsertId()
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": id, "code": code, "name": name}}, "workflow.admin.form_schemas.create", nil
}

func (a *Adapter) adminUpdateFormSchema(ctx context.Context, id string, body map[string]any) (InstanceAPIResponse, string, error) {
	existing, err := queryOneMap(ctx, a.db, "SELECT id, version FROM form_schemas WHERE id = ?", id)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if existing == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "form_schema_not_found", "表单定义不存在")
	}
	sets, args := jsonSchemaSets(body, []string{"name", "description", "fields", "status"})
	if len(sets) == 0 {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "empty_update", "没有需要更新的字段")
	}
	sets = append(sets, "version = version + 1", "updated_at = NOW()")
	args = append(args, id)
	if _, err := a.db.ExecContext(ctx, "UPDATE form_schemas SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": parseInt64Fallback(id), "version": anyInt64(existing["version"]) + 1}}, "workflow.admin.form_schemas.update", nil
}

func (a *Adapter) adminListRoutes(ctx context.Context, query url.Values) (InstanceAPIResponse, string, error) {
	page := workflowPageParams(query, 50)
	whereParts := []string{}
	args := []any{}
	if actionDefID := strings.TrimSpace(query.Get("action_def_id")); actionDefID != "" {
		whereParts = append(whereParts, "r.action_def_id = ?")
		args = append(args, actionDefID)
	}
	whereSQL := whereSQL(whereParts)
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) AS total FROM flow_routes r "+whereSQL, args...).Scan(&total); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	rows, err := queryMaps(ctx, a.db, `
		SELECT r.*, f.code AS flow_code, f.name AS flow_name
		FROM flow_routes r
		LEFT JOIN flow_schemas f ON r.flow_schema_id = f.id
		`+whereSQL+`
		ORDER BY r.priority DESC, r.id ASC
		LIMIT ? OFFSET ?
	`, append(args, page.pageSize, page.offset)...)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	for _, row := range rows {
		row["flow_schema"] = map[string]any{"id": row["flow_schema_id"], "code": row["flow_code"], "name": row["flow_name"]}
		row["conditions"], _ = parseAnyJSON(row["conditions"])
		delete(row, "flow_code")
		delete(row, "flow_name")
	}
	return pagedAdminResponse(rows, total, page), "workflow.admin.routes.list", nil
}

func (a *Adapter) adminCreateRoute(ctx context.Context, body map[string]any) (InstanceAPIResponse, string, error) {
	currentUser := cleanAnyString(body["current_user"])
	if currentUser == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "未登录")
	}
	name := cleanAnyString(body["name"])
	actionDefID := nullableNumber(body["action_def_id"])
	flowSchemaID := nullableNumber(body["flow_schema_id"])
	if actionDefID == nil || flowSchemaID == nil || name == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "field_required", "action_def_id, flow_schema_id, name 必填")
	}
	if exists, err := existsByQuery(ctx, a.db, "SELECT id FROM flow_action_defs WHERE id = ?", actionDefID); err != nil {
		return InstanceAPIResponse{}, "", err
	} else if !exists {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "action_def_not_found", "动作定义不存在")
	}
	if exists, err := existsByQuery(ctx, a.db, "SELECT id FROM flow_schemas WHERE id = ?", flowSchemaID); err != nil {
		return InstanceAPIResponse{}, "", err
	} else if !exists {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "flow_schema_not_found", "流程定义不存在")
	}
	result, err := a.db.ExecContext(ctx, `
		INSERT INTO flow_routes
		  (action_def_id, flow_schema_id, name, description, level, conditions, priority, is_default, status, created_by, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW(), NOW())
	`, actionDefID, flowSchemaID, name, nilIfEmpty(cleanAnyString(body["description"])), nullableNumber(body["level"]), mustJSON(defaultMap(asStringMap(body["conditions"]))), intValue(body["priority"]), boolInt(body["is_default"]), currentUser)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	id, _ := result.LastInsertId()
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": id, "name": name}}, "workflow.admin.routes.create", nil
}

func (a *Adapter) adminUpdateRoute(ctx context.Context, id string, body map[string]any) (InstanceAPIResponse, string, error) {
	if exists, err := existsByQuery(ctx, a.db, "SELECT id FROM flow_routes WHERE id = ?", id); err != nil {
		return InstanceAPIResponse{}, "", err
	} else if !exists {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "route_not_found", "路由规则不存在")
	}
	sets := []string{}
	args := []any{}
	addSet := func(key string, column string, transform func(any) any) {
		if value, ok := body[key]; ok {
			sets = append(sets, column+" = ?")
			args = append(args, transform(value))
		}
	}
	addSet("flow_schema_id", "flow_schema_id", identity)
	addSet("name", "name", identity)
	addSet("description", "description", identity)
	addSet("level", "level", nullableNumber)
	addSet("conditions", "conditions", func(v any) any { return mustJSON(v) })
	addSet("priority", "priority", identity)
	addSet("is_default", "is_default", func(v any) any { return boolInt(v) })
	addSet("status", "status", identity)
	if len(sets) == 0 {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "empty_update", "没有需要更新的字段")
	}
	sets = append(sets, "updated_at = NOW()")
	args = append(args, id)
	if _, err := a.db.ExecContext(ctx, "UPDATE flow_routes SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": parseInt64Fallback(id)}}, "workflow.admin.routes.update", nil
}

func (a *Adapter) adminGetJSONSchema(ctx context.Context, table string, id string, jsonColumns []string, notFound string, operation string) (InstanceAPIResponse, string, error) {
	row, err := queryOneMap(ctx, a.db, "SELECT * FROM "+table+" WHERE id = ?", id)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if row == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "record_not_found", notFound)
	}
	for _, column := range jsonColumns {
		row[column], _ = parseAnyJSON(row[column])
	}
	return InstanceAPIResponse{Code: 0, Data: row}, operation, nil
}

func (a *Adapter) adminDelete(ctx context.Context, table string, id string, notFound string, operation string) (InstanceAPIResponse, string, error) {
	if exists, err := existsByQuery(ctx, a.db, "SELECT id FROM "+table+" WHERE id = ? AND status = 1", id); err != nil {
		return InstanceAPIResponse{}, "", err
	} else if !exists {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "record_not_found", notFound)
	}
	if _, err := a.db.ExecContext(ctx, "UPDATE "+table+" SET status = 0, updated_at = NOW() WHERE id = ?", id); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": parseInt64Fallback(id)}}, operation, nil
}

type queryContext interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

type execQueryContext interface {
	queryContext
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func queryMaps(ctx context.Context, conn queryContext, query string, args ...any) ([]map[string]any, error) {
	rows, err := conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return rowsToMaps(rows)
}

func queryOneMap(ctx context.Context, conn queryContext, query string, args ...any) (map[string]any, error) {
	rows, err := queryMaps(ctx, conn, query, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0], nil
}

func rowsToMaps(rows *sql.Rows) ([]map[string]any, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0)
	values := make([]any, len(columns))
	targets := make([]any, len(columns))
	for i := range values {
		targets[i] = &values[i]
	}
	for rows.Next() {
		if err := rows.Scan(targets...); err != nil {
			return nil, err
		}
		item := make(map[string]any, len(columns))
		for i, column := range columns {
			item[column] = normalizeSQLValue(values[i])
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func normalizeSQLValue(value any) any {
	switch typed := value.(type) {
	case nil:
		return nil
	case []byte:
		return string(typed)
	case time.Time:
		return typed.UTC().Format("2006-01-02 15:04:05")
	default:
		return typed
	}
}

func workflowPageParams(query url.Values, defaultSize int) workflowPage {
	page := parsePositiveInt(firstNonEmptyString(query.Get("page"), "1"), 1)
	pageSize := parsePositiveInt(firstNonEmptyString(query.Get("page_size"), query.Get("pageSize"), strconv.Itoa(defaultSize)), defaultSize)
	page = clampInt(page, 1, 100000)
	pageSize = clampInt(pageSize, 1, 1000)
	return workflowPage{page: page, pageSize: pageSize, offset: (page - 1) * pageSize}
}

func parsePositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func clampInt(value int, min int, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func pathID(path string, prefix string) string {
	return strings.TrimSpace(strings.TrimPrefix(path, prefix))
}

func pathActionID(path string, prefix string, suffix string) string {
	return strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix))
}

func taskForUpdate(ctx context.Context, tx *sql.Tx, taskID string) (map[string]any, error) {
	return queryOneMap(ctx, tx, "SELECT * FROM flow_tasks WHERE id = ? FOR UPDATE", taskID)
}

func (a *Adapter) pendingTaskForUser(ctx context.Context, instanceID int64, currentUser string) (map[string]any, error) {
	if currentUser == "" || instanceID == 0 {
		return nil, nil
	}
	return queryOneMap(ctx, a.db, "SELECT id, assignee_uid, status FROM flow_tasks WHERE instance_id = ? AND assignee_uid = ? AND status = 'pending' LIMIT 1", instanceID, currentUser)
}

func (a *Adapter) instancePayload(ctx context.Context, instance map[string]any, currentUser string, task map[string]any, requestAppCode string) (map[string]any, error) {
	instanceID := anyInt64(instance["id"])
	tasks, err := queryMaps(ctx, a.db, "SELECT * FROM flow_tasks WHERE instance_id = ? ORDER BY node_index ASC, id ASC", instanceID)
	if err != nil {
		return nil, err
	}
	actions, err := queryMaps(ctx, a.db, `
		SELECT a.id, a.task_id, a.actor_uid, a.action, a.comment, a.attachments, a.created_at,
		       t.node_index, t.node_name
		FROM flow_actions a
		LEFT JOIN flow_tasks t ON a.task_id = t.id
		WHERE a.instance_id = ?
		ORDER BY a.created_at ASC
	`, instanceID)
	if err != nil {
		return nil, err
	}
	flowSnapshot, err := parseAnyJSON(instance["flow_snapshot"])
	if err != nil {
		return nil, err
	}
	bizContext, err := parseAnyJSON(instance["biz_context"])
	if err != nil {
		return nil, err
	}
	formData, err := parseAnyJSON(instance["form_data"])
	if err != nil {
		return nil, err
	}
	attachments, err := parseAnyJSON(instance["attachments"])
	if err != nil {
		return nil, err
	}
	actionName, embedURLPattern, err := a.actionDefDisplay(ctx, instance["action_def_id"])
	if err != nil {
		return nil, err
	}
	instance["flow_snapshot"] = flowSnapshot
	instance["biz_context"] = bizContext
	return map[string]any{
		"id":            instance["id"],
		"instance_id":   instance["id"],
		"instance_no":   instance["instance_no"],
		"action_def_id": instance["action_def_id"],
		"app_code":      instance["app_code"],
		"resource_code": instance["resource_code"],
		"action_code":   instance["action_code"],
		"action_name":   actionName,
		"biz_id":        instance["biz_id"],
		"biz_title":     instance["biz_title"],
		"biz_url":       instance["biz_url"],
		"biz_context":   bizContext,
		"form_data":     formData,
		"attachments":   attachments,
		"initiator_uid": instance["initiator_uid"],
		"status":        instance["status"],
		"current_node":  instance["current_node"],
		"flow_snapshot": flowSnapshot,
		"created_at":    instance["created_at"],
		"completed_at":  instance["completed_at"],
		"updated_at":    instance["updated_at"],
		"tasks":         normalizeTasks(tasks),
		"actions":       normalizeActions(actions),
		"capabilities":  buildRuntimeCapabilities(instance, task, currentUser),
		"business_view": buildRuntimeBusinessView(instance, embedURLPattern, requestAppCode),
	}, nil
}

func taskDetailPayload(task map[string]any, instancePayload map[string]any) map[string]any {
	return map[string]any{
		"task":          normalizeTask(task),
		"instance":      instancePayload,
		"tasks":         instancePayload["tasks"],
		"actions":       instancePayload["actions"],
		"capabilities":  instancePayload["capabilities"],
		"business_view": instancePayload["business_view"],
	}
}

func normalizeTasks(tasks []map[string]any) []map[string]any {
	result := make([]map[string]any, 0, len(tasks))
	for _, task := range tasks {
		result = append(result, normalizeTask(task))
	}
	return result
}

func normalizeTask(task map[string]any) map[string]any {
	if task == nil {
		return nil
	}
	return map[string]any{
		"id":              task["id"],
		"instance_id":     task["instance_id"],
		"node_index":      task["node_index"],
		"node_name":       task["node_name"],
		"assignee_uid":    task["assignee_uid"],
		"task_type":       task["task_type"],
		"status":          task["status"],
		"due_at":          task["due_at"],
		"completed_at":    task["completed_at"],
		"created_at":      task["created_at"],
		"task_created_at": task["created_at"],
	}
}

func normalizeActions(actions []map[string]any) []map[string]any {
	result := make([]map[string]any, 0, len(actions))
	for _, action := range actions {
		attachments, _ := parseAnyJSON(action["attachments"])
		result = append(result, map[string]any{
			"id":          action["id"],
			"node_index":  action["node_index"],
			"node_name":   action["node_name"],
			"task_id":     action["task_id"],
			"actor_uid":   action["actor_uid"],
			"action":      action["action"],
			"comment":     action["comment"],
			"attachments": attachments,
			"created_at":  action["created_at"],
		})
	}
	return result
}

func buildRuntimeCapabilities(instance map[string]any, task map[string]any, currentUser string) map[string]bool {
	isAssignee := task != nil && cleanAnyString(task["assignee_uid"]) == currentUser && cleanAnyString(task["status"]) == "pending"
	isInitiator := currentUser != "" && cleanAnyString(instance["initiator_uid"]) == currentUser
	status := cleanAnyString(instance["status"])
	config := map[string]any{}
	if snapshot, ok := instance["flow_snapshot"].(map[string]any); ok {
		config = asStringMap(snapshot["config"])
	}
	return map[string]bool{
		"can_approve":  isAssignee && status == "running",
		"can_reject":   isAssignee && status == "running",
		"can_delegate": isAssignee && status == "running" && truthy(config["allow_delegate"]),
		"can_cancel":   isInitiator && status == "running" && truthy(config["allow_withdraw"]),
		"can_resubmit": isInitiator && status == "rejected" && truthy(config["allow_resubmit"]),
		"can_comment":  status == "running",
	}
}

func (a *Adapter) actionDefDisplay(ctx context.Context, actionDefID any) (string, string, error) {
	row, err := queryOneMap(ctx, a.db, "SELECT name, embed_url_pattern FROM flow_action_defs WHERE id = ?", actionDefID)
	if err != nil || row == nil {
		return "", "", err
	}
	return cleanAnyString(row["name"]), cleanAnyString(row["embed_url_pattern"]), nil
}

func buildRuntimeBusinessView(instance map[string]any, embedURLPattern string, requestAppCode string) map[string]any {
	mode := "external-link"
	embedURL := any(nil)
	if embedURLPattern != "" {
		if requestAppCode != "" && requestAppCode == cleanAnyString(instance["app_code"]) {
			mode = "local"
		} else {
			mode = "iframe"
		}
		embedURL = renderEmbedURL(embedURLPattern, instance)
	}
	return map[string]any{
		"mode":          mode,
		"app_code":      instance["app_code"],
		"resource_code": instance["resource_code"],
		"biz_id":        instance["biz_id"],
		"biz_url":       instance["biz_url"],
		"embed_url":     embedURL,
	}
}

func renderEmbedURL(pattern string, instance map[string]any) string {
	result := strings.ReplaceAll(pattern, "{resource_code}", cleanAnyString(instance["resource_code"]))
	result = strings.ReplaceAll(result, "{biz_id}", cleanAnyString(instance["biz_id"]))
	if context, ok := instance["biz_context"].(map[string]any); ok {
		for strings.Contains(result, "{biz_context.") {
			start := strings.Index(result, "{biz_context.")
			end := strings.Index(result[start:], "}")
			if end < 0 {
				break
			}
			token := result[start : start+end+1]
			key := strings.TrimSuffix(strings.TrimPrefix(token, "{biz_context."), "}")
			result = strings.ReplaceAll(result, token, cleanAnyString(contextValue(context, key)))
		}
	}
	return result
}

func nextNodePayload(updated map[string]any) any {
	if updated == nil || cleanAnyString(updated["status"]) != "running" {
		return nil
	}
	snapshot, err := parseAnyJSON(updated["flow_snapshot"])
	if err != nil {
		return nil
	}
	nodes := asMapSlice(snapshotValue(snapshot, "nodes"))
	index := int(anyInt64(updated["current_node"]))
	if index < 0 || index >= len(nodes) {
		return nil
	}
	node := nodes[index]
	assignees := make([]map[string]any, 0)
	for _, assignee := range resolvedAssignees(node) {
		assignees = append(assignees, map[string]any{"uid": assignee.UID, "name": assignee.Name})
	}
	return map[string]any{"name": node["name"], "assignees": assignees}
}

func advanceFlowRuntime(ctx context.Context, tx *sql.Tx, instanceID int64) (*WorkflowEffects, error) {
	effects := &WorkflowEffects{}
	instance, err := queryOneMap(ctx, tx, "SELECT * FROM flow_instances WHERE id = ? FOR UPDATE", instanceID)
	if err != nil || instance == nil || cleanAnyString(instance["status"]) != "running" {
		return effects, err
	}
	flowSnapshot, err := parseJSONObject(cleanAnyString(instance["flow_snapshot"]))
	if err != nil {
		return nil, err
	}
	nodes := asMapSlice(flowSnapshot["nodes"])
	currentNode := int(anyInt64(instance["current_node"]))
	if currentNode < 0 || currentNode >= len(nodes) {
		return effects, nil
	}
	currentNodeDef := nodes[currentNode]
	nodeType := cleanAnyString(currentNodeDef["type"])
	if nodeType == "approve" || nodeType == "countersign" {
		tasks, err := queryMaps(ctx, tx, "SELECT * FROM flow_tasks WHERE instance_id = ? AND node_index = ?", instanceID, currentNode)
		if err != nil {
			return nil, err
		}
		if len(tasks) == 0 {
			return effects, nil
		}
		approveMode := firstNonEmptyString(cleanAnyString(currentNodeDef["approve_mode"]), "any")
		completed := 0
		for _, task := range tasks {
			if cleanAnyString(task["status"]) == "completed" {
				completed++
			}
		}
		done := false
		switch approveMode {
		case "all":
			done = true
			for _, task := range tasks {
				status := cleanAnyString(task["status"])
				if status != "completed" && status != "cancelled" {
					done = false
					break
				}
			}
		case "count", "ratio":
			done = completed >= calculateApproveThreshold(currentNodeDef, len(tasks))
			if done {
				if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'cancelled', updated_at = NOW() WHERE instance_id = ? AND node_index = ? AND status = 'pending'", instanceID, currentNode); err != nil {
					return nil, err
				}
			}
		default:
			done = completed > 0
			if done {
				if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'cancelled', updated_at = NOW() WHERE instance_id = ? AND node_index = ? AND status = 'pending'", instanceID, currentNode); err != nil {
					return nil, err
				}
			}
		}
		if !done {
			return effects, nil
		}
	}

	bizContext, _ := parseJSONObject(cleanAnyString(instance["biz_context"]))
	formData, _ := parseJSONObject(cleanAnyString(instance["form_data"]))
	flowContext := copyMap(bizContext)
	flowContext["initiator_uid"] = instance["initiator_uid"]
	flowContext["initiator_dept_code"] = bizContext["dept_code"]
	flowContext["resource_dept_code"] = bizContext["resource_dept_code"]
	flowContext["form_data"] = formData

	nextIndex := currentNode + 1
	for nextIndex < len(nodes) {
		if !evaluateSkipWhen(asStringMap(nodes[nextIndex]["skip_when"]), flowContext) {
			break
		}
		if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'skipped', updated_at = NOW() WHERE instance_id = ? AND node_index = ? AND status = 'pending'", instanceID, nextIndex); err != nil {
			return nil, err
		}
		nextIndex++
	}
	if nextIndex >= len(nodes) {
		if _, err := tx.ExecContext(ctx, "UPDATE flow_instances SET status = 'approved', current_node = ?, completed_at = NOW(), updated_at = NOW() WHERE id = ?", currentNode, instanceID); err != nil {
			return nil, err
		}
		if nonSelf, err := existsByQuery(ctx, tx, "SELECT id FROM flow_actions WHERE instance_id = ? AND action = 'approve' AND actor_uid != ? LIMIT 1", instanceID, instance["initiator_uid"]); err != nil {
			return nil, err
		} else if nonSelf {
			effects.Notifications = append(effects.Notifications, WorkflowNotification{ToUser: []string{cleanAnyString(instance["initiator_uid"])}, Title: "审批已通过", Description: fmt.Sprintf("您的「%s」已全部审批通过", cleanAnyString(instance["biz_title"])), URL: cleanAnyString(instance["biz_url"])})
		}
		if callback := callbackEffect(instance, "approved"); callback.URL != "" {
			effects.Callbacks = append(effects.Callbacks, callback)
		}
		return effects, nil
	}
	nextNode := nodes[nextIndex]
	if _, err := tx.ExecContext(ctx, "UPDATE flow_instances SET current_node = ?, updated_at = NOW() WHERE id = ?", nextIndex, instanceID); err != nil {
		return nil, err
	}
	if err := createTasksForNode(ctx, tx, instanceID, nextIndex, nextNode); err != nil {
		return nil, err
	}
	autoEffects, err := maybeAutoApproveRuntime(ctx, tx, instanceID, nextIndex, nextNode, cleanAnyString(instance["initiator_uid"]))
	if err != nil {
		return nil, err
	}
	if len(autoEffects.Notifications) > 0 || len(autoEffects.Callbacks) > 0 {
		mergeEffects(effects, autoEffects)
		return effects, nil
	}
	if uids := resolvedUIDs(nextNode); len(uids) > 0 {
		effects.Notifications = append(effects.Notifications, WorkflowNotification{ToUser: uids, Title: "您有新的审批待办", Description: fmt.Sprintf("%s - %s，请审批", cleanAnyString(instance["biz_title"]), cleanAnyString(nextNode["name"])), URL: cleanAnyString(instance["biz_url"])})
	}
	return effects, nil
}

func maybeAutoApproveRuntime(ctx context.Context, tx *sql.Tx, instanceID int64, nodeIndex int, node map[string]any, initiatorUID string) (*WorkflowEffects, error) {
	effects := &WorkflowEffects{}
	if !isExplicitInitiatorApprovalNode(node, initiatorUID) {
		return effects, nil
	}
	taskIDs, err := pendingTaskIDs(ctx, tx, instanceID, nodeIndex)
	if err != nil {
		return nil, err
	}
	if len(taskIDs) == 0 {
		return effects, nil
	}
	for _, taskID := range taskIDs {
		if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = ?", taskID); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, created_at)
			VALUES (?, ?, ?, 'approve', ?, NOW())
		`, instanceID, taskID, initiatorUID, "系统自动通过（发起人自审批）"); err != nil {
			return nil, err
		}
	}
	return advanceFlowRuntime(ctx, tx, instanceID)
}

func calculateApproveThreshold(node map[string]any, totalTasks int) int {
	threshold := asStringMap(node["approve_threshold"])
	required := 1.0
	switch cleanAnyString(node["approve_mode"]) {
	case "all":
		required = float64(totalTasks)
	case "count":
		if value, ok := numberValue(threshold["count"]); ok {
			required = value
		}
	case "ratio":
		ratio := 1.0
		if value, ok := numberValue(threshold["ratio"]); ok {
			ratio = value
		}
		raw := float64(totalTasks) * ratio
		switch cleanAnyString(threshold["round"]) {
		case "floor_plus_one":
			required = mathFloor(raw) + 1
		case "floor":
			required = mathFloor(raw)
		default:
			required = mathCeil(raw)
		}
	}
	min := 1.0
	if value, ok := numberValue(threshold["min"]); ok {
		min = value
	}
	max := float64(totalTasks)
	if value, ok := numberValue(threshold["max"]); ok {
		max = value
	}
	value := int(mathCeil(required))
	if value < int(min) {
		value = int(min)
	}
	if value > int(max) {
		value = int(max)
	}
	if value > totalTasks {
		value = totalTasks
	}
	if value < 1 {
		value = 1
	}
	return value
}

func callbackEffect(instance map[string]any, status string) WorkflowCallback {
	callbackURL := cleanAnyString(instance["callback_url"])
	if callbackURL == "" {
		return WorkflowCallback{}
	}
	formData, _ := parseAnyJSON(instance["form_data"])
	return WorkflowCallback{
		URL: callbackURL,
		Payload: map[string]any{
			"event":         "flow_completed",
			"instance_id":   instance["id"],
			"instance_no":   instance["instance_no"],
			"app_code":      instance["app_code"],
			"resource_code": instance["resource_code"],
			"action_code":   instance["action_code"],
			"biz_id":        instance["biz_id"],
			"status":        status,
			"form_data":     formData,
			"completed_at":  time.Now().UTC().Format(time.RFC3339),
			"initiator_uid": instance["initiator_uid"],
		},
	}
}

func mergeEffects(target *WorkflowEffects, source *WorkflowEffects) {
	if target == nil || source == nil {
		return
	}
	target.Notifications = append(target.Notifications, source.Notifications...)
	target.Callbacks = append(target.Callbacks, source.Callbacks...)
}

func hasCompletedTaskAfterLastResubmit(ctx context.Context, tx *sql.Tx, instanceID string) (bool, error) {
	lastResubmit, err := queryOneMap(ctx, tx, `
		SELECT created_at FROM flow_actions
		WHERE instance_id = ? AND action = 'resubmit'
		ORDER BY created_at DESC LIMIT 1
	`, instanceID)
	if err != nil {
		return false, err
	}
	if lastResubmit != nil {
		return existsByQuery(ctx, tx, "SELECT id FROM flow_tasks WHERE instance_id = ? AND status = 'completed' AND completed_at > ? LIMIT 1", instanceID, lastResubmit["created_at"])
	}
	return existsByQuery(ctx, tx, "SELECT id FROM flow_tasks WHERE instance_id = ? AND status = 'completed' LIMIT 1", instanceID)
}

func existsByQuery(ctx context.Context, conn queryContext, query string, args ...any) (bool, error) {
	row, err := queryOneMap(ctx, conn, query, args...)
	return row != nil, err
}

func parseAnyJSON(value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	if record, ok := value.(map[string]any); ok {
		return record, nil
	}
	if items, ok := value.([]any); ok {
		return items, nil
	}
	raw := cleanAnyString(value)
	if raw == "" {
		return nil, nil
	}
	var parsed any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil, err
	}
	return parsed, nil
}

func jsonOrNil(value any) any {
	if value == nil {
		return nil
	}
	return mustJSON(value)
}

func anyInt64(value any) int64 {
	switch typed := value.(type) {
	case int:
		return int64(typed)
	case int64:
		return typed
	case int32:
		return int64(typed)
	case uint64:
		return int64(typed)
	case float64:
		return int64(typed)
	case []byte:
		return parseInt64Fallback(string(typed))
	case string:
		return parseInt64Fallback(typed)
	default:
		return 0
	}
}

func parseInt64Fallback(value string) int64 {
	parsed, _ := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	return parsed
}

func intValue(value any) int64 {
	return anyInt64(value)
}

func nullableNumber(value any) any {
	if value == nil || strings.TrimSpace(cleanAnyString(value)) == "" {
		return nil
	}
	return anyInt64(value)
}

func boolInt(value any) int {
	if truthy(value) {
		return 1
	}
	return 0
}

func identity(value any) any {
	return value
}

func bodyValue(body map[string]any, key string, fallback any) any {
	if value, ok := body[key]; ok {
		return value
	}
	return fallback
}

func filteredWhere(query url.Values, equals map[string]string, searchColumns []string) (string, []any) {
	parts := []string{}
	args := []any{}
	for key, column := range equals {
		if value := strings.TrimSpace(query.Get(key)); value != "" {
			parts = append(parts, column+" = ?")
			args = append(args, value)
		}
	}
	if search := strings.TrimSpace(query.Get("search")); search != "" && len(searchColumns) > 0 {
		searchParts := make([]string, 0, len(searchColumns))
		for _, column := range searchColumns {
			searchParts = append(searchParts, column+" LIKE ?")
			args = append(args, like(search))
		}
		parts = append(parts, "("+strings.Join(searchParts, " OR ")+")")
	}
	return whereSQL(parts), args
}

func whereSQL(parts []string) string {
	if len(parts) == 0 {
		return ""
	}
	return "WHERE " + strings.Join(parts, " AND ")
}

func like(value string) string {
	return "%" + value + "%"
}

func pagedAdminResponse(items []map[string]any, total int64, page workflowPage) InstanceAPIResponse {
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"items": items, "total": total, "page": page.page, "page_size": page.pageSize}}
}

func jsonSchemaSets(body map[string]any, keys []string) ([]string, []any) {
	sets := []string{}
	args := []any{}
	jsonColumns := map[string]bool{"nodes": true, "config": true, "fields": true}
	for _, key := range keys {
		value, ok := body[key]
		if !ok {
			continue
		}
		sets = append(sets, key+" = ?")
		if jsonColumns[key] {
			args = append(args, mustJSON(value))
		} else {
			args = append(args, value)
		}
	}
	return sets, args
}

func snapshotValue(snapshot any, key string) any {
	if record, ok := snapshot.(map[string]any); ok {
		return record[key]
	}
	return nil
}

func mathFloor(value float64) float64 {
	return float64(int(value))
}

func mathCeil(value float64) float64 {
	if value == float64(int(value)) {
		return value
	}
	return float64(int(value) + 1)
}
