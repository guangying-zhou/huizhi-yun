package workflow

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	aims "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	directory "github.com/huizhi-yun/data-runtime/internal/apps/directory"
	"github.com/huizhi-yun/data-runtime/internal/apps/workflow/internal/lane"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/http"
	"strconv"
	"strings"
)

type completionLane struct {
	registry                                               *e.Registry
	binding                                                e.Binding
	aims                                                   *aims.Adapter
	directory                                              *directory.Adapter
	sourceDeployment, workerDeployment, workflowDeployment string
}

func (a *Adapter) ConfigureCompletionLane(registry *e.Registry, binding e.Binding, source, worker, workflowDeployment string, aimsAdapter *aims.Adapter, directoryAdapter *directory.Adapter) error {
	if registry == nil || aimsAdapter == nil || directoryAdapter == nil || source == "" || worker == "" || workflowDeployment == "" {
		return e.ErrBindingMismatch
	}
	req := e.ResolveRequest{Key: binding.Key, Domain: "workflow", Operation: e.Write, OwnerDeployment: binding.Domains["workflow"].OwnerDeployment, SchemaVersion: binding.SchemaVersion, Generation: binding.Generation}
	rs, err := registry.Resolve(req)
	if err != nil || rs.DB != a.db {
		return e.ErrBindingMismatch
	}
	a.completion = &completionLane{registry: registry, binding: binding, aims: aimsAdapter, directory: directoryAdapter, sourceDeployment: source, workerDeployment: worker, workflowDeployment: workflowDeployment}
	return nil
}
func laneError(err error) error {
	if errors.Is(err, e.ErrCompletionObjectMissing) {
		return httperror.New(404, "completion_object_not_found", "Completion object not found")
	}
	return err
}
func completionLaneRequirements(kind string) e.WorkflowTransactionRequirements {
	names := append(aims.EnterpriseCompletionTransactionViewNames(), "aims_projects", "aims_project_members", "work_items", "work_item_changelog", "project_activity_logs")
	if kind == "matter" {
		names = append(names, aims.EnterpriseCompletionArtifactViewNames()...)
	}
	return e.WorkflowTransactionRequirements{Aims: names, Workflow: []string{"flow_action_defs", "flow_routes", "flow_schemas", "flow_instances", "flow_tasks", "flow_actions", "flow_notification_outbox", "flow_actionable_outbox", "flow_callback_logs"}}
}

