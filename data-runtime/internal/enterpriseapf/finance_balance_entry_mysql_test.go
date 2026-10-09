package enterpriseapf

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func balanceFixture(t *testing.T, subsets ...string) (*Service, *sql.DB) {
	t.Helper()
	s, db := financeFixture(t)
	ctx := context.Background()
	b := s.binding
	for _, name := range subsets {
		for _, table := range domaininstall.W1Tables(name) {
			if _, e := db.Exec(table.DDL); e != nil {
				t.Fatal(table.Logical, e)
			}
		}
		var e error
		if b, e = domaininstall.WithW1(b, name, "host-test"); e != nil {
			t.Fatal(name, e)
		}
	}
	registry := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e := registry.Register(ctx, b); e != nil {
		t.Fatal(e)
	}
	s, e := New(registry, b)
	if e != nil {
		t.Fatal(e)
	}
	return s, db
}

func TestAPFW3BalanceRegisterMySQL(t *testing.T) {
	// Not installed: the new commands are unavailable; existing reads are unchanged.
	bare, db := balanceFixture(t)
	ctx := context.Background()
	who := func(key string) Identity {
		return Identity{Actor: "cashier", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: key, RequestID: key}
	}
	refused := func(e error, status int, code string) {
		t.Helper()
		var he httperror.Error
		if !errors.As(e, &he) || he.Status != status || he.Code != code {
			t.Fatal("expected", status, code, "got", e)
		}
	}
	created, e := bare.Finance(ctx, "accounts-create", accountInput(), who("create"))
	if e != nil {
		t.Fatal(e)
	}
	code := created.(map[string]any)["data"].(map[string]any)["code"].(string)
	entry := func(date, amount string) FinanceInput {
		return FinanceInput{AccountCode: code, Payload: map[string]any{"balanceDate": date, "balanceAmount": amount, "note": nil}}
	}
	_, e = bare.FinanceBalanceEntryCreate(ctx, entry("2026-09-30", "100.00"), who("e0"))
	refused(e, 503, "finance_balance_entry_unavailable")
	_, e = bare.FinanceBalanceEntries(ctx, FinanceInput{AccountCode: code, StartDate: "2026-09-30", Page: 1, PageSize: 20}, who(""))
	refused(e, 503, "finance_balance_entry_unavailable")
	if _, e = db.Exec("ALTER TABLE finance_account_balance_snapshot DROP COLUMN entry_count, DROP COLUMN latest_tie_count, DROP COLUMN distinct_amounts"); e != nil {
		t.Fatal(e)
	}
	listed, e := bare.Finance(ctx, "balances-list", FinanceInput{Page: 1, PageSize: 20}, who(""))
	if e != nil || listed.(map[string]any)["total"] != int64(0) {
		t.Fatal("existing balance list changed", listed, e)
	}
	accounts, e := bare.Finance(ctx, "accounts-list", FinanceInput{Page: 1, PageSize: 20}, who(""))
	if e != nil || accounts.(map[string]any)["data"].([]map[string]any)[0]["latest_balance_amount"] != nil || len(accounts.(map[string]any)["balanceTotals"].([]map[string]any)) != 0 {
		t.Fatal("account without a balance must not show zero", accounts, e)
	}

	s, db := balanceFixture(t, "w1-finance-legal-entity", "w1-finance-balance-entry")
	for _, q := range []string{
		"INSERT INTO finance_legal_entity(code,name) VALUES('ENT-W000001','Marked entity')",
		"INSERT INTO finance_bank_account(id,code,account_name,account_type,currency_code,legal_entity_code,status) VALUES(1,'BA-1','main','bank','CNY','ENT-W000001','active'),(2,'BA-2','loan','bank','CNY','ENT-W000001','active'),(3,'BA-3','usd','bank','USD',NULL,'active'),(4,'BA-4','closed','bank','CNY',NULL,'closed'),(5,'BA-5','no balance','bank','CNY','ENT-W000001','active')",
	} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	register := func(key, account, date, amount string) (map[string]any, error) {
		v, e := s.FinanceBalanceEntryCreate(ctx, FinanceInput{AccountCode: account, Payload: map[string]any{"balanceDate": date, "balanceAmount": amount, "note": nil}}, who(key))
		if e != nil {
			return nil, e
		}
		return v.(map[string]any)["data"].(map[string]any), nil
	}
	out, e := register("k1", "BA-1", "2026-09-30", "100.00")
	if e != nil || out["day_balance_amount"] != "100.00" || out["entry_count"] != int64(1) || out["latest_tie_count"] != int64(1) || out["distinct_amounts"] != int64(1) {
		t.Fatal("first registration", out, e)
	}
	// Registering again the same day keeps the history and moves the shown value.
	out, e = register("k2", "BA-1", "2026-09-30", "120.50")
	if e != nil || out["day_balance_amount"] != "120.50" || out["entry_count"] != int64(2) || out["latest_tie_count"] != int64(1) || out["distinct_amounts"] != int64(2) {
		t.Fatal("second registration", out, e)
	}
	// Same key: the first result again, no third entry.
	again, e := register("k2", "BA-1", "2026-09-30", "120.50")
	if e != nil || again["id"] != out["id"] || again["entry_count"] != int64(2) {
		t.Fatal("replay", again, e)
	}
	_, e = register("k2", "BA-1", "2026-09-30", "999.00")
	refused(e, 409, "finance_idempotency_conflict")
	// Correcting back to an earlier amount is a new entry, not a tie.
	out, e = register("k3", "BA-1", "2026-09-30", "100.00")
	if e != nil || out["day_balance_amount"] != "100.00" || out["entry_count"] != int64(3) || out["latest_tie_count"] != int64(1) || out["distinct_amounts"] != int64(2) {
		t.Fatal("third registration", out, e)
	}
	var snapshots, latest int
	if e = db.QueryRow("SELECT (SELECT COUNT(*) FROM finance_account_balance_snapshot WHERE bank_account_id=1 AND snapshot_date='2026-09-30'),(SELECT COUNT(*) FROM finance_account_balance_entry WHERE bank_account_id=1 AND is_day_latest=1)").Scan(&snapshots, &latest); e != nil || snapshots != 1 || latest != 1 {
		t.Fatal("one snapshot and one latest entry per day", snapshots, latest, e)
	}
	v, e := s.FinanceBalanceEntries(ctx, FinanceInput{AccountCode: "BA-1", StartDate: "2026-09-30", Page: 1, PageSize: 20}, who(""))
	if e != nil {
		t.Fatal(e)
	}
	entries := v.(map[string]any)["data"].([]map[string]any)
	if v.(map[string]any)["total"] != int64(3) || entries[0]["balance_amount"] != "100.00" || entries[0]["is_day_latest"] != true || entries[1]["is_day_latest"] != false || entries[0]["recorded_by"] != "cashier" || entries[0]["entry_source"] != "manual" {
		t.Fatal("entries", entries)
	}

	// Signed amounts, other accounts and days.
	if out, e = register("k4", "BA-2", "2026-09-30", "-5000.00"); e != nil || out["day_balance_amount"] != "-5000.00" {
		t.Fatal("negative balance", out, e)
	}
	if _, e = register("k5", "BA-1", "2026-10-01", "200.00"); e != nil {
		t.Fatal(e)
	}
	if _, e = register("k6", "BA-3", "2026-09-30", "7.00"); e != nil {
		t.Fatal(e)
	}
	_, e = register("k7", "BA-4", "2026-09-30", "1.00")
	refused(e, 409, "finance_account_closed")
	_, e = register("k8", "BA-1", "2999-01-01", "1.00")
	refused(e, 409, "finance_balance_date_invalid")
	_, e = register("k9", "BA-missing", "2026-09-30", "1.00")
	refused(e, 404, "finance_object_not_found")
	for name, in := range map[string]FinanceInput{
		"no amount":      {AccountCode: "BA-1", Payload: map[string]any{"balanceDate": "2026-09-30"}},
		"number amount":  {AccountCode: "BA-1", Payload: map[string]any{"balanceDate": "2026-09-30", "balanceAmount": float64(1)}},
		"three decimals": {AccountCode: "BA-1", Payload: map[string]any{"balanceDate": "2026-09-30", "balanceAmount": "1.001"}},
		"bare minus":     {AccountCode: "BA-1", Payload: map[string]any{"balanceDate": "2026-09-30", "balanceAmount": "-"}},
		"source":         {AccountCode: "BA-1", Payload: map[string]any{"balanceDate": "2026-09-30", "balanceAmount": "1.00", "entrySource": "import"}},
		"recorded at":    {AccountCode: "BA-1", Payload: map[string]any{"balanceDate": "2026-09-30", "balanceAmount": "1.00", "recordedAt": "2020-01-01 00:00:00"}},
		"bad date":       {AccountCode: "BA-1", Payload: map[string]any{"balanceDate": "2026-13-01", "balanceAmount": "1.00"}},
	} {
		if _, e = s.FinanceBalanceEntryCreate(ctx, in, who("bad-"+name)); e == nil {
			t.Fatal(name)
		}
	}
	if _, e = s.FinanceBalanceEntryCreate(ctx, entry("2026-09-30", "1.00"), who("")); e == nil {
		t.Fatal("registration without idempotency key")
	}

	// Snapshot list carries the day's registration facts.
	listed, e = s.Finance(ctx, "balances-list", FinanceInput{Page: 1, PageSize: 20, AccountCode: "BA-1", StartDate: "2026-09-30", EndDate: "2026-09-30"}, who(""))
	if e != nil {
		t.Fatal(e)
	}
	row := listed.(map[string]any)["data"].([]map[string]any)[0]
	if row["balance_amount"] != "100.00" || fmt.Sprint(row["entry_count"]) != "3" || fmt.Sprint(row["distinct_amounts"]) != "2" {
		t.Fatal("snapshot row", row)
	}

	// Account list: latest balance per account, totals per entity and currency over
	// the whole filtered result; an account without a balance shows none, not zero.
	accounts, e = s.Finance(ctx, "accounts-list", FinanceInput{Page: 1, PageSize: 2}, who(""))
	if e != nil {
		t.Fatal(e)
	}
	page := accounts.(map[string]any)
	items := page["data"].([]map[string]any)
	if page["total"] != int64(5) || len(items) != 2 || items[0]["latest_balance_amount"] != "200.00" || items[0]["latest_balance_date"] != "2026-10-01" || items[1]["latest_balance_amount"] != "-5000.00" {
		t.Fatal("account page", items)
	}
	totals := map[string]string{}
	for _, total := range page["balanceTotals"].([]map[string]any) {
		totals[fmt.Sprint(total["legal_entity_code"], "/", total["currency_code"])] = fmt.Sprint(total["amount"], "/", total["account_count"])
	}
	if len(totals) != 2 || totals["ENT-W000001/CNY"] != "-4800.00/2" || totals["<nil>/USD"] != "7.00/1" {
		t.Fatal("totals", totals)
	}
	second, e := s.Finance(ctx, "accounts-list", FinanceInput{Page: 3, PageSize: 2}, who(""))
	if e != nil || second.(map[string]any)["data"].([]map[string]any)[0]["latest_balance_amount"] != nil || fmt.Sprint(second.(map[string]any)["balanceTotals"]) != fmt.Sprint(page["balanceTotals"]) {
		t.Fatal("totals depend on the page, or a missing balance shows a value", second, e)
	}
	filtered, e := s.Finance(ctx, "accounts-list", FinanceInput{Page: 1, PageSize: 20, Search: "usd"}, who(""))
	if e != nil || len(filtered.(map[string]any)["balanceTotals"].([]map[string]any)) != 1 {
		t.Fatal("totals ignore the filter", filtered, e)
	}

	// An imported day whose latest entries disagree cannot be decided by the rule.
	if _, e = db.Exec("INSERT INTO finance_account_balance_entry(bank_account_id,balance_date,balance_amount,entry_source,recorded_at,entry_ref) VALUES(5,'2026-09-01',1.00,'import','2026-09-02 08:00:00',1),(5,'2026-09-01',2.00,'import','2026-09-02 08:00:00',2)"); e != nil {
		t.Fatal(e)
	}
	tx, e := db.Begin()
	if e != nil {
		t.Fatal(e)
	}
	e = refreshBalanceDay(ctx, tx, balanceTables{entry: "finance_account_balance_entry", snapshot: "finance_account_balance_snapshot"}, 5, "2026-09-01", "import", "CNY", "tool")
	tx.Rollback()
	refused(e, 409, "finance_balance_latest_conflict")
}

