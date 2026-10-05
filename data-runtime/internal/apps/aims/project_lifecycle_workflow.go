package aims

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"strings"
)

// AimsWorkflowInstanceReader is a read-only in-process dependency. Runtime
// construction injects the enabled owning adapter; no trusted flags or routes
// can be supplied by a caller, and Aims does not import Workflow.
type ProjectLifecycleInstance struct {
	InstanceID, InstanceNo, BizID, InitiatorUID, AppCode, ResourceCode, ActionCode string
	Form                                                                           map[string]any
}
type AimsWorkflowInstanceReader interface {
	ReadAimsRequirementReviewInstance(context.Context, string, string, string, string) (map[string]any, error)
	ReadProjectLifecycleInstance(context.Context, string) (ProjectLifecycleInstance, error)
}

func (a *Adapter) ConfigureWorkflowInstanceReader(reader AimsWorkflowInstanceReader) {
	a.workflowInstanceReader = reader
}

type projectLifecycleSnapshot struct {
	ProjectID string `json:"projectId"`
	Action    string `json:"actionCode"`
	From      string `json:"fromStatus"`
	To        string `json:"toStatus"`
	Actor     string `json:"requestedBy"`
	Comment   string `json:"comment"`
	Version   string `json:"expectedVersion"`
}

func projectLifecycleTransition(action string) (string, string, error) {
	switch action {
	case "pause":
		return "active", "paused", nil
	case "resume":
		return "paused", "active", nil
	case "finish":
		return "active", "completed", nil
	}
	return "", "", httperror.New(400, "project_lifecycle_action_invalid", "Invalid lifecycle action")
}

func (a *Adapter) RequestEnterpriseProjectLifecycle(ctx context.Context, identity EnterpriseProjectUpdateIdentity, projectID string, input map[string]any, bind bool) (map[string]any, error) {
	if scoped, ok := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity); ok {
		identity.CommandScope = scoped.CommandScope
	}
	// The independent Workflow read happens before acquiring the Aims registry
	// fence. Frozen PLC instance identity is immutable; the request is still
	// locked, authorized and compared inside the fenced write transaction below.
	if bind {
		if err := a.requireEnterpriseWriter(); err != nil {
			return nil, err
		}
		b := a.enterpriseWrites
		if identity.Tenant != b.writer.Key.Tenant || identity.SourceDeployment != b.sourceDeployment || identity.TargetDeployment != b.writer.Key.RuntimeDeployment {
			return nil, e.ErrBindingMismatch
		}
		if _, unified := b.binding.Domains["workflow"]; !unified {
			if a.workflowInstanceReader == nil {
				return nil, httperror.New(503, "project_lifecycle_workflow_store_unavailable", "Workflow adapter unavailable")
			}
			if firstBodyText(input, "instanceId") == "" || firstBodyText(input, "instanceNo") == "" || len(firstBodyText(input, "instanceId")) > 128 || len(firstBodyText(input, "instanceNo")) > 128 {
				return nil, httperror.New(400, "project_lifecycle_instance_required", "Instance ID and number required")
			}
			instance, readErr := a.workflowInstanceReader.ReadProjectLifecycleInstance(ctx, firstBodyText(input, "instanceId"))
			if readErr != nil {
				var h httperror.Error
				if errors.As(readErr, &h) && (h.Status == 403 || h.Status == 404) {
					return nil, httperror.New(409, "project_lifecycle_instance_mismatch", "Workflow instance does not belong to request")
				}
				return nil, httperror.New(503, "project_lifecycle_workflow_store_unavailable", "Workflow instance read unavailable")
			}
			if err := validateProjectLifecycleInstance(instance, identity, projectID, input); err != nil {
				return nil, err
			}
		}
	}
	base := EnterpriseProjectCreateIdentity{Tenant: identity.Tenant, SourceDeployment: identity.SourceDeployment, TargetDeployment: identity.TargetDeployment, ActorUID: identity.ActorUID, ServiceClientID: identity.ServiceClientID, IdempotencyKey: identity.IdempotencyKey, RequestID: identity.RequestID}
	tx, _, err := a.beginEnterpriseWrite(ctx, base)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if bind {
		b := a.enterpriseWrites
		domain, ok := b.binding.Domains["workflow"]
		if ok {
			resolved, resolveErr := b.registry.Resolve(e.ResolveRequest{Key: b.writer.Key, Domain: "workflow", OwnerDeployment: domain.OwnerDeployment, SchemaVersion: b.writer.SchemaVersion, Generation: b.writer.Generation, Operation: e.Read})
			if resolveErr != nil || resolved.DB != a.DB() {
				return nil, httperror.New(503, "project_lifecycle_workflow_store_unavailable", "Registered unified Workflow store required")
			}
			table, tableErr := resolved.Table("flow_instances")
			if tableErr != nil {
				return nil, tableErr
			}
			if err = verifyProjectLifecycleInstanceTx(ctx, tx, table, identity, projectID, input); err != nil {
				return nil, err
			}
		}
	}
	out, err := requestProjectLifecycleTx(ctx, tx, identity, projectID, input, bind)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}

