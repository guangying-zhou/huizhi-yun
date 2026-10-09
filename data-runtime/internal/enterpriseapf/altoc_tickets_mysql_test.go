package enterpriseapf

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseticket"
	"os"
	"regexp"
	"sync"
	"testing"
	"time"
)

func ticketsFixture(t *testing.T) (*Service, *sql.DB) {
	t.Helper()
	s, db := servicesFixture(t)
	ctx := context.Background()
	b, e := domaininstall.WithAltocTickets(s.binding)
	if e != nil {
		t.Fatal(e)
	}
	inst := domaininstall.ForAltocTickets(domaininstall.Expectation{Tenant: b.Key.Tenant, Environment: b.Key.Environment, OwnerDeployment: "host-test", Address: b.Storage.Address})
	plan, e := inst.PlanInstall(ctx, db, b)
	if e != nil {
		t.Fatal(e)
	}
	var receipt domaininstall.Receipt
	if e = inst.Apply(ctx, db, plan, func(context.Context) error { return nil }, func(r domaininstall.Receipt) error { receipt = r; return nil }); e != nil {
		t.Fatal(e)
	}
	if e = inst.VerifyReceipt(ctx, db, receipt); e != nil {
		t.Fatal(e)
	}
	// Canonical Aims execution tables, local disposable database only.
	source, e := os.ReadFile("../../../aims/docs/aims_schema.sql")
	if e != nil {
		t.Fatal(e)
	}
	conn, e := db.Conn(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer conn.Close()
	conn.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS=0")
	for _, n := range []string{"work_items", "work_item_service_ext", "work_item_changelog", "milestones", "project_counters", "time_entries", "project_documents"} {
		ddl := regexp.MustCompile("(?s)CREATE TABLE IF NOT EXISTS `" + n + "`.*?ENGINE=InnoDB[^;]*;").FindString(string(source))
		if ddl == "" {
			t.Fatal(n)
		}
		// Disposable fixture parents deliberately use minimal BIGINT IDs. FK removal
		// here avoids imposing canonical parent types on unrelated service fixtures.
		ddl = regexp.MustCompile("(?m)^[ \t]*--[^\n]*\n").ReplaceAllString(ddl, "")
		ddl = regexp.MustCompile("(?m)^[ \t]*CONSTRAINT[^\n]*\n").ReplaceAllString(ddl, "")
		ddl = regexp.MustCompile(",\\s*\\)").ReplaceAllString(ddl, ")")
		if _, e = conn.ExecContext(ctx, ddl); e != nil {
			t.Fatal(n, e)
		}
		b.Domains["aims"].Tables[n] = n
	}
	conn.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS=1")
	conn.Close()
	reg := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e = reg.Register(ctx, b); e != nil {
		t.Fatal(e)
	}
	s, e = New(reg, b)
	if e != nil {
		t.Fatal(e)
	}
	s.ConfigureOwnerDirectory(testOwnerDirectory)
	return s, db
}
func TestAPFTicketsCommandsMySQL(t *testing.T) {
	s, db := ticketsFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "agreement"}
	scope := altoc.BasicReadScope{Access: "self"}
	a, e := s.Sales(ctx, "service-agreements-create", SalesInput{Payload: map[string]any{"name": "服务", "contract_id": "1", "status": "active", "included_quota": "2", "quota_unit": "ticket"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	aid := fmt.Sprint(a.(map[string]any)["id"])
	call := func(op, key, id string, p map[string]any) map[string]any {
		t.Helper()
		who.Key = key
		v, e := s.Sales(ctx, op, SalesInput{ID: id, Payload: p}, who, scope)
		if e != nil {
			t.Fatal(op, e)
		}
		return v.(map[string]any)
	}
	create := map[string]any{"title": "标记工单", "ticket_type": "incident", "service_agreement_id": aid}
	id := fmt.Sprint(call("service-tickets-create", "ticket", "", create)["id"])
	if fmt.Sprint(call("service-tickets-create", "ticket", "", create)["id"]) != id {
		t.Fatal("duplicate ticket")
	}
	who.Key = "outside-owner"
	if _, e = s.Sales(ctx, "service-tickets-update", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(1), "owner_user_id": "other"}}, who, scope); httperrorStatus(e) != 403 {
		t.Fatal("target owner escaped current scope", e)
	}
	call("service-tickets-update", "update", id, map[string]any{"expectedVersion": float64(1), "description": "补充"})
	dispatch := map[string]any{"expectedVersion": float64(2), "project_code": "PROJECT-1"}
	call("service-ticket-dispatch", "dispatch", id, dispatch)
	call("service-ticket-dispatch", "dispatch", id, dispatch)
	var n int
	if e = db.QueryRow("SELECT COUNT(*) FROM work_items").Scan(&n); e != nil || n != 1 {
		t.Fatal(n, e)
	}
	call("service-ticket-dispatch-resume", "resume", id, map[string]any{"expectedVersion": float64(3)})
	if e = db.QueryRow("SELECT COUNT(*) FROM work_items").Scan(&n); e != nil || n != 1 {
		t.Fatal(n, e)
	}
	view := call("service-ticket-dispatch-view", "", id, map[string]any{})
	if view["aims_work_item_key"] == nil {
		t.Fatal(view)
	}
	call("service-tickets-close", "close", id, map[string]any{"expectedVersion": float64(4), "reason": "完成"})
	who.Key = "cannot-edit"
	if _, e = s.Sales(ctx, "service-tickets-update", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(5), "title": "非法"}}, who, scope); e == nil {
		t.Fatal("terminal edit accepted")
	}
	call("service-tickets-reopen", "reopen", id, map[string]any{"expectedVersion": float64(5), "reason": "显式重开"})
	var quota string
	if e = db.QueryRow("SELECT consumed_quota FROM altoc_service_agreement WHERE id=?", aid).Scan(&quota); e != nil || quota != "1.00" {
		t.Fatal("close/reopen must consume once without refund", quota, e)
	}
	who.Key = "stale-reopen"
	if _, e = s.Sales(ctx, "service-tickets-reopen", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(5), "reason": "过期版本重开"}}, who, scope); httperrorStatus(e) != 409 {
		t.Fatal("stale explicit action", e)
	}
	who.Key = "out-of-scope"
	_, e = s.Sales(ctx, "service-tickets-update", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(6), "title": "越权"}}, who, altoc.BasicReadScope{Access: "self", DepartmentCodes: []string{}})
	if e != nil {
		t.Fatal(e)
	}
	who.Actor = "other"
	who.Key = "dispatch"
	if _, e = s.Sales(ctx, "service-ticket-dispatch", SalesInput{ID: id, Payload: dispatch}, who, scope); e == nil {
		t.Fatal("revoked actor replay accepted")
	}
	who.Actor = "person"
	db.Exec("UPDATE altoc_service_agreement SET consumed_quota=2 WHERE id=?", aid)
	who.Key = "over-quota"
	if _, e = s.Sales(ctx, "service-ticket-dispatch", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(7), "project_code": "PROJECT-1"}}, who, scope); e == nil {
		t.Fatal("over quota accepted")
	}
	if _, e = db.Exec("CREATE TRIGGER refuse_ticket_audit BEFORE INSERT ON altoc_audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test fail'"); e != nil {
		t.Fatal(e)
	}
	who.Key = "rollback"
	if _, e = s.Sales(ctx, "service-tickets-create", SalesInput{Payload: map[string]any{"title": "回滚", "ticket_type": "incident", "service_agreement_id": aid}}, who, scope); e == nil {
		t.Fatal("expected audit failure")
	}
	db.Exec("DROP TRIGGER refuse_ticket_audit")
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_service_ticket").Scan(&n); e != nil || n != 1 {
		t.Fatal("partial insert", n, e)
	}
}
func TestAPFTicketResultsMySQL(t *testing.T) {
	s, db := ticketsFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "agreement"}
	scope := altoc.BasicReadScope{Access: "self"}
	v, e := s.Sales(ctx, "service-agreements-create", SalesInput{Payload: map[string]any{"name": "服务", "contract_id": "1", "status": "active", "included_quota": "10", "quota_unit": "hour"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	aid := fmt.Sprint(v.(map[string]any)["id"])
	var ids []int64
	for k := 1; k <= 2; k++ {
		who.Key = fmt.Sprintf("ticket-%d", k)
		v, e = s.Sales(ctx, "service-tickets-create", SalesInput{Payload: map[string]any{"title": "并发工单", "ticket_type": "incident", "service_agreement_id": aid}}, who, scope)
		if e != nil {
			t.Fatal(e)
		}
		id := fmt.Sprint(v.(map[string]any)["id"])
		who.Key = fmt.Sprintf("dispatch-%d", k)
		if _, e = s.Sales(ctx, "service-ticket-dispatch", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(1), "project_code": "PROJECT-1", "estimated_hours": "1"}}, who, scope); e != nil {
			t.Fatal(e)
		}
		var item int64
		if e = db.QueryRow("SELECT w.id FROM work_items w JOIN work_item_service_ext se ON se.work_item_id=w.id JOIN altoc_service_ticket t ON BINARY t.code=BINARY se.source_ticket_code WHERE t.id=?", id).Scan(&item); e != nil {
			t.Fatal(e)
		}
		ids = append(ids, item)
	}
	reqA, _ := s.request("altoc", enterprise.Write)
	reqI, _ := s.request("aims", enterprise.Write)
	apply := func(ids []int64, fail bool) error {
		tx, rs, e := s.registry.BeginWriteTransaction(ctx, reqA, reqI)
		if e != nil {
			return e
		}
		defer tx.Rollback()
		p, e := altoc.PrepareEnterpriseTicketResultsTx(ctx, tx, rs[0], rs[1], ids)
		if e != nil {
			return e
		}
		c := enterpriseticket.With(ctx, p)
		for j, id := range ids {
			var key, ticket string
			var gen int64
			if e = tx.QueryRow("SELECT w.item_key,se.source_ticket_code,se.delivery_generation FROM work_items w JOIN work_item_service_ext se ON se.work_item_id=w.id WHERE w.id=? FOR UPDATE", id).Scan(&key, &ticket, &gen); e != nil {
				return e
			}
			if _, e = tx.Exec("UPDATE work_items SET status='completed' WHERE id=?", id); e != nil {
				return e
			}
			facts := map[string]any{"ticketCode": ticket, "aimsProjectCode": "PROJECT-1", "workItemKey": key, "deliveryStatus": "closed", "deliveryGeneration": gen + 1, "quotaConsumed": float64(2), "firstRespondedAt": time.Now().UTC().Format("2006-01-02 15:04:05")}
			if fail && j == 1 {
				facts["aimsProjectCode"] = "OTHER-P"
			}
			if _, e = enterpriseticket.Apply(c, tx, fmt.Sprint(id), facts); e != nil {
				return e
			}
			if _, e = tx.Exec("UPDATE work_item_service_ext SET delivery_generation=? WHERE work_item_id=?", gen+1, id); e != nil {
				return e
			}
		}
		return tx.Commit()
	}
	if e = apply(ids, true); e == nil {
		t.Fatal("batch mismatch accepted")
	}
	var consumed string
	if e = db.QueryRow("SELECT consumed_quota FROM altoc_service_agreement WHERE id=?", aid).Scan(&consumed); e != nil || consumed != "0.00" {
		t.Fatal("partial batch", consumed, e)
	}
	var advanced int
	if e = db.QueryRow("SELECT COUNT(*) FROM work_items WHERE status='completed'").Scan(&advanced); e != nil || advanced != 0 {
		t.Fatal("Aims half committed", advanced, e)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for k := 0; k < 2; k++ {
		wg.Add(1)
		ordered := append([]int64{}, ids...)
		if k == 1 {
			ordered[0], ordered[1] = ordered[1], ordered[0]
		}
		go func() { defer wg.Done(); errs <- apply(ordered, false) }()
	}
	wg.Wait()
	close(errs)
	for e = range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	if e = db.QueryRow("SELECT consumed_quota FROM altoc_service_agreement WHERE id=?", aid).Scan(&consumed); e != nil || consumed != "4.00" {
		t.Fatal("duplicate consumption", consumed, e)
	}
	var closed int
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_service_ticket WHERE status='closed'").Scan(&closed); e != nil || closed != 2 {
		t.Fatal(closed, e)
	}
	if _, e = db.Exec("UPDATE altoc_service_ticket SET resolved_at='2020-01-01 10:00:00',resolution_due_at='2020-01-02 10:00:00'"); e != nil {
		t.Fatal(e)
	}
	if e = apply(ids, false); e != nil {
		t.Fatal(e)
	}
	var met int
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_service_ticket WHERE sla_status='met'").Scan(&met); e != nil || met != 2 {
		t.Fatal("late higher generation changed historical SLA", met, e)
	}
	if _, e = db.Exec("UPDATE altoc_service_ticket SET status='cancelled' WHERE id=1"); e != nil {
		t.Fatal(e)
	}
	if e = apply(ids, false); e != nil {
		t.Fatal(e)
	}
	var status string
	db.QueryRow("SELECT status FROM altoc_service_ticket WHERE id=1").Scan(&status)
	if status != "cancelled" {
		t.Fatal("delayed result reopened", status)
	}
}
