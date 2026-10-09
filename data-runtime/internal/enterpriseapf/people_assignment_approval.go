package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
	"strconv"
	"strings"
)

const assignmentApprovalCode = "people.assignment.workflow-create.v1"

type FrozenPeopleApproval struct {
	ID              string         `json:"id"`
	EmployeeUID     string         `json:"employeeUid"`
	Actor           string         `json:"actor"`
	BizID           string         `json:"bizId"`
	Key             string         `json:"key"`
	OperationKey    string         `json:"operationKey"`
	ExpectedVersion int64          `json:"expectedVersion"`
	SnapshotHash    string         `json:"snapshotHash"`
	Form            map[string]any `json:"formData"`
}

func (s PeopleFactsService) freezeAssignmentApprovalTx(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, i people.EnterpriseFactsInput, who Identity) (map[string]any, error) {
	t, e := r.Table("people_assignments")
	if e != nil {
		return nil, e
	}
	row, e := people.FactsRowTx(ctx, tx, t, "id=? AND BINARY employee_uid=BINARY ?", i.ID, i.EmployeeUID)
	if e != nil {
		return nil, e
	}
	if row["created_by"] != who.Actor {
		return nil, httperror.New(403, "people_approval_actor_mismatch", "Only the original initiator may submit")
	}
	if row["approval_status"] != "draft" || fmt.Sprint(row["row_version"]) != fmt.Sprint(people.FactsVersion(i.Payload)) {
		return nil, httperror.New(409, "people_approval_preparation_changed", "Assignment changed")
	}
	form, hash := people.AssignmentSnapshot(row, who.Actor)
	form["snapshotHash"] = hash
	f := FrozenPeopleApproval{ID: i.ID, EmployeeUID: i.EmployeeUID, Actor: who.Actor, BizID: fmt.Sprint(row["assignment_code"]), Key: "people:assignment:" + i.ID + ":" + who.Key, OperationKey: "people:assignment:" + i.ID + ":" + who.Key, ExpectedVersion: people.FactsVersion(i.Payload) + 1, SnapshotHash: hash, Form: form}
	raw, e := json.Marshal(f)
	if e != nil {
		return nil, e
	}
	// Digest validated scalar/array intent, not an arbitrary JSON body.
	digest, e := integrationoperation.ValidateAndDigestCommand(map[string]any{"assignment": f.ID, "actor": f.Actor, "snapshotHash": hash, "key": f.Key, "version": f.ExpectedVersion})
	if e != nil {
		return nil, e
	}
	queue, e := r.Table("integration_operation")
	if e != nil {
		return nil, e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO "+queue+"(operation_id,operation_key,correlation_key,sequence_no,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,command_json,command_sha256,status,next_attempt_at,original_request_id,original_actor_uid,service_client_id,created_by,updated_by) VALUES(?,?,?,1,?,?,'enterprise','workflow',?,'workflow:proxy','assignment',?,?,'v1',?,?,'pending',UTC_TIMESTAMP(3),?,?,?,?,?)", uuid.NewString(), f.OperationKey, f.OperationKey, who.Tenant, who.Deployment, assignmentApprovalCode, f.BizID, f.Key, string(raw), digest, who.RequestID, who.Actor, who.Client, who.Actor, who.Actor)
	if e != nil {
		return nil, e
	}
	res, e := tx.ExecContext(ctx, "UPDATE "+t+" SET approval_status='pending',row_version=row_version+1,updated_by=? WHERE id=? AND approval_status='draft' AND row_version=?", who.Actor, i.ID, f.ExpectedVersion-1)
	if e != nil {
		return nil, e
	}
	n, e := res.RowsAffected()
	if e != nil {
		return nil, e
	}
	if n != 1 {
		return nil, httperror.New(409, "people_version_conflict", "Version changed")
	}
	return map[string]any{"id": i.ID, "row_version": f.ExpectedVersion}, nil
}
func (s PeopleFactsService) approvalSystemIdentity(who Identity) error {
	if s.Registry == nil || s.ApprovalReader == nil {
		return httperror.New(503, "people_workflow_unavailable", "Workflow unavailable")
	}
	if who.Actor != "" || who.Client != "enterprise.runtime" || who.Tenant != s.Binding.Key.Tenant || who.Deployment != s.Binding.Domains["people"].OwnerDeployment {
		return httperror.New(403, "people_approval_system_invalid", "System binding invalid")
	}
	return nil
}
func (s PeopleFactsService) PendingAssignmentApprovals(ctx context.Context, who Identity) ([]FrozenPeopleApproval, error) {
	if e := s.approvalSystemIdentity(who); e != nil {
		return nil, e
	}
	tx, rs, e := s.Registry.BeginSchedulerTransaction(ctx, s.request("people", enterprise.Scheduler))
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := rs[0]
	q, e := r.Table("integration_operation")
	if e != nil {
		return nil, e
	}
	a, e := r.Table("people_assignments")
	if e != nil {
		return nil, e
	}
	rows, e := queryRows(ctx, tx, "SELECT o.command_json,a.* FROM "+q+" o JOIN "+a+" a ON BINARY a.assignment_code=BINARY o.source_biz_code WHERE o.tenant_code=? AND o.deployment_code=? AND o.source_app='enterprise' AND o.service_client_id='enterprise.runtime' AND o.target_app='workflow' AND o.operation_code=? AND o.status='pending' AND a.approval_status='pending' AND a.workflow_instance_id IS NULL ORDER BY o.created_at,o.operation_id LIMIT 20", who.Tenant, who.Deployment, assignmentApprovalCode)
	if e != nil {
		return nil, e
	}
	out := []FrozenPeopleApproval{}
	for _, row := range rows {
		var f FrozenPeopleApproval
		if e = json.Unmarshal([]byte(fmt.Sprint(row["command_json"])), &f); e != nil {
			return nil, httperror.New(503, "people_approval_snapshot_invalid", "Frozen command invalid")
		}
		if e = validateFrozenAssignment(row, f); e != nil {
			return nil, e
		}
		if fmt.Sprint(row["row_version"]) != fmt.Sprint(f.ExpectedVersion) {
			return nil, httperror.New(409, "people_approval_version_changed", "Version changed")
		}
		out = append(out, f)
	}

	return out, tx.Commit()
}
func validateFrozenAssignment(row map[string]any, f FrozenPeopleApproval) error {
	form, hash := people.AssignmentSnapshot(row, f.Actor)
	form["snapshotHash"] = hash
	actual, e := json.Marshal(f.Form)
	if e != nil {
		return e
	}
	expected, e := json.Marshal(form)
	if e != nil {
		return e
	}
	if f.Actor == "" || f.Actor != row["created_by"] || f.ID != fmt.Sprint(row["id"]) || f.EmployeeUID != row["employee_uid"] || f.BizID != row["assignment_code"] || f.Key != f.OperationKey || f.SnapshotHash != hash || string(actual) != string(expected) {
		return httperror.New(409, "people_approval_snapshot_changed", "Frozen assignment changed")
	}
	return nil
}
func (s PeopleFactsService) BindAssignmentApproval(ctx context.Context, key, instanceID string, who Identity) (any, error) {
	if e := s.approvalSystemIdentity(who); e != nil {
		return nil, e
	}
	if key == "" || len(key) > 191 {
		return nil, httperror.New(400, "people_approval_key_invalid", "Key invalid")
	}
	if n, e := strconv.ParseUint(instanceID, 10, 64); e != nil || n == 0 || fmt.Sprint(n) != instanceID {
		return nil, httperror.New(400, "people_workflow_id_invalid", "Instance invalid")
	}
	instance, e := s.readApproval(ctx, instanceID)
	if e != nil {
		return nil, e
	}
	if _, e := s.Registry.Resolve(s.request("people", enterprise.Scheduler)); e != nil {
		return nil, e
	}
	tx, rs, e := s.Registry.BeginWriteTransaction(ctx, s.request("people", enterprise.Write))
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := rs[0]
	q, e := r.Table("integration_operation")
	if e != nil {
		return nil, e
	}
	// Read immutable command without taking the operation lock before People rows.
	var raw []byte
	e = tx.QueryRowContext(ctx, "SELECT command_json FROM "+q+" WHERE BINARY operation_key=BINARY ? AND tenant_code=? AND deployment_code=? AND source_app='enterprise' AND service_client_id='enterprise.runtime' AND operation_code=?", key, who.Tenant, who.Deployment, assignmentApprovalCode).Scan(&raw)
	if e == sql.ErrNoRows {
		return nil, httperror.New(404, "people_approval_not_found", "Request unavailable")
	}
	if e != nil {
		return nil, e
	}
	var f FrozenPeopleApproval
	if e = json.Unmarshal(raw, &f); e != nil {
		return nil, e
	}
	emp, e := r.Table("people_employees")
	if e != nil {
		return nil, e
	}
	if _, e = people.FactsRowTx(ctx, tx, emp, "BINARY employee_uid=BINARY ? AND archived_at IS NULL", f.EmployeeUID); e != nil {
		return nil, e
	}
	a, e := r.Table("people_assignments")
	if e != nil {
		return nil, e
	}
	row, e := people.FactsRowTx(ctx, tx, a, "id=? AND BINARY employee_uid=BINARY ?", f.ID, f.EmployeeUID)
	if e != nil {
		return nil, e
	}
	if e = validateFrozenAssignment(row, f); e != nil {
		return nil, e
	}
	_, hash := people.AssignmentSnapshot(row, f.Actor)
	if f.Actor == "" || row["created_by"] != f.Actor || f.OperationKey != key || f.BizID != row["assignment_code"] || hash != f.SnapshotHash || row["approval_status"] != "pending" {
		return nil, httperror.New(409, "people_approval_snapshot_changed", "Frozen assignment changed")
	}
	if row["workflow_instance_id"] == nil && fmt.Sprint(row["row_version"]) != fmt.Sprint(f.ExpectedVersion) {
		return nil, httperror.New(409, "people_approval_version_changed", "Version changed")
	}
	if instance.ID != instanceID || instance.App != "people" || instance.Resource != "assignments" || instance.Action != "change" || instance.BizID != f.BizID || instance.Initiator != f.Actor || instance.Form["snapshotHash"] != f.SnapshotHash || instance.CallbackPath != workflowapproval.CallbackPath || instance.Status != "running" {
		return nil, httperror.New(403, "people_workflow_binding_invalid", "Workflow binding invalid")
	}
	if row["workflow_instance_id"] != nil && fmt.Sprint(row["workflow_instance_id"]) != instanceID {
		return nil, httperror.New(409, "people_workflow_binding_conflict", "Instance already bound")
	}
	// Owning code has verified the frozen version and the real Workflow instance.
	if row["workflow_instance_id"] == nil {
		res, updateError := tx.ExecContext(ctx, "UPDATE "+a+" SET workflow_instance_id=?,row_version=row_version+1,updated_by='enterprise.runtime' WHERE id=? AND row_version=? AND workflow_instance_id IS NULL", instanceID, f.ID, f.ExpectedVersion)
		if updateError != nil {
			return nil, updateError
		}
		n, updateError := res.RowsAffected()
		if updateError != nil {
			return nil, updateError
		}
		if n != 1 {
			return nil, httperror.New(409, "people_approval_version_changed", "Version changed")
		}
	}
	_, e = tx.ExecContext(ctx, "UPDATE "+q+" SET status='succeeded',version_no=version_no+1,updated_by='enterprise.runtime' WHERE BINARY operation_key=BINARY ? AND tenant_code=? AND deployment_code=? AND source_app='enterprise' AND service_client_id='enterprise.runtime' AND operation_code=? AND status='pending'", key, who.Tenant, who.Deployment, assignmentApprovalCode)
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"bound": true, "instanceId": instanceID}, nil
}