func requestProjectLifecycleTx(ctx context.Context, tx *sql.Tx, identity EnterpriseProjectUpdateIdentity, projectID string, input map[string]any, bind bool) (map[string]any, error) {
	id, err := parseID(projectID, "project_id")
	if err != nil {
		return nil, err
	}
	action := firstBodyText(input, "actionCode")
	from, to, err := projectLifecycleTransition(action)
	if err != nil {
		return nil, err
	}
	permission := "edit"
	if action == "finish" {
		permission = "close"
	}
	if identity.CommandScope == nil {
		return nil, httperror.New(403, "project_lifecycle_scope_required", "Scoped project authorization required")
	}
	if err = requireEnterpriseProjectCommandScopeTx(ctx, tx, identity, projectID, "", permission); err != nil {
		return nil, err
	}
	var lifecycle, leader, code string
	if err = tx.QueryRowContext(ctx, "SELECT lifecycle_status,COALESCE(leader_uid,''),project_code FROM aims_projects WHERE id=? FOR UPDATE", id).Scan(&lifecycle, &leader, &code); err != nil {
		return nil, err
	}
	if err = requireEnterpriseSettingsManagerTx(ctx, tx, projectID, identity.ActorUID, leader); err != nil {
		return nil, err
	}
	keyBytes, _ := json.Marshal([]string{identity.Tenant, identity.ActorUID, identity.IdempotencyKey})
	keyHash := sha256.Sum256(keyBytes)
	key := "project-lifecycle:" + hex.EncodeToString(keyHash[:])
	var requestNo, raw, status string
	var instance sql.NullString
	err = tx.QueryRowContext(ctx, "SELECT request_no,CAST(snapshot_json AS CHAR),status,workflow_instance_id FROM approval_records WHERE idempotency_key=? FOR UPDATE", key).Scan(&requestNo, &raw, &status, &instance)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	exists := err == nil
	var snapshot projectLifecycleSnapshot
	if exists {
		if json.Unmarshal([]byte(raw), &snapshot) != nil {
			return nil, httperror.New(503, "project_lifecycle_snapshot_invalid", "Frozen request unavailable")
		}
		if snapshot.ProjectID != projectID || snapshot.Action != action || snapshot.Actor != identity.ActorUID {
			return nil, httperror.New(409, "idempotency_payload_mismatch", "Request intent changed")
		}
	}
	if bind {
		if !exists || input["requestNo"] != requestNo {
			return nil, httperror.New(409, "project_lifecycle_request_mismatch", "Request binding mismatch")
		}
		instanceID := firstBodyText(input, "instanceId")
		if instanceID == "" || len(instanceID) > 128 {
			return nil, httperror.New(400, "project_lifecycle_instance_required", "Instance binding required")
		}
		if instance.Valid && instance.String != instanceID {
			return nil, httperror.New(409, "project_lifecycle_instance_mismatch", "Instance already bound")
		}
		if !instance.Valid {
			if status != "pending" || lifecycle != snapshot.From {
				return nil, httperror.New(409, "project_lifecycle_state_conflict", "Project state changed")
			}
			if _, err = tx.ExecContext(ctx, "UPDATE approval_records SET workflow_instance_id=? WHERE request_no=? AND project_owner_id=? AND status='pending'", instanceID, requestNo, id); err != nil {
				return nil, err
			}
		}
		return map[string]any{"requestNo": requestNo, "instanceId": instanceID, "bound": true}, nil
	}
	comment := strings.TrimSpace(firstBodyText(input, "comment"))
	version := firstBodyText(input, "expectedVersion")
	if comment == "" || len([]rune(comment)) > 4000 {
		return nil, httperror.New(400, "project_lifecycle_comment_required", "Approval explanation required")
	}
	if exists {
		if status == "pending" && lifecycle != snapshot.From {
			return nil, httperror.New(409, "project_lifecycle_state_conflict", "Project state changed")
		}
		if comment != snapshot.Comment || version != snapshot.Version {
			return nil, httperror.New(409, "idempotency_payload_mismatch", "Request intent changed")
		}
	} else {
		if lifecycle != from {
			return nil, httperror.New(409, "project_lifecycle_state_conflict", "Project state changed")
		}
		_, current, readErr := enterpriseProjectSnapshot(ctx, tx, projectID, true)
		if readErr != nil {
			return nil, readErr
		}
		if current != version {
			return nil, httperror.New(409, "project_version_conflict", "Project information changed")
		}
		var pending int
		if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM approval_records WHERE project_owner_id=? AND status='pending'", id).Scan(&pending); err != nil {
			return nil, err
		}
		if pending > 0 {
			return nil, httperror.New(409, "project_lifecycle_request_pending", "A project approval is pending")
		}
		snapshot = projectLifecycleSnapshot{ProjectID: projectID, Action: action, From: from, To: to, Actor: identity.ActorUID, Comment: comment, Version: version}
		bytes, _ := json.Marshal(snapshot)
		raw = string(bytes)
		hash := sha256.Sum256(bytes)
		requestNo = "PLC-" + hex.EncodeToString(keyHash[:])
		if _, err = tx.ExecContext(ctx, `INSERT INTO approval_records(request_no,project_owner_id,project_id,project_code,transition,title,requested_by,request_comment,snapshot_json,snapshot_sha256,idempotency_key,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending')`, requestNo, id, id, code, from+"→"+to, "项目生命周期审批", identity.ActorUID, comment, raw, hex.EncodeToString(hash[:]), key); err != nil {
			return nil, err
		}
		status = "pending"
	}
	return map[string]any{"requestNo": requestNo, "snapshot": snapshot, "status": status, "instanceId": instance.String}, nil
}

