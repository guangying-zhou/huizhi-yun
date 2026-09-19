package aims

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const EnterpriseWorkItemCompleteCapability = "aims:work-item-complete:execute"
const workItemCompletionWorkflowOperation = "aims.work-item.completion.workflow-submit.v1"
const workItemCompletionWorkflowCapability = "workflow:work-item-complete:create"

// This is the original target/non-requirement completion action. It is not a
// generic status setter and does not approve a work item on the user's behalf.
func validateWorkItemCompletionReady(item map[string]any, children []map[string]any) error {
	if aimsMapText(item, "tier") != "target" || aimsMapText(item, "type") == "requirement" || aimsMapText(item, "status") != "in_progress" {
		return httperror.New(409, "work_item_completion_state_invalid", "Only an in-progress non-requirement target can request completion")
	}
	if len(children) == 0 {
		return httperror.New(409, "work_item_completion_children_required", "Complete the child work items before requesting review")
	}
	for _, child := range children {
		if aimsMapText(child, "status") != "completed" {
			return httperror.New(409, "work_item_completion_children_incomplete", "All child work items must be completed")
		}
	}
	return nil
}

func completionSnapshotTx(ctx context.Context, tx *sql.Tx, item map[string]any) (map[string]any, string, error) {
	rows, err := tx.QueryContext(ctx, "SELECT id FROM work_items WHERE parent_id=? ORDER BY id FOR UPDATE", item["id"])
	if err != nil {
		return nil, "", err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, "", err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, "", err
	}
	children := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		child, version, e := enterpriseWorkItemSnapshot(ctx, tx, id, true)
		if e != nil {
			return nil, "", e
		}
		if fmt.Sprint(child["project_id"]) != fmt.Sprint(item["project_id"]) {
			return nil, "", httperror.New(409, "work_item_completion_child_project_mismatch", "Child work item belongs to another project")
		}
		children = append(children, map[string]any{"id": child["id"], "status": child["status"], "version": version})
	}
	if err = validateWorkItemCompletionReady(item, children); err != nil {
		return nil, "", err
	}
	snapshot := map[string]any{"item": item, "children": children}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return nil, "", err
	}
	sum := sha256.Sum256(raw)
	return snapshot, hex.EncodeToString(sum[:]), nil
}

