package enterpriseapf

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"testing"
)

func tenderFixture(t *testing.T) (*Service, *sql.DB) {
	t.Helper()
	base, db := salesFixture(t)
	b, e := domaininstall.WithAltocTenders(base.binding)
	if e != nil {
		t.Fatal(e)
	}
	inst := domaininstall.ForAltocTenders(domaininstall.Expectation{Tenant: b.Key.Tenant, Environment: b.Key.Environment, OwnerDeployment: "host-test", Address: b.Storage.Address})
	p, e := inst.PlanInstall(context.Background(), db, b)
	if e != nil {
		t.Fatal(e)
	}
	var receipt domaininstall.Receipt
	e = inst.Apply(context.Background(), db, p, func(context.Context) error { return nil }, func(r domaininstall.Receipt) error { receipt = r; return nil })
	if e != nil {
		t.Fatal(e)
	}
	if e = inst.VerifyReceipt(context.Background(), db, receipt); e != nil {
		t.Fatal(e)
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
func TestAPFTendersMySQL(t *testing.T) {
	s, db := tenderFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "tender-create", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "self"}
	call := func(op string, i SalesInput) map[string]any {
		t.Helper()
		v, e := s.Tenders(ctx, op, i, who, scope)
		if e != nil {
			t.Fatal(op, e)
		}
		return v.(map[string]any)
	}
	i := SalesInput{Payload: map[string]any{"name": "标记投标", "owner_uid": "person", "budget_amount": "10.20"}}
	row := call("tenders-create", i)
	id := fmt.Sprint(row["id"])
	if call("tenders-create", i)["id"] != row["id"] {
		t.Fatal("replay duplicated")
	}
	var count int
	db.QueryRow("SELECT COUNT(*) FROM altoc_tender").Scan(&count)
	if count != 1 {
		t.Fatal(count)
	}
	who.Key = "member-add"
	call("tender-members-add", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(1), "user_id": "crew", "role": "technical"}})
	detail := call("tenders-view", SalesInput{ID: id, Payload: map[string]any{}})
	member := detail["members"].([]map[string]any)[0]
	who.Key = "member-remove"
	remove := SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(2), "childId": fmt.Sprint(member["id"])}}
	call("tender-members-remove", remove)
	call("tender-members-remove", remove)
	who.Key = "milestone"
	call("tender-milestones-create", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(3), "name": "投标截止", "due_date": "2026-10-10"}})
	who.Key = "stale"
	if _, e := s.Tenders(ctx, "tenders-update", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(1), "name": "过期"}}, who, scope); httperrorStatus(e) != 409 {
		t.Fatal(e)
	}
	other := who
	other.Actor = "other"
	other.Key = "unauthorized"
	if _, e := s.Tenders(ctx, "tenders-view", SalesInput{ID: id, Payload: map[string]any{}}, other, scope); httperrorStatus(e) != 403 {
		t.Fatal(e)
	}
	// Revocation is checked before original receipt; no new receipt on denial.
	if _, e := s.Tenders(ctx, "tenders-create", i, other, scope); httperrorStatus(e) != 403 {
		t.Fatal(e)
	}
	page := call("tenders-page", SalesInput{Payload: map[string]any{"page": float64(1), "pageSize": float64(1)}})
	if fmt.Sprint(page["total"]) != "1" {
		t.Fatal(page)
	}
	who.Key = "cross-child"
	if _, e := s.Tenders(ctx, "tender-milestones-update", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(4), "childId": "999", "name": "跨父"}}, who, scope); httperrorStatus(e) != 404 {
		t.Fatal(e)
	}
	// Business and audit share the receipt transaction: force audit failure.
	db.Exec("RENAME TABLE altoc_audit_log TO broken_audit")
	who.Key = "rollback"
	_, e := s.Tenders(ctx, "tenders-create", i, who, scope)
	db.Exec("RENAME TABLE broken_audit TO altoc_audit_log")
	if e == nil {
		t.Fatal("failure ignored")
	}
	db.QueryRow("SELECT COUNT(*) FROM altoc_tender").Scan(&count)
	if count != 1 {
		t.Fatal("partial transaction", count)
	}
}

