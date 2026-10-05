package finance

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var applicantRequestDeptCodeKeys = []string{
	"current_user_expense_request_dept_codes",
	"currentUserExpenseRequestDeptCodes",
	"current_user_expense_request_dept_code",
	"currentUserExpenseRequestDeptCode",
	"current_user_expense_claim_dept_codes",
	"currentUserExpenseClaimDeptCodes",
	"current_user_expense_claim_dept_code",
	"currentUserExpenseClaimDeptCode",
}

func isApplicantRequestTable(table string) bool {
	switch table {
	case "expense_claim", "project_expense_request", "payment_request":
		return true
	default:
		return false
	}
}

func applicantRequestAccessFromQuery(query url.Values) string {
	return cleanStringValue(firstNonEmpty(
		query.Get("current_user_expense_request_access"),
		query.Get("currentUserExpenseRequestAccess"),
		query.Get("current_user_expense_claim_access"),
		query.Get("currentUserExpenseClaimAccess"),
	))
}

func applicantRequestAccessFromBody(body jsonBody) string {
	return cleanStringValue(bodyValue(
		body,
		"current_user_expense_request_access",
		"currentUserExpenseRequestAccess",
		"current_user_expense_claim_access",
		"currentUserExpenseClaimAccess",
	))
}

func applicantRequestCurrentUserFromQuery(query url.Values) string {
	return cleanStringValue(firstNonEmpty(query.Get("current_user"), query.Get("currentUser")))
}

func applicantRequestCurrentUserFromBody(body jsonBody) string {
	return cleanStringValue(bodyValue(body, "current_user", "currentUser"))
}

func applicantRequestDeptCodesFromQuery(query url.Values) []string {
	values := make([]any, 0, len(applicantRequestDeptCodeKeys))
	for _, key := range applicantRequestDeptCodeKeys {
		values = append(values, query.Get(key))
	}
	return applicantRequestDeptCodes(values...)
}

func applicantRequestDeptCodesFromBody(body jsonBody) []string {
	values := make([]any, 0, len(applicantRequestDeptCodeKeys))
	for _, key := range applicantRequestDeptCodeKeys {
		values = append(values, bodyValue(body, key))
	}
	return applicantRequestDeptCodes(values...)
}

func applicantRequestDeptCodes(values ...any) []string {
	result := make([]string, 0)
	seen := make(map[string]struct{})
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}

	var walk func(value any)
	walk = func(value any) {
		switch typed := value.(type) {
		case []string:
			for _, item := range typed {
				walk(item)
			}
		case []any:
			for _, item := range typed {
				walk(item)
			}
		default:
			text := cleanStringValue(value)
			if text == "" {
				return
			}
			for _, item := range strings.FieldsFunc(text, func(r rune) bool {
				return r == ',' || r == ';' || r == ' ' || r == '\n' || r == '\t'
			}) {
				add(item)
			}
		}
	}

	for _, value := range values {
		walk(value)
	}
	return result
}

func containsApplicantRequestDeptCode(codes []string, code string) bool {
	code = strings.TrimSpace(code)
	if code == "" {
		return false
	}
	for _, item := range codes {
		if item == code {
			return true
		}
	}
	return false
}

func applyApplicantRequestListAccess(where *[]string, args *[]any, query url.Values) {
	switch applicantRequestAccessFromQuery(query) {
	case "", "all":
		return
	case "self":
		uid := applicantRequestCurrentUserFromQuery(query)
		if uid == "" {
			*where = append(*where, "1 = 0")
			return
		}
		*where = append(*where, "applicant_user_id = ?")
		*args = append(*args, uid)
	case "dept":
		uid := applicantRequestCurrentUserFromQuery(query)
		deptCodes := applicantRequestDeptCodesFromQuery(query)
		parts := make([]string, 0, 2)
		if uid != "" {
			parts = append(parts, "applicant_user_id = ?")
			*args = append(*args, uid)
		}
		if len(deptCodes) > 0 {
			parts = append(parts, "applicant_dept_code IN ("+placeholders(len(deptCodes))+")")
			for _, code := range deptCodes {
				*args = append(*args, code)
			}
		}
		if len(parts) == 0 {
			*where = append(*where, "1 = 0")
			return
		}
		*where = append(*where, "("+strings.Join(parts, " OR ")+")")
	default:
		*where = append(*where, "1 = 0")
	}
}

