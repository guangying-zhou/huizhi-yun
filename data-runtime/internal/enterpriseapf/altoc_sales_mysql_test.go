package enterpriseapf

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/enterprisecontracts"
	"testing"
)

func salesFixture(t *testing.T) (*Service, *sql.DB) {
	t.Helper()
	base, db := customerFixture(t)
	b, e := domaininstall.WithAltocSales(base.binding)
	if e != nil {
		t.Fatal(e)
	}
	for _, v := range domaininstall.AltocSalesTables() {
		if _, e = db.Exec(v.DDL); e != nil {
			t.Fatal(v.Logical, e)
		}
	}
	for _, q := range []string{
		`INSERT INTO altoc_opportunity_stage(code,name,sort_no,stage_kind,is_closed,is_won,is_lost) VALUES('initial','初步接触',1,'normal',0,0,0),('qualified','需求确认',2,'normal',0,0,0),('won','赢单',3,'won',1,1,0),('lost','输单',4,'lost',1,0,1),('paused','暂停',5,'paused',0,0,0)`,
	} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	reg := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e = reg.Register(context.Background(), b); e != nil {
		t.Fatal(e)
	}
	s, e := New(reg, b)
	if e != nil {
		t.Fatal(e)
	}
	s.ConfigureOwnerDirectory(testOwnerDirectory)
	return s, db
}
func TestAPFSalesMainChainMySQL(t *testing.T) {
	s, db := salesFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "lead-create", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "self"}
	call := func(op string, i SalesInput) map[string]any {
		t.Helper()
		out, e := s.Sales(ctx, op, i, who, scope)
		if e != nil {
			t.Fatal(op, e)
		}
		return out.(map[string]any)["data"].(map[string]any)
	}
	lead := SalesInput{Payload: map[string]any{"name": "标记线索", "org_name": "标记公司", "source_type": "referral", "need_summary": "需要实施", "contact_name": "联系人", "owner_uid": "person", "next_action": "联系", "next_action_due_at": "2026-10-05 09:00:00"}}
	first := call("leads-create", lead)
	again := call("leads-create", lead)
	if first["id"] != again["id"] {
		t.Fatal("replay duplicated lead")
	}
	who.Key = "lead-convert"
	convert := SalesInput{ID: fmt.Sprint(first["id"]), Payload: map[string]any{"expectedVersion": float64(1)}}
	converted := call("leads-convert", convert)
	call("leads-convert", convert)
	for _, table := range []string{"altoc_customer", "altoc_contact", "altoc_opportunity", "altoc_lead_conversion"} {
		var n int
		if e := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); e != nil || n != 1 {
			t.Fatal(table, n, e)
		}
	}
	who.Key = "opp-transition"
	oppID := fmt.Sprint(converted["converted_opportunity_id"])
	out := call("opportunities-transition", SalesInput{ID: oppID, Payload: map[string]any{"expectedVersion": float64(1), "stageId": "2"}})
	if fmt.Sprint(out["row_version"]) != "2" {
		t.Fatal(out)
	}
	who.Key = "opp-won"
	call("opportunities-close-won", SalesInput{ID: oppID, Payload: map[string]any{"expectedVersion": float64(2), "won_reason_code": "fit", "won_reason": "符合需求"}})
	who.Key = "opp-reopen"
	call("opportunities-reopen", SalesInput{ID: oppID, Payload: map[string]any{"expectedVersion": float64(3), "stageId": "1"}})
	who.Key = "scope-denied"
	if _, e := s.Sales(ctx, "opportunities-update", SalesInput{ID: oppID, Payload: map[string]any{"expectedVersion": float64(4), "name": "越权"}}, Identity{Actor: "other", Tenant: who.Tenant, Deployment: who.Deployment, Client: who.Client, Key: who.Key}, scope); httperrorStatus(e) != 403 {
		t.Fatal("cross-owner accepted", e)
	}
}
func TestAPFSalesInstallerMySQL(t *testing.T) {
	s, db := customerFixture(t)
	ctx := context.Background()
	b, e := domaininstall.WithAltocSales(s.binding)
	if e != nil {
		t.Fatal(e)
	}
	inst := domaininstall.ForAltocSales(domaininstall.Expectation{Tenant: b.Key.Tenant, Environment: b.Key.Environment, OwnerDeployment: "host-test", Address: b.Storage.Address})
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
	if len(receipt.Created) != 8 {
		t.Fatal("incomplete install")
	}
	if _, e = db.Exec("INSERT INTO altoc_opportunity_stage(code,name,sort_no) VALUES('retained','保留证据',1)"); e != nil {
		t.Fatal(e)
	}
	if e = inst.Rollback(ctx, db, receipt, off); e == nil {
		t.Fatal("nonempty B2 rollback accepted")
	}
	if _, e = db.Exec("DELETE FROM altoc_opportunity_stage WHERE code='retained'"); e != nil {
		t.Fatal(e)
	}
	if e = inst.Rollback(ctx, db, receipt, off); e != nil {
		t.Fatal(e)
	}
	var n int
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_customer").Scan(&n); e != nil {
		t.Fatal("base domain changed", e)
	}
}