func TestAPFTenderInstallerRollbackMySQL(t *testing.T) {
	base, db := salesFixture(t)
	ctx := context.Background()
	b, e := domaininstall.WithAltocTenders(base.binding)
	if e != nil {
		t.Fatal(e)
	}
	inst := domaininstall.ForAltocTenders(domaininstall.Expectation{Tenant: b.Key.Tenant, Environment: b.Key.Environment, OwnerDeployment: "host-test", Address: b.Storage.Address})
	p, e := inst.PlanInstall(ctx, db, b)
	if e != nil {
		t.Fatal(e)
	}
	var receipt domaininstall.Receipt
	off := func(context.Context) error { return nil }
	if e = inst.Apply(ctx, db, p, off, func(r domaininstall.Receipt) error { receipt = r; return nil }); e != nil {
		t.Fatal(e)
	}
	if e = inst.VerifyReceipt(ctx, db, receipt); e != nil || len(receipt.Created) != 4 {
		t.Fatal(e, len(receipt.Created))
	}
	if _, e = db.Exec("INSERT INTO altoc_tender(code,name,owner_user_id) VALUES('MARK','标记','person')"); e != nil {
		t.Fatal(e)
	}
	if inst.Rollback(ctx, db, receipt, off) == nil {
		t.Fatal("nonempty rollback accepted")
	}
	db.Exec("DELETE FROM altoc_tender WHERE code='MARK'")
	if e = inst.Rollback(ctx, db, receipt, off); e != nil {
		t.Fatal(e)
	}
	var n int
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_opportunity_stage").Scan(&n); e != nil || n != 5 {
		t.Fatal("existing domain changed", e, n)
	}
}