// RequestCompletion preserves the signed Host boundary; no body field selects
// an internal lane or bypasses the owning Aims permit/relationship checks.
func (a *Adapter) RequestCompletion(ctx context.Context, id aims.EnterpriseProjectUpdateIdentity, project, item, kind string, input map[string]any) (map[string]any, error) {
	c := a.completion
	if c == nil {
		return nil, httperror.New(503, "workflow_lane_unavailable", "Workflow lane unavailable")
	}
	if id.SourceDeployment != c.sourceDeployment || id.Tenant != c.binding.Key.Tenant || id.TargetDeployment != c.binding.Key.RuntimeDeployment || id.ServiceClientID != "enterprise.runtime" || id.CommandScope == nil {
		return nil, httperror.New(403, "workflow_lane_binding_invalid", "Completion identity is invalid")
	}
	if id.ActorUID == id.ServiceClientID || id.ActorUID == "client:"+id.ServiceClientID || strings.HasPrefix(id.ActorUID, "system:") {
		return nil, subjectDenied()
	}
	snap, err := c.directory.ReadWorkflowInitiatorSnapshot(ctx, id.ActorUID)
	if err != nil {
		return nil, err
	}
	people, err := a.completionRequestEmployees(ctx, id.ActorUID, project, item, kind, snap)
	if err != nil {
		return nil, err
	}
	if !people.Allows(id.ActorUID) {
		return nil, subjectDenied()
	}
	pid, err := strconv.ParseInt(project, 10, 64)
	if err != nil {
		return nil, httperror.New(400, "invalid_project_id", "Invalid project")
	}
	iid, err := strconv.ParseInt(item, 10, 64)
	if err != nil {
		return nil, httperror.New(400, "invalid_item_id", "Invalid item")
	}
	h, err := lane.OpenRequest(ctx, c.registry, c.binding, e.CompletionLocks{ProjectID: pid, WorkItemIDs: []int64{iid}}, completionLaneRequirements(kind), snap, people)
	if err != nil {
		return nil, laneError(err)
	}
	defer h.Rollback()
	ctx = lane.Context(ctx, h)
	out, err := c.aims.RequestCompletionInLane(ctx, h, id, project, item, kind, input)
	if err != nil {
		return nil, err
	}
	cmd, err := c.aims.CompletionCommandInLane(ctx, h, cleanAnyString(out["receiptId"]))
	if err != nil {
		return nil, err
	}
	tx, rs, _ := h.WorkflowTransaction()
	repo, err := a.enterpriseReceiptRepository(rs)
	if err != nil {
		return nil, err
	}
	raw, _ := json.Marshal(cmd)
	hash, err := iop.ValidateAndDigestCommand(cmd)
	if err != nil {
		return nil, err
	}
	schema := "v1"
	if kind == "matter" {
		schema = "v2"
	}
	key := cleanAnyString(cmd["idempotencyKey"])
	ri := iop.ReceiptCommandInput{TrustedContext: iop.TrustedContext{TenantCode: id.Tenant, DeploymentCode: c.workerDeployment, SourceApp: "aims", ServiceClientID: "aims.lane", RequestID: "lane:" + id.RequestID}, SourceDeploymentCode: c.workerDeployment, TargetDeploymentCode: rs.OwnerDeployment, TargetApp: "workflow", OperationID: stableCompletionLaneOperationID(id.Tenant, "request:"+key), OperationCode: "aims.completion.request.lane." + schema, RequiredCapability: aimsCompletionWorkflowCapability, IdempotencyKey: key, CommandSchemaVersion: schema, CommandSHA256: hash, Command: raw, OriginalActorUID: id.ActorUID}
	executed, err := repo.ExecuteInTransaction(ctx, tx, ri, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (iop.ReceiptBusinessResult, error) {
		action, err := actionDefByKeyOn(ctx, tx, "aims", "tasks", "complete")
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if action == nil {
			return iop.ReceiptBusinessResult{}, httperror.New(503, "workflow_route_not_found", "Completion action unavailable")
		}
		frozen, err := c.aims.CompletionDirectoryInLane(ctx, h, cleanAnyString(out["receiptId"]))
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		full := prepareFlowContext(id.ActorUID, frozen, cmd["bizContext"].(map[string]any), item, cleanAnyString(cmd["bizTitle"]), "", cmd["formData"].(map[string]any))
		routes, err := matchRoutesOn(ctx, tx, action.ID, full)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if len(routes) == 0 {
			return iop.ReceiptBusinessResult{}, httperror.New(503, "workflow_route_not_found", "No completion route matches the Directory snapshot")
		}
		created, err := a.createInstanceTx(ctx, tx, map[string]any{"action_def_id": action.ID, "route_id": routes[0].ID, "biz_id": item, "biz_title": cmd["bizTitle"], "biz_url": "/work-items/" + item, "biz_context": cmd["bizContext"], "form_data": cmd["formData"], "attachments": []any{}, "callback_url": aimsCompletionWorkflowCallback, "current_user": id.ActorUID, "initiator_context": frozen})
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		data := created.Data.(map[string]any)
		if cleanAnyString(data["status"]) != "running" {
			return iop.ReceiptBusinessResult{}, httperror.New(409, "completion_approval_route_required", "Completion requires a human approval route")
		}
		return iop.ReceiptBusinessResult{TargetBizType: "work_item_completion_workflow", TargetBizCode: "completion-request:" + cleanAnyString(cmd["completionRequestId"]), HTTPStatus: 200, Value: created}, nil
	})
	if err != nil {
		return nil, workflowServiceCommandError(err)
	}
	instance, number, err := a.restoreCompletionInstanceOn(ctx, tx, cmd, anyInt64(cmd["completionRequestId"]), iid, id.ActorUID)
	if err != nil {
		return nil, err
	}
	if err = c.aims.BindCompletionInstanceInLane(ctx, h, cmd, instance, number, executed.ReceiptID); err != nil {
		return nil, err
	}
	if err = h.Commit(); err != nil {
		return nil, err
	}
	// Effects are returned only after commit; durable outboxes recover lost replies.
	out["workflowInstanceId"] = instance
	out["workflowInstanceNo"] = number
	// Durable outboxes are drained after commit; internal effects never reach Host/browser.
	delete(out, "effects")
	return out, nil
}
func subjectDenied() error {
	return httperror.New(403, "workflow_subject_type_not_allowed", "Only employee subjects may participate in this Workflow lane")
}

