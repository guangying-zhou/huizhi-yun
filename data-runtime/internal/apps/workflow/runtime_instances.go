package workflow

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// handleInstanceReadRuntime owns the read-only /instances route family. Keep
// the business lookup routes before generic instance detail so their actor
// delegation contract cannot be bypassed by the detail route.
func (a *Adapter) handleInstanceReadRuntime(ctx context.Context, path string, query url.Values) (InstanceAPIResponse, string, error) {
	switch {
	case path == "/v1/workflow/instances/by-biz":
		return a.instanceByBiz(ctx, query)
	case path == "/v1/workflow/instances/by-biz-history":
		return a.instanceByBizHistory(ctx, query)
	case !strings.Contains(strings.TrimPrefix(path, "/v1/workflow/instances/"), "/"):
		return a.instanceDetail(ctx, query, pathID(path, "/v1/workflow/instances/"))
	default:
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "not_found", "Route not found")
	}
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
	data, err := a.instancePayload(ctx, instance, currentUser, task, "")
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: data}, "workflow.instances.detail", nil
}

func (a *Adapter) instanceByBiz(ctx context.Context, query url.Values) (InstanceAPIResponse, string, error) {
	currentUser := strings.TrimSpace(query.Get("current_user"))
	if currentUser == "" || query.Get("hzy_runtime_actor_delegated") != "1" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusForbidden, "trusted_workflow_actor_required", "trusted actor is required for business instance reads")
	}
	appCode := strings.TrimSpace(query.Get("app_code"))
	resourceCode := strings.TrimSpace(query.Get("resource_code"))
	bizID := strings.TrimSpace(query.Get("biz_id"))
	actionCode := strings.TrimSpace(query.Get("action_code"))
	if appCode == "" || resourceCode == "" || bizID == "" || actionCode == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "field_required", "缺少必填参数：app_code, resource_code, biz_id, action_code")
	}
	conditions := []string{"app_code = ?", "resource_code = ?", "biz_id = ?", "action_code = ?", `(
		initiator_uid = ?
		OR EXISTS (SELECT 1 FROM flow_tasks participant_task WHERE participant_task.instance_id = flow_instances.id AND participant_task.assignee_uid = ?)
		OR EXISTS (SELECT 1 FROM flow_actions participant_action WHERE participant_action.instance_id = flow_instances.id AND participant_action.actor_uid = ?)
	)`}
	args := []any{appCode, resourceCode, bizID, actionCode, currentUser, currentUser, currentUser}
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
	task, err := a.pendingTaskForUser(ctx, anyInt64(instance["id"]), currentUser)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	data, err := a.instancePayload(ctx, instance, currentUser, task, "")
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: data}, "workflow.instances.by_biz", nil
}

func (a *Adapter) instanceByBizHistory(ctx context.Context, query url.Values) (InstanceAPIResponse, string, error) {
	currentUser := strings.TrimSpace(query.Get("current_user"))
	if currentUser == "" || query.Get("hzy_runtime_actor_delegated") != "1" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusForbidden, "trusted_workflow_actor_required", "trusted actor is required for business instance history reads")
	}
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
		  AND (
		    i.initiator_uid = ?
		    OR EXISTS (SELECT 1 FROM flow_tasks participant_task WHERE participant_task.instance_id = i.id AND participant_task.assignee_uid = ?)
		    OR EXISTS (SELECT 1 FROM flow_actions participant_action WHERE participant_action.instance_id = i.id AND participant_action.actor_uid = ?)
		  )
		ORDER BY i.created_at DESC
	`, appCode, resourceCode, bizID, currentUser, currentUser, currentUser)
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
