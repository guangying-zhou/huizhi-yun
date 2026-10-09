package enterpriseapf

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func peopleFixture(t *testing.T, parseDates ...bool) (*Service, *sql.DB) {
	t.Helper()
	socket := os.Getenv("HZY_DOMAIN_INSTALL_SOCKET")
	if socket == "" {
		t.Skip("isolated MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.ParseTime = len(parseDates) > 0 && parseDates[0]
	mc.Net = "unix"
	mc.Addr = socket
	root, e := sql.Open("mysql", mc.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { root.Close() })
	name := "hzy_apf09_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e = root.Exec("CREATE DATABASE " + name); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		if _, e := root.Exec("DROP DATABASE " + name); e != nil {
			t.Error(e)
		}
	})
	mc.DBName = name
	db, e := sql.Open("mysql", mc.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close() })
	for _, q := range []string{"CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(30),environment_code VARCHAR(30),runtime_deployment VARCHAR(80),schema_version VARCHAR(30),generation BIGINT) ENGINE=InnoDB", "INSERT INTO enterprise_schema_registry VALUES(1,'C000001','test','runtime-test','v1',7)"} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	var instance string
	db.QueryRow("SELECT @@server_uuid").Scan(&instance)
	b := enterprise.Binding{Key: enterprise.BindingKey{Tenant: "C000001", Environment: "test", RuntimeDeployment: "runtime-test"}, Storage: enterprise.Storage{Database: name, InstanceID: instance, Address: "127.0.0.1:3306"}, SchemaVersion: "v1", Generation: 7, Domains: map[string]enterprise.DomainBinding{}}
	b, e = domaininstall.WithAPF(b, "host-test")
	if e != nil {
		t.Fatal(e)
	}
	d := b.Domains["people"]
	d.Write = enterprise.PathUnified
	b.Domains["people"] = d
	tables, _ := domaininstall.APFTables("people")
	for _, v := range tables {
		if _, e = db.Exec(v.DDL); e != nil {
			t.Fatal(e)
		}
	}
	registry := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e = registry.Register(context.Background(), b); e != nil {
		t.Fatal(e)
	}
	s, e := New(registry, b)
	if e != nil {
		t.Fatal(e)
	}
	return s, db
}
func TestAPFPeopleMasterMySQL(t *testing.T) {
	s, db := peopleFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "Person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "position-create", RequestID: "isolated-people"}
	scope := altoc.BasicReadScope{Access: "all"}
	input := PeopleInput{Payload: map[string]any{"position_code": "POS-A", "position_name": "岗位甲", "enabled": float64(1)}, CostScope: people.EnterpriseMasterScope{Access: "none"}}
	call := func(op string, i PeopleInput) map[string]any {
		t.Helper()
		o, e := s.People(ctx, op, i, who, scope)
		if e != nil {
			t.Fatal(op, e)
		}
		return o.(map[string]any)
	}
	created := call("positions-create", input)
	id := created["data"].(map[string]any)["id"].(string)

	// The live Host M1 list/view routes must expose the full 09a whitelist.
	for _, op := range []string{"list", "view"} {
		q := Input{ID: id}
		if op == "list" {
			q = Input{Page: 1, PageSize: 20}
		}
		value, err := s.Read(ctx, "people", op, q, who.Actor, scope)
		if err != nil {
			t.Fatal("Host position projection", op, err)
		}
		var row map[string]any
		if op == "list" {
			row = value.(map[string]any)["items"].([]any)[0].(map[string]any)
		} else {
			row = value.(map[string]any)
		}
		_, columns := people.MasterColumns("positions-list")
		for _, col := range columns {
			if _, ok := row[col]; !ok {
				t.Fatalf("%s missing %s: %v", op, col, row)
			}
		}
		if row["position_code"] != "POS-A" || row["position_name"] != "岗位甲" || fmt.Sprint(row["enabled"]) != "1" || fmt.Sprint(row["row_version"]) != "1" {
			t.Fatal("Host position values", row)
		}
	}
	replay := call("positions-create", input)
	if replay["replayed"] != true || replay["data"].(map[string]any)["id"] != id {
		t.Fatal("same intent duplicated")
	}
	input.Payload["position_name"] = "different"
	if _, e := s.People(ctx, "positions-create", input, who, scope); e == nil {
		t.Fatal("changed intent accepted")
	}
	input.Payload["position_name"] = "岗位甲"
	input.ID = id
	input.Payload["expectedVersion"] = float64(1)
	who.Key = "position-update"
	call("positions-update", input)
	who.Key = "stale-update"
	if _, e := s.People(ctx, "positions-update", input, who, scope); peopleStatus(e) != 409 {
		t.Fatal("stale version", e)
	}
	// Reference checks and failure leave both primary data and receipt unchanged.
	if _, e := db.Exec("INSERT INTO people_employees(employee_uid,employee_no,display_name,position_code,dept_code,rank_code,rank_name,cost_center_code,mobile,metadata) VALUES('Person','E-A','甲','POS-A','D-A','P1','一级','CC-A','SECRET',JSON_OBJECT('secret','hidden')),('Other','E-B','乙',NULL,'D-B','P2','二级','CC-B','SECRET',JSON_OBJECT('secret','hidden'))"); e != nil {
		t.Fatal(e)
	}
	who.Key = "position-delete"
	del := PeopleInput{ID: id, Payload: map[string]any{"expectedVersion": float64(2)}, CostScope: people.EnterpriseMasterScope{Access: "none"}}
	if _, e := s.People(ctx, "positions-delete", del, who, scope); peopleStatus(e) != 409 {
		t.Fatal("referenced delete", e)
	}
	var n int
	db.QueryRow("SELECT COUNT(*) FROM people_positions").Scan(&n)
	if n != 1 {
		t.Fatal("failed delete mutated")
	}
	db.QueryRow("SELECT COUNT(*) FROM people_service_command_receipt").Scan(&n)
	if n != 2 {
		t.Fatal("failed writes left receipt", n)
	}
	read := PeopleInput{Page: 1, PageSize: 1, Payload: map[string]any{}, CostScope: people.EnterpriseMasterScope{Access: "none"}}
	list := call("employees-search", read)
	if list["total"] != int64(2) || len(list["data"].([]map[string]any)) != 1 {
		t.Fatal("count/pagination")
	}
	row := list["data"].([]map[string]any)[0]
	for _, k := range []string{"rank_code", "rank_name", "cost_center_code", "mobile", "metadata", "login_name"} {
		if _, ok := row[k]; ok {
			t.Fatal("field leaked", k)
		}
	}
	read.PageSize = 100
	read.CostAllowed = true
	read.CostScope = people.EnterpriseMasterScope{Access: "self"}
	list = call("employees-search", read)
	for _, r := range list["data"].([]map[string]any) {
		_, present := r["rank_code"]
		if present != (r["employee_uid"] == who.Actor) {
			t.Fatal("field scope widened", r)
		}
	}
	scope = altoc.BasicReadScope{Access: "dept", DepartmentCodes: []string{"D-A"}}
	list = call("employees-search", read)
	if list["total"] != int64(1) {
		t.Fatal("scope before count")
	}
	profile := PeopleInput{ID: "Other", Payload: map[string]any{}, CostScope: people.EnterpriseMasterScope{Access: "none"}}
	if _, e := s.People(ctx, "employees-profile", profile, who, scope); peopleStatus(e) != 404 {
		t.Fatal("cross dept profile", e)
	}
	scope = altoc.BasicReadScope{Access: "self"}
	who.Actor = "person"
	list = call("employees-search", read)
	if list["total"] != int64(0) {
		t.Fatal("case insensitive identity")
	}
	// Owning core supports caller-Tx rollback; no implicit commit.
	tx, e := db.BeginTx(ctx, nil)
	if e != nil {
		t.Fatal(e)
	}
	p := PeopleInput{Payload: map[string]any{"position_code": "ROLLBACK", "position_name": "回滚"}, CostScope: people.EnterpriseMasterScope{Access: "none"}}
	if _, e = people.MasterWriteTx(ctx, tx, func(name string) (string, error) { return name, nil }, "positions-create", p, "Person"); e != nil {
		t.Fatal(e)
	}
	tx.Rollback()
	db.QueryRow("SELECT COUNT(*) FROM people_positions WHERE position_code='ROLLBACK'").Scan(&n)
	if n != 0 {
		t.Fatal("owning core committed caller transaction")
	}
}

