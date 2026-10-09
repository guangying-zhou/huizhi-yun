package enterpriseapf

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
)

func financeLedgerFixture(t *testing.T) (*Service, *sql.DB) {
	s, db := financeFixture(t)
	ctx := context.Background()
	db.SetMaxOpenConns(1)
	if _, e := db.Exec("SET FOREIGN_KEY_CHECKS=0"); e != nil {
		t.Fatal(e)
	}
	tables, _ := domaininstall.APFTables("altoc")
	for _, v := range tables {
		if _, e := db.Exec(v.DDL); e != nil {
			t.Fatal(v.Logical, e)
		}
	}
	if _, e := db.Exec("SET FOREIGN_KEY_CHECKS=1"); e != nil {
		t.Fatal(e)
	}
	for _, v := range domaininstall.FinanceB3Tables() {
		if _, e := db.Exec(v.DDL); e != nil {
			t.Fatal(v.Logical, e)
		}
	}
	db.SetMaxOpenConns(8)
	b, e := domaininstall.WithFinanceB3(s.binding)
	if e != nil {
		t.Fatal(e)
	}
	d := b.Domains["altoc"]
	d.Write = enterprise.PathUnified
	b.Domains["altoc"] = d
	registry := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e = registry.Register(ctx, b); e != nil {
		t.Fatal(e)
	}
	s, e = New(registry, b)
	if e != nil {
		t.Fatal(e)
	}
	for _, q := range []string{"INSERT INTO altoc_customer(id,code,name,owner_uid) VALUES(1,'C1','Marked customer','maker')", "INSERT INTO altoc_contract(id,code,name,customer_id,owner_uid,legal_status,amount_tax_inclusive) VALUES(1,'CT1','Marked contract',1,'maker','effective',100.00)", "INSERT INTO altoc_billing_schedule(id,code,contract_id,name,trigger_type,amount,status,billable_at) VALUES(1,'BS1',1,'Marked plan','manual',100.00,'billable',NOW())"} {
		if _, e := db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	s.ConfigureOwnerDirectory(testOwnerDirectory)
	return s, db
}
func TestAPF11FinanceLedgerMySQL(t *testing.T) {
	s, db := financeLedgerFixture(t)
	ctx := context.Background()
	scope := altoc.BasicReadScope{Access: "all"}
	who := Identity{Actor: "maker", Tenant: s.binding.Key.Tenant, Deployment: "host-test", Client: "enterprise.runtime"}
	run := func(op, code, key, actor string, p map[string]any) map[string]any {
		t.Helper()
		u := who
		u.Actor = actor
		u.Key = key
		out, e := s.FinanceLedger(ctx, op, FinanceInput{Code: code, Payload: p}, u, scope)
		if e != nil {
			t.Fatal(op, e)
		}
		return out.(map[string]any)["data"].(map[string]any)
	}
	version := func(table, code string) float64 {
		t.Helper()
		var v int
		if e := db.QueryRow("SELECT row_version FROM "+table+" WHERE code=?", code).Scan(&v); e != nil {
			t.Fatal(e)
		}
		return float64(v)
	}
	if _, err := db.Exec("INSERT INTO altoc_customer_invoice_profile(code,customer_id,taxpayer_name,taxpayer_no) VALUES('PROFILE1',1,'Marked purchaser','MARKED-TAX')"); err != nil {
		t.Fatal(err)
	}
	req := run("invoice-requests-create", "", "request", "maker", map[string]any{"customerCode": "C1", "contractCode": "CT1", "billingScheduleCode": "BS1", "requestedAmount": "100.00", "currencyCode": "CNY", "invoiceItem": "Marked work", "invoiceProfileCode": "PROFILE1", "taxpayerName": "Spoofed"})
	if req["taxpayer_name"] != "Marked purchaser" {
		t.Fatal("profile snapshot not owning")
	}
	code := ledgerText(req["code"])
	run("invoice-requests-update", code, "update-request", "maker", map[string]any{"expectedVersion": version("finance_invoice_request", code), "remark": "Updated draft"})
	run("invoice-requests-detail", code, "", "maker", nil)

	// APF-11b is not installed: fixture seeds approved prerequisite, no production approve entry.
	if _, e := db.Exec("UPDATE finance_invoice_request SET status='approved',workflow_instance_id='fixture-approved',requested_by='maker' WHERE code=?", code); e != nil {
		t.Fatal(e)
	}
	run("invoice-requests-assign-issuance", code, "assign", "issuer", map[string]any{"expectedVersion": version("finance_invoice_request", code), "responsibleUid": "issuer", "dueAt": "2026-10-10 00:00:00"})
	for _, actor := range []string{"maker", "other"} {
		u := who
		u.Actor = actor
		u.Key = "denied-file-" + actor
		_, err := s.FinanceLedger(ctx, "invoice-files-attach", FinanceInput{Payload: map[string]any{"attachmentPurpose": "issuance", "entityType": "finance_invoice_request", "entityCode": code, "fileKey": "finance/invoices/denied.pdf", "fileName": "denied.pdf", "mimeType": "application/pdf", "fileSize": float64(10), "fileSha256": strings.Repeat("c", 64)}}, u, scope)
		if err == nil {
			t.Fatal("non-responsible attachment accepted", actor)
		}
	}
	file := run("invoice-files-attach", "", "file", "issuer", map[string]any{"attachmentPurpose": "issuance", "entityType": "finance_invoice_request", "entityCode": code, "fileKey": "finance/invoices/marked.pdf", "fileName": "marked.pdf", "mimeType": "application/pdf", "fileSize": float64(10), "fileSha256": strings.Repeat("a", 64)})
	attachmentInput := FinanceInput{Payload: map[string]any{"attachmentPurpose": "issuance", "entityType": "finance_invoice_request", "entityCode": code, "fileKey": "finance/invoices/marked.pdf", "fileName": "marked.pdf", "mimeType": "application/pdf", "fileSize": float64(10), "fileSha256": strings.Repeat("a", 64)}}
	attachmentActor := who
	attachmentActor.Actor = "issuer"
	attachmentActor.Key = "file"
	attachmentReplay, attachmentErr := s.FinanceLedger(ctx, "invoice-files-attach", attachmentInput, attachmentActor, scope)
	if attachmentErr != nil || ledgerText(attachmentReplay.(map[string]any)["data"].(map[string]any)["code"]) != ledgerText(file["code"]) {
		t.Fatal("attachment original key replay", attachmentErr)
	}
	if _, err := db.Exec("UPDATE finance_invoice_request SET issuance_responsible_uid='other' WHERE code=?", code); err != nil {
		t.Fatal(err)
	}
	if _, err := s.FinanceLedger(ctx, "invoice-files-attach", attachmentInput, attachmentActor, scope); err == nil {
		t.Fatal("old issuer reused receipt after reassignment")
	}
	if _, err := db.Exec("UPDATE finance_invoice_request SET issuance_responsible_uid='issuer' WHERE code=?", code); err != nil {
		t.Fatal(err)
	}

	if file["file_key"] == nil {
		t.Fatal("file")
	}
	issue := map[string]any{"expectedVersion": version("finance_invoice_request", code), "invoiceNo": "MARKED-INV1", "invoiceDate": "2026-10-03", "invoiceFileKey": "finance/invoices/marked.pdf", "invoiceFileName": "marked.pdf", "invoiceFileMimeType": "application/pdf", "invoiceFileSize": float64(999)}
	same := who
	same.Key = "self-issue"
	if _, e := s.FinanceLedger(ctx, "invoice-requests-issue", FinanceInput{Code: code, Payload: issue}, same, scope); e == nil {
		t.Fatal("D01 accepted")
	}
	issued := run("invoice-requests-issue", code, "issue", "issuer", issue)
	if issued["status"] != "issued" {
		t.Fatal(issued)
	}
	replay := run("invoice-requests-issue", code, "issue", "issuer", issue)
	if replay["row_version"] != issued["row_version"] {
		t.Fatal("receipt replay")
	}
	var inv string
	if e := db.QueryRow("SELECT code FROM finance_invoice WHERE invoice_no='MARKED-INV1'").Scan(&inv); e != nil {
		t.Fatal(e)
	}
	run("invoices-update", inv, "update-invoice", "issuer", map[string]any{"expectedVersion": version("finance_invoice", inv), "remark": "Marked invoice remark"})
	run("invoice-files-read", ledgerText(file["code"]), "", "issuer", nil)
	receipt := run("receipts-create", "", "receipt", "cashier", map[string]any{"customerCode": "C1", "contractCode": "CT1", "billingScheduleCode": "BS1", "receivedAmount": "100.00", "currencyCode": "CNY", "receivedAt": "2026-10-03", "responsibleUid": "clerk", "dueAt": "2026-10-10 00:00:00"})
	rc := ledgerText(receipt["code"])
	if receipt["status"] != "draft" {
		t.Fatal("F03")
	}
	run("receipts-update", rc, "update-receipt", "cashier", map[string]any{"expectedVersion": version("finance_receipt", rc), "note": "Marked receipt"})
	if _, err := db.Exec("INSERT INTO finance_income_type(id,code,name) VALUES(1,'MARKED','Marked income')"); err != nil {
		t.Fatal(err)
	}
	run("receipts-classify", rc, "classify", "clerk", map[string]any{"expectedVersion": version("finance_receipt", rc), "incomeTypeId": float64(1), "note": "Marked classification"})
	allocation := func(amount string) map[string]any {
		return map[string]any{"receiptCode": rc, "invoiceCode": inv, "billingScheduleCode": "BS1", "reconciledAmount": amount, "currencyCode": "CNY", "receiptVersion": version("finance_receipt", rc), "invoiceVersion": version("finance_invoice", inv), "scheduleVersion": version("altoc_billing_schedule", "BS1")}
	}
	u := who
	u.Actor = "clerk"
	u.Key = "draft-reconcile"
	if _, e := s.FinanceLedger(ctx, "reconciliation-create", FinanceInput{Payload: allocation("10.00")}, u, scope); e == nil {
		t.Fatal("draft accepted")
	}
	run("receipts-confirm", rc, "confirm", "cashier", map[string]any{"expectedVersion": version("finance_receipt", rc)})
	u.Actor = "cashier"
	u.Key = "self-reconcile"
	if _, e := s.FinanceLedger(ctx, "reconciliation-create", FinanceInput{Payload: allocation("10.00")}, u, scope); e == nil {
		t.Fatal("D02 accepted")
	}
	p := allocation("40.00")
	first := run("reconciliation-create", "", "allocation1", "clerk", p)
	again := run("reconciliation-create", "", "allocation1", "clerk", p)
	if first["code"] != again["code"] {
		t.Fatal("duplicate allocation")
	}
	var received string
	db.QueryRow("SELECT received_amount FROM altoc_billing_schedule WHERE code='BS1'").Scan(&received)
	if received != "40.00" {
		t.Fatal("owning summary", received)
	}
	// Summary failure after owning mutations must roll back receipt, allocation and invoices.
	if _, e := db.Exec("CREATE TRIGGER fail_summary BEFORE UPDATE ON finance_contract_summary FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture rollback'"); e != nil {
		t.Fatal(e)
	}
	u.Actor = "clerk"
	u.Key = "rollback"
	if _, e := s.FinanceLedger(ctx, "reconciliation-create", FinanceInput{Payload: allocation("10.00")}, u, scope); e == nil {
		t.Fatal("failure swallowed")
	}
	db.Exec("DROP TRIGGER fail_summary")
	var count int
	db.QueryRow("SELECT COUNT(*) FROM finance_reconciliation").Scan(&count)
	if count != 1 {
		t.Fatal("partial mutation", count)
	}
	// Competing writers observe same versions: at most one 40 allocation succeeds.
	p = allocation("40.00")
	var wg sync.WaitGroup
	ok := make(chan bool, 2)
	for n := 0; n < 2; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			u := who
			u.Actor = "clerk"
			u.Key = fmt.Sprint("race", n)
			_, e := s.FinanceLedger(ctx, "reconciliation-create", FinanceInput{Payload: p}, u, scope)
			ok <- e == nil
		}(n)
	}
	wg.Wait()
	close(ok)
	success := 0
	for v := range ok {
		if v {
			success++
		}
	}
	if success != 1 {
		t.Fatal("concurrent CAS", success)
	}
	run("reconciliation-void", ledgerText(first["code"]), "reverse", "clerk", map[string]any{"expectedVersion": version("finance_reconciliation", ledgerText(first["code"])), "reason": "Marked reversal"})
	db.QueryRow("SELECT received_amount FROM altoc_billing_schedule WHERE code='BS1'").Scan(&received)
	if received != "40.00" {
		t.Fatal("reverse summary", received)
	}

	// Remaining balance, currency and parent identity are owning-domain guards.
	for key, changes := range map[string]map[string]any{
		"overdraw": {"reconciledAmount": "61.00"}, "wrong-currency": {"currencyCode": "USD"}, "wrong-contract": {"contractCode": "FOREIGN"},
	} {
		bad := allocation("10.00")
		for k, v := range changes {
			bad[k] = v
		}
		u.Actor = "clerk"
		u.Key = key
		if _, err := s.FinanceLedger(ctx, "reconciliation-create", FinanceInput{Payload: bad}, u, scope); err == nil {
			t.Fatal("accepted", key)
		}
	}
	detail := run("invoices-detail", inv, "", "issuer", nil)
	if len(detail["attachments"].([]map[string]any)) != 1 {
		t.Fatal("source invoice attachment missing")
	}
	if ledgerVersion(detail["invoice_file_size"]) != 10 {
		t.Fatal("browser attachment metadata trusted")
	}
	rd := run("receipts-detail", rc, "", "clerk", nil)
	if len(rd["billing_candidates"].([]altoc.FinanceBillingCandidate)) != 1 {
		t.Fatal("allocation projection")
	}
	var remainingCode string
	if err := db.QueryRow("SELECT code FROM finance_reconciliation WHERE status='active'").Scan(&remainingCode); err != nil {
		t.Fatal(err)
	}
	run("reconciliation-void", remainingCode, "reverse-last", "clerk", map[string]any{"expectedVersion": version("finance_reconciliation", remainingCode), "reason": "Marked final reversal"})
	run("invoices-red-reverse", inv, "red", "issuer", map[string]any{"expectedVersion": version("finance_invoice", inv), "invoiceNo": "MARKED-RED1", "reason": "Marked correction"})
	var redCount int
	if err := db.QueryRow("SELECT COUNT(*) FROM finance_invoice r JOIN finance_invoice b ON r.reversal_of_invoice_id=b.id WHERE b.code=? AND r.status='red_reversed' AND b.status='red_reversed'", inv).Scan(&redCount); err != nil || redCount != 1 {
		t.Fatal("F04 red record", redCount, err)
	}
	var invoiced string
	if err := db.QueryRow("SELECT invoiced_amount FROM altoc_billing_schedule WHERE code='BS1'").Scan(&invoiced); err != nil || invoiced != "0.00" {
		t.Fatal("red summary", invoiced, err)
	}

	for _, op := range []string{"invoice-requests-page", "invoices-page", "receipts-page", "reconciliation-page"} {
		out, err := s.FinanceLedger(ctx, op, FinanceInput{Page: 1, PageSize: 20}, who, scope)
		if err != nil || out.(map[string]any)["total"].(int64) < 1 {
			t.Fatal("paged read", op, err)
		}
	}
	spare := run("receipts-create", "", "spare", "cashier", map[string]any{"receivedAmount": "1.00", "currencyCode": "CNY", "receivedAt": "2026-10-03", "responsibleUid": "clerk", "dueAt": "2026-10-10 00:00:00"})
	run("receipts-delete", ledgerText(spare["code"]), "delete-spare", "cashier", map[string]any{"expectedVersion": float64(ledgerVersion(spare["row_version"]))})

	// A second approved prerequisite verifies the ordinary invoice void branch.
	spareReq := run("invoice-requests-create", "", "spare-request", "maker", map[string]any{"customerCode": "C1", "contractCode": "CT1", "requestedAmount": "20.00", "currencyCode": "CNY", "invoiceItem": "Marked spare"})
	spareCode := ledgerText(spareReq["code"])
	if _, err := db.Exec("UPDATE finance_invoice_request SET status='approved',workflow_instance_id='fixture-approved' WHERE code=?", spareCode); err != nil {
		t.Fatal(err)
	}
	run("invoice-requests-assign-issuance", spareCode, "spare-assign", "issuer", map[string]any{"expectedVersion": version("finance_invoice_request", spareCode), "responsibleUid": "issuer", "dueAt": "2026-10-10 00:00:00"})
	run("invoice-files-attach", "", "spare-file", "issuer", map[string]any{"attachmentPurpose": "issuance", "entityType": "finance_invoice_request", "entityCode": spareCode, "fileKey": "finance/invoices/spare.pdf", "fileName": "spare.pdf", "mimeType": "application/pdf", "fileSize": float64(10), "fileSha256": strings.Repeat("b", 64)})
	run("invoice-requests-issue", spareCode, "spare-issue", "issuer", map[string]any{"expectedVersion": version("finance_invoice_request", spareCode), "invoiceNo": "MARKED-SPARE", "invoiceDate": "2026-10-03", "invoiceFileKey": "finance/invoices/spare.pdf", "invoiceFileName": "spare.pdf", "invoiceFileMimeType": "application/pdf", "invoiceFileSize": float64(10)})
	var spareInvoice string
	if err := db.QueryRow("SELECT code FROM finance_invoice WHERE invoice_no='MARKED-SPARE'").Scan(&spareInvoice); err != nil {
		t.Fatal(err)
	}
	run("invoices-void", spareInvoice, "void-spare", "issuer", map[string]any{"expectedVersion": version("finance_invoice", spareInvoice), "reason": "Marked void"})
	// Revocation and persisted generation fencing reject even original intent.
	u.Actor = "issuer"
	u.Key = "issue"
	if _, e := s.FinanceLedger(ctx, "invoice-requests-issue", FinanceInput{Code: code, Payload: issue}, u, altoc.BasicReadScope{Access: "none"}); e == nil {
		t.Fatal("revoked replay")
	}
	db.Exec("UPDATE enterprise_schema_registry SET generation=8 WHERE id=1")
	if _, e := s.FinanceLedger(ctx, "receipts-detail", FinanceInput{Code: rc}, u, scope); e == nil {
		t.Fatal("generation fence")
	}
}

func TestAPF11FinanceB3InstallerMySQL(t *testing.T) {
	s, db := financeFixture(t)
	ctx := context.Background()
	b, e := domaininstall.WithFinanceB3(s.binding)
	if e != nil {
		t.Fatal(e)
	}
	installer := domaininstall.ForFinanceB3(domaininstall.Expectation{Tenant: b.Key.Tenant, Environment: b.Key.Environment, OwnerDeployment: "host-test", Address: b.Storage.Address})
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
	if len(receipt.Created) != 7 {
		t.Fatal("subset")
	}
	db.Exec("INSERT INTO finance_invoice_request(code,requested_amount) VALUES('MARKED',1.00)")
	if installer.Rollback(ctx, db, receipt, off) == nil {
		t.Fatal("nonempty rollback accepted")
	}
	db.Exec("DELETE FROM finance_invoice_request WHERE code='MARKED'")
	if e = installer.Rollback(ctx, db, receipt, off); e != nil {
		t.Fatal(e)
	}
	var count int
	if e = db.QueryRow("SELECT COUNT(*) FROM finance_bank_account").Scan(&count); e != nil {
		t.Fatal("B1 touched", e)
	}
}