func (a *Adapter) RequestEnterpriseWorkItemCompletion(ctx context.Context, identity EnterpriseProjectUpdateIdentity, projectID, itemID string, command map[string]any) (map[string]any, error) {
	if err := a.requireEnterpriseWriter(); err != nil {
		return nil, err
	}
	if err := a.verifyEnterpriseCompletionTables(ctx); err != nil {
		return nil, err
	}
	expected, ok := command["expectedVersion"].(string)
	if !ok || len(expected) != 64 || len(command) != 1 {
		return nil, httperror.New(400, "work_item_completion_input_invalid", "A content version is required")
	}
	if len(identity.Personnel) != 0 {
		return nil, httperror.New(400, "work_item_completion_input_invalid", "Completion does not accept personnel changes")
	}
	if _, err := parseID(projectID, "project_id"); err != nil {
		return nil, err
	}
	if _, err := parseID(itemID, "work_item_id"); err != nil {
		return nil, err
	}
	base := EnterpriseProjectCreateIdentity{Tenant: identity.Tenant, SourceDeployment: identity.SourceDeployment, TargetDeployment: identity.TargetDeployment, ActorUID: identity.ActorUID, ServiceClientID: identity.ServiceClientID, RequestID: identity.RequestID, IdempotencyKey: identity.IdempotencyKey}
	ri, err := enterpriseProjectCreateReceiptInput(base, map[string]any{"projectId": projectID, "workItemId": itemID, "input": command})
	if err != nil {
		return nil, err
	}
	ri.OperationCode = "enterprise.aims.work-items.complete.v1"
	ri.RequiredCapability = EnterpriseWorkItemCompleteCapability
	ri.CommandSchemaVersion = "work-item-complete.v1"
	tx, repo, err := a.beginEnterpriseWrite(ctx, base)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := repo.ExecuteInTransaction(ctx, tx, ri, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		var leader string
		var lifecycle string
		if err := tx.QueryRowContext(ctx, "SELECT leader_uid,lifecycle_status FROM aims_projects WHERE id=? FOR UPDATE", projectID).Scan(&leader, &lifecycle); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if leader != identity.ActorUID {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(403, "work_item_completion_leader_required", "Only the project leader can request completion")
		}
		item, version, err := enterpriseWorkItemSnapshot(ctx, tx, itemID, true)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if fmt.Sprint(item["project_id"]) != projectID {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(403, "work_item_project_mismatch", "Work item is outside the project")
		}
		if version != expected {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "work_item_version_conflict", "Work item changed; reload before requesting review")
		}
		if err = validateProjectWorkItemLifecycle(lifecycle, aimsMapText(item, "tier")); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if mid := serviceBodyInt(item, "milestone_id"); mid > 0 {
			if err = requireMilestoneCompletionUnlockedTx(ctx, tx, int64(mid)); err != nil {
				return integrationoperation.ReceiptBusinessResult{}, err
			}
		}
		snapshot, hash, err := completionSnapshotTx(ctx, tx, item)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		raw, _ := json.Marshal(snapshot)
		if _, err = tx.ExecContext(ctx, "UPDATE work_items SET status='in_review',updated_at=UTC_TIMESTAMP(6) WHERE id=?", itemID); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		_, reviewVersion, err := enterpriseWorkItemSnapshot(ctx, tx, itemID, false)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		temporaryKey := "completion-pending:" + ri.OperationID
		inserted, err := tx.ExecContext(ctx, "INSERT INTO work_item_completion_requests(project_id,work_item_id,requested_by,snapshot_json,snapshot_sha256,review_version,status,operation_key) VALUES(?,?,?,?,?,?,'queued',?)", projectID, itemID, identity.ActorUID, raw, hash, reviewVersion, temporaryKey)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		requestID, err := inserted.LastInsertId()
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		key := fmt.Sprintf("aims:work-item-completion:%d:workflow-submit:v1", requestID)
		if _, err = tx.ExecContext(ctx, "UPDATE work_item_completion_requests SET operation_key=? WHERE id=?", key, requestID); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		cmd := map[string]any{"completionRequestId": requestID, "workItemId": serviceBodyInt(item, "id"), "workItemKey": item["item_key"], "projectId": serviceBodyInt(item, "project_id"), "actorUid": identity.ActorUID, "snapshotSha256": hash, "bizTitle": item["title"], "bizContext": map[string]any{"project_id": serviceBodyInt(item, "project_id")}, "formData": map[string]any{"completionRequestId": requestID, "workItemId": serviceBodyInt(item, "id"), "projectId": serviceBodyInt(item, "project_id"), "snapshotSha256": hash}, "idempotencyKey": key}
		outboundBase := base
		outboundBase.TargetDeployment = a.enterpriseWrites.workerDeployment
		outbox, err := a.enterpriseOutbox()
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if err = enqueueWorkItemCompletionWorkflowTx(ctx, tx, outbox, outboundBase, requestID, key, cmd); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		trusted := enterpriseCompletionStatusBody(outboundBase, "in_review")
		if _, err = a.enqueueServiceTicketDeliveryOperationTx(ctx, tx, itemID, trusted); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if err = writeCompletionAuditTx(ctx, tx, projectID, itemID, identity.ActorUID, identity.IdempotencyKey, "completion_request", map[string]any{"requestId": requestID, "snapshotSha256": hash, "from": "in_progress", "to": "in_review"}); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "work_item_completion_request", TargetBizCode: fmt.Sprint(requestID), HTTPStatus: http.StatusAccepted, Value: map[string]any{"requestId": requestID, "workItemId": itemID, "status": "queued", "operationKey": key, "editVersion": reviewVersion}}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"receiptId": result.ReceiptID, "idempotent": result.Existing, "result": result.Value}, nil
}

func (a *Adapter) verifyEnterpriseCompletionTables(ctx context.Context) error {
	if err := a.requireEnterpriseWriter(); err != nil {
		return err
	}
	if a.enterpriseWrites.workerDeployment == "" {
		return httperror.New(503, "work_item_completion_worker_unavailable", "Formal Aims worker deployment is not configured")
	}
	// The outbox identifiers are deliberately absent: aims and assets each map
	// them to their own physical tables, so compatibilityViewSpecs refuses a
	// schema-level view for them and requiring one here could never succeed.
	// Outbox statements resolve the owning domain's table through TrustedContext.SQL.
	return e.VerifyCompatibilityViews(ctx, a.DB(), a.enterpriseWrites.binding, "aims", []string{"work_item_completion_requests", "work_item_service_ext", "project_documents", "time_entries"})
}

