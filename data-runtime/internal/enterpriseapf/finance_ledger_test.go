package enterpriseapf

import (
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"testing"
)

func TestFinanceLedgerClosedOperationsAndDutySeparation(t *testing.T) {
	if len(financeLedgerOps) != 23 {
		t.Fatal("operation freeze changed")
	}
	for _, op := range []string{"invoices-create", "invoice-requests-submit", "approval-callback"} {
		if _, _, ok := FinanceLedgerPermission(op); ok {
			t.Fatal("unapproved entry", op)
		}
	}
	if requireFinanceIssueSeparation(map[string]any{"requested_by": "maker"}, "maker") == nil || requireFinanceIssueSeparation(map[string]any{"requested_by": "maker"}, "issuer") != nil {
		t.Fatal("D01")
	}
	if requireFinanceReconciliationSeparation(map[string]any{"confirmed_by": "cashier"}, "cashier") == nil || requireFinanceReconciliationSeparation(map[string]any{"confirmed_by": "cashier"}, "clerk") != nil {
		t.Fatal("D02")
	}
	for _, actor := range []string{"", "maker"} {
		if requireFinanceIssueSeparation(map[string]any{}, actor) == nil {
			t.Fatal("missing facts fail closed")
		}
	}
	if ledgerScope(map[string]any{"reconciliation_responsible_uid": "new"}, altoc.BasicReadScope{Access: "self"}, "old") {
		t.Fatal("stale responsibility")
	}
	if centsText(moneyCents("9999999999999999.99")) != "9999999999999999.99" {
		t.Fatal("precision")
	}
}
func TestFinanceLedgerRejectsClientFacts(t *testing.T) {
	for _, field := range []string{"approved_by", "status", "confirmedBy", "reconciledBy", "current_user", "invoice_amount", "row_version"} {
		i := FinanceInput{Code: "RC-1", Payload: map[string]any{"expectedVersion": float64(1), field: "spoof"}}
		if ValidateFinanceLedgerInput("receipts-confirm", i) == nil {
			t.Fatal(field)
		}
	}
	for _, amount := range []any{1.1, "1e2", "-1.00", "0.00", "0.001"} {
		if ValidateFinanceLedgerInput("receipts-create", FinanceInput{Payload: map[string]any{"receivedAmount": amount, "currencyCode": "CNY", "receivedAt": "2026-10-03", "responsibleUid": "clerk", "dueAt": "2026-10-10 00:00:00"}}) == nil {
			t.Fatal(amount)
		}
	}
}

func TestInvoiceAttachmentRequiresExactIssuanceActionAndCurrentResponsibility(t *testing.T) {
	payload := map[string]any{"entityType": "finance_invoice_request", "attachmentPurpose": "issuance"}
	r, a, ok := FinanceLedgerInputPermission("invoice-files-attach", FinanceInput{Payload: payload})
	if !ok || r != "invoices" || a != "issue" {
		t.Fatal(r, a, ok)
	}
	_, a, _ = FinanceLedgerInputPermission("invoice-files-attach", FinanceInput{})
	if a != "edit" {
		t.Fatal("ordinary attachment permission changed")
	}
	row := map[string]any{"status": "approved", "requested_by": "maker", "issuance_responsible_uid": "issuer"}
	if err := requireFinanceAttachmentAction(row, payload, "issuer"); err != nil {
		t.Fatal(err)
	}
	for _, actor := range []string{"maker", "other", ""} {
		if requireFinanceAttachmentAction(row, payload, actor) == nil {
			t.Fatal("invalid issuer accepted", actor)
		}
	}
	if requireFinanceAttachmentAction(row, map[string]any{"entityType": "finance_invoice_request"}, "issuer") == nil {
		t.Fatal("edit bypassed issue")
	}
	row["status"] = "draft"
	if requireFinanceAttachmentAction(row, payload, "issuer") == nil {
		t.Fatal("draft treated as approved")
	}
	if err := requireFinanceAttachmentAction(row, map[string]any{"entityType": "finance_invoice_request"}, "maker"); err != nil {
		t.Fatal("ordinary edit changed", err)
	}
	row["status"] = "approved"
	row["requested_by"] = "issuer"
	if requireFinanceAttachmentAction(row, payload, "issuer") == nil {
		t.Fatal("applicant attached as issuer")
	}
}
