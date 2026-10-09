package enterpriseapf

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"strings"
	"testing"
)

func privateFixture(t *testing.T) (*Service, *sql.DB) {
	base, db := peopleFixture(t)
	ctx := context.Background()
	b, e := domaininstall.WithPeoplePrivateFacts(base.binding)
	if e != nil {
		t.Fatal(e)
	}
	installer := domaininstall.ForPeoplePrivateFacts(domaininstall.Expectation{Tenant: "C000001", Environment: "test", OwnerDeployment: "host-test"})
	p, e := installer.PlanInstall(ctx, db, b)
	if e != nil {
		t.Fatal(e)
	}
	off := func(context.Context) error { return nil }
	var receipt domaininstall.Receipt
	if e = installer.Apply(ctx, db, p, off, func(r domaininstall.Receipt) error { receipt = r; return nil }); e != nil {
		t.Fatal(e)
	}
	if e = installer.Verify(ctx, db, p); e != nil {
		t.Fatal(e)
	}
	if e = installer.Rollback(ctx, db, receipt, off); e != nil {
		t.Fatal(e)
	}
	p, e = installer.PlanInstall(ctx, db, b)
	if e != nil {
		t.Fatal(e)
	}
	if e = installer.Apply(ctx, db, p, off, func(r domaininstall.Receipt) error { receipt = r; return nil }); e != nil {
		t.Fatal(e)
	}
	if e = installer.Verify(ctx, db, p); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("INSERT INTO people_employee_private_facts(employee_uid,field_code,source_code,value_text) VALUES('guard','major','manual','不得丢失')"); e != nil {
		t.Fatal(e)
	}
	if installer.Rollback(ctx, db, receipt, off) == nil {
		t.Fatal("rollback discarded private data")
	}
	db.Exec("DELETE FROM people_employee_private_facts WHERE employee_uid='guard'")
	registry := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e = registry.Register(ctx, b); e != nil {
		t.Fatal(e)
	}
	s, e := New(registry, b)
	if e != nil {
		t.Fatal(e)
	}
	return s, db
}
func TestAPFPeoplePrivateMySQL(t *testing.T) {
	s, db := privateFixture(t)
	ctx := context.Background()
	db.Exec("INSERT INTO people_employees(employee_uid,employee_no,display_name,dept_code) VALUES('Person','E1','甲','A'),('Other','E2','乙','B')")
	who := Identity{Actor: "Manager", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "private-update", RequestID: "private-test"}
	scope := altoc.BasicReadScope{Access: "dept", DepartmentCodes: []string{"A"}}
	i := PeopleInput{ID: "Person", Payload: map[string]any{"expectedVersion": float64(1), "id_number": "12345619900101001X", "major": "设计"}, CostScope: people.EnterpriseMasterScope{Access: "none"}}
	out, e := s.People(ctx, "employees-private-update", i, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	if out.(map[string]any)["data"].(map[string]any)["row_version"] != int64(2) {
		t.Fatal("version")
	}
	replay, e := s.People(ctx, "employees-private-update", i, who, scope)
	if e != nil || replay.(map[string]any)["replayed"] != true {
		t.Fatal("replay", e)
	}
	if _, e = s.People(ctx, "employees-private-update", i, who, altoc.BasicReadScope{Access: "none"}); peopleStatus(e) != 404 {
		t.Fatal("revoked scope old key", e)
	}
	read := PeopleInput{ID: "Person", Payload: map[string]any{}, CostScope: people.EnterpriseMasterScope{Access: "none"}}
	out, e = s.People(ctx, "employees-private-view", read, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	fields := out.(map[string]any)["data"].(map[string]any)["fields"].(map[string]any)
	if fields["id_number"].(map[string]any)["value"] != "123456********001X" {
		t.Fatal("id not masked", fields)
	}
	var command string
	db.QueryRow("SELECT command_json FROM people_service_command_receipt LIMIT 1").Scan(&command)
	if strings.Contains(command, "12345619900101001X") || strings.Contains(command, "设计") {
		t.Fatal("private values duplicated into audit ledger")
	}
	who.Key = "stale"
	if _, e = s.People(ctx, "employees-private-update", i, who, scope); peopleStatus(e) != 409 {
		t.Fatal("stale", e)
	}
	db.Exec("INSERT INTO people_employee_private_facts(employee_uid,field_code,source_code,value_text) VALUES('Person','major','dingtalk','受管')")
	i.Payload = map[string]any{"expectedVersion": float64(2), "major": "替换"}
	who.Key = "dingtalk"
	if _, e = s.People(ctx, "employees-private-update", i, who, scope); peopleStatus(e) != 409 {
		t.Fatal("dingtalk overwritten", e)
	}
	i.Payload = map[string]any{"expectedVersion": float64(2), "bank_account": "forged"}
	if _, e = s.People(ctx, "employees-private-update", i, who, scope); peopleStatus(e) != 400 {
		t.Fatal("unknown private field", e)
	}
	read.ID = "Other"
	if _, e = s.People(ctx, "employees-private-view", read, who, scope); peopleStatus(e) != 404 {
		t.Fatal("cross employee", e)
	}
	var n int
	db.QueryRow("SELECT COUNT(*) FROM people_service_command_receipt").Scan(&n)
	if n != 1 {
		t.Fatal("failure left receipt", n)
	}
}