func (a *Adapter) applyProjectLifecycleWorkflowCallback(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	if !truthyQuery(query, "workflow_callback_verified") {
		return nil, httperror.New(403, "workflow_callback_verification_required", "Trusted callback required")
	}
	action := firstBodyText(body, "action_code", "actionCode")
	from, to, err := projectLifecycleTransition(action)
	if err != nil {
		return nil, err
	}
	if firstBodyText(body, "event") != "flow_completed" || firstBodyText(body, "app_code", "appCode") != "aims" || firstBodyText(body, "resource_code", "resourceCode") != "projects" {
		return nil, httperror.New(400, "project_lifecycle_callback_invalid", "Invalid callback")
	}
	form, _ := body["form_data"].(map[string]any)
	requestNo := firstBodyText(form, "requestNo")
	instanceID := firstBodyText(body, "instance_id", "instanceId")
	projectID := firstBodyText(body, "biz_id", "bizId")
	status := firstBodyText(body, "status")
	if requestNo == "" || instanceID == "" || (status != "approved" && status != "rejected" && status != "cancelled") {
		return nil, httperror.New(400, "project_lifecycle_callback_invalid", "Invalid callback binding")
	}
	if firstBodyText(form, "projectId") != projectID || firstBodyText(form, "actionCode") != action {
		return nil, httperror.New(409, "project_lifecycle_callback_binding_mismatch", "Callback business mismatch")
	}
	tx, _, err := a.beginBoundEnterpriseTransaction(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var lifecycle string
	if err = tx.QueryRowContext(ctx, "SELECT lifecycle_status FROM aims_projects WHERE id=? FOR UPDATE", projectID).Scan(&lifecycle); err != nil {
		return nil, err
	}
	var raw, current string
	var bound sql.NullString
	if err = tx.QueryRowContext(ctx, "SELECT CAST(snapshot_json AS CHAR),status,workflow_instance_id FROM approval_records WHERE request_no=? AND project_owner_id=? FOR UPDATE", requestNo, projectID).Scan(&raw, &current, &bound); err != nil {
		return nil, httperror.New(409, "project_lifecycle_request_mismatch", "Unknown project request")
	}
	var snapshot projectLifecycleSnapshot
	if json.Unmarshal([]byte(raw), &snapshot) != nil || snapshot.ProjectID != projectID || snapshot.Action != action || snapshot.From != from || snapshot.To != to || !bound.Valid || bound.String != instanceID {
		return nil, httperror.New(409, "project_lifecycle_callback_binding_mismatch", "Callback does not match bound request")
	}
	if current == status {
		return map[string]any{"requestNo": requestNo, "alreadyApplied": true}, nil
	}
	if current != "pending" || lifecycle != from {
		return nil, httperror.New(409, "project_lifecycle_state_conflict", "Project state changed")
	}
	if status == "approved" {
		if _, err = tx.ExecContext(ctx, "UPDATE aims_projects SET lifecycle_status=? WHERE id=?", to, projectID); err != nil {
			return nil, err
		}
		if err = appendProjectLifecycleEventTx(ctx, tx, projectID, to, "workflow"); err != nil {
			return nil, err
		}
	}
	if _, err = tx.ExecContext(ctx, "UPDATE approval_records SET status=?,reviewed_at=UTC_TIMESTAMP() WHERE request_no=? AND project_owner_id=?", status, requestNo, projectID); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"requestNo": requestNo, "status": status, "lifecycleStatus": map[bool]string{true: to, false: from}[status == "approved"]}, nil
}