// This hint is read-only and is returned only after the existing object scope
// authorization. The write handler repeats every condition under locks.
func (a *Adapter) EnterpriseWorkItemCompletionState(ctx context.Context, itemID, actor string) (map[string]any, error) {
	state := map[string]any{"canRequest": false, "available": false}
	if a.enterpriseWrites == nil {
		return state, nil
	}
	if _, ok := a.enterpriseWrites.binding.Domains["aims"].Tables["work_item_completion_requests"]; !ok {
		return state, nil
	}
	if err := a.verifyEnterpriseCompletionTables(ctx); err != nil {
		return nil, err
	}
	reader := a.enterpriseWrites.writer
	reader.Operation = e.Read
	tx, _, err := a.enterpriseWrites.registry.BeginSnapshotReadTransaction(ctx, reader)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var ready int
	err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM work_items w JOIN aims_projects p ON p.id=w.project_id WHERE w.id=? AND p.leader_uid=? AND w.tier='target' AND w.type<>'requirement' AND w.status='in_progress' AND EXISTS(SELECT 1 FROM work_items c WHERE c.parent_id=w.id) AND NOT EXISTS(SELECT 1 FROM work_items c WHERE c.parent_id=w.id AND c.status<>'completed')`, itemID, actor).Scan(&ready)
	if err != nil {
		return nil, err
	}
	state["available"] = true
	state["canRequest"] = ready == 1
	outbox, err := a.enterpriseOutbox()
	if err != nil {
		return nil, err
	}
	latest, err := aimsQueryOneMap(ctx, tx, outbox.SQL(`SELECT r.id,r.status,r.workflow_instance_id,r.workflow_instance_no,o.status AS operation_status,o.version_no AS operation_version,o.last_error_code
 FROM work_item_completion_requests r LEFT JOIN integration_operation o ON o.operation_key=r.operation_key AND o.tenant_code=? AND o.deployment_code=? AND o.source_app='aims' AND o.target_app='workflow' AND o.operation_code=?
 WHERE r.work_item_id=? ORDER BY r.id DESC LIMIT 1`), a.enterpriseWrites.writer.Key.Tenant, a.enterpriseWrites.workerDeployment, workItemCompletionWorkflowOperation, itemID)
	if err != nil {
		return nil, err
	}
	if latest != nil {
		state["request"] = latest
		var manager int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM work_items w JOIN aims_projects p ON p.id=w.project_id LEFT JOIN aims_project_members m ON m.project_id=p.id AND m.uid=? AND m.status='active' AND m.role='manager' WHERE w.id=? AND (p.leader_uid=? OR m.id IS NOT NULL)`, actor, itemID, actor).Scan(&manager); err != nil {
			return nil, err
		}
		state["canReplay"] = manager == 1 && (aimsMapText(latest, "status") == "queued" || aimsMapText(latest, "status") == "running") && (aimsMapText(latest, "operation_status") == "failed_permanent" || aimsMapText(latest, "operation_status") == "dead_letter")
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return state, nil
}

func (a *Adapter) requireEnterpriseWorkItemReviewUnlockedTx(ctx context.Context, tx *sql.Tx, item map[string]any) error {
	if _, ok := a.enterpriseWrites.binding.Domains["aims"].Tables["work_item_completion_requests"]; !ok {
		return nil
	}
	if err := a.verifyEnterpriseCompletionTables(ctx); err != nil {
		return err
	}
	var count int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM work_item_completion_requests WHERE active_work_item_id IN (?,?) FOR UPDATE", item["id"], item["parent_id"]).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return httperror.New(409, "work_item_completion_review_locked", "Work item plan is frozen during completion review")
	}
	return nil
}

