package enterpriseapf

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"strings"
	"sync"
	"testing"
)

func TestAPF13bSettingsMySQL(t *testing.T) {
	s, db := financeSpendFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "manager", Tenant: s.binding.Key.Tenant, Deployment: "host-test", Client: "enterprise.runtime", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "all"}
	run := func(op, code, key string, p map[string]any) map[string]any {
		t.Helper()
		who.Key = key
		out, e := s.FinanceLedger(ctx, op, FinanceInput{Code: code, Payload: p}, who, scope)
		if e != nil {
			t.Fatal(op, e)
		}
		return out.(map[string]any)["data"].(map[string]any)
	}
	subject := run("subjects-create", "", "subject", map[string]any{"code": "6001", "name": "Marked cost", "subjectType": "cost"})
	sid := float64(ledgerVersion(subject["id"]))
	run("subjects-create", "", "subject", map[string]any{"code": "6001", "name": "Marked cost", "subjectType": "cost"})
	for _, kind := range []string{"expense-types", "income-types", "accounting-objects", "subject-mappings"} {
		p := map[string]any{"code": "MARKED13B", "name": "Marked"}
		if kind == "expense-types" || kind == "income-types" {
			p["defaultSubjectId"] = sid
		}
		if kind == "accounting-objects" {
			p["objectType"] = "other"
		}
		if kind == "subject-mappings" {
			p = map[string]any{"bizType": "payment", "defaultSubjectCode": "6001", "objectStrategy": "manual", "requiredDimensions": []any{"project"}}
		}
		row := run(kind+"-create", "", kind, p)
		code := ledgerText(row["code"])
		if code == "" {
			code = ledgerText(row["id"])
		}
		run(kind+"-create", "", kind, p)
		version := float64(ledgerVersion(row["row_version"]))
		update := map[string]any{"expectedVersion": version, "status": "inactive"}
		row = run(kind+"-update", code, kind+"-update", update)
		if row["status"] != "inactive" {
			t.Fatal(row)
		}
		run(kind+"-update", code, kind+"-update", update)
		who.Key = kind + "-stale"
		if _, e := s.FinanceLedger(ctx, kind+"-update", FinanceInput{Code: code, Payload: update}, who, scope); e == nil {
			t.Fatal("stale CAS")
		}
		out, e := s.FinanceLedger(ctx, kind+"-page", FinanceInput{Code: code, Page: 1, PageSize: 1}, who, scope)
		if e != nil || out.(map[string]any)["total"] != int64(1) {
			t.Fatal("exact row", kind, out, e)
		}
	}
	for _, kind := range []string{"subjects", "expense-types", "income-types", "subject-mappings", "accounting-objects", "audit-logs", "approval-instances"} {
		out, e := s.FinanceLedger(ctx, kind+"-page", FinanceInput{Page: 1, PageSize: 1}, who, scope)
		if e != nil {
			t.Fatal(kind, e)
		}
		rows := out.(map[string]any)["data"].([]map[string]any)
		if len(rows) > 1 {
			t.Fatal("pagination")
		}
		if kind == "audit-logs" {
			for _, r := range rows {
				for _, key := range []string{"new_value", "old_value", "request_id", "command"} {
					if _, ok := r[key]; ok {
						t.Fatal("sensitive audit payload", key)
					}
				}
			}
		}
		if _, e = s.FinanceLedger(ctx, kind+"-page", FinanceInput{Page: 1, PageSize: 1}, who, altoc.BasicReadScope{Access: "self"}); e == nil {
			t.Fatal("settings self scope")
		}
	}
	who.Key = "bad-reference"
	if _, e := s.FinanceLedger(ctx, "expense-types-create", FinanceInput{Payload: map[string]any{"code": "BAD", "name": "Bad", "defaultSubjectId": float64(999999)}}, who, scope); e == nil {
		t.Fatal("missing subject")
	}
	if _, e := db.Exec("CREATE TRIGGER apf13b_audit_fault BEFORE INSERT ON finance_audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated fault'"); e != nil {
		t.Fatal(e)
	}
	who.Key = "audit-fault"
	if _, e := s.FinanceLedger(ctx, "subjects-create", FinanceInput{Payload: map[string]any{"code": "ROLLBACK", "name": "Rollback", "subjectType": "cost"}}, who, scope); e == nil {
		t.Fatal("audit fault")
	}
	if _, e := db.Exec("DROP TRIGGER apf13b_audit_fault"); e != nil {
		t.Fatal(e)
	}
	var count int
	if e := db.QueryRow("SELECT COUNT(*) FROM finance_subject WHERE code='ROLLBACK'").Scan(&count); e != nil || count != 0 {
		t.Fatal("write rollback", e, count)
	}
	parent := run("subjects-create", "", "parent", map[string]any{"code": "PARENT", "name": "Parent", "subjectType": "cost", "parentId": sid})
	who.Key = "cycle"
	if _, e := s.FinanceLedger(ctx, "subjects-update", FinanceInput{Code: "6001", Payload: map[string]any{"parentId": float64(ledgerVersion(parent["id"])), "expectedVersion": float64(1)}}, who, scope); e == nil {
		t.Fatal("hierarchy cycle")
	}
}
func TestAPF13bInstallerMySQL(t *testing.T) {
	s, db := financeSpendFixture(t)
	ctx := context.Background()
	b := s.binding
	d := b.Domains["finance"]
	delete(d.Tables, "finance_payment_request")
	b.Domains["finance"] = d
	if _, e := db.Exec("DROP TABLE finance_payment_request"); e != nil {
		t.Fatal(e)
	}
	b, e := domaininstall.WithFinance13b(b)
	if e != nil {
		t.Fatal(e)
	}
	installer := domaininstall.ForFinance13b(domaininstall.Expectation{Tenant: b.Key.Tenant, Environment: b.Key.Environment, OwnerDeployment: "host-test", Address: b.Storage.Address})
	plan, e := installer.PlanInstall(ctx, db, b)
	if e != nil {
		t.Fatal(e)
	}
	var receipt domaininstall.Receipt
	save := func(r domaininstall.Receipt) error { receipt = r; return nil }
	off := func(context.Context) error { return nil }
	if e = installer.Apply(ctx, db, plan, off, save); e != nil {
		t.Fatal(e)
	}
	if e = installer.VerifyReceipt(ctx, db, receipt); e != nil {
		t.Fatal(e)
	}
	if len(receipt.Created) != 1 {
		t.Fatal("subset")
	}
	if _, e = db.Exec("INSERT INTO finance_payment_request(code,title,payment_type,applicant_uid,payee_name,requested_amount)VALUES('MARKED','Marked','other','maker','Marked',1.00)"); e != nil {
		t.Fatal(e)
	}
	if installer.Rollback(ctx, db, receipt, off) == nil {
		t.Fatal("nonempty rollback")
	}
	db.Exec("DELETE FROM finance_payment_request WHERE code='MARKED'")
	if e = installer.Rollback(ctx, db, receipt, off); e != nil {
		t.Fatal(e)
	}
}

