package people

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var employeeDeptCodeKeys = []string{
	"current_user_employee_dept_codes",
	"currentUserEmployeeDeptCodes",
	"current_user_employee_dept_code",
	"currentUserEmployeeDeptCode",
	"current_user_data_dept_codes",
	"currentUserDataDeptCodes",
	"current_user_data_dept_code",
	"currentUserDataDeptCode",
}

func firstCleanEmployeeAccessValue(values ...string) string {
	for _, value := range values {
		if text := cleanAnyString(value); text != "" {
			return text
		}
	}
	return ""
}

func employeeAccessFromQuery(query url.Values) string {
	return firstCleanEmployeeAccessValue(
		query.Get("current_user_employee_access"),
		query.Get("currentUserEmployeeAccess"),
	)
}

func employeeCurrentUserFromQuery(query url.Values) string {
	return firstCleanEmployeeAccessValue(query.Get("current_user"), query.Get("currentUser"))
}

func employeeDeptCodesFromQuery(query url.Values) []string {
	values := make([]string, 0, len(employeeDeptCodeKeys))
	for _, key := range employeeDeptCodeKeys {
		values = append(values, query[key]...)
	}
	return splitEmployeeDeptCodes(values...)
}

func splitEmployeeDeptCodes(values ...string) []string {
	result := make([]string, 0)
	seen := make(map[string]struct{})
	for _, value := range values {
		for _, item := range strings.FieldsFunc(cleanAnyString(value), func(r rune) bool {
			return r == ',' || r == ';' || r == ' ' || r == '\n' || r == '\t'
		}) {
			item = strings.TrimSpace(item)
			if item == "" {
				continue
			}
			if _, ok := seen[item]; ok {
				continue
			}
			seen[item] = struct{}{}
			result = append(result, item)
		}
	}
	return result
}

func containsEmployeeDeptCode(codes []string, code string) bool {
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

func requireEmployeeQueryAccess(query url.Values) error {
	switch employeeAccessFromQuery(query) {
	case "", "all", "self", "dept":
		return nil
	default:
		return employeeAccessForbidden()
	}
}

func requireEmployeeGlobalAccess(query url.Values) error {
	switch employeeAccessFromQuery(query) {
	case "", "all":
		return nil
	default:
		return employeeAccessForbidden()
	}
}

func standardCostAccessFromQuery(query url.Values) string {
	return firstCleanEmployeeAccessValue(
		query.Get("current_user_standard_cost_access"),
		query.Get("currentUserStandardCostAccess"),
	)
}

func requireStandardCostGlobalAccess(query url.Values) error {
	switch standardCostAccessFromQuery(query) {
	case "", "all":
		return nil
	default:
		return employeeAccessForbidden()
	}
}

func employeeSensitiveCostFieldPresent(body map[string]any) bool {
	if body == nil {
		return false
	}
	for _, key := range []string{"monthly_standard_cost", "monthlyStandardCost"} {
		if _, ok := body[key]; ok {
			return true
		}
	}
	return false
}

func requireEmployeeSensitiveCostFieldAccess(query url.Values, body map[string]any) error {
	if !employeeSensitiveCostFieldPresent(body) {
		return nil
	}
	return requireStandardCostGlobalAccess(query)
}

func requireEmployeeRecordQueryAccess(query url.Values, row map[string]any) error {
	switch employeeAccessFromQuery(query) {
	case "", "all":
		return nil
	case "self":
		uid := employeeCurrentUserFromQuery(query)
		if uid == "" || cleanAnyString(row["employee_uid"]) != uid {
			return employeeAccessForbidden()
		}
		return nil
	case "dept":
		uid := employeeCurrentUserFromQuery(query)
		if uid != "" && cleanAnyString(row["employee_uid"]) == uid {
			return nil
		}
		if containsEmployeeDeptCode(employeeDeptCodesFromQuery(query), cleanAnyString(row["dept_code"])) {
			return nil
		}
		return employeeAccessForbidden()
	default:
		return employeeAccessForbidden()
	}
}

func employeeAccessForbidden() error {
	return httperror.New(http.StatusForbidden, "people_employee_access_denied", "only authorized users can access this employee record")
}