func peopleStatus(e error) int {
	var h httperror.Error
	if errors.As(e, &h) {
		return h.Status
	}
	return 0
}

func TestAPFPeopleRankAndSalaryMySQL(t *testing.T) {
	s, db := peopleFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "Person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "rank", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "all"}
	rank := PeopleInput{Payload: map[string]any{"rank_code": "P1", "rank_name": "一级", "rank_series": "P", "rank_level": float64(1)}, CostScope: people.EnterpriseMasterScope{Access: "none"}}
	out, e := s.People(ctx, "ranks-create", rank, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	id := out.(map[string]any)["data"].(map[string]any)["id"].(string)
	rate := PeopleInput{Payload: map[string]any{"rate_code": "RATE-A", "rate_name": "工资标准", "rank_code": "P1", "rank_series": "P", "rank_level": float64(1), "rank_salary": "1000.01", "performance_salary_min": "0.00", "performance_salary_max": "100.00", "currency": "CNY", "effective_from": "2026-10-01", "effective_to": ""}, CostScope: people.EnterpriseMasterScope{Access: "none"}}
	who.Key = "rate"
	out, e = s.People(ctx, "standard-costs-create", rate, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	rateID := out.(map[string]any)["data"].(map[string]any)["id"].(string)
	read := PeopleInput{ID: rateID, Payload: map[string]any{}, CostScope: people.EnterpriseMasterScope{Access: "none"}}
	out, e = s.People(ctx, "standard-costs-view", read, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	row := out.(map[string]any)["data"].(map[string]any)
	if row["rank_salary"] != "1000.01" || row["effective_from"] != "2026-10-01" {
		t.Fatal("money/date not exact", row)
	}
	who.Key = "rank-delete"
	del := PeopleInput{ID: id, Payload: map[string]any{"expectedVersion": float64(1)}, CostScope: people.EnterpriseMasterScope{Access: "none"}}
	if _, e = s.People(ctx, "ranks-delete", del, who, scope); peopleStatus(e) != 409 {
		t.Fatal("rank reference", e)
	}
	rate.ID = rateID
	rate.Payload["expectedVersion"] = float64(1)
	rate.Payload["performance_salary_max"] = "-1.00"
	who.Key = "invalid-money"
	if _, e = s.People(ctx, "standard-costs-update", rate, who, scope); peopleStatus(e) != 400 {
		t.Fatal("money invalid", e)
	}
	rate.Payload["performance_salary_max"] = "150.00"
	who.Key = "update-rate"
	if _, e = s.People(ctx, "standard-costs-update", rate, who, scope); e != nil {
		t.Fatal(e)
	}
	var receipts int
	db.QueryRow("SELECT COUNT(*) FROM people_service_command_receipt").Scan(&receipts)
	if receipts != 3 {
		t.Fatal("failed write audited as success", receipts)
	}
}
func TestAPFPeopleAssignmentUsesCurrentEmployeeScopeMySQL(t *testing.T) {
	s, db := peopleFixture(t)
	for _, q := range []string{"INSERT INTO people_employees(employee_uid,employee_no,display_name,dept_code) VALUES('Person','E1','甲','NOW'),('Other','E2','乙','OUT')", "INSERT INTO people_assignments(assignment_code,employee_uid,change_type,effective_from,dept_code,rank_code) VALUES('AS1','Person','transfer','2026-10-01','OLD','P1'),('AS2','Other','transfer','2026-10-01','NOW','P2')"} {
		if _, e := db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	i := PeopleInput{Page: 1, PageSize: 20, Payload: map[string]any{}, CostAllowed: true, CostScope: people.EnterpriseMasterScope{Access: "dept", DepartmentCodes: []string{"NOW"}}}
	out, e := s.People(context.Background(), "assignments-list", i, Identity{Actor: "Reader", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime"}, altoc.BasicReadScope{Access: "dept", DepartmentCodes: []string{"NOW"}})
	if e != nil {
		t.Fatal(e)
	}
	list := out.(map[string]any)
	if list["total"] != int64(1) {
		t.Fatal("historical department widened current employee scope", list)
	}
	row := list["data"].([]map[string]any)[0]
	if row["assignment_code"] != "AS1" || row["rank_code"] != "P1" {
		t.Fatal("current owner scope lost historical assignment", row)
	}
	if _, ok := row["_scope_department"]; ok {
		t.Fatal("internal fact leaked")
	}
}
