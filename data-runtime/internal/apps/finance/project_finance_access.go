package finance

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var projectFinanceProjectCodeKeys = []string{
	"current_user_project_finance_project_codes",
	"currentUserProjectFinanceProjectCodes",
	"current_user_project_accounting_project_codes",
	"currentUserProjectAccountingProjectCodes",
}

func isProjectFinanceTable(table string) bool {
	switch table {
	case "project_finance_summary", "project_cost_allocation":
		return true
	default:
		return false
	}
}

func isEmployeeCostSnapshotTable(table string) bool {
	return table == "employee_cost_snapshot"
}

func projectFinanceAccessFromQuery(query url.Values) string {
	return cleanStringValue(firstNonEmpty(
		query.Get("current_user_project_finance_access"),
		query.Get("currentUserProjectFinanceAccess"),
		query.Get("current_user_project_accounting_access"),
		query.Get("currentUserProjectAccountingAccess"),
	))
}

func projectFinanceCurrentUserFromQuery(query url.Values) string {
	return cleanStringValue(firstNonEmpty(query.Get("current_user"), query.Get("currentUser")))
}

func projectFinanceCodesFromQuery(query url.Values) []string {
	values := make([]any, 0, len(projectFinanceProjectCodeKeys))
	for _, key := range projectFinanceProjectCodeKeys {
		values = append(values, query.Get(key))
	}
	return projectFinanceProjectCodes(values...)
}

func projectFinanceAccessFromBody(body jsonBody) string {
	return cleanStringValue(bodyValue(
		body,
		"current_user_project_finance_access",
		"currentUserProjectFinanceAccess",
		"current_user_project_accounting_access",
		"currentUserProjectAccountingAccess",
	))
}

func projectFinanceCurrentUserFromBody(body jsonBody) string {
	return cleanStringValue(bodyValue(body, "current_user", "currentUser", "operator_uid", "operatorUid"))
}

func projectFinanceCodesFromBody(body jsonBody) []string {
	values := make([]any, 0, len(projectFinanceProjectCodeKeys))
	for _, key := range projectFinanceProjectCodeKeys {
		values = append(values, bodyValue(body, key))
	}
	return projectFinanceProjectCodes(values...)
}

func projectFinanceProjectCodes(values ...any) []string {
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

func projectFinanceRequestedProjectCodesFromQuery(query url.Values) []string {
	return projectFinanceProjectCodes(
		query.Get("projectCodes"),
		query.Get("project_codes"),
		query.Get("projectCode"),
		query.Get("project_code"),
	)
}

func projectFinanceReportProjectCodesFromQuery(query url.Values) ([]string, bool) {
	requested := projectFinanceRequestedProjectCodesFromQuery(query)
	switch projectFinanceAccessFromQuery(query) {
	case "", "all":
		if len(requested) > 0 {
			return requested, true
		}
		return nil, false
	case "projects":
		allowed := projectFinanceCodesFromQuery(query)
		if len(requested) == 0 {
			return allowed, true
		}
		return intersectProjectFinanceCodes(requested, allowed), true
	default:
		return nil, true
	}
}

func intersectProjectFinanceCodes(left []string, right []string) []string {
	rightSet := make(map[string]struct{}, len(right))
	for _, code := range right {
		rightSet[code] = struct{}{}
	}
	result := make([]string, 0, len(left))
	for _, code := range left {
		if _, ok := rightSet[code]; ok {
			result = append(result, code)
		}
	}
	return result
}

func containsProjectFinanceCode(codes []string, code string) bool {
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

func applyProjectFinanceListAccess(where *[]string, args *[]any, query url.Values) {
	applyProjectFinanceProjectCodeAccess(where, args, query, "project_code")
}

func applyProjectFinanceProjectCodeAccess(where *[]string, args *[]any, query url.Values, column string) {
	switch projectFinanceAccessFromQuery(query) {
	case "", "all":
		return
	case "projects":
		projectCodes := projectFinanceCodesFromQuery(query)
		if len(projectCodes) == 0 {
			*where = append(*where, "1 = 0")
			return
		}
		*where = append(*where, column+" IN ("+placeholders(len(projectCodes))+")")
		for _, code := range projectCodes {
			*args = append(*args, code)
		}
	default:
		*where = append(*where, "1 = 0")
	}
}

func requireProjectFinanceQueryAccess(query url.Values, projectCode string) error {
	switch projectFinanceAccessFromQuery(query) {
	case "", "all":
		return nil
	case "projects":
		if containsProjectFinanceCode(projectFinanceCodesFromQuery(query), projectCode) {
			return nil
		}
		return projectFinanceForbidden()
	default:
		return projectFinanceForbidden()
	}
}

func requireProjectFinanceGlobalQueryAccess(query url.Values) error {
	switch projectFinanceAccessFromQuery(query) {
	case "all":
		return nil
	case "":
		if projectFinanceCurrentUserFromQuery(query) == "" {
			return nil
		}
		return projectFinanceForbidden()
	default:
		return projectFinanceForbidden()
	}
}

func applyProjectFinanceBodyProjectCodeAccess(where *[]string, args *[]any, body jsonBody, column string) error {
	switch projectFinanceAccessFromBody(body) {
	case "", "all":
		return nil
	case "projects":
		projectCodes := projectFinanceCodesFromBody(body)
		if len(projectCodes) == 0 {
			return projectFinanceForbidden()
		}
		*where = append(*where, column+" IN ("+placeholders(len(projectCodes))+")")
		for _, code := range projectCodes {
			*args = append(*args, code)
		}
		return nil
	default:
		return projectFinanceForbidden()
	}
}

func requireProjectFinanceGlobalBodyAccess(body jsonBody) error {
	switch projectFinanceAccessFromBody(body) {
	case "all":
		return nil
	case "":
		if projectFinanceCurrentUserFromBody(body) == "" {
			return nil
		}
		return projectFinanceForbidden()
	default:
		return projectFinanceForbidden()
	}
}

func requireProjectFinanceBodyAccess(body jsonBody, projectCode string) error {
	switch projectFinanceAccessFromBody(body) {
	case "", "all":
		return nil
	case "projects":
		if containsProjectFinanceCode(projectFinanceCodesFromBody(body), projectCode) {
			return nil
		}
		return projectFinanceForbidden()
	default:
		return projectFinanceForbidden()
	}
}

func projectFinanceForbidden() error {
	return httperror.New(http.StatusForbidden, "finance_project_access_denied", "only authorized users can access this finance project")
}
