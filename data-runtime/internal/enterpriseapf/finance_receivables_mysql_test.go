package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/openingproof"
	"os"
	"strings"
	"testing"
)

func financeReceivablesFixture(t *testing.T) (*Service, *sql.DB) {
	s, db := financeLedgerFixture(t)
	ctx := context.Background()
	var columns int
	if e := db.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='finance_bank_account' AND column_name='legal_entity_code'").Scan(&columns); e != nil {
		t.Fatal(e)
	}
	if columns == 0 {
		if _, e := db.Exec("ALTER TABLE finance_bank_account ADD COLUMN legal_entity_code VARCHAR(32)"); e != nil {
			t.Fatal(e)
		}
	}
	for _, q := range []string{"INSERT INTO finance_bank_account(id,code,account_name,legal_entity_code) VALUES(1,'BA1','Synthetic account','LE1'),(2,'BA2','Other entity','LE2')", "UPDATE altoc_contract SET receiving_bank_account_code='BA1'"} {
		if _, e := db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	for _, table := range domaininstall.W1Tables("w1-migration-ledger") {
		if _, e := db.Exec(table.DDL); e != nil {
			t.Fatal(e)
		}
	}
	for _, table := range domaininstall.FinanceReceivablesTables() {
		if _, e := db.Exec(table.DDL); e != nil {
			t.Fatal(e)
		}
	}
	b, e := domaininstall.WithW1(s.binding, "w1-migration-ledger", "host-test")
	if e != nil {
		t.Fatal(e)
	}
	b, e = domaininstall.WithFinanceReceivables(b)
	if e != nil {
		t.Fatal(e)
	}
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
func TestB5BAtomicAllocationAndAdjustmentMySQL(t *testing.T) {
	s, db := financeReceivablesFixture(t)
	ctx := context.Background()
	scope := altoc.BasicReadScope{Access: "all"}
	who := Identity{Tenant: s.binding.Key.Tenant, Deployment: "host-test", Client: "enterprise.runtime", Actor: "reviewer"}
	run := func(op, code, key, actor string, p map[string]any) (map[string]any, error) {
		w := who
		w.Key = key
		w.Actor = actor
		v, e := s.FinanceLedger(ctx, op, FinanceInput{Code: code, Payload: p}, w, scope)
		if e != nil {
			return nil, e
		}
		return v.(map[string]any)["data"].(map[string]any), nil
	}
	for _, q := range []string{"INSERT INTO altoc_billing_schedule(id,code,contract_id,name,trigger_type,amount,status,billable_at) VALUES(2,'BS2',1,'Second','manual',100,'billable',NOW())", "INSERT INTO finance_receipt(code,customer_code,currency_code,received_amount,received_at,bank_account_id,reconciliation_responsible_uid,reconciliation_due_at,status,confirmed_by,created_by) VALUES('R1','C1','CNY',100,NOW(),1,'reviewer',NOW(),'confirmed','cashier','maker')"} {
		if _, e := db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	version := func(table, code string) int64 {
		var v int64
		if e := db.QueryRow("SELECT row_version FROM "+table+" WHERE code=?", code).Scan(&v); e != nil {
			t.Fatal(e)
		}
		return v
	}
	payload := func(a, b string) map[string]any {
		return map[string]any{"receiptVersion": version("finance_receipt", "R1"), "items": []any{map[string]any{"contractCode": "CT1", "billingScheduleCode": "BS1", "scheduleVersion": version("altoc_billing_schedule", "BS1"), "amount": a}, map[string]any{"contractCode": "CT1", "billingScheduleCode": "BS2", "scheduleVersion": version("altoc_billing_schedule", "BS2"), "amount": b}}}
	}
	if _, e := run("reconciliation-allocate-batch", "R1", "too-much", "reviewer", payload("60.00", "50.00")); e == nil {
		t.Fatal("over allocation accepted")
	}
	var n int
	if e := db.QueryRow("SELECT COUNT(*) FROM finance_reconciliation").Scan(&n); e != nil || n != 0 {
		t.Fatal("partial allocation committed", n, e)
	}
	p := payload("60.00", "40.00")
	v, e := run("reconciliation-allocate-batch", "R1", "good", "reviewer", p)
	if e != nil {
		t.Fatal(e)
	}
	code := ledgerText(v["code"])
	var summary string
	if e = db.QueryRow("SELECT CAST(reconciled_amount AS CHAR) FROM finance_contract_summary WHERE contract_code='CT1'").Scan(&summary); e != nil || summary != "100.00" {
		t.Fatal("missing contract summary", summary, e)
	}
	if _, e = run("reconciliation-allocate-batch", "R1", "good", "reviewer", p); e != nil {
		t.Fatal("replay", e)
	}
	p["receiptVersion"] = int64(999)
	if _, e = run("reconciliation-allocate-batch", "R1", "good", "reviewer", p); e == nil {
		t.Fatal("changed replay accepted")
	}
	var child string
	if e = db.QueryRow("SELECT code FROM finance_reconciliation WHERE status='active' LIMIT 1").Scan(&child); e != nil {
		t.Fatal(e)
	}
	if _, e = run("reconciliation-void", child, "individual", "reviewer", map[string]any{"expectedVersion": 1, "reason": "Must reverse batch"}); e == nil {
		t.Fatal("individual batch reversal accepted")
	}
	if _, e = run("allocation-batches-reverse", code, "reverse", "reviewer", map[string]any{"expectedVersion": 1, "reason": "Marked reversal"}); e != nil {
		t.Fatal(e)
	}
	a, e := run("receivable-adjustments-create", "", "adjust", "maker", map[string]any{"contractCode": "CT1", "billingScheduleCode": "BS1", "scheduleVersion": version("altoc_billing_schedule", "BS1"), "adjustmentType": "bad_debt", "amount": "50.00", "reason": "Marked loss"})
	if e != nil {
		t.Fatal(e)
	}
	ac := ledgerText(a["code"])
	if _, e = run("receivable-adjustments-confirm", ac, "self", "maker", map[string]any{"expectedVersion": 1}); e == nil {
		t.Fatal("self confirm")
	}
	if _, e = run("receivable-adjustments-confirm", ac, "confirm", "director", map[string]any{"expectedVersion": 1}); e != nil {
		t.Fatal(e)
	}
	if _, e = run("reconciliation-allocate-batch", "R1", "capacity", "reviewer", payload("60.00", "40.00")); e == nil {
		t.Fatal("adjustment capacity bypassed")
	}
	if _, e = run("receivable-adjustments-reverse", ac, "restore", "director", map[string]any{"expectedVersion": 2, "reason": "Marked restoration"}); e != nil {
		t.Fatal(e)
	}
	if _, e = run("reconciliation-allocate-batch", "R1", "again", "reviewer", payload("60.00", "40.00")); e != nil {
		t.Fatal("reallocation", e)
	}
}
func TestB5BHistoricalOpeningContinuationMySQL(t *testing.T) {
	s, db := financeReceivablesFixture(t)
	ctx := context.Background()
	scope := altoc.BasicReadScope{Access: "all"}
	who := Identity{Tenant: s.binding.Key.Tenant, Deployment: "host-test", Client: "enterprise.runtime", Actor: "director"}
	if _, e := db.Exec("UPDATE altoc_contract SET origin_type='historical_import',amount_basis='header',imported_batch_code='MAIN' WHERE id=1"); e != nil {
		t.Fatal(e)
	}
	if _, e := db.Exec("UPDATE altoc_billing_schedule SET plan_type='opening_balance',source_type='historical_import',source_ref_code='CT1' WHERE id=1"); e != nil {
		t.Fatal(e)
	}
	rows, e := db.Query("SELECT * FROM altoc_billing_schedule WHERE id=1")
	if e != nil {
		t.Fatal(e)
	}
	cols, _ := rows.Columns()
	v := make([]sql.RawBytes, len(cols))
	ptr := make([]any, len(cols))
	for n := range v {
		ptr[n] = &v[n]
	}
	rows.Next()
	if e = rows.Scan(ptr...); e != nil {
		t.Fatal(e)
	}
	row := map[string]any{}
	for n, k := range cols {
		if v[n] == nil {
			row[k] = nil
		} else {
			row[k] = string(v[n])
		}
	}
	rows.Close()
	seal, _ := openingproof.CanonicalRow(row)
	hash := strings.Repeat("a", 64)
	c := openingproof.OpeningConfirmation{BatchCode: "OPEN", MainReviewHash: hash, SnapshotSHA256: hash, Approver: "director", Date: "2026-10-02", AsOfDate: "2026-10-01", Contracts: []openingproof.OpeningConfirmedRow{{SourcePK: "1", Amount: "100.00"}}}
	p := openingproof.OpeningPlan{Version: "wizbiz-opening-plan.v1", BatchCode: "OPEN", MainReviewHash: hash, SnapshotSHA256: hash, ConfirmationSHA256: hash, Rows: []openingproof.OpeningRow{{SourcePK: "1", ContractCode: "CT1", Code: "BS1", Amount: "100.00"}}, Total: "100.00"}
	raw, _ := json.Marshal(p)
	p.ReviewHash = openingproof.Digest(raw)
	evidence := map[string]any{"plan": p, "confirmation": c, "seals": map[string]any{"BS1": map[string]any{"table": "altoc_billing_schedule", "keyColumn": "code", "key": "BS1", "sha256": openingproof.Digest(seal)}}}
	raw, _ = json.Marshal(evidence)
	if _, e = db.Exec("INSERT INTO mig_batch(id,batch_code,source_system,source_snapshot,scope_json,plan_sha256,status,operator) VALUES(1,'OPEN','wizbiz','SNAP',?,?,'applied','director')", string(raw), p.ReviewHash); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("INSERT INTO mig_batch_step(batch_id,step,status,planned_rows,done_rows) VALUES(1,'opening-balance','completed',1,1)"); e != nil {
		t.Fatal(e)
	}
	for _, q := range []string{"INSERT INTO mig_object_map(source_system,source_table,source_pk,target_domain,target_table,target_key,map_role,disposition,batch_id) VALUES('wizbiz','wb_contract','1','altoc','altoc_billing_schedule','BS1','opening','created',1)", "INSERT INTO mig_object_map(source_system,source_table,source_pk,target_domain,target_table,target_key,map_role,disposition,batch_id) VALUES('wizbiz','wb_contract','1','altoc','altoc_contract','CT1','primary','created',1)", "INSERT INTO mig_source_row(source_system,source_table,source_pk,source_snapshot,first_batch_id,row_json,row_sha256,captured_at) VALUES('wizbiz','wb_project_income','OLD1','SNAP',1,JSON_OBJECT('contract_id','1','amount','999999.00'),REPEAT('b',64),NOW())"} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	// Seal was produced with migration's text-date connection. Runtime uses
	// ParseTime=true; identical facts must retain exactly the same evidence hash.
	var database string
	if e := db.QueryRow("SELECT DATABASE()").Scan(&database); e != nil {
		t.Fatal(e)
	}
	mc := mysql.NewConfig()
	mc.User, mc.Net, mc.Addr, mc.DBName, mc.ParseTime = "root", "unix", os.Getenv("HZY_DOMAIN_INSTALL_SOCKET"), database, true
	runtimeDB, e := sql.Open("mysql", mc.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { runtimeDB.Close() })
	s.registry = enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return runtimeDB, nil })
	if e := s.registry.Register(ctx, s.binding); e != nil {
		t.Fatal(e)
	}
	run := func(op, code, key string, payload map[string]any) (map[string]any, error) {
		w := who
		w.Key = key
		o, e := s.FinanceLedger(ctx, op, FinanceInput{Code: code, Payload: payload}, w, scope)
		if e != nil {
			return nil, e
		}
		return o.(map[string]any)["data"].(map[string]any), nil
	}
	if _, e := run("historical-finance-activate", "CT1", "missing-proof", map[string]any{"expectedVersion": 1, "reviewHash": strings.Repeat("z", 64), "evidenceSha256": strings.Repeat("z", 64)}); e == nil {
		t.Fatal("unreviewed historical activation accepted")
	}
	preview, e := run("historical-finance-preview", "CT1", "", nil)
	if e != nil {
		t.Fatal(e)
	}
	if preview["opening_amount"] != "100.00" {
		t.Fatal(preview)
	}
	var storedEvidence string
	if e := db.QueryRow("SELECT scope_json FROM mig_batch WHERE id=1").Scan(&storedEvidence); e != nil {
		t.Fatal(e)
	}
	if preview["evidence_sha256"] != openingproof.Digest([]byte(storedEvidence)) || preview["cutoff_date"] != "2026-10-01" {
		t.Fatal("real migration evidence lost", preview)
	}
	list, e := s.FinanceLedger(ctx, "historical-finance-page", FinanceInput{Page: 1, PageSize: 1, Status: "pending", Search: "CT1"}, who, scope)
	if e != nil || list.(map[string]any)["data"].(map[string]any)["total"] != int64(1) {
		t.Fatal("opening list", list, e)
	}
	if _, e := s.FinanceLedger(ctx, "historical-finance-page", FinanceInput{}, who, altoc.BasicReadScope{Access: "self"}); e == nil {
		t.Fatal("scope bypass")
	}
	if _, e := db.Exec("UPDATE altoc_billing_schedule SET amount=101 WHERE code='BS1'"); e != nil {
		t.Fatal(e)
	}
	if _, e := run("historical-finance-preview", "CT1", "", nil); e == nil {
		t.Fatal("tampered seal accepted")
	}
	if _, e := db.Exec("UPDATE altoc_billing_schedule SET amount=100,updated_at=? WHERE code='BS1'", row["updated_at"]); e != nil {
		t.Fatal(e)
	}
	if _, e = run("historical-finance-activate", "CT1", "activate", map[string]any{"expectedVersion": preview["row_version"], "reviewHash": preview["review_hash"], "evidenceSha256": preview["evidence_sha256"]}); e != nil {
		t.Fatal(e)
	}
	active, e := run("historical-finance-preview", "CT1", "", nil)
	if e != nil || active["ready"] != true || active["cutoff_date"] != "2026-10-01" || active["evidence_sha256"] != nil {
		t.Fatal("activated overview", active, e)
	}
	for _, test := range []struct {
		status string
		page   int
		total  int64
		rows   int
	}{{"pending", 1, 0, 0}, {"active", 1, 1, 1}, {"active", 2, 1, 0}} {
		out, e := s.FinanceLedger(ctx, "historical-finance-page", FinanceInput{Page: test.page, PageSize: 1, Status: test.status}, who, scope)
		if e != nil {
			t.Fatal(e)
		}
		data := out.(map[string]any)["data"].(map[string]any)
		if data["total"] != test.total || len(data["items"].([]map[string]any)) != test.rows {
			t.Fatal("list filter/page", data)
		}
	}
	old, e := run("historical-finance-history-page", "CT1", "", nil)
	if e != nil || old["excluded_from_balance"] != true || old["total"] != int64(1) {
		t.Fatal(old, e)
	}
	if _, e = db.Exec("INSERT INTO finance_receipt(code,customer_code,currency_code,received_amount,received_at,bank_account_id,reconciliation_responsible_uid,reconciliation_due_at,status,confirmed_by,created_by) VALUES('H1','C1','CNY',100,'2026-10-01',1,'director',NOW(),'confirmed','cashier','maker')"); e != nil {
		t.Fatal(e)
	}
	payload := map[string]any{"receiptVersion": 1, "items": []any{map[string]any{"contractCode": "CT1", "billingScheduleCode": "BS1", "scheduleVersion": 1, "amount": "50.00"}}}
	if _, e = run("reconciliation-allocate-batch", "H1", "before", payload); e == nil {
		t.Fatal("cutoff accepted")
	}
	if _, e = db.Exec("UPDATE finance_receipt SET received_at='2026-10-02' WHERE code='H1'"); e != nil {
		t.Fatal(e)
	}
	if _, e = run("reconciliation-allocate-batch", "H1", "after", payload); e != nil {
		t.Fatal(e)
	}
	var paid string
	if e = db.QueryRow("SELECT CAST(received_amount AS CHAR) FROM altoc_billing_schedule WHERE code='BS1'").Scan(&paid); e != nil || paid != "50.00" {
		t.Fatal("historical collections double counted", paid, e)
	}
	if _, e = db.Exec("DELETE FROM mig_batch WHERE id=1"); e == nil {
		t.Fatal("activated opening rollback allowed")
	}
}
func TestB5BInstallerAndNonemptyRollbackMySQL(t *testing.T) {
	s, db := financeLedgerFixture(t)
	ctx := context.Background()
	_, unavailable := s.FinanceLedger(ctx, "historical-finance-preview", FinanceInput{Code: "CT1"}, Identity{Tenant: s.binding.Key.Tenant, Deployment: "host-test", Client: "enterprise.runtime", Actor: "reader"}, altoc.BasicReadScope{Access: "all"})
	if unavailable == nil || !strings.Contains(unavailable.Error(), "receivables_unavailable") {
		t.Fatal("uninstalled subset did not fail closed", unavailable)
	}
	for _, v := range domaininstall.W1Tables("w1-migration-ledger") {
		if _, e := db.Exec(v.DDL); e != nil {
			t.Fatal(e)
		}
	}
	b, e := domaininstall.WithW1(s.binding, "w1-migration-ledger", "host-test")
	if e != nil {
		t.Fatal(e)
	}
	b, e = domaininstall.WithFinanceReceivables(b)
	if e != nil {
		t.Fatal(e)
	}
	install := domaininstall.ForFinanceReceivables(domaininstall.Expectation{Tenant: b.Key.Tenant, Environment: b.Key.Environment, OwnerDeployment: "host-test", Address: b.Storage.Address})
	plan, e := install.PlanInstall(ctx, db, b)
	if e != nil {
		t.Fatal(e)
	}
	var receipt domaininstall.Receipt
	off := func(context.Context) error { return nil }
	if e = install.Apply(ctx, db, plan, off, func(r domaininstall.Receipt) error { receipt = r; return nil }); e != nil {
		t.Fatal(e)
	}
	if e = install.VerifyReceipt(ctx, db, receipt); e != nil || len(receipt.Created) != 3 {
		t.Fatal(receipt, e)
	}
	if _, e = db.Exec("INSERT INTO finance_receivable_adjustment(code,contract_id,billing_schedule_id,contract_code,billing_schedule_code,currency_code,adjustment_type,amount,reason,entered_by) VALUES('A1',1,1,'CT1','BS1','CNY','bad_debt',1,'Marked','maker')"); e != nil {
		t.Fatal(e)
	}
	if install.Rollback(ctx, db, receipt, off) == nil {
		t.Fatal("nonempty rollback")
	}
	if _, e = db.Exec("DELETE FROM finance_receivable_adjustment"); e != nil {
		t.Fatal(e)
	}
	if e = install.Rollback(ctx, db, receipt, off); e != nil {
		t.Fatal(e)
	}
	var n int
	if e = db.QueryRow("SELECT COUNT(*) FROM finance_receipt").Scan(&n); e != nil {
		t.Fatal("base ledger changed", e)
	}
}
func TestB5BConcurrentCapacityAndTargetScopeMySQL(t *testing.T) {
	s, db := financeReceivablesFixture(t)
	ctx := context.Background()
	scope := altoc.BasicReadScope{Access: "all"}
	for _, code := range []string{"R1", "R2"} {
		if _, e := db.Exec("INSERT INTO finance_receipt(code,customer_code,currency_code,received_amount,received_at,bank_account_id,reconciliation_responsible_uid,reconciliation_due_at,status,confirmed_by,created_by) VALUES(?,'C1','CNY',100,NOW(),1,'reviewer',NOW(),'confirmed','cashier','maker')", code); e != nil {
			t.Fatal(e)
		}
	}
	run := func(receipt, key string, access altoc.BasicReadScope) error {
		who := Identity{Tenant: s.binding.Key.Tenant, Deployment: "host-test", Client: "enterprise.runtime", Actor: "reviewer", Key: key}
		_, e := s.FinanceLedger(ctx, "reconciliation-allocate-batch", FinanceInput{Code: receipt, Payload: map[string]any{"receiptVersion": 1, "items": []any{map[string]any{"contractCode": "CT1", "billingScheduleCode": "BS1", "scheduleVersion": 1, "amount": "60.00"}}}}, who, access)
		return e
	}
	if _, e := db.Exec("UPDATE finance_receipt SET bank_account_id=2 WHERE code='R1'"); e != nil {
		t.Fatal(e)
	}
	if run("R1", "wrongentity", scope) == nil {
		t.Fatal("cross legal entity accepted")
	}
	if _, e := db.Exec("UPDATE finance_receipt SET bank_account_id=1 WHERE code='R1'"); e != nil {
		t.Fatal(e)
	}
	if run("R1", "denied", altoc.BasicReadScope{Access: "none"}) == nil {
		t.Fatal("scope bypass")
	}
	errors := make(chan error, 2)
	go func() { errors <- run("R1", "concurrent1", scope) }()
	go func() { errors <- run("R2", "concurrent2", scope) }()
	success := 0
	for n := 0; n < 2; n++ {
		if <-errors == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatal("concurrent capacity", success)
	}
	var amount string
	if e := db.QueryRow("SELECT CAST(SUM(reconciled_amount) AS CHAR) FROM finance_reconciliation WHERE status='active'").Scan(&amount); e != nil || amount != "60.00" {
		t.Fatal(amount, e)
	}
	if _, e := db.Exec("UPDATE finance_receipt SET customer_code='other' WHERE code='R2'"); e != nil {
		t.Fatal(e)
	}
	if run("R2", "wrongcustomer", scope) == nil {
		t.Fatal("cross customer accepted")
	}
	if _, e := db.Exec("UPDATE finance_receipt SET customer_code='C1',currency_code='USD' WHERE code='R2'"); e != nil {
		t.Fatal(e)
	}
	if run("R2", "wrongcurrency", scope) == nil {
		t.Fatal("cross currency accepted")
	}
}