// Binding uses the registered Workflow table, never a browser-supplied table or URL.
func verifyProjectLifecycleInstanceTx(ctx context.Context, tx *sql.Tx, table string, identity EnterpriseProjectUpdateIdentity, projectID string, input map[string]any) error {
	instanceID, instanceNo := firstBodyText(input, "instanceId"), firstBodyText(input, "instanceNo")
	if instanceID == "" || instanceNo == "" || len(instanceID) > 128 || len(instanceNo) > 128 {
		return httperror.New(400, "project_lifecycle_instance_required", "Instance ID and number required")
	}
	var number, biz, actor, app, resource, action, raw string
	err := tx.QueryRowContext(ctx, "SELECT instance_no,biz_id,initiator_uid,app_code,resource_code,action_code,CAST(form_data AS CHAR) FROM "+table+" WHERE id=? FOR SHARE", instanceID).Scan(&number, &biz, &actor, &app, &resource, &action, &raw)
	if err != nil {
		if err == sql.ErrNoRows {
			return httperror.New(409, "project_lifecycle_instance_mismatch", "Workflow instance missing")
		}
		return err
	}
	var form map[string]any
	if json.Unmarshal([]byte(raw), &form) != nil {
		return httperror.New(409, "project_lifecycle_instance_mismatch", "Invalid Workflow instance form")
	}
	return validateProjectLifecycleInstance(ProjectLifecycleInstance{InstanceID: instanceID, InstanceNo: number, BizID: biz, InitiatorUID: actor, AppCode: app, ResourceCode: resource, ActionCode: action, Form: form}, identity, projectID, input)
}

func validateProjectLifecycleInstance(instance ProjectLifecycleInstance, identity EnterpriseProjectUpdateIdentity, projectID string, input map[string]any) error {
	form := instance.Form
	if instance.InstanceID != firstBodyText(input, "instanceId") || instance.InstanceNo != firstBodyText(input, "instanceNo") || instance.BizID != projectID || instance.InitiatorUID != identity.ActorUID || instance.AppCode != "aims" || instance.ResourceCode != "projects" || instance.ActionCode != firstBodyText(input, "actionCode") || firstBodyText(form, "requestNo") != firstBodyText(input, "requestNo") || firstBodyText(form, "projectId") != projectID || firstBodyText(form, "requestedBy") != identity.ActorUID || firstBodyText(form, "actionCode") != firstBodyText(input, "actionCode") {
		return httperror.New(409, "project_lifecycle_instance_mismatch", "Workflow instance does not belong to frozen request")
	}
	return nil
}
