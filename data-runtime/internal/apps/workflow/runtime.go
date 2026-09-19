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
	if err := a.reconcileAimsMilestoneProjectDirector(ctx, query); err != nil {
		return InstanceAPIResponse{}, "workflow.aims_milestone_project_director.reconcile", err
	}
	body := workflowRuntimeBodyFromRequest(query, rawBody)
	switch {
	case method == http.MethodPost && path == "/v1/workflow/service/aims-work-item-completion-approval":
		response, err := a.executeAimsCompletionApproval(ctx, body)
		return response, "workflow.service.aims_work_item_completion_approval", err
	case method == http.MethodPost && path == "/v1/workflow/service/codocs-publish-approval":
		response, err := a.executeCodocsPublishApproval(ctx, body)
		return response, "workflow.service.codocs_publish_approval", err
	case method == http.MethodPost && path == "/v1/workflow/service/finance-invoice-approval":
		response, err := a.executeFinanceInvoiceApproval(ctx, body)
		return response, "workflow.service.finance_invoice_approval", err
	case method == http.MethodPost && path == "/v1/workflow/notification-details/authorize":
		return a.authorizeNotificationDetail(ctx, body)
	case method == http.MethodGet && path == "/v1/workflow/actionable-lifecycle-effects/pending":
		limit, _ := strconv.Atoi(query.Get("limit"))
		return a.pendingActionableLifecycleOutbox(ctx, limit)
	case method == http.MethodGet && path == "/v1/workflow/callback-effects/pending":
		limit, _ := strconv.Atoi(query.Get("limit"))
		return a.pendingWorkflowCallbacks(ctx, limit)
	case method == http.MethodPost && strings.HasSuffix(path, "/ack") && strings.HasPrefix(path, "/v1/workflow/callback-effects/"):
		return a.acknowledgeWorkflowCallback(ctx, pathActionID(path, "/v1/workflow/callback-effects/", "/ack"))
	case method == http.MethodPost && strings.HasSuffix(path, "/fail") && strings.HasPrefix(path, "/v1/workflow/callback-effects/"):
		return a.failWorkflowCallback(ctx, pathActionID(path, "/v1/workflow/callback-effects/", "/fail"), body)
	case method == http.MethodPost && strings.HasSuffix(path, "/ack") && strings.HasPrefix(path, "/v1/workflow/actionable-lifecycle-effects/"):
		return a.acknowledgeActionableLifecycleOutbox(ctx, pathActionID(path, "/v1/workflow/actionable-lifecycle-effects/", "/ack"))
	case method == http.MethodPost && strings.HasSuffix(path, "/fail") && strings.HasPrefix(path, "/v1/workflow/actionable-lifecycle-effects/"):
		return a.failActionableLifecycleOutbox(ctx, pathActionID(path, "/v1/workflow/actionable-lifecycle-effects/", "/fail"))
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
		return a.approveTask(ctx, pathActionID(path, "/v1/workflow/tasks/", "/approve"), body)
	case method == http.MethodPost && strings.HasSuffix(path, "/reject") && strings.HasPrefix(path, "/v1/workflow/tasks/"):
		return a.rejectTask(ctx, pathActionID(path, "/v1/workflow/tasks/", "/reject"), body)
	case method == http.MethodPost && strings.HasSuffix(path, "/delegate") && strings.HasPrefix(path, "/v1/workflow/tasks/"):
		return a.delegateTask(ctx, pathActionID(path, "/v1/workflow/tasks/", "/delegate"), body)
	case method == http.MethodGet && strings.HasPrefix(path, "/v1/workflow/instances/"):
		return a.handleInstanceReadRuntime(ctx, path, query)
	case method == http.MethodPost && strings.HasSuffix(path, "/cancel") && strings.HasPrefix(path, "/v1/workflow/instances/"):
		return a.cancelInstance(ctx, pathActionID(path, "/v1/workflow/instances/", "/cancel"), body)
	case method == http.MethodPost && strings.HasSuffix(path, "/resubmit") && strings.HasPrefix(path, "/v1/workflow/instances/"):
		return a.resubmitInstance(ctx, pathActionID(path, "/v1/workflow/instances/", "/resubmit"), body)
	case strings.HasPrefix(path, "/v1/workflow/admin/"):
		return a.handleAdminRuntime(ctx, method, path, query, body)
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
	data, err := a.instancePayload(ctx, instance, currentUser, task, "")
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: taskDetailPayload(task, data)}, "workflow.tasks.detail", nil
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
	actionResult, err := tx.ExecContext(ctx, `
		INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, attachments, created_at)
		VALUES (?, ?, ?, 'approve', ?, ?, NOW())
	`, task["instance_id"], taskID, currentUser, nilIfEmpty(cleanAnyString(rawBody["comment"])), jsonOrNil(rawBody["attachments"]))
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	actionID, err := actionResult.LastInsertId()
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}

	effects, err := advanceFlowRuntime(ctx, tx, anyInt64(task["instance_id"]), actionID)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	effects.ActionableLifecycles = append([]WorkflowActionableLifecycle{
		lifecycleForTask(task, actionEventVersion(actionID), "resolved", currentUser),
	}, effects.ActionableLifecycles...)
	updated, err := queryOneMap(ctx, tx, "SELECT status, current_node, flow_snapshot FROM flow_instances WHERE id = ?", task["instance_id"])
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if err := persistActionableLifecycleEffects(ctx, tx, task["instance_id"], actionID, effects); err != nil {
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
	actionResult, err := tx.ExecContext(ctx, `
		INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, created_at)
		VALUES (?, ?, ?, 'reject', ?, NOW())
	`, task["instance_id"], taskID, currentUser, comment)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	actionID, err := actionResult.LastInsertId()
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	var pendingEffects []WorkflowActionableLifecycle
	if rejectStrategy == "to_previous" && int(anyInt64(task["node_index"])) > 0 {
		pendingEffects, err = pendingActionableLifecycleEffectsForGeneration(ctx, tx, task["instance_id"], cleanAnyString(task["generation_key"]), actionEventVersion(actionID), "cancelled")
	} else {
		pendingEffects, err = pendingActionableLifecycleEffects(ctx, tx, task["instance_id"], actionEventVersion(actionID), "cancelled")
	}
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'cancelled', updated_at = NOW() WHERE instance_id = ? AND generation_key = ? AND status = 'pending' AND id != ?", task["instance_id"], task["generation_key"], taskID); err != nil {
		return InstanceAPIResponse{}, "", err
	}

	effects := &WorkflowEffects{ActionableLifecycles: append(
		[]WorkflowActionableLifecycle{lifecycleForTask(task, actionEventVersion(actionID), "resolved", currentUser)},
		pendingEffects...,
	)}
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
		newTaskIDs, err := createTasksForNode(ctx, tx, anyInt64(task["instance_id"]), prevNodeIndex, prevNode)
		if err != nil {
			return InstanceAPIResponse{}, "", err
		}
		if uids := resolvedUIDs(prevNode); len(uids) > 0 {
			effects.Notifications = append(effects.Notifications, newWorkflowNotification(
				uids, "审批被退回",
				fmt.Sprintf("「%s」被退回至您重新审批，原因：%s", cleanAnyString(instance["biz_title"]), comment),
				cleanAnyString(instance["biz_url"]), "workflow.instance.rejected", taskEventVersion(newTaskIDs), "warning", notificationTargetFromInstance(instance),
				map[string]any{"instanceId": task["instance_id"], "actionId": actionID, "taskIds": newTaskIDs, "rejectStrategy": rejectStrategy},
			))
		}
	} else {
		if _, err := tx.ExecContext(ctx, "UPDATE flow_instances SET status = 'rejected', completed_at = NOW(), updated_at = NOW() WHERE id = ?", task["instance_id"]); err != nil {
			return InstanceAPIResponse{}, "", err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'cancelled', updated_at = NOW() WHERE instance_id = ? AND status = 'pending'", task["instance_id"]); err != nil {
			return InstanceAPIResponse{}, "", err
		}
		effects.Notifications = append(effects.Notifications, newWorkflowNotification(
			[]string{cleanAnyString(instance["initiator_uid"])}, "审批被驳回",
			fmt.Sprintf("您的「%s」被%s驳回，原因：%s", cleanAnyString(instance["biz_title"]), currentUser, comment),
			cleanAnyString(instance["biz_url"]), "workflow.instance.rejected", actionEventVersion(actionID), "warning", notificationTargetFromInstance(instance),
			map[string]any{"instanceId": task["instance_id"], "actionId": actionID, "taskId": parseInt64Fallback(taskID), "rejectStrategy": rejectStrategy},
		))
		if callback := callbackEffect(instance, "rejected"); callback.URL != "" {
			if err := bindCompletionApprovalEvidence(ctx, tx, &callback, instance, actionID); err != nil {
				return InstanceAPIResponse{}, "", err
			}
			effects.Callbacks = append(effects.Callbacks, callback)
		}
	}
	if err := persistActionableLifecycleEffects(ctx, tx, task["instance_id"], actionID, effects); err != nil {
		return InstanceAPIResponse{}, "", err
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
	instance, err := queryOneMap(ctx, tx, "SELECT id, app_code, resource_code, biz_id, status, biz_title, biz_url, flow_snapshot FROM flow_instances WHERE id = ? FOR UPDATE", task["instance_id"])
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
	comment := cleanAnyString(rawBody["comment"])
	delegateName := firstNonEmptyString(cleanAnyString(rawBody["delegate_name"]), delegateTo)
	if comment == "" {
		comment = "委托给" + delegateName
	}
	actionResult, err := tx.ExecContext(ctx, `
		INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, created_at)
		VALUES (?, ?, ?, 'delegate', ?, NOW())
	`, task["instance_id"], taskID, currentUser, comment)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	actionID, err := actionResult.LastInsertId()
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	delegateKey := delegatedTaskActionableKey(parseInt64Fallback(taskID), actionID)
	delegateVersion := actionEventVersion(actionID)
	if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET assignee_uid = ?, actionable_key = ?, actionable_version = ?, updated_at = NOW() WHERE id = ?", delegateTo, delegateKey, delegateVersion, taskID); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	delegateEffects := &WorkflowEffects{
		Notifications: []WorkflowNotification{newWorkflowNotification(
			[]string{delegateTo}, "您收到一项委托审批",
			fmt.Sprintf("%s将「%s」的审批委托给您处理", currentUser, cleanAnyString(instance["biz_title"])),
			cleanAnyString(instance["biz_url"]), "workflow.task.delegated", delegateVersion, "info", notificationTargetFromInstance(instance),
			map[string]any{"instanceId": task["instance_id"], "actionId": actionID, "taskId": parseInt64Fallback(taskID), "delegateTo": delegateTo, "actionableKey": delegateKey},
		)},
		ActionableLifecycles: []WorkflowActionableLifecycle{lifecycleForTask(task, delegateVersion, "resolved", currentUser)},
	}
	if err := persistActionableLifecycleEffects(ctx, tx, task["instance_id"], actionID, delegateEffects); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{
		Code:    0,
		Data:    map[string]any{"task_id": parseInt64Fallback(taskID), "delegate_to": delegateTo, "delegate_name": delegateName},
		Effects: delegateEffects,
	}, "workflow.tasks.delegate", nil
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