func TestB5BAdjustmentAllocationRaceMySQL(t *testing.T) {
	s, db := financeReceivablesFixture(t)
	ctx := context.Background()
	scope := altoc.BasicReadScope{Access: "all"}
	run := func(op, code, key, actor string, payload map[string]any) (any, error) {
		return s.FinanceLedger(ctx, op, FinanceInput{Code: code, Payload: payload}, Identity{Tenant: s.binding.Key.Tenant, Deployment: "host-test", Client: "enterprise.runtime", Actor: actor, Key: key}, scope)
	}
	if _, e := db.Exec("INSERT INTO finance_receipt(code,customer_code,currency_code,received_amount,received_at,bank_account_id,reconciliation_responsible_uid,reconciliation_due_at,status,confirmed_by,created_by) VALUES('R1','C1','CNY',100,NOW(),1,'reviewer',NOW(),'confirmed','cashier','maker')"); e != nil {
		t.Fatal(e)
	}
	out, e := run("receivable-adjustments-create", "", "draft", "maker", map[string]any{"contractCode": "CT1", "billingScheduleCode": "BS1", "scheduleVersion": 1, "adjustmentType": "discount", "amount": "60.00", "reason": "Synthetic race"})
	if e != nil {
		t.Fatal(e)
	}
	code := ledgerText(out.(map[string]any)["data"].(map[string]any)["code"])
	result := make(chan error, 2)
	go func() {
		_, e := run("receivable-adjustments-confirm", code, "confirm", "director", map[string]any{"expectedVersion": 1})
		result <- e
	}()
	go func() {
		_, e := run("reconciliation-allocate-batch", "R1", "allocate", "reviewer", map[string]any{"receiptVersion": 1, "items": []any{map[string]any{"contractCode": "CT1", "billingScheduleCode": "BS1", "scheduleVersion": 1, "amount": "60.00"}}})
		result <- e
	}()
	successes := 0
	for n := 0; n < 2; n++ {
		if <-result == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatal("race allowed negative outstanding", successes)
	}
	var remaining string
	if e := db.QueryRow("SELECT CAST(b.amount-(SELECT COALESCE(SUM(reconciled_amount),0) FROM finance_reconciliation WHERE billing_schedule_code=b.code AND status='active')-(SELECT COALESCE(SUM(amount),0) FROM finance_receivable_adjustment WHERE billing_schedule_id=b.id AND status='confirmed') AS CHAR) FROM altoc_billing_schedule b WHERE code='BS1'").Scan(&remaining); e != nil || remaining != "40.00" {
		t.Fatal(remaining, e)
	}
}
