package enterpriseapf

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
	"time"
)

type PeopleFactsCallback struct {
	AppCode    string `json:"app_code"`
	BizType    string `json:"biz_type"`
	BizID      string `json:"biz_id"`
	InstanceID string `json:"workflow_instance_id"`
	Status     string `json:"status"`
}

func (s PeopleFactsService) Callback(ctx context.Context, b PeopleFactsCallback, who Identity) (any, error) {
	if b.AppCode != "people" || b.BizType != "assignments" || b.BizID == "" || b.InstanceID == "" || b.Status != "approved" && b.Status != "rejected" && b.Status != "cancelled" {
		return nil, httperror.New(400, "people_callback_invalid", "Invalid People callback")
	}
	if s.Registry == nil || s.ApprovalReader == nil || !domaininstall.IsPeopleFactsDomain(s.Binding.Domains["people"]) {
		return nil, httperror.New(503, "people_workflow_unavailable", "People Workflow unavailable")
	}
	if who.Client != "enterprise.runtime" || who.Tenant != s.Binding.Key.Tenant || who.Deployment != s.Binding.Domains["people"].OwnerDeployment {
		return nil, httperror.New(403, "people_callback_identity_invalid", "Invalid system binding")
	}
	instance, e := s.readApproval(ctx, b.InstanceID)
	if e != nil {
		return nil, e
	}
	tx, rs, e := s.Registry.BeginWriteTransaction(ctx, s.request("people", enterprise.Write))
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := rs[0]
	assignments, e := r.Table("people_assignments")
	if e != nil {
		return nil, e
	}
	employees, e := r.Table("people_employees")
	if e != nil {
		return nil, e
	}
	var uid string
	if e = tx.QueryRowContext(ctx, "SELECT employee_uid FROM "+assignments+" WHERE BINARY assignment_code=BINARY ?", b.BizID).Scan(&uid); e == sql.ErrNoRows {
		return nil, httperror.New(404, "people_assignment_not_found", "Assignment unavailable")
	}
	if e != nil {
		return nil, e
	}
	if _, e = people.FactsRowTx(ctx, tx, employees, "BINARY employee_uid=BINARY ? AND archived_at IS NULL", uid); e != nil {
		return nil, e
	}
	row, e := people.FactsRowTx(ctx, tx, assignments, "BINARY assignment_code=BINARY ? AND BINARY employee_uid=BINARY ?", b.BizID, uid)
	if e != nil {
		return nil, e
	}
	_, hash := people.AssignmentSnapshot(row, fmt.Sprint(row["created_by"]))
	if instance.App != "people" || instance.Resource != "assignments" || instance.Action != "change" || instance.BizID != b.BizID || instance.ID != fmt.Sprint(row["workflow_instance_id"]) || instance.CallbackPath != workflowapproval.CallbackPath || instance.Status != b.Status || instance.Initiator != row["created_by"] || instance.Form["snapshotHash"] != hash {
		return nil, httperror.New(403, "people_callback_binding_invalid", "Workflow result does not match frozen assignment")
	}
	// The formal initiator, not a body-provided approval actor, anchors the audit.
	who.Actor = instance.Initiator
	who.Key = "people:workflow:" + b.InstanceID + ":" + b.Status
	i := people.EnterpriseFactsInput{ID: fmt.Sprint(row["id"]), EmployeeUID: uid, Payload: map[string]any{"workflowInstanceId": instance.ID, "result": instance.Status}}
	out, e := s.receipt(ctx, tx, r, "workflow-callback", i, who, func() (map[string]any, error) {
		if e := people.ApplyAssignmentResultTx(ctx, tx, r.Table, row, instance.Status, people.FactsContext{Tenant: who.Tenant, Deployment: who.Deployment, Actor: who.Actor, Client: who.Client, RequestID: who.RequestID, Key: who.Key, AsOf: time.Now().UTC()}); e != nil {
			return nil, e
		}
		var version int64
		if e := tx.QueryRowContext(ctx, "SELECT row_version FROM "+assignments+" WHERE id=?", row["id"]).Scan(&version); e != nil {
			return nil, e
		}
		return map[string]any{"id": row["id"], "row_version": version}, nil
	})
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return out, nil
}
