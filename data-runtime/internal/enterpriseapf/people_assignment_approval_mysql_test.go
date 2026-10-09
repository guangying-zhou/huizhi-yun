package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
)

func TestAPF18PeopleAssignmentRecoveryMySQL(t *testing.T) {
	s, db := factsFixture(t)
	ctx := context.Background()
	b := s.Binding
	d := b.Domains["people"]
	d.Scheduler = enterprise.PathUnified
	b.Domains["people"] = d
	s.Binding = b
	s.Registry = enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e := s.Registry.Register(ctx, b); e != nil {
		t.Fatal(e)
	}
	user := Identity{Actor: "HR", Client: "enterprise.runtime", Tenant: "C000001", Deployment: "host-test", Key: "employee"}
	all := altoc.BasicReadScope{Access: "all"}
	call := func(op string, i people.EnterpriseFactsInput) map[string]any {
		t.Helper()
		out, e := s.Execute(ctx, op, i, user, all)
		if e != nil {
			t.Fatal(op, e)
		}
		return out.(map[string]any)["data"].(map[string]any)
	}
	call("employees-create", people.EnterpriseFactsInput{EmployeeUID: "RecoveryEmployee", Payload: map[string]any{"display_name": "Recovery", "dept_code": "A"}})
	user.Key = "draft"
	draft := call("assignments-change", people.EnterpriseFactsInput{EmployeeUID: "RecoveryEmployee", Payload: map[string]any{"change_type": "transfer", "effective_from": "2099-01-01", "dept_code": "B"}})
	id := fmt.Sprint(draft["id"])
	machine := user
	machine.Actor = ""
	machine.Key = ""
	pending, e := s.PendingAssignmentApprovals(ctx, machine)
	if e != nil || len(pending) != 0 {
		t.Fatal("ordinary draft recovered", pending, e)
	}
	input := people.EnterpriseFactsInput{ID: id, EmployeeUID: "RecoveryEmployee", Payload: map[string]any{"expectedVersion": float64(1)}}
	user.Key = "request"
	forged := user
	forged.Actor = "Other"
	if _, e = s.Execute(ctx, "assignments-request-workflow", input, forged, all); peopleStatus(e) != 403 {
		t.Fatal("foreign initiator", e)
	}
	if _, e = db.Exec("CREATE TRIGGER apf18_fail BEFORE INSERT ON people_integration_operation FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated fault'"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Execute(ctx, "assignments-request-workflow", input, user, all); e == nil {
		t.Fatal("freeze fault ignored")
	}
	if _, e = db.Exec("DROP TRIGGER apf18_fail"); e != nil {
		t.Fatal(e)
	}
	var status string
	db.QueryRow("SELECT approval_status FROM people_assignments WHERE id=?", id).Scan(&status)
	if status != "draft" {
		t.Fatal("partial pending state", status)
	}
	call("assignments-request-workflow", input)
	call("assignments-request-workflow", input) // immutable user receipt replay
	pending, e = s.PendingAssignmentApprovals(ctx, machine)
	if e != nil || len(pending) != 1 {
		t.Fatal("missing frozen request", pending, e)
	}
	// Request-driven recovery is scoped to one assignment; no scheduler/drain.
	recoverInput := people.EnterpriseFactsInput{ID: id, EmployeeUID: "RecoveryEmployee", Payload: map[string]any{"expectedVersion": float64(2), "phase": "recover"}}
	user.Key = "new-browser-key"
	recovered := call("assignments-request-workflow", recoverInput)
	frozen := recovered["frozenApproval"].(FrozenPeopleApproval)
	if frozen.OperationKey != pending[0].OperationKey {
		t.Fatal("recovery replaced original operation")
	}
	if _, e = s.Execute(ctx, "assignments-request-workflow", recoverInput, forged, all); peopleStatus(e) != 403 {
		t.Fatal("foreign recovery", e)
	}
	if _, e = s.Execute(ctx, "assignments-request-workflow", recoverInput, user, altoc.BasicReadScope{Access: "none"}); peopleStatus(e) != 403 {
		t.Fatal("out-of-scope recovery", e)
	}
	if _, e = db.Exec("UPDATE people_integration_operation SET status='failed_permanent' WHERE operation_key=?", frozen.OperationKey); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Execute(ctx, "assignments-request-workflow", recoverInput, user, all); peopleStatus(e) != 409 {
		t.Fatal("missing frozen intent", e)
	}
	if _, e = db.Exec("UPDATE people_integration_operation SET status='pending' WHERE operation_key=?", frozen.OperationKey); e != nil {
		t.Fatal(e)
	}
	f := pending[0]
	if f.Actor != "HR" || f.Form["requestedBy"] != "HR" || f.Key != "people:assignment:"+id+":request" || f.ExpectedVersion != 2 {
		t.Fatal("incorrect frozen command", f)
	}
	user.Key = "edit-frozen"
	if _, e = s.Execute(ctx, "assignments-update", people.EnterpriseFactsInput{ID: id, EmployeeUID: "RecoveryEmployee", Payload: map[string]any{"expectedVersion": float64(2), "remarks": "tampered"}}, user, all); peopleStatus(e) != 409 {
		t.Fatal("frozen edit", e)
	}
	raw, _ := json.Marshal(f.Form)
	if _, e = db.Exec("INSERT INTO workflow_flow_instances VALUES(981,'people','assignments','change',?,'HR','running',?)", f.BizID, string(raw)); e != nil {
		t.Fatal(e)
	}
	for _, change := range []string{"initiator_uid='Other'", "biz_id='Other'", "status='approved'", "resource_code='employees'"} {
		if _, e = db.Exec("UPDATE workflow_flow_instances SET " + change + " WHERE id=981"); e != nil {
			t.Fatal(e)
		}
		if _, e = s.BindAssignmentApproval(ctx, f.OperationKey, "981", machine); peopleStatus(e) != 403 {
			t.Fatal(change, e)
		}
		if _, e = db.Exec("UPDATE workflow_flow_instances SET initiator_uid='HR',biz_id=?,status='running',resource_code='assignments' WHERE id=981", f.BizID); e != nil {
			t.Fatal(e)
		}
	}
	for _, bad := range []Identity{user, {Client: "people.runtime", Tenant: machine.Tenant, Deployment: machine.Deployment}, {Client: machine.Client, Tenant: "other", Deployment: machine.Deployment}, {Client: machine.Client, Tenant: machine.Tenant, Deployment: "other"}} {
		if _, e = s.BindAssignmentApproval(ctx, f.OperationKey, "981", bad); peopleStatus(e) != 403 {
			t.Fatal("untrusted machine", e)
		}
	}
	// Two machine deliveries may observe the same frozen intent. Both must
	// converge after People row locks, without a Registry lock upgrade.
	start := make(chan struct{})
	errors := make(chan error, 2)
	for range 2 {
		go func() {
			<-start
			_, err := s.BindAssignmentApproval(ctx, f.OperationKey, "981", machine)
			errors <- err
		}()
	}
	close(start)
	for range 2 {
		if err := <-errors; err != nil {
			t.Fatal("concurrent bind", err)
		}
	}
	if _, e = s.BindAssignmentApproval(ctx, f.OperationKey, "981", machine); e != nil {
		t.Fatal("lost ack replay", e)
	}
	boundRecovery := call("assignments-request-workflow", recoverInput)
	if fmt.Sprint(boundRecovery["workflow_instance_id"]) != "981" {
		t.Fatal("bound recovery not idempotent")
	}
	pending, e = s.PendingAssignmentApprovals(ctx, machine)
	if e != nil || len(pending) != 0 {
		t.Fatal("bound request reclaimed", pending, e)
	}
	var count int
	db.QueryRow("SELECT COUNT(*) FROM people_integration_operation WHERE operation_code=?", assignmentApprovalCode).Scan(&count)
	if count != 1 {
		t.Fatal("duplicate operation", count)
	}
	db.QueryRow("SELECT status FROM people_integration_operation WHERE operation_code=?", assignmentApprovalCode).Scan(&status)
	if status != "succeeded" {
		t.Fatal(status)
	}
	var dept string
	db.QueryRow("SELECT dept_code FROM people_employees WHERE employee_uid='RecoveryEmployee'").Scan(&dept)
	if dept != "A" {
		t.Fatal("future projected early", dept)
	}
	// Request-driven bind acknowledges the same operation, and machine recovery
	// never treats an ordinary draft as an approval request.
	user.Key = "draft-immediate"
	second := call("assignments-change", people.EnterpriseFactsInput{EmployeeUID: "RecoveryEmployee", Payload: map[string]any{"change_type": "transfer", "effective_from": "2099-02-01", "dept_code": "C"}})
	secondID := fmt.Sprint(second["id"])
	user.Key = "request-immediate"
	call("assignments-request-workflow", people.EnterpriseFactsInput{ID: secondID, EmployeeUID: "RecoveryEmployee", Payload: map[string]any{"expectedVersion": float64(1)}})
	pending, e = s.PendingAssignmentApprovals(ctx, machine)
	if e != nil || len(pending) != 1 {
		t.Fatal("immediate frozen intent", e)
	}
	raw, _ = json.Marshal(pending[0].Form)
	if _, e = db.Exec("INSERT INTO workflow_flow_instances VALUES(982,'people','assignments','change',?,'HR','running',?)", pending[0].BizID, string(raw)); e != nil {
		t.Fatal(e)
	}
	user.Key = "request-immediate:bind"
	call("assignments-attach-workflow", people.EnterpriseFactsInput{ID: secondID, EmployeeUID: "RecoveryEmployee", Payload: map[string]any{"expectedVersion": float64(2), "workflowInstanceId": "982"}})
	db.QueryRow("SELECT status FROM people_integration_operation WHERE BINARY operation_key=BINARY ?", pending[0].OperationKey).Scan(&status)
	if status != "succeeded" {
		t.Fatal("request-driven bind did not acknowledge frozen intent", status)
	}
	// Every fixture owns a disposable DB (peopleFixture cleanup), no shared rows.
}