func enterpriseCompletionStatusBody(i EnterpriseProjectCreateIdentity, status string) map[string]any {
	return map[string]any{"hzy_runtime_tenant_code": i.Tenant, "hzy_runtime_deployment_code": i.TargetDeployment, "hzy_runtime_source_app": "aims", "hzy_runtime_service_client_id": "aims.runtime", "hzy_runtime_request_id": i.RequestID, "current_user": i.ActorUID, "status": status}
}
func writeCompletionAuditTx(ctx context.Context, tx *sql.Tx, projectID, itemID, actor, key, action string, changes map[string]any) error {
	raw, err := json.Marshal(changes)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO work_item_changelog(work_item_id,field_name,old_value,new_value,changed_by) VALUES(?,'completion_workflow',NULL,?,?)", itemID, raw, actor)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO project_activity_logs(project_id,object_type,object_code,action,actor_uid,changes,request_id) VALUES(?,'work_item',?,?,?,?,?)", projectID, itemID, action, actor, raw, key)
	return err
}

func enqueueWorkItemCompletionWorkflowTx(ctx context.Context, tx *sql.Tx, outbox integrationoperation.TrustedContext, i EnterpriseProjectCreateIdentity, requestID int64, key string, command map[string]any) error {
	if !validWorkItemCompletionWorkflowCommand(command) {
		return httperror.New(400, "work_item_completion_command_invalid", "Invalid frozen workflow command")
	}
	hash, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(command)
	if err != nil {
		return err
	}
	id, err := integrationoperation.NewOperationID()
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, outbox.SQL(`INSERT INTO integration_operation(operation_id,operation_key,correlation_key,sequence_no,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,command_json,command_sha256,status,original_request_id,original_actor_uid,service_client_id,created_by,updated_by,next_attempt_at) VALUES(?,?,?,1,?,?,'aims','workflow',?,?,'work_item_completion_request',?,?,'v1',?,?,'pending',?,?,'aims.runtime',?,?,UTC_TIMESTAMP(3))`), id, key, key, i.Tenant, i.TargetDeployment, workItemCompletionWorkflowOperation, workItemCompletionWorkflowCapability, fmt.Sprint(requestID), key, raw, hash, i.RequestID, i.ActorUID, i.ActorUID, i.ActorUID)
	return err
}

func validWorkItemCompletionWorkflowCommand(c map[string]any) bool {
	keys := []string{"completionRequestId", "workItemId", "workItemKey", "projectId", "actorUid", "snapshotSha256", "bizTitle", "bizContext", "formData", "idempotencyKey"}
	if len(c) != len(keys) {
		return false
	}
	for _, k := range keys {
		if _, ok := c[k]; !ok {
			return false
		}
	}
	request, item, project := completionPositiveNumber(c["completionRequestId"]), completionPositiveNumber(c["workItemId"]), completionPositiveNumber(c["projectId"])
	if request <= 0 || item <= 0 || project <= 0 {
		return false
	}
	hash, ok := c["snapshotSha256"].(string)
	if !ok || len(hash) != 64 {
		return false
	}
	if _, err := hex.DecodeString(hash); err != nil {
		return false
	}
	for _, k := range []string{"actorUid", "workItemKey", "bizTitle"} {
		v, ok := c[k].(string)
		limit := map[string]int{"actorUid": 50, "workItemKey": 100, "bizTitle": 255}[k]
		if !ok || strings.TrimSpace(v) == "" || !utf8.ValidString(v) || utf8.RuneCountInString(v) > limit {
			return false
		}
		if k != "bizTitle" && strings.TrimSpace(v) != v {
			return false
		}
		if k == "actorUid" {
			for _, ch := range v {
				if ch < 32 || ch == 127 {
					return false
				}
			}
		}
	}
	if c["idempotencyKey"] != fmt.Sprintf("aims:work-item-completion:%d:workflow-submit:v1", request) {
		return false
	}
	context, ok := c["bizContext"].(map[string]any)
	if !ok || len(context) != 1 || completionPositiveNumber(context["project_id"]) != project {
		return false
	}
	form, ok := c["formData"].(map[string]any)
	return ok && len(form) == 4 && completionPositiveNumber(form["completionRequestId"]) == request && completionPositiveNumber(form["workItemId"]) == item && completionPositiveNumber(form["projectId"]) == project && form["snapshotSha256"] == hash
}

func completionPositiveNumber(value any) int {
	raw, err := json.Marshal(value)
	if err != nil {
		return 0
	}
	n, err := strconv.ParseInt(string(raw), 10, 64)
	if err != nil || n <= 0 || n > 9007199254740991 || strconv.FormatInt(n, 10) != string(raw) {
		return 0
	}
	return int(n)
}