// Decision hints are read without locks, then revalidated after the canonical
// Aims -> Workflow lock plan. No Directory lookup occurs under business locks.
func (a *Adapter) completionTaskHint(ctx context.Context, taskID string) (map[string]any, map[string]any, error) {
	task, err := queryOneMap(ctx, a.db, "SELECT * FROM flow_tasks WHERE id=?", taskID)
	if err != nil {
		return nil, nil, err
	}
	if task == nil {
		return nil, nil, httperror.New(409, "completion_binding_changed", "Completion task missing")
	}
	instance, err := queryOneMap(ctx, a.db, "SELECT * FROM flow_instances WHERE id=?", task["instance_id"])
	if err == nil && instance == nil {
		err = httperror.New(409, "completion_binding_changed", "Completion instance missing")
	}
	return task, instance, err
}
func isCompletionInstance(instance map[string]any) bool {
	return instance != nil && cleanAnyString(instance["app_code"]) == "aims" && cleanAnyString(instance["resource_code"]) == "tasks" && cleanAnyString(instance["action_code"]) == "complete" && trustedWorkflowCallbackPath("aims", cleanAnyString(instance["callback_url"])) == aimsCompletionWorkflowCallback
}
func (a *Adapter) decideCompletion(ctx context.Context, taskID, action string, body map[string]any) (InstanceAPIResponse, string, bool, error) {
	c := a.completion
	if c == nil {
		return InstanceAPIResponse{}, "", false, nil
	}
	var task, instance map[string]any
	var err error
	if action == "cancel" {
		instance, err = queryOneMap(ctx, a.db, "SELECT * FROM flow_instances WHERE id=?", taskID)
		if instance == nil && err == nil {
			err = httperror.New(409, "completion_binding_changed", "Completion instance missing")
		}
		task = map[string]any{"id": int64(0), "instance_id": taskID, "assignee_uid": body["current_user"]}
	} else {
		task, instance, err = a.completionTaskHint(ctx, taskID)
	}
	if err != nil {
		return InstanceAPIResponse{}, "", true, err
	}
	if !isCompletionInstance(instance) {
		return InstanceAPIResponse{}, "", false, nil
	}
	operation := "workflow.tasks." + action
	if action == "cancel" {
		operation = "workflow.instances.cancel"
	}
	fail := func(err error) (InstanceAPIResponse, string, bool, error) {
		return InstanceAPIResponse{}, operation, true, err
	}
	actor := cleanAnyString(body["current_user"])
	key := cleanAnyString(body["idempotency_key"])
	if key == "" || len(key) > 191 {
		return fail(httperror.New(400, "idempotency_key_required", "Idempotency-Key is required"))
	}
	if strings.HasPrefix(actor, "system:") || actor == "" || actor == cleanAnyString(body["hzy_runtime_service_client_id"]) || actor == "client:"+cleanAnyString(body["hzy_runtime_service_client_id"]) {
		return fail(subjectDenied())
	}
	uids := []string{actor}
	if action == "delegate" {
		uids = append(uids, cleanAnyString(body["delegate_to"]))
	}
	// Only previously recorded evidence can enter the terminal callback. This hint
	// is rechecked by the locked callback; concurrent unseen actors fail closed.
	if action == "approve" || action == "reject" {
		rows, readErr := queryMaps(ctx, a.db, `SELECT actor_uid FROM flow_actions WHERE instance_id=? AND action=? AND id > COALESCE((SELECT MAX(previous.id) FROM flow_actions previous WHERE previous.instance_id=? AND previous.action='resubmit'),0)`, instance["id"], action, instance["id"])
		if readErr != nil {
			return fail(readErr)
		}
		for _, row := range rows {
			uids = append(uids, cleanAnyString(row["actor_uid"]))
		}
	}
	people, err := c.directory.ReadWorkflowEmployees(ctx, uids)
	if err != nil {
		return fail(err)
	}
	if !people.Allows(actor) {
		return fail(subjectDenied())
	}
	if action == "delegate" && !people.Allows(cleanAnyString(body["delegate_to"])) {
		return fail(subjectDenied())
	}
	form, err := parseJSONObject(cleanAnyString(instance["form_data"]))
	if err != nil {
		return fail(httperror.New(409, "completion_binding_invalid", "Completion binding invalid"))
	}
	locks := e.CompletionLocks{ProjectID: anyInt64(form["projectId"]), WorkItemIDs: []int64{anyInt64(form["workItemId"])}, RequestIDs: []int64{anyInt64(form["completionRequestId"])}, InstanceID: anyInt64(instance["id"]), TaskIDs: []int64{anyInt64(task["id"])}}
	if action == "cancel" {
		locks.TaskIDs = nil
	}
	h, err := lane.OpenDecision(ctx, c.registry, c.binding, locks, completionLaneRequirements(cleanAnyString(form["kind"])), people)
	if err != nil {
		return fail(completionDecisionLaneError(err))
	}
	defer h.Rollback()
	tx, rs, _ := h.WorkflowTransaction()
	ctx = lane.Context(ctx, h)
	ctx = context.WithValue(ctx, completionOwnerContextKey{}, c)
	lockedTask := task
	if action != "cancel" {
		lockedTask, err = queryOneMap(ctx, tx, "SELECT * FROM flow_tasks WHERE id=?", taskID)
	}
	if err != nil {
		return fail(err)
	}
	lockedInstance, err := queryOneMap(ctx, tx, "SELECT * FROM flow_instances WHERE id=?", instance["id"])
	if err != nil {
		return fail(err)
	}
	if lockedTask == nil || !isCompletionInstance(lockedInstance) || cleanAnyString(lockedTask["instance_id"]) != cleanAnyString(task["instance_id"]) || cleanAnyString(lockedTask["generation_key"]) != cleanAnyString(task["generation_key"]) || cleanAnyString(lockedInstance["form_data"]) != cleanAnyString(instance["form_data"]) {
		return fail(httperror.New(409, "completion_binding_changed", "Completion binding changed"))
	}
	if cleanAnyString(lockedTask["assignee_uid"]) != actor {
		return fail(httperror.New(403, "forbidden", "Not the current assignee"))
	}
	if action == "cancel" && actor != cleanAnyString(lockedInstance["initiator_uid"]) {
		return fail(httperror.New(403, "forbidden", "Only the initiator may withdraw"))
	}
	if action != "cancel" && actor == cleanAnyString(lockedInstance["initiator_uid"]) {
		return fail(httperror.New(403, "completion_self_approval_forbidden", "Self approval is forbidden"))
	}
	if action == "delegate" && cleanAnyString(body["delegate_to"]) == cleanAnyString(lockedInstance["initiator_uid"]) {
		return fail(httperror.New(403, "completion_self_approval_forbidden", "Delegation to the initiator is forbidden"))
	}
	command := map[string]any{"taskId": taskID, "instanceId": lockedInstance["id"], "actorUid": actor, "action": action, "comment": body["comment"], "attachments": body["attachments"]}
	if action == "delegate" {
		command["delegateTo"] = body["delegate_to"]
	}
	raw, _ := json.Marshal(command)
	hash, err := iop.ValidateAndDigestCommand(command)
	if err != nil {
		return fail(err)
	}
	ri := iop.ReceiptCommandInput{TrustedContext: iop.TrustedContext{TenantCode: rs.Key.Tenant, DeploymentCode: c.workflowDeployment, SourceApp: "workflow", ServiceClientID: "workflow.lane", RequestID: "lane:" + cleanAnyString(body["hzy_runtime_request_id"])}, SourceDeploymentCode: c.workflowDeployment, TargetDeploymentCode: c.workerDeployment, TargetApp: "aims", OperationID: stableCompletionLaneOperationID(rs.Key.Tenant, "decision:"+key), OperationCode: operation + ".lane", RequiredCapability: "aims:work-item-completion-callback:execute", IdempotencyKey: key, CommandSchemaVersion: "v1", CommandSHA256: hash, Command: raw, OriginalActorUID: actor}
	// The owning outcome is the Aims application of this Workflow decision.
	// Keep real Workflow provenance and the existing cross-app receipt CHECK.
	_, aimsResolved, err := h.AimsTransaction()
	if err != nil {
		return fail(err)
	}
	receiptTable, err := aimsResolved.Table("service_command_receipt")
	if err != nil {
		return fail(completionDecisionLaneError(err))
	}
	repo, err := iop.NewReceiptRepository(aimsResolved.DB, iop.WithReceiptTable(receiptTable))
	if err != nil {
		return fail(err)
	}
	executed, err := repo.ExecuteInTransaction(ctx, tx, ri, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (iop.ReceiptBusinessResult, error) {
		var response InstanceAPIResponse
		var err error
		switch action {
		case "cancel":
			response, _, err = a.cancelInstanceTx(ctx, tx, taskID, body)
		case "approve":
			response, _, err = a.approveTaskTx(ctx, tx, taskID, body)
		case "reject":
			response, _, err = a.rejectTaskTx(ctx, tx, taskID, body)
		case "delegate":
			response, _, err = a.delegateTaskTx(ctx, tx, taskID, body)
		default:
			err = httperror.New(400, "invalid_decision", "Invalid decision")
		}
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		return iop.ReceiptBusinessResult{TargetBizType: "completion_decision", TargetBizCode: taskID, HTTPStatus: http.StatusOK, Value: response}, nil
	})
	if err != nil {
		return fail(workflowServiceCommandError(err))
	}
	if err = h.Commit(); err != nil {
		return fail(err)
	}
	if response, ok := executed.Value.(InstanceAPIResponse); ok {
		if data, ok := response.Data.(map[string]any); ok {
			data["receiptId"] = executed.ReceiptID
		}
		return response, operation, true, nil
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"task_id": task["id"], "instance_id": instance["id"], "idempotent": true, "receiptId": executed.ReceiptID}}, operation, true, nil
}