// The registration permission is bank_accounts:edit and reaches nothing else.
func TestW3BalanceRegisterPermissionIsNarrow(t *testing.T) {
	for op, action := range map[string]string{"balance-entries-list": "view", "balance-entries-create": "edit", "accounts-create": "admin", "accounts-update": "admin", "accounts-reveal-account-no": "reveal-account-no", "accounts-list": "view"} {
		if r, a, ok := FinancePermission(op); !ok || r != "bank_accounts" || a != action {
			t.Fatal(op, r, a)
		}
	}
	// Only the registration command asks for edit.
	edits := 0
	for _, op := range []string{"accounts-list", "accounts-view", "accounts-create", "accounts-update", "accounts-reveal-account-no", "balances-list", "balance-entries-list", "balance-entries-create", "legal-entities-create", "legal-entities-update"} {
		if r, a, _ := FinancePermission(op); r == "bank_accounts" && a == "edit" {
			edits++
		}
	}
	if edits != 1 {
		t.Fatal("bank_accounts:edit reaches more than balance registration", edits)
	}
	// A registration payload cannot carry account fields.
	for _, field := range []string{"accountName", "accountNoSecretRef", "status", "legalEntityCode", "reason"} {
		if ValidateFinanceInput("balance-entries-create", FinanceInput{AccountCode: "BA-1", Payload: map[string]any{"balanceDate": "2026-09-30", "balanceAmount": "1.00", field: "x"}}) == nil {
			t.Fatal(field)
		}
	}
}

