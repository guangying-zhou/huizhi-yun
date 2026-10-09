package enterpriseapf

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"sync"
	"testing"
)

func servicesFixture(t *testing.T) (*Service, *sql.DB) {
	t.Helper()
	base, db := salesFixture(t)
	ctx := context.Background()
	b, e := domaininstall.WithAltocServices(base.binding)
	if e != nil {
		t.Fatal(e)
	}
	inst := domaininstall.ForAltocServices(domaininstall.Expectation{Tenant: b.Key.Tenant, Environment: b.Key.Environment, OwnerDeployment: "host-test", Address: b.Storage.Address})
	p, e := inst.PlanInstall(ctx, db, b)
	if e != nil {
		t.Fatal(e)
	}
	var receipt domaininstall.Receipt
	off := func(context.Context) error { return nil }
	if e = inst.Apply(ctx, db, p, off, func(r domaininstall.Receipt) error { receipt = r; return nil }); e != nil {
		t.Fatal(e)
	}
	if e = inst.VerifyReceipt(ctx, db, receipt); e != nil {
		t.Fatal(e)
	}
	// Disposable target-domain fixtures model the owning columns, not production data.
	for _, q := range []string{
		"CREATE TABLE aims_projects(id BIGINT PRIMARY KEY,project_code VARCHAR(64),leader_uid VARCHAR(64),contract_code VARCHAR(64),lifecycle_status VARCHAR(30)) ENGINE=InnoDB",
		"CREATE TABLE aims_project_members(id BIGINT PRIMARY KEY,project_id BIGINT,uid VARCHAR(64),role VARCHAR(30),status VARCHAR(30)) ENGINE=InnoDB",
		"CREATE TABLE customer_delivery_assets(id BIGINT PRIMARY KEY,delivery_asset_code VARCHAR(100),customer_code VARCHAR(100),deleted_at DATETIME) ENGINE=InnoDB",
		"CREATE TABLE asset_environments(id BIGINT PRIMARY KEY,environment_code VARCHAR(100),customer_code VARCHAR(100)) ENGINE=InnoDB",
		"CREATE TABLE customer_delivery_asset_environment_rel(id BIGINT PRIMARY KEY,delivery_asset_id BIGINT,environment_id BIGINT,status VARCHAR(30),deleted_at DATETIME) ENGINE=InnoDB",
		"INSERT INTO altoc_customer(id,code,name,owner_uid) VALUES(1,'CUSTOMER','客户','person'),(2,'OTHER','外客户','other')",
		"INSERT INTO altoc_contract(id,code,customer_id,name,owner_uid) VALUES(1,'CONTRACT',1,'服务合同','person'),(2,'OTHER-CT',2,'外合同','other')",
		"INSERT INTO aims_projects VALUES(1,'PROJECT-1','person','CONTRACT','active'),(2,'PROJECT-2','person','CONTRACT','active'),(3,'OTHER-P','other','OTHER-CT','active')",
		"INSERT INTO customer_delivery_assets VALUES(1,'DA-1','CUSTOMER',NULL),(2,'DA-2','OTHER',NULL)",
		"INSERT INTO asset_environments VALUES(1,'ENV-1','CUSTOMER'),(2,'ENV-2','OTHER')",
		"INSERT INTO customer_delivery_asset_environment_rel VALUES(1,1,1,'active',NULL)",
	} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(e, q)
		}
	}
	for domain, tables := range map[string][]string{"aims": {"aims_projects", "aims_project_members"}, "assets": {"customer_delivery_assets", "asset_environments", "customer_delivery_asset_environment_rel"}} {
		m := map[string]string{}
		for _, n := range tables {
			m[n] = n
		}
		b.Domains[domain] = enterprise.DomainBinding{OwnerDeployment: domain + "-test", Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathDisabled, Tables: m}
	}
	reg := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e = reg.Register(ctx, b); e != nil {
		t.Fatal(e)
	}
	s, e := New(reg, b)
	if e != nil {
		t.Fatal(e)
	}
	s.ConfigureOwnerDirectory(testOwnerDirectory)
	return s, db
}
func TestAPFServiceAgreementCommandsMySQL(t *testing.T) {
	s, db := servicesFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "new", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "self"}
	call := func(op string, i SalesInput) map[string]any {
		t.Helper()
		v, e := s.Sales(ctx, op, i, who, scope)
		if e != nil {
			t.Fatal(op, e)
		}
		return v.(map[string]any)
	}
	new := SalesInput{Payload: map[string]any{"name": "标记协议", "contract_id": "1"}}
	id := fmt.Sprint(call("service-agreements-create", new)["id"])
	if fmt.Sprint(call("service-agreements-create", new)["id"]) != id {
		t.Fatal("duplicate")
	}
	v := float64(1)
	write := func(op string, p map[string]any) string {
		t.Helper()
		p["expectedVersion"] = v
		who.Key = fmt.Sprintf("%s-%v", op, v)
		out := call(op, SalesInput{ID: id, Payload: p})
		v++
		return fmt.Sprint(out["id"])
	}
	write("service-agreements-update", map[string]any{"name": "更新协议"})
	coverage := write("service-coverages-create", map[string]any{"target_type": "delivery_asset_environment", "delivery_asset_code": "DA-1", "environment_code": "ENV-1"})
	write("service-coverages-suspend", map[string]any{"childId": coverage})
	write("service-coverages-end", map[string]any{"childId": coverage})
	// Plan is an authoritative contract-owned row. Resolve retries reuse their receipt.
	_, e := db.Exec("INSERT INTO altoc_contract_delivery_asset_plan(code,contract_id,name,source_contract_code) VALUES('PLAN',1,'标记计划','CONTRACT')")
	if e != nil {
		t.Fatal(e)
	}
	pending := write("service-coverages-create", map[string]any{"target_type": "pending_plan", "source_plan_code": "PLAN"})
	resolve := SalesInput{ID: id, Payload: map[string]any{"expectedVersion": v, "childId": pending, "target_type": "delivery_asset", "delivery_asset_code": "DA-1"}}
	who.Key = "resolve"
	call("service-coverages-resolve", resolve)
	v++
	call("service-coverages-resolve", resolve)
	project := write("service-projects-bind", map[string]any{"project_code": "PROJECT-1", "project_role": "maintenance"})
	write("service-projects-set-default", map[string]any{"childId": project})
	write("service-projects-suspend", map[string]any{"childId": project})
	write("service-projects-end", map[string]any{"childId": project})
	for _, op := range []string{"service-agreements-page", "service-coverages-page", "service-projects-page"} {
		i := SalesInput{ID: id, Payload: map[string]any{"page": float64(1), "pageSize": float64(1)}}
		if op == "service-agreements-page" {
			i.ID = ""
		}
		out := call(op, i)
		if fmt.Sprint(out["total"]) == "0" {
			t.Fatal(op, out)
		}
	}
	detail := call("service-agreements-view", SalesInput{ID: id, Payload: map[string]any{}})
	if fmt.Sprint(detail["row_version"]) != fmt.Sprint(v) {
		t.Fatal(detail, v)
	}
	other := who
	other.Actor = "other"
	other.Key = "denied"
	if _, e = s.Sales(ctx, "service-agreements-view", SalesInput{ID: id, Payload: map[string]any{}}, other, scope); httperrorStatus(e) != 403 {
		t.Fatal(e)
	}
	if _, e = s.Sales(ctx, "service-agreements-create", new, other, scope); httperrorStatus(e) != 403 {
		t.Fatal("revoked replay", e)
	}
	who.Key = "cross-asset"
	if _, e = s.Sales(ctx, "service-coverages-create", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": v, "target_type": "delivery_asset", "delivery_asset_code": "DA-2"}}, who, scope); httperrorStatus(e) != 403 {
		t.Fatal(e)
	}
	who.Key = "cross-pair"
	if _, e = s.Sales(ctx, "service-coverages-create", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": v, "target_type": "delivery_asset_environment", "delivery_asset_code": "DA-1", "environment_code": "ENV-2"}}, who, scope); httperrorStatus(e) != 403 {
		t.Fatal(e)
	}
	who.Key = "cross-project"
	if _, e = s.Sales(ctx, "service-projects-bind", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": v, "project_code": "OTHER-P", "project_role": "maintenance"}}, who, scope); httperrorStatus(e) != 409 {
		t.Fatal(e)
	}
	who.Key = "cross-child"
	if _, e = s.Sales(ctx, "service-projects-end", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": v, "childId": "999"}}, who, scope); httperrorStatus(e) != 404 {
		t.Fatal(e)
	}
	var before int
	db.QueryRow("SELECT COUNT(*) FROM altoc_service_agreement").Scan(&before)
	db.Exec("RENAME TABLE altoc_audit_log TO failed_audit")
	who.Key = "rollback"
	_, e = s.Sales(ctx, "service-agreements-create", new, who, scope)
	db.Exec("RENAME TABLE failed_audit TO altoc_audit_log")
	if e == nil {
		t.Fatal("audit failure swallowed")
	}
	var after int
	db.QueryRow("SELECT COUNT(*) FROM altoc_service_agreement").Scan(&after)
	if after != before {
		t.Fatal("partial commit")
	}
}
func TestAPFServiceDefaultConcurrencyMySQL(t *testing.T) {
	s, db := servicesFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "new"}
	scope := altoc.BasicReadScope{Access: "self"}
	out, e := s.Sales(ctx, "service-agreements-create", SalesInput{Payload: map[string]any{"name": "并发服务", "contract_id": "1"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	id := fmt.Sprint(out.(map[string]any)["id"])
	children := []string{}
	for n := 1; n <= 2; n++ {
		who.Key = fmt.Sprintf("bind-%d", n)
		out, e = s.Sales(ctx, "service-projects-bind", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(n), "project_code": fmt.Sprintf("PROJECT-%d", n), "project_role": "maintenance"}}, who, scope)
		if e != nil {
			t.Fatal(e)
		}
		children = append(children, fmt.Sprint(out.(map[string]any)["id"]))
	}
	start := make(chan struct{})
	result := make(chan error, 2)
	var wg sync.WaitGroup
	for n := 0; n < 2; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			<-start
			w := who
			w.Key = fmt.Sprintf("default-%d", n)
			_, e := s.Sales(ctx, "service-projects-set-default", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(3), "childId": children[n]}}, w, scope)
			result <- e
		}(n)
	}
	close(start)
	wg.Wait()
	success, conflict := 0, 0
	for n := 0; n < 2; n++ {
		e := <-result
		if e == nil {
			success++
		} else if httperrorStatus(e) == 409 {
			conflict++
		} else {
			t.Fatal(e)
		}
	}
	var count int
	db.QueryRow("SELECT COUNT(*) FROM altoc_service_agreement_project_rel WHERE is_default=1").Scan(&count)
	if success != 1 || conflict != 1 || count != 1 {
		t.Fatal(success, conflict, count)
	}
}

