package enterpriseapf

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"testing"
	"time"
)

func receivableFixture(t *testing.T, installed bool) (*Service, *sql.DB) {
	s, db := customerFixture(t)
	if installed {
		b, e := domaininstall.WithReceivables(s.binding)
		if e != nil {
			t.Fatal(e)
		}
		inst := domaininstall.ForReceivables(domaininstall.Expectation{Tenant: b.Key.Tenant, Environment: b.Key.Environment, OwnerDeployment: "host-test", Address: b.Storage.Address})
		plan, e := inst.PlanInstall(context.Background(), db, b)
		if e != nil {
			t.Fatal(e)
		}
		var receipt domaininstall.Receipt
		if e = inst.Apply(context.Background(), db, plan, func(context.Context) error { return nil }, func(r domaininstall.Receipt) error { receipt = r; return nil }); e != nil {
			t.Fatal(e)
		}
		if e = inst.VerifyReceipt(context.Background(), db, receipt); e != nil {
			t.Fatal(e)
		}
		reg := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
		if e = reg.Register(context.Background(), b); e != nil {
			t.Fatal(e)
		}
		s.registry = reg
		s, e = New(s.registry, b)
		if e != nil {
			t.Fatal(e)
		}
		s.ConfigureOwnerDirectory(testOwnerDirectory)
	}
	w3Exec(t, db, "INSERT INTO altoc_customer(id,code,name,owner_uid)VALUES(1,'CU-B5','Synthetic','person')")
	w3Exec(t, db, "INSERT INTO altoc_contract(id,code,name,customer_id,owner_uid)VALUES(1,'CT-B5','Synthetic',1,'person'),(2,'CT-hidden','Hidden',1,'other')")
	w3Exec(t, db, "INSERT INTO altoc_contract(id,code,name,customer_id,owner_uid,origin_type,imported_batch_code,amount_basis)VALUES(3,'CT-old','Historical',1,'person','historical_import','B5-Synthetic','header')")
	now := time.Now().In(time.FixedZone("CN", 8*3600))
	for id := 1; id <= 125; id++ {
		currency := "CNY"
		if id%2 == 0 {
			currency = "USD"
		}
		due := now.AddDate(0, 0, -(id % 200)).Format("2006-01-02")
		_, e := db.Exec("INSERT INTO altoc_billing_schedule(id,code,contract_id,name,trigger_type,amount,currency_code,due_date,status,collection_responsible_uid,received_amount)VALUES(?,?,1,'Synthetic','manual',100,?,?,'partially_received','collector',25)", id, fmt.Sprint("BS-B5-", id), currency, due)
		if e != nil {
			t.Fatal(e)
		}
	}
	w3Exec(t, db, "INSERT INTO altoc_billing_schedule(id,code,contract_id,name,trigger_type,amount,status)VALUES(126,'BS-hidden',2,'Hidden','manual',9000,'billable'),(127,'BS-old',3,'Old','manual',9999,'billable'),(128,'BS-cancelled',1,'Cancelled','manual',200,'cancelled'),(129,'BS-no-date',1,'No date','manual',10,'billable')")
	return s, db
}
func TestAPFReceivablePagesAndSnapshotMySQL(t *testing.T) {
	s, _ := receivableFixture(t, false)
	ctx := context.Background()
	scope := altoc.BasicReadScope{Access: "self"}
	who := Identity{Actor: "person", Client: "enterprise.runtime", Tenant: "C000001", Deployment: "host-test"}
	ids := map[string]bool{}
	var last map[string]any
	for page := 1; page <= 7; page++ {
		out, e := s.Receivables(ctx, "receivables-page", SalesInput{Payload: map[string]any{"page": float64(page), "pageSize": float64(20)}}, who, scope)
		if e != nil {
			t.Fatal(e)
		}
		d := out.(map[string]any)
		last = d
		if d["total"] != int64(126) || d["historical_not_ready_count"] != int64(1) {
			t.Fatal(d["total"], d["historical_not_ready_count"])
		}
		for _, row := range d["items"].([]map[string]any) {
			id := fmt.Sprint(row["id"])
			if ids[id] {
				t.Fatal("duplicate", id)
			}
			ids[id] = true
		}
	}
	if len(ids) != 126 {
		t.Fatal(len(ids))
	}
	if last["collection_installed"] != false {
		t.Fatal("installation falsely ready")
	}
	sum := 0.0
	for _, row := range last["totals"].([]map[string]any) {
		var n float64
		fmt.Sscan(fmt.Sprint(row["outstanding_amount"]), &n)
		sum += n
	}
	if sum != 125*75+10 {
		t.Fatal("summary mismatch", sum)
	}
	aging, err := s.Receivables(ctx, "receivables-aging-summary", SalesInput{Payload: map[string]any{"page": float64(1), "pageSize": float64(20)}}, who, scope)
	if err != nil || aging.(map[string]any)["total"] != int64(126) || len(aging.(map[string]any)["items"].([]map[string]any)) != 0 {
		t.Fatal("aging read differs", err, aging)
	}
	var bucketCount int64
	for _, bucket := range aging.(map[string]any)["totals"].([]map[string]any) {
		var n int64
		fmt.Sscan(fmt.Sprint(bucket["item_count"]), &n)
		bucketCount += n
	}
	if bucketCount != int64(len(ids)) {
		t.Fatal("bucket count differs from paged items", bucketCount)
	}
	out, e := s.Receivables(ctx, "receivables-page", SalesInput{Payload: map[string]any{"page": float64(1), "pageSize": float64(20), "agingBucket": "no_due_date"}}, who, scope)
	if e != nil || out.(map[string]any)["total"] != int64(1) {
		t.Fatal(e, out)
	}
	who.Actor = "collector"
	out, e = s.Receivables(ctx, "receivables-page", SalesInput{Payload: map[string]any{"page": float64(1), "pageSize": float64(20)}}, who, scope)
	if e != nil || out.(map[string]any)["total"] != int64(125) {
		t.Fatal(e)
	}
	who.Actor = "stranger"
	out, e = s.Receivables(ctx, "receivables-page", SalesInput{Payload: map[string]any{"page": float64(1), "pageSize": float64(20)}}, who, scope)
	if e != nil || out.(map[string]any)["total"] != int64(0) {
		t.Fatal(e, out)
	}
	if _, e = s.Receivables(ctx, "receivables-detail", SalesInput{ID: "1", Payload: map[string]any{}}, who, scope); e == nil {
		t.Fatal("detail leak")
	}
	who.Actor = "person"
	if _, e = s.Receivables(ctx, "receivables-set-due-date", SalesInput{ID: "1", Payload: map[string]any{"expectedVersion": float64(1), "due_date": nil}}, Identity{Actor: who.Actor, Client: who.Client, Tenant: who.Tenant, Deployment: who.Deployment, Key: "key"}, scope); e == nil {
		t.Fatal("uninstalled write")
	}
	if _, e = s.Receivables(ctx, "receivables-page", SalesInput{Payload: map[string]any{"page": float64(1), "pageSize": float64(20), "queryDate": "2000-01-01"}}, who, scope); e == nil {
		t.Fatal("fake history")
	}
}
func TestAPFReceivableReceiptCASAndOwnerMySQL(t *testing.T) {
	s, db := receivableFixture(t, true)
	ctx := context.Background()
	scope := altoc.BasicReadScope{Access: "self"}
	who := Identity{Actor: "person", Client: "enterprise.runtime", Tenant: "C000001", Deployment: "host-test", Key: "intent-b5"}
	i := SalesInput{ID: "1", Payload: map[string]any{"expectedVersion": float64(1), "collection_responsible_uid": "collector", "collection_due_at": "2026-10-08 10:00:00"}}
	out, e := s.Receivables(ctx, "receivables-set-collection-owner", i, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.Receivables(ctx, "receivables-set-collection-owner", i, who, scope)
	if e != nil || fmt.Sprint(out) != fmt.Sprint(again) {
		t.Fatal(e, out, again)
	}
	var count int
	db.QueryRow("SELECT COUNT(*) FROM altoc_collection_event").Scan(&count)
	if count != 1 {
		t.Fatal(count)
	}
	i.Payload["collection_due_at"] = "2026-10-09 10:00:00"
	if _, e = s.Receivables(ctx, "receivables-set-collection-owner", i, who, scope); httperrorStatus(e) != 409 {
		t.Fatal("mismatch", e)
	}
	who.Key = "new-key"
	if _, e = s.Receivables(ctx, "receivables-set-collection-owner", i, who, scope); httperrorStatus(e) != 409 {
		t.Fatal("CAS", e)
	}
	i.Payload["expectedVersion"] = float64(2)
	i.Payload["collection_responsible_uid"] = ReservedUnassignedOwner
	if _, e = s.Receivables(ctx, "receivables-set-collection-owner", i, who, scope); httperrorStatus(e) != 400 && httperrorStatus(e) != 403 {
		t.Fatal("reserved", e)
	}
	i.Payload["collection_responsible_uid"] = "inactive"
	reset := setTestOwners([]string{"inactive"}, false)
	_, e = s.Receivables(ctx, "receivables-set-collection-owner", i, who, scope)
	reset()
	if e == nil {
		t.Fatal("inactive")
	}
	reset = setTestOwners(nil, true)
	_, e = s.Receivables(ctx, "receivables-set-collection-owner", i, who, scope)
	reset()
	if httperrorStatus(e) != 503 {
		t.Fatal("directory", e)
	}
	due := SalesInput{ID: "1", Payload: map[string]any{"expectedVersion": float64(2), "due_date": "2026-02-28"}}
	who.Key = "due-key"
	if _, e = s.Receivables(ctx, "receivables-set-due-date", due, who, scope); e != nil {
		t.Fatal(e)
	}
	follow := SalesInput{ID: "1", Payload: map[string]any{"expectedVersion": float64(3), "result": "Synthetic promise", "promised_amount": "30.00", "promised_payment_date": "2026-10-09", "next_followup_at": "2026-10-10 10:00:00"}}
	who.Key = "follow-key"
	if _, e = s.Receivables(ctx, "collection-followup-create", follow, who, scope); e != nil {
		t.Fatal(e)
	}
	var received string
	db.QueryRow("SELECT CAST(received_amount AS CHAR) FROM altoc_billing_schedule WHERE id=1").Scan(&received)
	if received != "25.00" {
		t.Fatal("promise counted as receipt", received)
	}
	var before, after string
	db.QueryRow("SELECT before_json,after_json FROM altoc_collection_event WHERE event_type='due_date'").Scan(&before, &after)
	if before == after {
		t.Fatal("date history missing")
	}
	who.Key = "history-key"
	due.ID = "127"
	due.Payload["expectedVersion"] = float64(1)
	if _, e = s.Receivables(ctx, "receivables-set-due-date", due, who, scope); httperrorStatus(e) != 409 {
		t.Fatal("historical", e)
	}
	// Registry generation fence remains mandatory for all writes.
	w3Exec(t, db, "UPDATE enterprise_schema_registry SET generation=8")
	due.ID = "2"
	if _, e = s.Receivables(ctx, "receivables-set-due-date", due, who, scope); e == nil {
		t.Fatal("generation bypass")
	}
}

func TestAPFReceivableConcurrentCASAndHistoryMySQL(t *testing.T) {
	s, db := receivableFixture(t, true)
	ctx := context.Background()
	scope := altoc.BasicReadScope{Access: "self"}
	results := make(chan error, 2)
	for _, key := range []string{"concurrent-a", "concurrent-b"} {
		go func(key string) {
			_, err := s.Receivables(ctx, "receivables-set-due-date", SalesInput{ID: "2", Payload: map[string]any{"expectedVersion": float64(1), "due_date": "2026-10-10"}}, Identity{Actor: "person", Client: "enterprise.runtime", Tenant: "C000001", Deployment: "host-test", Key: key}, scope)
			results <- err
		}(key)
	}
	success, conflict := 0, 0
	for n := 0; n < 2; n++ {
		err := <-results
		if err == nil {
			success++
		} else if httperrorStatus(err) == 409 {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatal(success, conflict)
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM altoc_collection_event WHERE billing_schedule_id=2").Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
	who := Identity{Actor: "person", Client: "enterprise.runtime", Tenant: "C000001", Deployment: "host-test"}
	for n := 0; n < 23; n++ {
		who.Key = fmt.Sprintf("history-%d", n)
		if _, err := s.Receivables(ctx, "collection-followup-create", SalesInput{ID: "2", Payload: map[string]any{"expectedVersion": float64(n + 2), "result": "Synthetic followup"}}, who, scope); err != nil {
			t.Fatal(err)
		}
	}
	seen := map[string]bool{}
	for page := 1; page <= 2; page++ {
		out, err := s.Receivables(ctx, "receivables-detail", SalesInput{ID: "2", Payload: map[string]any{"page": float64(page), "pageSize": float64(20)}}, who, scope)
		if err != nil {
			t.Fatal(err)
		}
		data := out.(map[string]any)
		if data["followup_total"] != int64(24) {
			t.Fatal(data["followup_total"])
		}
		for _, row := range data["followups"].([]map[string]any) {
			code := fmt.Sprint(row["code"])
			if seen[code] {
				t.Fatal("history duplicate")
			}
			seen[code] = true
		}
	}
	if len(seen) != 24 {
		t.Fatal(len(seen))
	}
	w3Exec(t, db, "UPDATE altoc_billing_schedule SET received_amount=amount,status='received' WHERE id=2")
	who.Key = "closed-attempt"
	if _, err := s.Receivables(ctx, "collection-followup-create", SalesInput{ID: "2", Payload: map[string]any{"expectedVersion": float64(25), "result": "closed"}}, who, scope); httperrorStatus(err) != 409 {
		t.Fatal("closed write", err)
	}
	// Same original intent still returns its durable receipt after settlement.
	who.Key = "history-22"
	if _, err := s.Receivables(ctx, "collection-followup-create", SalesInput{ID: "2", Payload: map[string]any{"expectedVersion": float64(24), "result": "Synthetic followup"}}, who, scope); err != nil {
		t.Fatal("settled replay", err)
	}
}

func TestAPFReceivableInstallerRollbackMySQL(t *testing.T) {
	s, db := customerFixture(t)
	b, err := domaininstall.WithReceivables(s.binding)
	if err != nil {
		t.Fatal(err)
	}
	inst := domaininstall.ForReceivables(domaininstall.Expectation{Tenant: b.Key.Tenant, Environment: b.Key.Environment, OwnerDeployment: "host-test", Address: b.Storage.Address})
	ctx := context.Background()
	plan, err := inst.PlanInstall(ctx, db, b)
	if err != nil {
		t.Fatal(err)
	}
	off := func(context.Context) error { return nil }
	var receipt domaininstall.Receipt
	if err = inst.Apply(ctx, db, plan, off, func(r domaininstall.Receipt) error { receipt = r; return nil }); err != nil {
		t.Fatal(err)
	}
	if err = inst.VerifyReceipt(ctx, db, receipt); err != nil {
		t.Fatal(err)
	}
	w3Exec(t, db, "INSERT INTO altoc_collection_event(code,billing_schedule_id,contract_id,event_type,before_json,after_json,actor_uid,idempotency_key,operation_id) VALUES('CE-fixture',1,1,'assign','{}','{}','fixture','fixture-key','fixture-operation')")
	if inst.Rollback(ctx, db, receipt, off) == nil {
		t.Fatal("nonempty events dropped")
	}
	w3Exec(t, db, "DELETE FROM altoc_collection_event")
	if err = inst.Rollback(ctx, db, receipt, off); err != nil {
		t.Fatal(err)
	}
	if _, err = inst.PlanInstall(ctx, db, b); err != nil {
		t.Fatal("baseline not restored", err)
	}
}

func TestAPFReceivableLegalEntityScopeMySQL(t *testing.T) {
	s, db := receivableFixture(t, false)
	ctx := context.Background()
	who := Identity{Actor: "person", Client: "enterprise.runtime", Tenant: "C000001", Deployment: "host-test"}
	input := SalesInput{Payload: map[string]any{"page": float64(1), "pageSize": float64(20), "legalEntityCode": "LE-SYNTHETIC", "legalEntityRead": true}}
	scope := altoc.BasicReadScope{Access: "self"}
	if _, err := s.Receivables(ctx, "receivables-page", input, who, scope); err == nil {
		t.Fatal("uninstalled bank storage accepted")
	}
	tables, _ := domaininstall.APFTables("finance")
	for _, table := range tables {
		if table.Logical == "finance_bank_account" {
			w3Exec(t, db, table.DDL)
		}
	}
	w3Exec(t, db, "INSERT INTO finance_bank_account(code,account_name,legal_entity_code)VALUES('BA-SYNTHETIC','Synthetic','LE-SYNTHETIC')")
	w3Exec(t, db, "UPDATE altoc_contract SET receiving_bank_account_code='BA-SYNTHETIC' WHERE id IN(1,2)")
	out, err := s.Receivables(ctx, "receivables-page", input, who, scope)
	if err != nil || out.(map[string]any)["total"] != int64(126) {
		t.Fatal(err, out)
	}
	who.Actor = "stranger"
	out, err = s.Receivables(ctx, "receivables-page", input, who, scope)
	if err != nil || out.(map[string]any)["total"] != int64(0) {
		t.Fatal("entity bypassed contract scope", err, out)
	}
	delete(input.Payload, "legalEntityRead")
	if _, err = s.Receivables(ctx, "receivables-page", input, who, scope); httperrorStatus(err) != 400 {
		t.Fatal("missing joint authority", err)
	}
}

func TestAPFReceivableExistingDueClosureMySQL(t *testing.T) {
	s, db := dueFixture(t, "altoc")
	ctx := context.Background()
	w3Exec(t, db, "INSERT INTO altoc_customer(id,code,name,owner_uid) VALUES(1,'CU-B5-DUE','Synthetic','Owner')")
	w3Exec(t, db, "INSERT INTO altoc_contract(id,code,name,customer_id,owner_uid) VALUES(1,'CT-B5-DUE','Synthetic',1,'Owner')")
	w3Exec(t, db, "INSERT INTO altoc_billing_schedule(code,contract_id,name,trigger_type,amount,status,collection_due_at) VALUES('BS-B5-DUE',1,'Synthetic','manual',100,'billable',UTC_TIMESTAMP()-INTERVAL 1 DAY)")
	who := Identity{Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", RequestID: "isolated-b5a-due"}
	owner := DueOwner{Enabled: true, LegacyOwnerDisabled: true}
	call := func(action string, input DueInput) map[string]any {
		t.Helper()
		out, err := s.Due(ctx, "altoc", "billing-due:"+action, input, who, owner)
		if err != nil {
			t.Fatal(err)
		}
		return out.(map[string]any)
	}
	if len(call("scan-due", DueInput{})["items"].([]DueCandidate)) != 0 {
		t.Fatal("missing recipient delivered")
	}
	w3Exec(t, db, "UPDATE altoc_billing_schedule SET collection_responsible_uid='Owner'")
	first := call("scan-due", DueInput{})["items"].([]DueCandidate)
	if len(first) != 1 {
		t.Fatal(first)
	}
	call("published", DueInput{EventKey: first[0].EventKey, NotificationID: "synthetic-1", RecipientUID: "Owner"})
	w3Exec(t, db, "UPDATE altoc_billing_schedule SET collection_responsible_uid='Next'")
	closures := call("scan-due", DueInput{})["closures"].([]DueCandidate)
	if len(closures) != 1 || closures[0].ClosureState != "cancelled" {
		t.Fatal("old collector notification not closed", closures)
	}
	call("closure-ack", DueInput{EventKey: first[0].EventKey, State: "cancelled"})
	second := call("scan-due", DueInput{})["items"].([]DueCandidate)
	if len(second) != 1 || second[0].RecipientUID != "Next" {
		t.Fatal(second)
	}
	call("published", DueInput{EventKey: second[0].EventKey, NotificationID: "synthetic-2", RecipientUID: "Next"})
	w3Exec(t, db, "UPDATE altoc_billing_schedule SET status='received',received_amount=amount")
	closures = call("scan-due", DueInput{})["closures"].([]DueCandidate)
	if len(closures) != 1 || closures[0].ClosureState != "resolved" {
		t.Fatal("settled notification not resolved", closures)
	}
}
