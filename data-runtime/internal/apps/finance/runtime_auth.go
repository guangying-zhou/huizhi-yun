package finance

import (
	"net/url"
	"strings"
)

var financeRuntimeAuthKeys = map[string]bool{
	"current_user":                                  true,
	"currentUser":                                   true,
	"operator_uid":                                  true,
	"operatorUid":                                   true,
	"current_user_expense_request_access":           true,
	"currentUserExpenseRequestAccess":               true,
	"current_user_expense_request_dept_codes":       true,
	"currentUserExpenseRequestDeptCodes":            true,
	"current_user_expense_request_dept_code":        true,
	"currentUserExpenseRequestDeptCode":             true,
	"current_user_expense_claim_access":             true,
	"currentUserExpenseClaimAccess":                 true,
	"current_user_expense_claim_dept_codes":         true,
	"currentUserExpenseClaimDeptCodes":              true,
	"current_user_expense_claim_dept_code":          true,
	"currentUserExpenseClaimDeptCode":               true,
	"current_user_project_finance_access":           true,
	"currentUserProjectFinanceAccess":               true,
	"current_user_project_finance_project_codes":    true,
	"currentUserProjectFinanceProjectCodes":         true,
	"current_user_project_accounting_access":        true,
	"currentUserProjectAccountingAccess":            true,
	"current_user_project_accounting_project_codes": true,
	"currentUserProjectAccountingProjectCodes":      true,
	"current_user_finance_performance_access":       true,
	"currentUserFinancePerformanceAccess":           true,
	"current_user_finance_performance_dept_codes":   true,
	"currentUserFinancePerformanceDeptCodes":        true,
	"current_user_finance_performance_dept_code":    true,
	"currentUserFinancePerformanceDeptCode":         true,
	"current_user_performance_access":               true,
	"currentUserPerformanceAccess":                  true,
	"current_user_performance_dept_codes":           true,
	"currentUserPerformanceDeptCodes":               true,
	"current_user_performance_dept_code":            true,
	"currentUserPerformanceDeptCode":                true,
	"current_user_invoice_request_access":           true,
	"currentUserInvoiceRequestAccess":               true,
	"current_user_receipt_access":                   true,
	"currentUserReceiptAccess":                      true,
}

// RuntimeAuthContextKey identifies Finance data-scope facts which must only
// arrive through the request-target-bound runtime actor delegation. They are
// not browser request fields.
func RuntimeAuthContextKey(key string) bool {
	return financeRuntimeAuthKeys[key]
}

// SanitizeRuntimeMutationBody drops Finance authorization facts before the
// server rebuilds them from a trusted runtime query. Keeping this at the
// adapter boundary makes direct callers unable to turn a body field into an
// actor or a data-scope assertion.
func SanitizeRuntimeMutationBody(body map[string]any) {
	for key := range body {
		if RuntimeAuthContextKey(key) {
			delete(body, key)
		}
	}
}

func financeMutationBodyFromRequest(query url.Values, body jsonBody) jsonBody {
	if !financeQueryHasRuntimeAuthContext(query) {
		return body
	}

	result := jsonBody{}
	for key, value := range body {
		if !RuntimeAuthContextKey(key) {
			result[key] = value
		}
	}

	actor := firstNonEmpty(financeQueryValue(query, "operator_uid", "operatorUid"), financeQueryValue(query, "current_user", "currentUser"))
	if actor != "" {
		result["current_user"] = actor
		result["operator_uid"] = actor
	}

	for key := range financeRuntimeAuthKeys {
		if key == "current_user" || key == "currentUser" || key == "operator_uid" || key == "operatorUid" {
			continue
		}
		if value := financeQueryValue(query, key); value != "" {
			result[key] = value
		}
	}

	return result
}

func financeQueryHasRuntimeAuthContext(query url.Values) bool {
	if query == nil {
		return false
	}
	for key := range financeRuntimeAuthKeys {
		if len(query[key]) > 0 || strings.TrimSpace(query.Get(key)) != "" {
			return true
		}
	}
	return false
}

func financeQueryValue(query url.Values, keys ...string) string {
	for _, key := range keys {
		values := make([]string, 0, len(query[key]))
		for _, value := range query[key] {
			if text := strings.TrimSpace(value); text != "" {
				values = append(values, text)
			}
		}
		if len(values) > 0 {
			return strings.Join(values, ",")
		}
	}
	return ""
}