// Balance items of the migration queue are settled with one manual registration.
func TestAPFW3MigrationRecordBalanceMySQL(t *testing.T) {
	s, db := balanceFixture(t, "w1-finance-balance-entry", "w1-migration-ledger")
	ctx := context.Background()
	for _, q := range []string{
		"INSERT INTO finance_bank_account(id,code,account_name,account_type,currency_code,status) VALUES(1,'BA-W000001','main','bank','CNY','active'),(2,'BA-W000002','other','bank','CNY','active')",
		"INSERT INTO mig_batch(id,batch_code,source_system,source_snapshot,scope_json,plan_sha256,status,operator) VALUES(1,'W1','wizbiz','snapshot','{}',REPEAT('0',64),'applied','tool')",
		`INSERT INTO mig_exception(id,batch_id,owning_domain,kind,source_table,source_pk,target_table,target_key,detail_json) VALUES
			(1,1,'finance','balance_without_account','wb_account_balance','date:2024-01-31',NULL,NULL,'{"balanceDate":"2024-01-31","entryCount":"3","latestAmounts":["100.00","-250.50"],"sourceEntryIds":["1","2","3"]}'),
			(2,1,'finance','balance_latest_conflict','wb_account_balance','account:2|date:2024-02-01','finance_bank_account','BA-W000002','{"balanceDate":"2024-02-01","latestAmounts":["7.00","8.00"],"sourceEntryIds":["4","5"]}'),
			(3,1,'finance','contract_balance_mismatch','wb_contract','3','altoc_contract','CT-W000003','{"recomputedAmount":"10.00","cachedAmount":"12.00","difference":"2.00"}')`,
	} {
		if _, e := db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	resolve := func(key string, i MigrationResolveInput) (map[string]any, error) {
		v, e := s.MigrationResolve(ctx, "finance", i, Identity{Actor: "finance-admin", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: key, RequestID: key})
		if e != nil {
			return nil, e
		}
		return v.(map[string]any)["data"].(map[string]any), nil
	}
	refused := func(e error, status int, code string) {
		t.Helper()
		var he httperror.Error
		if !errors.As(e, &he) || he.Status != status || he.Code != code {
			t.Fatal("expected", status, code, "got", e)
		}
	}
	// The amount must be one the item lists; the account is required when the item has none.
	_, e := resolve("a", MigrationResolveInput{ID: "1", ExpectedVersion: 1, Method: "record_balance", AccountCode: "BA-W000001", Amount: "999.00"})
	refused(e, 409, "migration_balance_amount_invalid")
	_, e = resolve("b", MigrationResolveInput{ID: "1", ExpectedVersion: 1, Method: "record_balance", Amount: "100.00"})
	refused(e, 400, "migration_queue_input_invalid")
	_, e = resolve("c", MigrationResolveInput{ID: "1", ExpectedVersion: 1, Method: "record_balance", AccountCode: "BA-missing", Amount: "100.00"})
	refused(e, 404, "finance_object_not_found")
	var entries int
	var status string
	if e = db.QueryRow("SELECT (SELECT COUNT(*) FROM finance_account_balance_entry),(SELECT status FROM mig_exception WHERE id=1)").Scan(&entries, &status); e != nil || entries != 0 || status != "open" {
		t.Fatal("refused command left a trace", entries, status, e)
	}
	out, e := resolve("claim", MigrationResolveInput{ID: "1", ExpectedVersion: 1, Method: "record_balance", AccountCode: "BA-W000001", Amount: "-250.50"})
	if e != nil || out["status"] != "resolved" || out["accountCode"] != "BA-W000001" {
		t.Fatal("claim", out, e)
	}
	var amount, date, source, by string
	if e = db.QueryRow("SELECT CAST(balance_amount AS CHAR),CAST(balance_date AS CHAR),entry_source,recorded_by FROM finance_account_balance_entry WHERE bank_account_id=1").Scan(&amount, &date, &source, &by); e != nil || amount != "-250.50" || date != "2024-01-31" || source != "manual" || by != "finance-admin" {
		t.Fatal("registered entry", amount, date, source, by, e)
	}
	if e = db.QueryRow("SELECT CAST(balance_amount AS CHAR) FROM finance_account_balance_snapshot WHERE bank_account_id=1 AND snapshot_date='2024-01-31' AND source_type='manual'").Scan(&amount); e != nil || amount != "-250.50" {
		t.Fatal("snapshot", amount, e)
	}
	// Replay: same answer, still one entry.
	if out, e = resolve("claim", MigrationResolveInput{ID: "1", ExpectedVersion: 1, Method: "record_balance", AccountCode: "BA-W000001", Amount: "-250.50"}); e != nil || out["status"] != "resolved" {
		t.Fatal("replay", out, e)
	}
	if e = db.QueryRow("SELECT COUNT(*) FROM finance_account_balance_entry").Scan(&entries); e != nil || entries != 1 {
		t.Fatal("entries after replay", entries, e)
	}
	_, e = resolve("again", MigrationResolveInput{ID: "1", ExpectedVersion: 2, Method: "record_balance", AccountCode: "BA-W000001", Amount: "100.00"})
	refused(e, 409, "migration_exception_state_conflict")

	// A conflict item already names its account.
	_, e = resolve("d", MigrationResolveInput{ID: "2", ExpectedVersion: 1, Method: "record_balance", AccountCode: "BA-W000001", Amount: "7.00"})
	refused(e, 409, "migration_balance_account_invalid")
	if out, e = resolve("decide", MigrationResolveInput{ID: "2", ExpectedVersion: 1, Method: "record_balance", Amount: "8.00"}); e != nil || out["accountCode"] != "BA-W000002" || out["amount"] != "8.00" {
		t.Fatal("decide", out, e)
	}
	if e = db.QueryRow("SELECT CAST(balance_amount AS CHAR) FROM finance_account_balance_snapshot WHERE bank_account_id=2 AND snapshot_date='2024-02-01'").Scan(&amount); e != nil || amount != "8.00" {
		t.Fatal("decided snapshot", amount, e)
	}
	// Read-only kinds and the other domain stay closed.
	_, e = resolve("e", MigrationResolveInput{ID: "3", ExpectedVersion: 1, Method: "record_balance", AccountCode: "BA-W000001", Amount: "10.00"})
	refused(e, 409, "migration_exception_method_not_applicable")
	if _, e = s.MigrationResolve(ctx, "altoc", MigrationResolveInput{ID: "1", ExpectedVersion: 2, Method: "record_balance", AccountCode: "BA-W000001", Amount: "100.00"}, Identity{Actor: "x", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "k"}); e == nil {
		t.Fatal("Altoc recorded a balance")
	}
	if _, e = resolve("f", MigrationResolveInput{ID: "3", ExpectedVersion: 1, Method: "accept", AccountCode: "BA-W000001"}); e == nil {
		t.Fatal("account accepted on another method")
	}
	var audits int
	if e = db.QueryRow("SELECT (SELECT COUNT(*) FROM finance_audit_log WHERE entity_type='migration_exception' AND action='record_balance')*10+(SELECT COUNT(*) FROM finance_audit_log WHERE action='balance_entry')").Scan(&audits); e != nil || audits != 22 {
		t.Fatal("audits", audits, e)
	}
}