func advanceFlowRuntime(ctx context.Context, tx *sql.Tx, instanceID int64, triggeringActionID int64) (*WorkflowEffects, error) {
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
		tasks, err := queryMaps(ctx, tx, `
			SELECT task.*
			FROM flow_tasks AS task
			INNER JOIN flow_actions AS action ON action.id = ?
			INNER JOIN flow_tasks AS triggering_task ON triggering_task.id = action.task_id
			WHERE task.instance_id = ?
			  AND task.node_index = ?
			  AND task.generation_key = triggering_task.generation_key
			ORDER BY task.id
		`, triggeringActionID, instanceID, currentNode)
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
				effects.ActionableLifecycles = append(effects.ActionableLifecycles, actionableLifecycleEffectsForTasks(pendingTasksOnly(tasks), actionEventVersion(triggeringActionID), "cancelled")...)
				if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'cancelled', updated_at = NOW() WHERE instance_id = ? AND generation_key = ? AND status = 'pending'", instanceID, cleanAnyString(tasks[0]["generation_key"])); err != nil {
					return nil, err
				}
			}
		default:
			done = completed > 0
			if done {
				effects.ActionableLifecycles = append(effects.ActionableLifecycles, actionableLifecycleEffectsForTasks(pendingTasksOnly(tasks), actionEventVersion(triggeringActionID), "cancelled")...)
				if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'cancelled', updated_at = NOW() WHERE instance_id = ? AND generation_key = ? AND status = 'pending'", instanceID, cleanAnyString(tasks[0]["generation_key"])); err != nil {
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
			effects.Notifications = append(effects.Notifications, newWorkflowNotification(
				[]string{cleanAnyString(instance["initiator_uid"])}, "审批已通过",
				fmt.Sprintf("您的「%s」已全部审批通过", cleanAnyString(instance["biz_title"])), cleanAnyString(instance["biz_url"]),
				"workflow.instance.approved", actionEventVersion(triggeringActionID), "success", notificationTargetFromInstance(instance),
				map[string]any{"instanceId": instanceID, "actionId": triggeringActionID},
			))
		}
		if callback := callbackEffect(instance, "approved"); callback.URL != "" {
			if err := bindCompletionApprovalEvidence(ctx, tx, &callback, instance, triggeringActionID); err != nil {
				return nil, err
			}
			effects.Callbacks = append(effects.Callbacks, callback)
		}
		return effects, nil
	}
	nextNode := nodes[nextIndex]
	if _, err := tx.ExecContext(ctx, "UPDATE flow_instances SET current_node = ?, updated_at = NOW() WHERE id = ?", nextIndex, instanceID); err != nil {
		return nil, err
	}
	nextTaskIDs, err := createTasksForNode(ctx, tx, instanceID, nextIndex, nextNode)
	if err != nil {
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
		effects.Notifications = append(effects.Notifications, newWorkflowNotification(
			uids, "您有新的审批待办", fmt.Sprintf("%s - %s，请审批", cleanAnyString(instance["biz_title"]), cleanAnyString(nextNode["name"])),
			cleanAnyString(instance["biz_url"]), "workflow.task.created", taskEventVersion(nextTaskIDs), "info", notificationTargetFromInstance(instance),
			map[string]any{"instanceId": instanceID, "taskIds": nextTaskIDs, "nodeIndex": nextIndex},
		))
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
	triggeringActionID := int64(0)
	for _, taskID := range taskIDs {
		if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = ?", taskID); err != nil {
			return nil, err
		}
		actionResult, err := tx.ExecContext(ctx, `
			INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, created_at)
			VALUES (?, ?, ?, 'approve', ?, NOW())
		`, instanceID, taskID, initiatorUID, "系统自动通过（发起人自审批）")
		if err != nil {
			return nil, err
		}
		triggeringActionID, err = actionResult.LastInsertId()
		if err != nil {
			return nil, err
		}
	}
	return advanceFlowRuntime(ctx, tx, instanceID, triggeringActionID)
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
	callbackPath := trustedWorkflowCallbackPath(cleanAnyString(instance["app_code"]), cleanAnyString(instance["callback_url"]))
	if callbackPath == "" {
		return WorkflowCallback{}
	}
	formData, _ := parseAnyJSON(instance["form_data"])
	return WorkflowCallback{
		URL: callbackPath,
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

// Workflow callbacks are service-token-bearing writes. The instance may retain
// a legacy callback_url for migration, but dispatch only accepts the exact
// registered Service API path for its immutable app_code; the supplied origin,
// query, and fragment are never used.
func trustedWorkflowCallbackPath(appCode, raw string) string {
	allowed := map[string]string{
		"codocs":  "/api/reviews/workflow-callback",
		"finance": "/api/v1/finance/workflow/callback",
		"people":  "/api/v1/service/workflow/callback",
		"aims":    "/api/v1/service/workflow/callback",
	}
	expected := allowed[strings.TrimSpace(appCode)]
	if expected == "" || strings.TrimSpace(raw) == "" {
		return ""
	}
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if appCode == "aims" && err == nil && parsed.Path == aimsCompletionWorkflowCallback {
		expected = aimsCompletionWorkflowCallback
	}
	if err != nil || parsed.User != nil || parsed.ForceQuery || parsed.RawQuery != "" || parsed.Fragment != "" || strings.Contains(raw, "#") || parsed.Path != expected {
		return ""
	}
	return expected
}

func mergeEffects(target *WorkflowEffects, source *WorkflowEffects) {
	if target == nil || source == nil {
		return
	}
	target.Notifications = append(target.Notifications, source.Notifications...)
	target.ActionableLifecycles = append(target.ActionableLifecycles, source.ActionableLifecycles...)
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
func like(value string) string {
	return "%" + value + "%"
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
