package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
	"testing"
)

type factsTestReader struct{ db *sql.DB }

func (r factsTestReader) ReadPeopleApprovalInstance(ctx context.Context, id string) (*workflowapproval.Instance, error) {
	var v workflowapproval.Instance
	var raw []byte
	e := r.db.QueryRowContext(ctx, "SELECT id,app_code,resource_code,action_code,biz_id,initiator_uid,status,form_data FROM workflow_flow_instances WHERE id=?", id).Scan(&v.ID, &v.App, &v.Resource, &v.Action, &v.BizID, &v.Initiator, &v.Status, &raw)
	if e != nil {
		return nil, e
	}
	e = json.Unmarshal(raw, &v.Form)
	v.CallbackPath = workflowapproval.CallbackPath
	return &v, e
}
func factsFixture(t *testing.T, parseDates ...bool) (PeopleFactsService, *sql.DB) {
	base, db := peopleFixture(t, parseDates...)
	ctx := context.Background()
	b, e := domaininstall.WithPeopleFacts(base.binding)
	if e != nil {
		t.Fatal(e)
	}
	install := domaininstall.ForPeopleFacts(domaininstall.Expectation{Tenant: "C000001", Environment: "test", OwnerDeployment: "host-test"})
	plan, e := install.PlanInstall(ctx, db, b)
	if e != nil {
		t.Fatal(e)
	}
	var receipt domaininstall.Receipt
	off := func(context.Context) error { return nil }
	if e = install.Apply(ctx, db, plan, off, func(r domaininstall.Receipt) error { receipt = r; return nil }); e != nil {
		t.Fatal(e)
	}
	if e = install.Verify(ctx, db, plan); e != nil {
		t.Fatal(e)
	}
	if e = install.Rollback(ctx, db, receipt, off); e != nil {
		t.Fatal(e)
	}
	plan, e = install.PlanInstall(ctx, db, b)
	if e != nil {
		t.Fatal(e)
	}
	if e = install.Apply(ctx, db, plan, off, func(domaininstall.Receipt) error { return nil }); e != nil {
		t.Fatal(e)
	}
	if e = install.Verify(ctx, db, plan); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("CREATE TABLE workflow_flow_instances(id BIGINT PRIMARY KEY,app_code VARCHAR(30),resource_code VARCHAR(40),action_code VARCHAR(40),biz_id VARCHAR(64),initiator_uid VARCHAR(64),status VARCHAR(30),form_data JSON) ENGINE=InnoDB"); e != nil {
		t.Fatal(e)
	}
	// No Workflow Registry domain: reads use the independently injected port.
	registry := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e = registry.Register(ctx, b); e != nil {
		t.Fatal(e)
	}
	return PeopleFactsService{Registry: registry, Binding: b, ApprovalReader: factsTestReader{db: db}}, db
}
func TestAPFPeopleFactsC1MySQL(t *testing.T) {
	s, db := factsFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "HR", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "employee-create", RequestID: "c1-isolated"}
	all := altoc.BasicReadScope{Access: "all"}
	dept := altoc.BasicReadScope{Access: "dept", DepartmentCodes: []string{"A"}}
	call := func(op string, i people.EnterpriseFactsInput) map[string]any {
		t.Helper()
		o, e := s.Execute(ctx, op, i, who, all)
		if e != nil {
			t.Fatal(op, e)
		}
		return o.(map[string]any)
	}
	in := people.EnterpriseFactsInput{EmployeeUID: "Employee-A", Payload: map[string]any{"display_name": "员工甲", "dept_code": "A"}}
	out := call("employees-create", in)
	id := out["data"].(map[string]any)["id"].(string)
	if call("employees-create", in)["replayed"] != true {
		t.Fatal("duplicate employee")
	}
	var n int
	db.QueryRow("SELECT COUNT(*) FROM people_integration_operation").Scan(&n)
	if n != 1 {
		t.Fatal("lifecycle not frozen", n)
	}
	var source, client, status string
	db.QueryRow("SELECT source_app,service_client_id,status FROM people_integration_operation").Scan(&source, &client, &status)
	if source != "enterprise" || client != "enterprise.runtime" || status != "pending" {
		t.Fatal("wrong source or delivered", source, client, status)
	}
	in.ID = id
	in.Payload = map[string]any{"expectedVersion": float64(1), "display_name": "改名"}
	who.Key = "employee-update"
	call("employees-update", in)
	if call("employees-update", in)["replayed"] != true {
		t.Fatal("same-key update")
	}
	who.Key = "stale"
	if _, e := s.Execute(ctx, "employees-update", in, who, all); peopleStatus(e) != 409 {
		t.Fatal("stale", e)
	}
	who.Key = "revoked"
	if _, e := s.Execute(ctx, "employees-update", in, who, altoc.BasicReadScope{Access: "none"}); peopleStatus(e) != 403 {
		t.Fatal("revoked", e)
	}
	// Cause a real error after employee mutation, at lifecycle insert. Both facts
	// and their receipt must roll back with the operation.
	db.QueryRow("SELECT COUNT(*) FROM people_service_command_receipt").Scan(&n)
	beforeReceipts := n
	if _, e := db.Exec("CREATE TRIGGER reject_lifecycle BEFORE INSERT ON people_integration_operation FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated fault'"); e != nil {
		t.Fatal(e)
	}
	in.Payload = map[string]any{"expectedVersion": float64(2), "display_name": "不得保存"}
	who.Key = "rollback"
	if _, e := s.Execute(ctx, "employees-update", in, who, all); e == nil {
		t.Fatal("fault not returned")
	}
	db.Exec("DROP TRIGGER reject_lifecycle")
	var name string
	db.QueryRow("SELECT display_name FROM people_employees WHERE id=?", id).Scan(&name)
	if name != "改名" {
		t.Fatal("partial employee commit", name)
	}
	db.QueryRow("SELECT COUNT(*) FROM people_service_command_receipt").Scan(&n)
	if n != beforeReceipts {
		t.Fatal("failed receipt committed")
	}
	// Draft primary changes and future approval cannot project early.
	who.Key = "future-change"
	a := people.EnterpriseFactsInput{EmployeeUID: "Employee-A", Payload: map[string]any{"change_type": "transfer", "effective_from": "2099-01-01", "dept_code": "B"}}
	if _, e := s.Execute(ctx, "assignments-change", a, who, dept); peopleStatus(e) != 403 {
		t.Fatal("cross department", e)
	}
	out = call("assignments-change", a)
	data := out["data"].(map[string]any)
	aid := data["id"].(string)
	code := data["assignment_code"].(string)
	form := data["formData"].(map[string]any)
	form["snapshotHash"] = data["snapshotHash"]
	raw, _ := json.Marshal(form)
	if _, e := db.Exec("INSERT INTO workflow_flow_instances VALUES(1,'people','assignments','change',?,'HR','running',?)", code, string(raw)); e != nil {
		t.Fatal(e)
	}
	who.Key = "attach"
	a.ID = aid
	a.Payload = map[string]any{"expectedVersion": float64(1), "workflowInstanceId": "1"}
	call("assignments-attach-workflow", a)
	if _, e := db.Exec("UPDATE workflow_flow_instances SET status='approved' WHERE id=1"); e != nil {
		t.Fatal(e)
	}
	callback := PeopleFactsCallback{AppCode: "people", BizType: "assignments", BizID: code, InstanceID: "1", Status: "approved"}
	if _, e := s.Callback(ctx, callback, who); e != nil {
		t.Fatal("formal callback", e)
	}
	if _, e := s.Callback(ctx, callback, who); e != nil {
		t.Fatal("callback replay", e)
	}
	var d, approval string
	db.QueryRow("SELECT dept_code FROM people_employees WHERE id=?", id).Scan(&d)
	db.QueryRow("SELECT approval_status FROM people_assignments WHERE id=?", aid).Scan(&approval)
	if d != "A" || approval != "approved" {
		t.Fatal("future projected early", d, approval)
	}
	callback.Status = "rejected"
	if _, e := s.Callback(ctx, callback, who); peopleStatus(e) != 403 {
		t.Fatal("browser/fake result", e)
	}
	// Formal rejected result for another draft never updates current employment.
	who.Key = "today-change"
	a = people.EnterpriseFactsInput{EmployeeUID: "Employee-A", Payload: map[string]any{"change_type": "transfer", "effective_from": "2000-01-01", "dept_code": "B"}}
	out = call("assignments-create", a)
	data = out["data"].(map[string]any)
	aid = data["id"].(string)
	code = data["assignment_code"].(string)
	form = data["formData"].(map[string]any)
	form["snapshotHash"] = data["snapshotHash"]
	raw, _ = json.Marshal(form)
	db.Exec("INSERT INTO workflow_flow_instances VALUES(2,'people','assignments','change',?,'HR','running',?)", code, string(raw))
	who.Key = "attach-two"
	a.ID = aid
	a.Payload = map[string]any{"expectedVersion": float64(1), "workflowInstanceId": "2"}
	call("assignments-attach-workflow", a)
	db.Exec("UPDATE workflow_flow_instances SET status='approved' WHERE id=2")
	callback = PeopleFactsCallback{AppCode: "people", BizType: "assignments", BizID: code, InstanceID: "2", Status: "approved"}
	if _, e := s.Callback(ctx, callback, who); e != nil {
		t.Fatal("current callback", e)
	}
	db.QueryRow("SELECT dept_code FROM people_employees WHERE id=?", id).Scan(&d)
	if d != "B" {
		t.Fatal("effective assignment not projected", d)
	}
	// Draft deletion must replay the immutable result after the row is gone,
	// but current employee scope is still required before reading the receipt.
	who.Key = "delete-draft-create"
	draft := people.EnterpriseFactsInput{EmployeeUID: "Employee-A", Payload: map[string]any{"change_type": "transfer", "effective_from": "2098-01-01", "dept_code": "B"}}
	draftOut := call("assignments-create", draft)["data"].(map[string]any)
	draft.ID = draftOut["id"].(string)
	draft.Payload = map[string]any{"expectedVersion": float64(1), "remarks": "draft update"}
	who.Key = "delete-draft-update"
	call("assignments-update", draft)
	draft.Payload = map[string]any{"expectedVersion": float64(2)}
	who.Key = "delete-draft"
	call("assignments-delete", draft)
	if call("assignments-delete", draft)["replayed"] != true {
		t.Fatal("deleted draft not replayed")
	}
	if _, e := s.Execute(ctx, "assignments-delete", draft, who, altoc.BasicReadScope{Access: "none"}); peopleStatus(e) != 403 {
		t.Fatal("deleted replay after revoke", e)
	}
	who.Key = "other-delete-key"
	if _, e := s.Execute(ctx, "assignments-delete", draft, who, all); peopleStatus(e) != 404 {
		t.Fatal("missing draft new-key delete", e)
	}
	// Signed cross-employee identity does not let an ID reference another parent.
	who.Key = "bad-id"
	in.ID = id
	in.EmployeeUID = "Other"
	in.Payload = map[string]any{"expectedVersion": float64(3), "display_name": "坏"}
	if _, e := s.Execute(ctx, "employees-update", in, who, all); e == nil {
		t.Fatal("wrong employee")
	}
}
func TestAPFPeopleOnboardingC1MySQL(t *testing.T) {
	s, db := factsFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "HR", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "onboarding", RequestID: "onboarding-isolated"}
	scope := altoc.BasicReadScope{Access: "dept", DepartmentCodes: []string{"A"}}
	i := people.EnterpriseFactsInput{Payload: map[string]any{"candidate_name": "新人", "dept_code": "A", "canonical_uid": "NewPerson", "planned_onboard_date": "2099-01-01"}}
	out, e := s.Execute(ctx, "onboarding-create", i, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Execute(ctx, "onboarding-create", i, who, scope); e != nil {
		t.Fatal("replay", e)
	}
	id := out.(map[string]any)["data"].(map[string]any)["id"].(string)
	var count int
	db.QueryRow("SELECT COUNT(*) FROM people_employees").Scan(&count)
	if count != 0 {
		t.Fatal("candidate activated employee")
	}
	db.QueryRow("SELECT COUNT(*) FROM people_integration_operation").Scan(&count)
	if count != 0 {
		t.Fatal("candidate froze account operation")
	}
	i.ID = id
	i.Payload = map[string]any{"expectedVersion": float64(1), "candidate_name": "新人二"}
	who.Key = "onboarding-update"
	if _, e = s.Execute(ctx, "onboarding-update", i, who, scope); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Execute(ctx, "onboarding-update", i, who, altoc.BasicReadScope{Access: "self"}); peopleStatus(e) != 403 {
		t.Fatal("candidate self escalation", e)
	}
	list := people.EnterpriseFactsInput{Page: 1, PageSize: 1, Payload: map[string]any{}}
	o, e := s.Execute(ctx, "onboarding-list", list, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	if o.(map[string]any)["total"] != int64(1) {
		t.Fatal("count")
	}
	other := altoc.BasicReadScope{Access: "dept", DepartmentCodes: []string{"B"}}
	o, e = s.Execute(ctx, "onboarding-list", list, who, other)
	if e != nil || o.(map[string]any)["total"] != int64(0) {
		t.Fatal("scope count", e)
	}
	if _, e = db.Exec("UPDATE people_onboarding_cases SET status='reserving_identity' WHERE id=?", id); e != nil {
		t.Fatal(e)
	}
	who.Key = "frozen"
	i.Payload["expectedVersion"] = float64(2)
	if _, e = s.Execute(ctx, "onboarding-update", i, who, scope); peopleStatus(e) != 409 {
		t.Fatal("in flight case editable", e)
	}
	t.Log(fmt.Sprint("isolated cases cleaned with database"))
}
