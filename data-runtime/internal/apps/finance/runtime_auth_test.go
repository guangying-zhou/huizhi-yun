package finance

import (
	"net/url"
	"testing"
)

func TestFinanceMutationBodyFromRequestUsesTrustedQueryAuth(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "trusted-user")
	query.Set("operator_uid", "trusted-operator")
	query.Set("current_user_project_finance_access", "projects")
	query.Set("current_user_project_finance_project_codes", "P1,P2")
	query.Set("current_user_expense_request_access", "dept")
	query.Set("current_user_expense_request_dept_codes", "D1,D2")
	query.Set("current_user_invoice_request_access", "relation")
	query.Set("current_user_receipt_access", "all")

	body := jsonBody{
		"projectCode":                         "P3",
		"amount":                              "10",
		"current_user":                        "body-user",
		"operator_uid":                        "body-operator",
		"current_user_project_finance_access": "all",
		"current_user_project_finance_project_codes":    "P9",
		"current_user_expense_request_access":           "all",
		"current_user_expense_request_dept_codes":       "DX",
		"current_user_finance_performance_access":       "all",
		"current_user_finance_performance_dept_codes":   "PX",
		"current_user_project_accounting_project_codes": "P8",
		"currentUserProjectAccountingProjectCodes":      "P7",
		"currentUserFinancePerformanceDeptCodes":        "D9",
		"currentUserExpenseRequestDeptCodes":            "D8",
		"currentUserProjectFinanceProjectCodes":         "P6",
		"currentUserExpenseClaimDeptCodes":              "D7",
		"current_user_expense_claim_dept_codes":         "D6",
		"current_user_performance_dept_codes":           "D5",
		"currentUserPerformanceDeptCodes":               "D4",
		"current_user_project_accounting_access":        "all",
		"currentUserProjectAccountingAccess":            "all",
		"currentUserProjectFinanceAccess":               "all",
		"currentUserFinancePerformanceAccess":           "all",
		"current_user_performance_access":               "all",
		"currentUserPerformanceAccess":                  "all",
		"current_user_invoice_request_access":           "all",
		"currentUserInvoiceRequestAccess":               "all",
		"current_user_receipt_access":                   "none",
		"currentUserReceiptAccess":                      "none",
		"current_user_expense_claim_access":             "all",
		"currentUserExpenseClaimAccess":                 "all",
		"currentUserExpenseRequestAccess":               "all",
		"currentUser":                                   "body-user-camel",
		"operatorUid":                                   "body-operator-camel",
		"current_user_expense_request_dept_code":        "DX1",
		"currentUserExpenseRequestDeptCode":             "DX2",
		"current_user_expense_claim_dept_code":          "DX3",
		"currentUserExpenseClaimDeptCode":               "DX4",
		"current_user_finance_performance_dept_code":    "PX1",
		"currentUserFinancePerformanceDeptCode":         "PX2",
		"current_user_performance_dept_code":            "PX3",
		"currentUserPerformanceDeptCode":                "PX4",
	}

	actual := financeMutationBodyFromRequest(query, body)

	if got := bodyValue(actual, "current_user"); got != "trusted-operator" {
		t.Fatalf("current_user = %v, want trusted operator", got)
	}
	if got := bodyValue(actual, "operator_uid"); got != "trusted-operator" {
		t.Fatalf("operator_uid = %v, want trusted operator", got)
	}
	if got := bodyValue(actual, "current_user_project_finance_access"); got != "projects" {
		t.Fatalf("project finance access = %v, want projects", got)
	}
	if got := bodyValue(actual, "current_user_project_finance_project_codes"); got != "P1,P2" {
		t.Fatalf("project finance project codes = %v, want P1,P2", got)
	}
	if got := bodyValue(actual, "current_user_expense_request_access"); got != "dept" {
		t.Fatalf("expense request access = %v, want dept", got)
	}
	if got := bodyValue(actual, "current_user_expense_request_dept_codes"); got != "D1,D2" {
		t.Fatalf("expense request dept codes = %v, want D1,D2", got)
	}
	if got := bodyValue(actual, "current_user_invoice_request_access"); got != "relation" {
		t.Fatalf("invoice request responsibility access = %v, want trusted relation", got)
	}
	if got := bodyValue(actual, "current_user_receipt_access"); got != "all" {
		t.Fatalf("receipt responsibility access = %v, want trusted all", got)
	}
	if _, exists := actual["currentUserInvoiceRequestAccess"]; exists {
		t.Fatal("browser-forged camel-case invoice responsibility access was preserved")
	}
	if _, exists := actual["currentUserReceiptAccess"]; exists {
		t.Fatal("browser-forged camel-case receipt responsibility access was preserved")
	}
	if got := bodyValue(actual, "projectCode"); got != "P3" {
		t.Fatalf("projectCode = %v, want preserved business field", got)
	}
	if got := bodyValue(actual, "amount"); got != "10" {
		t.Fatalf("amount = %v, want preserved business field", got)
	}

	if err := requireProjectFinanceBodyAccess(actual, "P1"); err != nil {
		t.Fatalf("trusted query project P1 should pass, got %v", err)
	}
	if err := requireProjectFinanceBodyAccess(actual, "P3"); err == nil {
		t.Fatal("body-spoofed project access allowed P3, want forbidden")
	}
}

func TestFinanceMutationBodyFromRequestKeepsBodyFallbackWithoutQueryAuth(t *testing.T) {
	body := jsonBody{
		"current_user":                               "body-user",
		"operator_uid":                               "body-operator",
		"current_user_project_finance_access":        "all",
		"current_user_project_finance_project_codes": "P9",
		"projectCode":                                "P3",
	}

	actual := financeMutationBodyFromRequest(url.Values{}, body)

	if actual["current_user"] != "body-user" || actual["operator_uid"] != "body-operator" {
		t.Fatalf("body fallback auth was changed: %#v", actual)
	}
	if actual["current_user_project_finance_access"] != "all" || actual["projectCode"] != "P3" {
		t.Fatalf("body fallback fields were changed: %#v", actual)
	}
}