func TestAPFSalesConversionRevocationAndRollbackMySQL(t *testing.T) {
	s, db := salesFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "lead-first", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "self"}
	create := func(key, name string) string {
		t.Helper()
		who.Key = key
		out, e := s.Sales(ctx, "leads-create", SalesInput{Payload: map[string]any{"name": name, "org_name": name, "source_type": "referral", "need_summary": "需要实施", "contact_name": "员工", "owner_uid": "person", "next_action": "联系", "next_action_due_at": "2026-10-05 09:00:00"}}, who, scope)
		if e != nil {
			t.Fatal(e)
		}
		return fmt.Sprint(out.(map[string]any)["data"].(map[string]any)["id"])
	}
	id := create("lead-first", "独立目标")
	who.Key = "convert-first"
	input := SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(1)}}
	out, e := s.Sales(ctx, "leads-convert", input, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	customer := out.(map[string]any)["data"].(map[string]any)["converted_customer_id"]
	if _, e = db.Exec("UPDATE altoc_customer SET owner_uid='other' WHERE id=?", customer); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Sales(ctx, "leads-convert", input, who, scope); httperrorStatus(e) != 403 {
		t.Fatal("replay bypassed target revocation", e)
	}
	if _, e = db.Exec("UPDATE altoc_customer SET owner_uid='person' WHERE id=?", customer); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("UPDATE altoc_contact SET deleted_at=UTC_TIMESTAMP() WHERE customer_id=?", customer); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Sales(ctx, "leads-convert", input, who, scope); httperrorStatus(e) != 404 {
		t.Fatal("replay ignored deleted target contact", e)
	}
	second := create("lead-failure", "原子回滚目标")
	var beforeCustomers, beforeContacts, beforeOpps int
	db.QueryRow("SELECT COUNT(*) FROM altoc_customer").Scan(&beforeCustomers)
	db.QueryRow("SELECT COUNT(*) FROM altoc_contact").Scan(&beforeContacts)
	db.QueryRow("SELECT COUNT(*) FROM altoc_opportunity").Scan(&beforeOpps)
	if _, e = db.Exec("CREATE TRIGGER reject_conversion BEFORE INSERT ON altoc_lead_conversion FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated-fault'"); e != nil {
		t.Fatal(e)
	}
	who.Key = "convert-failure"
	if _, e = s.Sales(ctx, "leads-convert", SalesInput{ID: second, Payload: map[string]any{"expectedVersion": float64(1)}}, who, scope); e == nil {
		t.Fatal("fault ignored")
	}
	for table, want := range map[string]int{"altoc_customer": beforeCustomers, "altoc_contact": beforeContacts, "altoc_opportunity": beforeOpps} {
		var got int
		db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&got)
		if got != want {
			t.Fatal("partial conversion", table, got, want)
		}
	}
	var status string
	db.QueryRow("SELECT status FROM altoc_lead WHERE id=?", second).Scan(&status)
	if status == "converted" {
		t.Fatal("source advanced despite rollback")
	}
}