func TestAPFServicePagingAndCurrentAuthorityMySQL(t *testing.T) {
	s, db := servicesFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "frozen-create"}
	scope := altoc.BasicReadScope{Access: "self"}
	in := SalesInput{Payload: map[string]any{"name": "标记协议", "contract_id": "1"}}
	out, e := s.Sales(ctx, "service-agreements-create", in, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	id := fmt.Sprint(out.(map[string]any)["id"])
	for n := 0; n < 24; n++ {
		if _, e = db.Exec("INSERT INTO altoc_service_agreement(code,contract_id,name) VALUES(?,1,'分页标记')", fmt.Sprintf("PAGE-%d", n)); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = db.Exec("INSERT INTO altoc_service_agreement(code,contract_id,name) VALUES('HIDDEN',2,'范围外协议')"); e != nil {
		t.Fatal(e)
	}
	for page, count := range map[int]int{1: 20, 2: 5} {
		out, e = s.Sales(ctx, "service-agreements-page", SalesInput{Payload: map[string]any{"page": float64(page), "pageSize": float64(20)}}, who, scope)
		if e != nil {
			t.Fatal(e)
		}
		data := out.(map[string]any)
		if len(data["items"].([]map[string]any)) != count || fmt.Sprint(data["total"]) != "25" {
			t.Fatal(data)
		}
	}
	if _, e = db.Exec("INSERT INTO asset_environments VALUES(3,'UNRELATED-ENV','CUSTOMER')"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Sales(ctx, "service-coverages-create", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(1), "target_type": "delivery_asset_environment", "delivery_asset_code": "DA-1", "environment_code": "UNRELATED-ENV"}}, who, scope); httperrorStatus(e) != 409 {
		t.Fatal("same customer alone does not qualify a pair", e)
	}
	if _, e = db.Exec("INSERT INTO aims_projects VALUES(4,'MANAGER-P','someone','','active');"); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("INSERT INTO aims_project_members VALUES(1,4,'Person','manager','active')"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Sales(ctx, "service-projects-bind", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(1), "project_code": "MANAGER-P", "project_role": "maintenance"}}, who, scope); httperrorStatus(e) != 403 {
		t.Fatal("case folded manager uid", e)
	}
	if _, e = db.Exec("UPDATE aims_project_members SET uid='person' WHERE id=1"); e != nil {
		t.Fatal(e)
	}
	who.Key = "manager-bind"
	if _, e = s.Sales(ctx, "service-projects-bind", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(1), "project_code": "MANAGER-P", "project_role": "maintenance"}}, who, scope); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("UPDATE aims_project_members SET status='inactive' WHERE id=1"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Sales(ctx, "service-projects-bind", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(1), "project_code": "MANAGER-P", "project_role": "maintenance"}}, who, scope); httperrorStatus(e) != 403 {
		t.Fatal("replay bypassed manager revocation", e)
	}
	if _, e = db.Exec("UPDATE altoc_contract SET owner_uid='other' WHERE id=1"); e != nil {
		t.Fatal(e)
	}
	who.Key = "frozen-create"
	if _, e = s.Sales(ctx, "service-agreements-create", in, who, scope); httperrorStatus(e) != 403 {
		t.Fatal("receipt bypassed current scope", e)
	}
	out, e = s.Sales(ctx, "service-agreements-page", SalesInput{Payload: map[string]any{"page": float64(1), "pageSize": float64(20)}}, who, scope)
	if e != nil || fmt.Sprint(out.(map[string]any)["total"]) != "0" {
		t.Fatal("COUNT leaked moved contract", out, e)
	}
}
