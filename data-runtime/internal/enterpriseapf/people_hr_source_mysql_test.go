package enterpriseapf

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"sync"
	"testing"
)

func TestAPFPeopleHRSourceMySQL(t *testing.T) {
	s, db := factsFixture(t)
	ctx := context.Background()
	b, e := domaininstall.WithPeopleHRSource(s.Binding)
	if e != nil {
		t.Fatal(e)
	}
	install := domaininstall.ForPeopleHRSource(domaininstall.Expectation{Tenant: "C000001", Environment: "test", OwnerDeployment: "host-test"})
	p, e := install.PlanInstall(ctx, db, b)
	if e != nil {
		t.Fatal(e)
	}
	var receipt domaininstall.Receipt
	off := func(context.Context) error { return nil }
	if e = install.Apply(ctx, db, p, off, func(r domaininstall.Receipt) error { receipt = r; return nil }); e != nil {
		t.Fatal(e)
	}
	if e = install.Verify(ctx, db, p); e != nil {
		t.Fatal(e)
	}
	if e = install.Rollback(ctx, db, receipt, off); e != nil {
		t.Fatal(e)
	}
	p, e = install.PlanInstall(ctx, db, b)
	if e != nil {
		t.Fatal(e)
	}
	if e = install.Apply(ctx, db, p, off, func(domaininstall.Receipt) error { return nil }); e != nil {
		t.Fatal(e)
	}
	s.Binding = b
	s.Registry = enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e = s.Registry.Register(ctx, b); e != nil {
		t.Fatal(e)
	}
	who := Identity{Actor: "HR", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "map", RequestID: "hr-isolated"}
	all := altoc.BasicReadScope{Access: "all"}
	input := people.EnterpriseFactsInput{ID: "dingtalk", Payload: map[string]any{"expectedVersion": float64(1), "command": map[string]any{"mappings": []any{map[string]any{"externalDepartmentId": "123", "canonicalDeptCode": "B"}}}}}
	call := func(op string, i people.EnterpriseFactsInput) map[string]any {
		t.Helper()
		o, e := s.Execute(ctx, op, i, who, all)
		if e != nil {
			t.Fatal(op, e)
		}
		return o.(map[string]any)["data"].(map[string]any)
	}
	for _, bad := range []Identity{{Actor: "HR", Tenant: "wrong", Deployment: "host-test", Client: "enterprise.runtime", Key: "map"}, {Actor: "HR", Tenant: "C000001", Deployment: "wrong", Client: "enterprise.runtime", Key: "map"}, {Actor: "HR", Tenant: "C000001", Deployment: "host-test", Client: "people.runtime", Key: "map"}} {
		if _, e = s.Execute(ctx, "hr-mappings-prepare", input, bad, all); peopleStatus(e) != 403 {
			t.Fatal("identity boundary", e)
		}
	}
	if _, e = s.Execute(ctx, "hr-mappings-prepare", input, who, altoc.BasicReadScope{Access: "dept", DepartmentCodes: []string{"A"}}); peopleStatus(e) != 403 {
		t.Fatal("scoped employee permission became global HR", e)
	}
	prepared := call("hr-mappings-prepare", input)
	same := call("hr-mappings-prepare", input)
	if same["operationKey"] != prepared["operationKey"] {
		t.Fatal("new command on replay")
	}
	state := call("hr-state", people.EnterpriseFactsInput{ID: "dingtalk"})
	if state["remapPending"] != true || state["resume"] == nil {
		t.Fatal("lost frozen intent", state)
	}
	if _, e = s.Execute(ctx, "hr-mappings-prepare", input, who, altoc.BasicReadScope{Access: "none"}); peopleStatus(e) != 403 {
		t.Fatal("revoked replay", e)
	}
	bad := input
	bad.Payload = map[string]any{"expectedVersion": float64(2), "command": input.Payload["command"]}
	if _, e = s.Execute(ctx, "hr-mappings-prepare", bad, who, all); peopleStatus(e) != 409 {
		t.Fatal("version changed replay", e)
	}
	who.Key = "start"
	start := people.EnterpriseFactsInput{ID: "dingtalk", Payload: map[string]any{"expectedVersion": float64(2), "command": map[string]any{}, "sourceReady": true}}
	if _, e = s.Execute(ctx, "hr-jobs-start-prepare", start, who, all); peopleStatus(e) != 409 {
		t.Fatal("sync during pending", e)
	}
	frozen := prepared["frozen"].(map[string]any)
	confirmation := people.EnterpriseFactsInput{ID: "dingtalk", Payload: map[string]any{"operationKey": prepared["operationKey"], "confirmation": map[string]any{"targetConfirmed": true, "commandSha256": frozen["commandSha256"], "aliases": []any{map[string]any{"aliasDeptCode": "A", "canonicalDeptCode": "B"}}}}}
	if _, e = db.Exec("INSERT INTO people_employees(employee_uid,employee_no,display_name,dept_code,created_by) VALUES('RealEmployee','EMP-HR-01','真实员工','A','HR')"); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("INSERT INTO people_assignments(assignment_code,employee_uid,change_type,effective_from,dept_code,approval_status) VALUES('ASN-HR-FUTURE','RealEmployee','transfer','2099-01-01','A','approved')"); e != nil {
		t.Fatal(e)
	}
	forged := confirmation
	forged.Payload = map[string]any{"operationKey": prepared["operationKey"], "confirmation": map[string]any{"targetConfirmed": false, "commandSha256": frozen["commandSha256"], "aliases": []any{}}}
	if _, e = s.Execute(ctx, "hr-mappings-confirm", forged, who, all); peopleStatus(e) != 403 {
		t.Fatal("false target confirmation", e)
	}
	// Fail after employee mutation: facts, source gate, operation and receipt stay untouched.
	if _, e = db.Exec("CREATE TRIGGER hr_fail BEFORE UPDATE ON people_hr_source_state FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated fault'"); e != nil {
		t.Fatal(e)
	}
	who.Key = "map:confirmed"
	if _, e = s.Execute(ctx, "hr-mappings-confirm", confirmation, who, all); e == nil {
		t.Fatal("fault committed")
	}
	db.Exec("DROP TRIGGER hr_fail")
	var code string
	db.QueryRow("SELECT dept_code FROM people_employees WHERE employee_uid='RealEmployee'").Scan(&code)
	if code != "A" {
		t.Fatal("partial remap", code)
	}
	call("hr-mappings-confirm", confirmation)
	call("hr-mappings-confirm", confirmation)
	db.QueryRow("SELECT dept_code FROM people_employees WHERE employee_uid='RealEmployee'").Scan(&code)
	if code != "B" {
		t.Fatal("not remapped")
	}
	var approval string
	var future string
	if e = db.QueryRow("SELECT approval_status,CAST(effective_from AS CHAR) FROM people_assignments WHERE assignment_code='ASN-HR-FUTURE' AND dept_code='B'").Scan(&approval, &future); e != nil || approval != "approved" || future != "2099-01-01" {
		t.Fatal("future facts changed", approval, future, e)
	}
	if call("hr-state", people.EnterpriseFactsInput{ID: "dingtalk"})["remapPending"] != false {
		t.Fatal("gate stuck")
	}
	var n int
	db.QueryRow("SELECT COUNT(*) FROM people_service_command_receipt WHERE operation_code LIKE 'people.apf09c1.hr-%'").Scan(&n)
	if n != 2 {
		t.Fatal("receipt duplicate", n)
	}
	// Two different new source intents at the same version serialize to one frozen command.
	start.Payload["expectedVersion"] = float64(3)
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for j := 0; j < 2; j++ {
		wg.Add(1)
		go func(j int) {
			defer wg.Done()
			w := who
			w.Key = fmt.Sprintf("race-%d", j)
			_, e := s.Execute(ctx, "hr-jobs-start-prepare", start, w, all)
			errs <- e
		}(j)
	}
	wg.Wait()
	close(errs)
	success := 0
	for e := range errs {
		if e == nil {
			success++
		} else if peopleStatus(e) != 409 {
			t.Fatal(e)
		}
	}
	if success != 1 {
		t.Fatal("concurrent duplicate", success)
	}
}