func TestAPFSalesConcurrentCASAndNativeReadsMySQL(t *testing.T) {
	s, db := salesFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "create", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "self"}
	out, e := s.Sales(ctx, "leads-create", SalesInput{Payload: map[string]any{"name": "并发线索", "org_name": "公司", "source_type": "referral", "need_summary": "需求", "contact_name": "联系人", "owner_uid": "person", "next_action": "联系", "next_action_due_at": "2026-10-05 09:00:00"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	id := fmt.Sprint(out.(map[string]any)["data"].(map[string]any)["id"])
	ch := make(chan error, 2)
	for _, key := range []string{"writer-a", "writer-b"} {
		go func(key string) {
			w := who
			w.Key = key
			_, e := s.Sales(ctx, "leads-update", SalesInput{ID: id, Payload: map[string]any{"name": "并发修改", "expectedVersion": float64(1)}}, w, scope)
			ch <- e
		}(key)
	}
	a, b := <-ch, <-ch
	if !((a == nil && httperrorStatus(b) == 409) || (b == nil && httperrorStatus(a) == 409)) {
		t.Fatal("CAS must accept exactly one", a, b)
	}
	var version int
	if e = db.QueryRow("SELECT row_version FROM altoc_lead WHERE id=?", id).Scan(&version); e != nil || version != 2 {
		t.Fatal("CAS advanced twice", version, e)
	}
	service, e := enterprisecontracts.NewSalesReadService(s.registry, s.binding)
	if e != nil {
		t.Fatal(e)
	}
	read, e := service.Read(ctx, "lead", id, who.Actor, scope, altoc.SalesReadQuery{Page: 1, PageSize: 20})
	if e != nil {
		t.Fatal(e)
	}
	if fmt.Sprint(read["row_version"]) != "2" || read["owner_uid"] != "person" {
		t.Fatal("native fields missing", read)
	}
	if _, e = service.Read(ctx, "lead", id, "other", scope, altoc.SalesReadQuery{Page: 1, PageSize: 20}); httperrorStatus(e) != 404 {
		t.Fatal("native read leaked", e)
	}
}

func TestAPFSalesAllActionsAndStageGuardMySQL(t *testing.T) {
	s, db := salesFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "all"}
	call := func(op, id string, p map[string]any) map[string]any {
		t.Helper()
		version := p["expectedVersion"]
		if version == nil {
			version = 0
		}
		who.Key = fmt.Sprintf("%s-%v", op, version)
		out, e := s.Sales(ctx, op, SalesInput{ID: id, Payload: p}, who, scope)
		if e != nil {
			t.Fatal(op, e)
		}
		return out.(map[string]any)["data"].(map[string]any)
	}
	lead := call("leads-create", "", map[string]any{"name": "动作线索", "org_name": "公司", "source_type": "referral", "need_summary": "需求", "contact_name": "员工", "owner_uid": "person", "next_action": "联系", "next_action_due_at": "2026-10-05 09:00:00"})
	id := fmt.Sprint(lead["id"])
	call("leads-update", id, map[string]any{"expectedVersion": float64(1), "name": "修改线索"})
	call("leads-assign", id, map[string]any{"expectedVersion": float64(2), "owner_uid": "other"})
	call("lead-activities-create", id, map[string]any{"expectedVersion": float64(3), "subject": "电话确认", "activity_type": "call", "activity_at": "2026-10-03 10:00:00"})
	call("leads-disqualify", id, map[string]any{"expectedVersion": float64(4), "invalid_reason_code": "no_need", "invalid_reason": "暂不需要"})
	who.Key = "customer-base"
	customer, e := s.Customer(ctx, "customers-create", CustomerInput{Payload: map[string]any{"name": "动作客户", "owner_uid": "person"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	cid := fmt.Sprint(customer.(map[string]any)["data"].(map[string]any)["id"])
	opp := call("opportunities-create", "", map[string]any{"name": "动作商机", "owner_uid": "person", "customerId": cid, "next_action": "联系", "next_action_due_at": "2026-10-05 09:00:00"})
	oid := fmt.Sprint(opp["id"])
	call("opportunities-update", oid, map[string]any{"expectedVersion": float64(1), "name": "修改商机"})
	call("opportunities-assign", oid, map[string]any{"expectedVersion": float64(2), "owner_uid": "other"})
	call("opportunity-activities-create", oid, map[string]any{"expectedVersion": float64(3), "subject": "电话确认", "activity_type": "call", "activity_at": "2026-10-03 10:00:00"})
	if _, e = db.Exec(`UPDATE altoc_opportunity_stage SET required_fields_json='["amount_tax_inclusive"]' WHERE id=2`); e != nil {
		t.Fatal(e)
	}
	who.Key = "missing-required"
	if _, e = s.Sales(ctx, "opportunities-transition", SalesInput{ID: oid, Payload: map[string]any{"expectedVersion": float64(4), "stageId": "2"}}, who, scope); httperrorStatus(e) != 400 {
		t.Fatal("stage requirement bypass", e)
	}
	call("opportunities-transition", oid, map[string]any{"expectedVersion": float64(4), "stageId": "2", "amount_tax_inclusive": "100.10"})
	call("opportunities-pause", oid, map[string]any{"expectedVersion": float64(5), "pause_reason_code": "later", "pause_reason": "延期"})
	call("opportunities-reopen", oid, map[string]any{"expectedVersion": float64(6), "stageId": "1"})
	call("opportunities-close-lost", oid, map[string]any{"expectedVersion": float64(7), "lost_reason_code": "budget", "lost_reason": "预算不足"})
	var n int
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_sales_activity").Scan(&n); e != nil || n != 2 {
		t.Fatal("activities missing", n, e)
	}
}
