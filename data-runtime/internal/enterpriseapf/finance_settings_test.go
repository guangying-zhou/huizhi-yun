package enterpriseapf

import "testing"

func TestAPF13bClosedBudgetAndFields(t *testing.T) {
	for _, col := range ledgerColumns("finance_payment_request") {
		if col == "payee_account_secret_ref" {
			t.Fatal("payment secret reference disclosure")
		}
	}
	if len(financeSettingsOps)+7 != 24 {
		t.Fatal("operation budget")
	}
	payment := map[string]any{"title": "Payment", "currencyCode": "CNY", "paymentType": "supplier", "requestedAmount": "10.03", "payeeName": "Marked"}
	if e := ValidateFinanceSpendInput("payment-requests-create", FinanceInput{Payload: payment}); e != nil {
		t.Fatal(e)
	}
	for _, key := range []string{"actor", "handlerUid", "status", "approvedAmount", "paidAmount", "items", "payeeAccountSecretRef"} {
		payment[key] = "forged"
		if ValidateFinanceSpendInput("payment-requests-create", FinanceInput{Payload: payment}) == nil {
			t.Fatal(key)
		}
		delete(payment, key)
	}
	for _, kind := range []string{"expense-types", "income-types", "subjects", "subject-mappings", "accounting-objects"} {
		p := map[string]any{"code": "MARKED", "name": "Marked"}
		if kind == "subjects" {
			p["subjectType"] = "cost"
		}
		if kind == "accounting-objects" {
			p["objectType"] = "other"
		}
		if kind == "subject-mappings" {
			p = map[string]any{"bizType": "expense", "defaultSubjectCode": "6001", "objectStrategy": "manual"}
		}
		if e := ValidateFinanceSettingsInput(kind+"-create", FinanceInput{Payload: p}); e != nil {
			t.Fatal(kind, e)
		}
		for _, key := range []string{"actor", "tenant", "table", "row_version", "sourceApp"} {
			p[key] = "forged"
			if ValidateFinanceSettingsInput(kind+"-create", FinanceInput{Payload: p}) == nil {
				t.Fatal(kind, key)
			}
			delete(p, key)
		}
		r, a, ok := FinanceLedgerPermission(kind + "-page")
		if !ok || r != "settings" || a != "admin" {
			t.Fatal("permission", kind)
		}
	}
	if ValidateFinanceSettingsInput("subjects-update", FinanceInput{Code: "6001", Payload: map[string]any{"name": "New"}}) == nil {
		t.Fatal("missing CAS")
	}
	if ValidateFinanceSettingsInput("subjects-page", FinanceInput{Code: "6001", Page: 1, PageSize: 1}) != nil {
		t.Fatal("exact filter")
	}
	if ValidateFinanceSettingsInput("audit-logs-page", FinanceInput{Code: "6001", Page: 1, PageSize: 1}) == nil {
		t.Fatal("wrong filter")
	}
}