type completionOwnerContextKey struct{}

func applyCompletionLaneCallback(ctx context.Context, tx *sql.Tx, callback WorkflowCallback) (bool, error) {
	h, ok := lane.FromContext(ctx)
	if !ok || callback.URL != aimsCompletionWorkflowCallback {
		return false, nil
	}
	actual, _, err := h.WorkflowTransaction()
	if err != nil || actual != tx {
		return true, e.ErrBindingMismatch
	}
	owner, ok := ctx.Value(completionOwnerContextKey{}).(*completionLane)
	if !ok || owner == nil {
		return true, httperror.New(409, "completion_approval_route_required", "Completion requires a manual decision")
	}
	if callback.Payload["app_code"] != "aims" || callback.Payload["resource_code"] != "tasks" || callback.Payload["action_code"] != "complete" {
		return true, httperror.New(403, "completion_effect_invalid", "Invalid internal completion effect")
	}
	_, err = owner.aims.ApplyCompletionDecisionInLane(ctx, h, callback.Payload)
	return true, err
}

// The lane has no persisted source operation row, so the receipt identity is
// derived from the stable tenant + idempotency key (same pattern as Codocs
// stablePublishWorkflowOperationID): a retried request recovers the same
// receipt, and the value keeps the UUIDv4 shape the receipt contract requires.
func stableCompletionLaneOperationID(tenant, key string) string {
	digest := sha256.Sum256([]byte("workflow:completion-lane:" + tenant + ":" + key))
	bytes := digest[:16]
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes)
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]
}