func TestAPFTenderPagingAndReferenceScopeMySQL(t *testing.T) {
	s, db := tenderFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "manual", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "self"}
	// Manual tender does not require a configured opportunity or sales stage.
	if _, e := db.Exec("DELETE FROM altoc_opportunity_stage"); e != nil {
		t.Fatal(e)
	}
	out, e := s.Tenders(ctx, "tenders-create", SalesInput{Payload: map[string]any{"name": "手工投标", "owner_uid": "person"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	id := out.(map[string]any)["id"]
	for n := 0; n < 24; n++ {
		if _, e = db.Exec("INSERT INTO altoc_tender(code,name,owner_user_id) VALUES(?,?,'person')", fmt.Sprintf("PAGE-%d", n), "标记分页"); e != nil {
			t.Fatal(e)
		}
	}
	for page, expected := range map[int]int{1: 20, 2: 5} {
		out, e = s.Tenders(ctx, "tenders-page", SalesInput{Payload: map[string]any{"page": float64(page), "pageSize": float64(20)}}, who, scope)
		if e != nil {
			t.Fatal(e)
		}
		data := out.(map[string]any)
		if len(data["items"].([]map[string]any)) != expected || fmt.Sprint(data["total"]) != "25" {
			t.Fatal(data)
		}
	}
	// Source customer moved outside current permission: COUNT and detail both deny.
	result, e := db.Exec("INSERT INTO altoc_customer(code,name,owner_uid) VALUES('REFERENCE','越权客户','other')")
	if e != nil {
		t.Fatal(e)
	}
	customer, e := result.LastInsertId()
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("UPDATE altoc_tender SET customer_id=? WHERE id=?", customer, id); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Tenders(ctx, "tenders-view", SalesInput{ID: fmt.Sprint(id), Payload: map[string]any{}}, who, scope); httperrorStatus(e) != 403 {
		t.Fatal(e)
	}
	out, e = s.Tenders(ctx, "tenders-page", SalesInput{Payload: map[string]any{"page": float64(1), "pageSize": float64(20)}}, who, scope)
	if e != nil || fmt.Sprint(out.(map[string]any)["total"]) != "24" {
		t.Fatal(e, out)
	}
	who.Key = "cross-ref"
	if _, e = s.Tenders(ctx, "tenders-create", SalesInput{Payload: map[string]any{"name": "越权绑定", "owner_uid": "person", "customer_id": fmt.Sprint(customer)}}, who, scope); httperrorStatus(e) != 403 {
		t.Fatal(e)
	}
}

func TestAPFTenderConcurrentVersionsMySQL(t *testing.T) {
	s, db := tenderFixture(t)
	ctx := context.Background()
	scope := altoc.BasicReadScope{Access: "self"}
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "new", RequestID: "isolated"}
	out, e := s.Tenders(ctx, "tenders-create", SalesInput{Payload: map[string]any{"name": "并发投标", "owner_uid": "person"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	id := fmt.Sprint(out.(map[string]any)["id"])
	start := make(chan struct{})
	results := make(chan error, 2)
	for n := 0; n < 2; n++ {
		go func(n int) {
			<-start
			actor := who
			actor.Key = fmt.Sprintf("concurrent-%d", n)
			_, e := s.Tenders(ctx, "tender-milestones-create", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(1), "name": fmt.Sprintf("节点%d", n)}}, actor, scope)
			results <- e
		}(n)
	}
	close(start)
	success, conflict := 0, 0
	for n := 0; n < 2; n++ {
		e := <-results
		if e == nil {
			success++
		} else if httperrorStatus(e) == 409 {
			conflict++
		} else {
			t.Fatal(e)
		}
	}
	var count, version int
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_tender_milestone WHERE tender_id=?", id).Scan(&count); e != nil {
		t.Fatal(e)
	}
	if e = db.QueryRow("SELECT row_version FROM altoc_tender WHERE id=?", id).Scan(&version); e != nil {
		t.Fatal(e)
	}
	if success != 1 || conflict != 1 || count != 1 || version != 2 {
		t.Fatal(success, conflict, count, version)
	}
}

func TestAPFTenderAgencyAndAuditMySQL(t *testing.T) {
	s, db := tenderFixture(t)
	ctx := context.Background()
	scope := altoc.BasicReadScope{Access: "self"}
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "agency", RequestID: "isolated"}
	out, e := s.Tenders(ctx, "tender-agencies-create", SalesInput{Payload: map[string]any{"name": "标记代理", "agency_type": "third_party"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	agency := out.(map[string]any)["id"]
	page, e := s.Tenders(ctx, "tender-agencies-page", SalesInput{Payload: map[string]any{"page": float64(1), "pageSize": float64(20), "search": "标记"}}, who, scope)
	if e != nil || fmt.Sprint(page.(map[string]any)["total"]) != "1" {
		t.Fatal(e, page)
	}
	var id string
	for n := 0; n < 2; n++ {
		who.Key = fmt.Sprintf("audit-tender-%d", n)
		out, e = s.Tenders(ctx, "tenders-create", SalesInput{Payload: map[string]any{"name": "标记投标", "owner_uid": "person", "agency_id": fmt.Sprint(agency)}}, who, scope)
		if e != nil {
			t.Fatal(e)
		}
		id = fmt.Sprint(out.(map[string]any)["id"])
	}
	who.Key = "audit-member"
	i := SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(1), "user_id": "crew", "role": "technical"}}
	for n := 0; n < 2; n++ {
		if _, e = s.Tenders(ctx, "tender-members-add", i, who, scope); e != nil {
			t.Fatal(e)
		}
	}
	var count int
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_audit_log WHERE entity_type='tender' AND entity_id=? AND action='tender-members-add'", id).Scan(&count); e != nil || count != 1 {
		t.Fatal("parent audit not unique", e, count)
	}
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_audit_log WHERE entity_type='tender_agency' AND entity_id=? AND action='tender-agencies-create'", agency).Scan(&count); e != nil || count != 1 {
		t.Fatal("agency audit misclassified", e, count)
	}
	who.Key = "duplicate-member"
	i.Payload["expectedVersion"] = float64(2)
	if _, e = s.Tenders(ctx, "tender-members-add", i, who, scope); httperrorStatus(e) != 409 {
		t.Fatal("duplicate not conflict", e)
	}
}