// The request-driven bind and the machine bind converge on the same frozen
// operation. Legacy requests without a frozen operation remain unchanged.
func (s PeopleFactsService) confirmUserAssignmentApprovalTx(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, i people.EnterpriseFactsInput, who Identity) error {
	q, e := r.Table("integration_operation")
	if e != nil {
		return e
	}
	a, e := r.Table("people_assignments")
	if e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, "UPDATE "+q+" o JOIN "+a+" a ON BINARY a.assignment_code=BINARY o.source_biz_code SET o.status='succeeded',o.version_no=o.version_no+1,o.updated_by=? WHERE a.id=? AND BINARY a.employee_uid=BINARY ? AND a.workflow_instance_id IS NOT NULL AND o.tenant_code=? AND o.deployment_code=? AND o.source_app='enterprise' AND o.service_client_id='enterprise.runtime' AND o.operation_code=? AND BINARY o.original_actor_uid=BINARY ? AND o.status='pending'", who.Actor, i.ID, i.EmployeeUID, who.Tenant, who.Deployment, assignmentApprovalCode, who.Actor)
	return e
}

// User recovery reads one immutable intent under the existing edit scope/locks.
// It never claims any queue and does not create a replacement operation.
func (s PeopleFactsService) recoverAssignmentApprovalTx(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, i people.EnterpriseFactsInput, who Identity) (map[string]any, error) {
	a, e := r.Table("people_assignments")
	if e != nil {
		return nil, e
	}
	row, e := people.FactsRowTx(ctx, tx, a, "id=? AND BINARY employee_uid=BINARY ?", i.ID, i.EmployeeUID)
	if e != nil {
		return nil, e
	}
	if row["created_by"] != who.Actor {
		return nil, httperror.New(403, "people_approval_actor_mismatch", "Only the original initiator may recover")
	}
	if row["approval_status"] != "pending" {
		return nil, httperror.New(409, "people_approval_not_pending", "Assignment is not pending")
	}
	// Repeated recovery after a successful bind is harmless, without Workflow I/O.
	if row["workflow_instance_id"] != nil && fmt.Sprint(row["workflow_instance_id"]) != "" {
		return row, nil
	}
	if fmt.Sprint(row["row_version"]) != fmt.Sprint(people.FactsVersion(i.Payload)) {
		return nil, httperror.New(409, "people_approval_version_changed", "Version changed")
	}
	q, e := r.Table("integration_operation")
	if e != nil {
		return nil, e
	}
	rows, e := queryRows(ctx, tx, "SELECT operation_key,command_json FROM "+q+" WHERE BINARY source_biz_code=BINARY ? AND tenant_code=? AND deployment_code=? AND source_app='enterprise' AND service_client_id='enterprise.runtime' AND target_app='workflow' AND operation_code=? AND BINARY original_actor_uid=BINARY ? AND status='pending' LIMIT 2", row["assignment_code"], who.Tenant, who.Deployment, assignmentApprovalCode, who.Actor)
	if e != nil {
		return nil, e
	}
	if len(rows) != 1 {
		return nil, httperror.New(409, "people_approval_frozen_missing", "Frozen request unavailable")
	}
	var f FrozenPeopleApproval
	if json.Unmarshal([]byte(fmt.Sprint(rows[0]["command_json"])), &f) != nil {
		return nil, httperror.New(503, "people_approval_snapshot_invalid", "Frozen command invalid")
	}
	if e = validateFrozenAssignment(row, f); e != nil {
		return nil, e
	}
	if f.OperationKey != rows[0]["operation_key"] || f.ExpectedVersion != people.FactsVersion(i.Payload) || f.Actor != who.Actor || !strings.HasPrefix(f.Key, "people:assignment:"+i.ID+":") {
		return nil, httperror.New(409, "people_approval_snapshot_changed", "Frozen request changed")
	}
	return map[string]any{"id": f.ID, "row_version": f.ExpectedVersion, "assignment_code": f.BizID, "approval_status": "pending", "workflow_instance_id": nil, "frozenApproval": f}, nil
}