func completionDecisionLaneError(err error) error {
	if errors.Is(err, e.ErrCompletionObjectMissing) || errors.Is(err, e.ErrBindingMismatch) || errors.Is(err, e.ErrCompatibilityView) {
		return httperror.New(409, "completion_binding_changed", "Completion binding changed")
	}
	return err
}

// Route resolution is a hint only. The same route and candidate derivation is
// repeated under the business transaction; new/unread candidates cannot pass.
func (a *Adapter) completionRequestEmployees(ctx context.Context, actor, project, item, kind string, snapshot directory.WorkflowInitiatorSnapshot) (directory.WorkflowEmployees, error) {
	action, err := actionDefByKeyOn(ctx, a.db, "aims", "tasks", "complete")
	if err != nil {
		return directory.WorkflowEmployees{}, err
	}
	if action == nil {
		return directory.WorkflowEmployees{}, httperror.New(503, "workflow_route_not_found", "Completion action unavailable")
	}
	hint, err := queryOneMap(ctx, a.db, "SELECT title,project_id FROM work_items WHERE id=? AND project_id=?", item, project)
	if err != nil {
		return directory.WorkflowEmployees{}, err
	}
	if hint == nil {
		return directory.WorkflowEmployees{}, httperror.New(404, "completion_object_not_found", "Completion object not found")
	}
	form := map[string]any{"projectId": anyInt64(hint["project_id"]), "workItemId": anyInt64(item)}
	if kind == "matter" {
		form["kind"] = kind
	}
	full := prepareFlowContext(actor, snapshot.Context(), map[string]any{"project_id": hint["project_id"]}, item, cleanAnyString(hint["title"]), "", form)
	routes, err := matchRoutesOn(ctx, a.db, action.ID, full)
	if err != nil {
		return directory.WorkflowEmployees{}, err
	}
	if len(routes) == 0 {
		return directory.WorkflowEmployees{}, httperror.New(503, "workflow_route_not_found", "Completion route unavailable")
	}
	schema, err := flowSchemaByID(ctx, a.db, routes[0].FlowSchemaID)
	if err != nil {
		return directory.WorkflowEmployees{}, err
	}
	if schema == nil {
		return directory.WorkflowEmployees{}, httperror.New(503, "workflow_route_not_found", "Completion schema unavailable")
	}
	nodes, err := parseJSONArray(schema.Nodes)
	if err != nil {
		return directory.WorkflowEmployees{}, err
	}
	nodes, err = resolveSnapshotNodes(nodes, full)
	if err != nil {
		return directory.WorkflowEmployees{}, err
	}
	uids := []string{actor}
	for _, node := range nodes {
		for _, person := range resolvedAssignees(node) {
			uids = append(uids, person.UID)
		}
	}
	return a.completion.directory.ReadWorkflowEmployees(ctx, uids)
}
