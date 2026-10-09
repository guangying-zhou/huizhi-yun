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

func renewalFixture(t *testing.T) (*Service, *sql.DB) {
	t.Helper()
	base, db := servicesFixture(t)
	b, e := domaininstall.WithAltocRenewals(base.binding)
	if e != nil {
		t.Fatal(e)
	}
	inst := domaininstall.ForAltocRenewals(domaininstall.Expectation{Tenant: b.Key.Tenant, Environment: b.Key.Environment, OwnerDeployment: "host-test", Address: b.Storage.Address})
	p, e := inst.PlanInstall(context.Background(), db, b)
	if e != nil {
		t.Fatal(e)
	}
	var receipt domaininstall.Receipt
	if e = inst.Apply(context.Background(), db, p, func(context.Context) error { return nil }, func(r domaininstall.Receipt) error { receipt = r; return nil }); e != nil {
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
func TestAPFRenewalRecordsMySQL(t *testing.T) {
	s, db := renewalFixture(t)
	ctx := context.Background()
	scope := altoc.BasicReadScope{Access: "self"}
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "new", RequestID: "isolated"}
	call := func(op string, i SalesInput) map[string]any {
		t.Helper()
		v, e := s.Sales(ctx, op, i, who, scope)
		if e != nil {
			t.Fatal(op, e)
		}
		return v.(map[string]any)
	}
	input := SalesInput{Payload: map[string]any{"name": "续约标记", "customer_id": "1", "contract_id": "1", "owner_uid": "person", "expected_amount": "10.25"}}
	id := fmt.Sprint(call("renewals-create", input)["id"])
	if fmt.Sprint(call("renewals-create", input)["id"]) != id {
		t.Fatal("duplicate")
	}
	var count int
	if e := db.QueryRow("SELECT COUNT(*) FROM altoc_renewal_opportunity").Scan(&count); e != nil || count != 1 {
		t.Fatal(count, e)
	}
	altered := SalesInput{Payload: map[string]any{"name": "不同意图", "customer_id": "1", "contract_id": "1", "owner_uid": "person"}}
	if _, e := s.Sales(ctx, "renewals-create", altered, who, scope); httperrorStatus(e) != 409 {
		t.Fatal("changed intent", e)
	}
	view := call("renewals-view", SalesInput{ID: id, Payload: map[string]any{}})
	if fmt.Sprint(view["row_version"]) != "1" {
		t.Fatal(view)
	}
	for _, p := range []map[string]any{{"name": "outside", "customer_id": "2", "owner_uid": "person"}, {"name": "mismatch", "customer_id": "1", "contract_id": "2", "owner_uid": "person"}, {"name": "outside-owner", "customer_id": "1", "owner_uid": "other"}} {
		who.Key = "denied-" + fmt.Sprint(p["name"])
		if _, e := s.Sales(ctx, "renewals-create", SalesInput{Payload: p}, who, scope); e == nil {
			t.Fatal(p)
		}
	}
	who.Key = "update"
	update := SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(1), "status": "won", "next_action": "签订新合同"}}
	call("renewals-update", update)
	call("renewals-update", update)
	// Record status cannot mutate the old contract or create an opportunity.
	var contractVersion, opportunities int
	if e := db.QueryRow("SELECT row_version FROM altoc_contract WHERE id=1").Scan(&contractVersion); e != nil {
		t.Fatal(e)
	}
	if e := db.QueryRow("SELECT COUNT(*) FROM altoc_opportunity").Scan(&opportunities); e != nil || opportunities != 0 || contractVersion != 1 {
		t.Fatal(e, opportunities, contractVersion)
	}
	who.Key = "stale"
	if _, e := s.Sales(ctx, "renewals-update", update, who, scope); httperrorStatus(e) != 409 {
		t.Fatal(e)
	}
	// Current reference/owner scopes are checked even before successful receipt replay.
	if _, e := db.Exec("UPDATE altoc_customer SET owner_uid='other' WHERE id=1"); e != nil {
		t.Fatal(e)
	}
	who.Key = "new"
	if _, e := s.Sales(ctx, "renewals-create", input, who, scope); httperrorStatus(e) != 403 {
		t.Fatal("revoked replay", e)
	}
	page := call("renewals-page", SalesInput{Payload: map[string]any{"page": float64(1), "pageSize": float64(1)}})
	if fmt.Sprint(page["total"]) != "0" {
		t.Fatal("COUNT leaked reference", page)
	}
	if _, e := db.Exec("UPDATE altoc_customer SET owner_uid='person' WHERE id=1"); e != nil {
		t.Fatal(e)
	}
	who.Key = "second"
	call("renewals-create", input)
	page = call("renewals-page", SalesInput{Payload: map[string]any{"page": float64(2), "pageSize": float64(1)}})
	if fmt.Sprint(page["total"]) != "2" || len(page["items"].([]map[string]any)) != 1 {
		t.Fatal(page)
	}
	// An audit failure rolls back both the record and its receipt.
	if _, e := db.Exec("CREATE TRIGGER renewal_audit_fail BEFORE INSERT ON altoc_audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated'"); e != nil {
		t.Fatal(e)
	}
	who.Key = "rollback"
	if _, e := s.Sales(ctx, "renewals-create", input, who, scope); e == nil {
		t.Fatal("audit failure")
	}
	db.Exec("DROP TRIGGER renewal_audit_fail")
	db.QueryRow("SELECT COUNT(*) FROM altoc_renewal_opportunity").Scan(&count)
	if count != 2 {
		t.Fatal(count)
	}
	// Same-version writers converge to one mutation, never overwrite each other.
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for n := 0; n < 2; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			w := who
			w.Key = fmt.Sprintf("concurrent-%d", n)
			_, e := s.Sales(ctx, "renewals-update", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(2), "reason": fmt.Sprint(n)}}, w, scope)
			results <- e
		}(n)
	}
	wg.Wait()
	close(results)
	success := 0
	for e := range results {
		if e == nil {
			success++
		} else if httperrorStatus(e) != 409 {
			t.Fatal(e)
		}
	}
	if success != 1 {
		t.Fatal(success)
	}
}
