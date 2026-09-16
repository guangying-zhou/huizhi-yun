package workflow

import (
	"context"
	"fmt"
	"net/http"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// cancelInstance and resubmitInstance are the initiator-owned lifecycle writes
// for an existing workflow instance.  They stay together so their transaction,
// lifecycle-outbox and callback behavior cannot drift from the instance routes.
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
	pendingEffects, err := pendingActionableLifecycleEffects(ctx, tx, instanceID, "", "cancelled")
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'cancelled', updated_at = NOW() WHERE instance_id = ? AND status = 'pending'", instanceID); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE flow_instances SET status = 'cancelled', completed_at = NOW(), updated_at = NOW() WHERE id = ?", instanceID); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	actionResult, err := tx.ExecContext(ctx, `
		INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, created_at)
		VALUES (?, NULL, ?, 'withdraw', ?, NOW())
	`, instanceID, currentUser, nilIfEmpty(cleanAnyString(rawBody["comment"])))
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	actionID, err := actionResult.LastInsertId()
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	for index := range pendingEffects {
		pendingEffects[index].NextVersion = actionEventVersion(actionID)
	}
	effects := &WorkflowEffects{ActionableLifecycles: pendingEffects}
	if callback := callbackEffect(instance, "cancelled"); callback.URL != "" {
		effects.Callbacks = append(effects.Callbacks, callback)
	}
	if err := persistActionableLifecycleEffects(ctx, tx, instanceID, actionID, effects); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return InstanceAPIResponse{}, "", err
	}

	uids := make([]string, 0)
	for _, lifecycle := range pendingEffects {
		uids = append(uids, lifecycle.Recipients...)
	}
	uids = uniqueSortedUIDs(uids)
	if len(uids) > 0 {
		effects.Notifications = append(effects.Notifications, newWorkflowNotification(
			uids, "审批已撤回", fmt.Sprintf("%s已撤回「%s」", currentUser, cleanAnyString(instance["biz_title"])),
			cleanAnyString(instance["biz_url"]), "workflow.instance.withdrawn", actionEventVersion(actionID), "warning", notificationTargetFromInstance(instance),
			map[string]any{"instanceId": instance["id"], "actionId": actionID},
		))
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
	oldPendingEffects, err := pendingActionableLifecycleEffects(ctx, tx, instanceID, "", "cancelled")
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'cancelled', updated_at = NOW() WHERE instance_id = ? AND status = 'pending'", instanceID); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	actionResult, err := tx.ExecContext(ctx, `
		INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, created_at)
		VALUES (?, NULL, ?, 'resubmit', ?, NOW())
	`, instanceID, currentUser, nilIfEmpty(cleanAnyString(rawBody["comment"])))
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	resubmitActionID, err := actionResult.LastInsertId()
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}

	for index := range oldPendingEffects {
		oldPendingEffects[index].NextVersion = actionEventVersion(resubmitActionID)
	}
	effects := &WorkflowEffects{ActionableLifecycles: oldPendingEffects}
	if firstNodeIndex < len(nodes) {
		taskIDs, err := createTasksForNode(ctx, tx, parseInt64Fallback(instanceID), firstNodeIndex, nodes[firstNodeIndex])
		if err != nil {
			return InstanceAPIResponse{}, "", err
		}
		autoEffects, err := maybeAutoApproveRuntime(ctx, tx, parseInt64Fallback(instanceID), firstNodeIndex, nodes[firstNodeIndex], cleanAnyString(instance["initiator_uid"]))
		if err != nil {
			return InstanceAPIResponse{}, "", err
		}
		mergeEffects(effects, autoEffects)
		if len(autoEffects.Notifications) == 0 && len(autoEffects.Callbacks) == 0 {
			if uids := resolvedUIDs(nodes[firstNodeIndex]); len(uids) > 0 {
				effects.Notifications = append(effects.Notifications, newWorkflowNotification(
					uids, "审批重新提交", fmt.Sprintf("%s重新提交了「%s」，请审批", currentUser, cleanAnyString(instance["biz_title"])),
					cleanAnyString(instance["biz_url"]), "workflow.instance.resubmitted", taskEventVersion(taskIDs), "info", notificationTargetFromInstance(instance),
					map[string]any{"instanceId": instance["id"], "actionId": resubmitActionID, "taskIds": taskIDs},
				))
			}
		}
	}
	if err := persistActionableLifecycleEffects(ctx, tx, instanceID, resubmitActionID, effects); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"instance_id": instance["id"], "status": "running", "current_node": firstNodeIndex}, Effects: effects}, "workflow.instances.resubmit", nil
}