func TestAPF13bPaymentConcurrentConfirmationMySQL(t *testing.T) {
	s, db := financeSpendFixture(t)
	ctx := context.Background()
	scope := altoc.BasicReadScope{Access: "all"}
	who := Identity{Actor: "maker", Tenant: s.binding.Key.Tenant, Deployment: "host-test", Client: "enterprise.runtime", Key: "payment-concurrent", RequestID: "isolated"}
	out, e := s.FinanceLedger(ctx, "payment-requests-create", FinanceInput{Payload: map[string]any{"title": "Concurrent", "currencyCode": "CNY", "paymentType": "other", "payeeName": "Marked", "requestedAmount": "0.03"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	code := ledgerText(out.(map[string]any)["data"].(map[string]any)["code"])
	if _, e = db.Exec("UPDATE finance_payment_request SET payee_account_secret_ref='isolated-placeholder' WHERE code=?", code); e != nil {
		t.Fatal(e)
	}
	detail, e := s.FinanceLedger(ctx, "payment-requests-detail", FinanceInput{Code: code}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	if _, ok := detail.(map[string]any)["data"].(map[string]any)["payee_account_secret_ref"]; ok {
		t.Fatal("secret reference exposed")
	}

	if _, e = db.Exec("UPDATE finance_payment_request SET status='approved',workflow_instance_id='isolated-approved-prerequisite' WHERE code=?", code); e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, key := range []string{"one", "two"} {
		wg.Add(1)
		go func(key string) {
			defer wg.Done()
			u := who
			u.Actor = "cashier"
			u.Key = key
			_, e := s.FinanceLedger(ctx, "payment-requests-confirm", FinanceInput{Code: code, Payload: map[string]any{"expectedVersion": float64(1)}}, u, scope)
			results <- e
		}(key)
	}
	wg.Wait()
	close(results)
	success := 0
	for e := range results {
		if e == nil {
			success++
		}
	}
	var n int
	if e = db.QueryRow("SELECT COUNT(*) FROM finance_expense WHERE source_request_code=? AND expense_amount='0.03' AND confirmed_by='cashier'", code).Scan(&n); e != nil || n != 1 || success != 1 {
		t.Fatal("one ledger", success, n, e)
	}
}

func TestAPF13bPaymentIdentityWidthMySQL(t *testing.T) {
	s, _ := financeSpendFixture(t)
	who := Identity{Actor: strings.Repeat("u", 64), Tenant: s.binding.Key.Tenant, Deployment: "host-test", Client: "enterprise.runtime", Key: "uid-width", RequestID: "isolated"}
	out, e := s.FinanceLedger(context.Background(), "payment-requests-create", FinanceInput{Payload: map[string]any{"title": "Marked", "currencyCode": "CNY", "paymentType": "other", "payeeName": "Marked", "requestedAmount": "1.00"}}, who, altoc.BasicReadScope{Access: "self"})
	if e != nil {
		t.Fatal(e)
	}
	if out.(map[string]any)["data"].(map[string]any)["applicant_uid"] != who.Actor {
		t.Fatal("trusted UID width")
	}
}