func requireApplicantRequestQueryAccess(query url.Values, row map[string]any) error {
	return requireApplicantRequestRecordAccess(applicantRequestAccessFromQuery(query), applicantRequestCurrentUserFromQuery(query), applicantRequestDeptCodesFromQuery(query), row, nil)
}

func requireApplicantRequestBodyAccess(body jsonBody, row map[string]any) error {
	return requireApplicantRequestRecordAccess(applicantRequestAccessFromBody(body), applicantRequestCurrentUserFromBody(body), applicantRequestDeptCodesFromBody(body), row, body)
}

func requireApplicantRequestCreateAccess(body jsonBody) error {
	access := applicantRequestAccessFromBody(body)
	if access == "" || access == "all" {
		return nil
	}
	if access != "self" && access != "dept" {
		return applicantRequestForbidden()
	}

	uid := applicantRequestCurrentUserFromBody(body)
	if uid == "" {
		return applicantRequestForbidden()
	}
	applicant := cleanStringValue(bodyValue(body, "applicantUserId", "applicant_user_id"))
	if applicant == "" {
		body["applicantUserId"] = uid
		body["applicant_user_id"] = uid
		return nil
	}
	if applicant == uid {
		return nil
	}
	if access == "self" {
		return applicantRequestForbidden()
	}

	deptCode := cleanStringValue(bodyValue(body, "applicantDeptCode", "applicant_dept_code"))
	if !containsApplicantRequestDeptCode(applicantRequestDeptCodesFromBody(body), deptCode) {
		return applicantRequestForbidden()
	}
	return nil
}

func requireApplicantRequestRecordAccess(access string, uid string, deptCodes []string, row map[string]any, body jsonBody) error {
	switch access {
	case "", "all":
		return nil
	case "self":
		if uid == "" || cleanStringValue(row["applicant_user_id"]) != uid {
			return applicantRequestForbidden()
		}
		if body != nil {
			applicant := cleanStringValue(bodyValue(body, "applicantUserId", "applicant_user_id"))
			if applicant != "" && applicant != uid {
				return applicantRequestForbidden()
			}
		}
		return nil
	case "dept":
		rowApplicant := cleanStringValue(row["applicant_user_id"])
		rowDeptCode := cleanStringValue(row["applicant_dept_code"])
		if (uid == "" || rowApplicant != uid) && !containsApplicantRequestDeptCode(deptCodes, rowDeptCode) {
			return applicantRequestForbidden()
		}
		if body != nil {
			applicant := cleanStringValue(bodyValue(body, "applicantUserId", "applicant_user_id"))
			deptCode := cleanStringValue(bodyValue(body, "applicantDeptCode", "applicant_dept_code"))
			effectiveApplicant := applicant
			if effectiveApplicant == "" {
				effectiveApplicant = rowApplicant
			}
			if applicant != "" && applicant != uid {
				if deptCode == "" {
					deptCode = rowDeptCode
				}
				if !containsApplicantRequestDeptCode(deptCodes, deptCode) {
					return applicantRequestForbidden()
				}
			}
			if deptCode != "" && !containsApplicantRequestDeptCode(deptCodes, deptCode) && effectiveApplicant != uid {
				return applicantRequestForbidden()
			}
		}
		return nil
	default:
		return applicantRequestForbidden()
	}
}

func applicantRequestForbidden() error {
	return httperror.New(http.StatusForbidden, "finance_request_access_denied", "only authorized users can access this finance request")
}
