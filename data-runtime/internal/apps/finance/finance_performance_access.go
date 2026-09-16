package finance

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var financePerformanceDeptCodeKeys = []string{
	"current_user_finance_performance_dept_codes",
	"currentUserFinancePerformanceDeptCodes",
	"current_user_finance_performance_dept_code",
	"currentUserFinancePerformanceDeptCode",
	"current_user_performance_dept_codes",
	"currentUserPerformanceDeptCodes",
	"current_user_performance_dept_code",
	"currentUserPerformanceDeptCode",
}

func isFinanceEmployeePerformanceTable(table string) bool {
	switch table {
	case "employee_finance_contribution", "employee_finance_performance":
		return true
	default:
		return false
	}
}

func isPerformanceCalculationSnapshotTable(table string) bool {
	return table == "performance_calculation_snapshot"
}

func isPerformanceRuleTable(table string) bool {
	return table == "performance_rule"
}

func financePerformanceAccessFromQuery(query url.Values) string {
	return cleanStringValue(firstNonEmpty(
		query.Get("current_user_finance_performance_access"),
		query.Get("currentUserFinancePerformanceAccess"),
		query.Get("current_user_performance_access"),
		query.Get("currentUserPerformanceAccess"),
	))
}

func financePerformanceCurrentUserFromQuery(query url.Values) string {
	return cleanStringValue(firstNonEmpty(query.Get("current_user"), query.Get("currentUser")))
}

func financePerformanceDeptCodesFromQuery(query url.Values) []string {
	values := make([]any, 0, len(financePerformanceDeptCodeKeys))
	for _, key := range financePerformanceDeptCodeKeys {
		values = append(values, query.Get(key))
	}
	return applicantRequestDeptCodes(values...)
}

func financePerformanceAccessFromBody(body jsonBody) string {
	return cleanStringValue(bodyValue(
		body,
		"current_user_finance_performance_access",
		"currentUserFinancePerformanceAccess",
		"current_user_performance_access",
		"currentUserPerformanceAccess",
	))
}

func financePerformanceCurrentUserFromBody(body jsonBody) string {
	return cleanStringValue(bodyValue(body, "current_user", "currentUser", "operator_uid", "operatorUid"))
}

func financePerformanceDeptCodesFromBody(body jsonBody) []string {
	values := make([]any, 0, len(financePerformanceDeptCodeKeys))
	for _, key := range financePerformanceDeptCodeKeys {
		values = append(values, bodyValue(body, key))
	}
	return applicantRequestDeptCodes(values...)
}

func applyFinanceEmployeePerformanceListAccess(where *[]string, args *[]any, query url.Values) {
	applyFinanceEmployeePerformanceColumnsAccess(where, args, query, "employee_uid", "dept_code")
}

func applyFinanceEmployeePerformanceColumnsAccess(where *[]string, args *[]any, query url.Values, employeeColumn string, deptColumn string) {
	switch financePerformanceAccessFromQuery(query) {
	case "", "all":
		return
	case "self":
		uid := financePerformanceCurrentUserFromQuery(query)
		if uid == "" {
			*where = append(*where, "1 = 0")
			return
		}
		*where = append(*where, employeeColumn+" = ?")
		*args = append(*args, uid)
	case "dept":
		uid := financePerformanceCurrentUserFromQuery(query)
		deptCodes := financePerformanceDeptCodesFromQuery(query)
		parts := make([]string, 0, 2)
		if uid != "" {
			parts = append(parts, employeeColumn+" = ?")
			*args = append(*args, uid)
		}
		if len(deptCodes) > 0 {
			parts = append(parts, deptColumn+" IN ("+placeholders(len(deptCodes))+")")
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

func applyPerformanceCalculationSnapshotListAccess(where *[]string, args *[]any, query url.Values) {
	switch financePerformanceAccessFromQuery(query) {
	case "", "all":
		return
	case "self":
		uid := financePerformanceCurrentUserFromQuery(query)
		if uid == "" {
			*where = append(*where, "1 = 0")
			return
		}
		*where = append(*where, "(target_type = 'employee' AND target_code = ?)")
		*args = append(*args, uid)
	case "dept":
		uid := financePerformanceCurrentUserFromQuery(query)
		deptCodes := financePerformanceDeptCodesFromQuery(query)
		parts := make([]string, 0, 3)
		if uid != "" {
			parts = append(parts, "(target_type = 'employee' AND target_code = ?)")
			*args = append(*args, uid)
		}
		if len(deptCodes) > 0 {
			parts = append(parts, "(target_type = 'dept' AND target_code IN ("+placeholders(len(deptCodes))+"))")
			for _, code := range deptCodes {
				*args = append(*args, code)
			}
			parts = append(parts, `(target_type = 'employee' AND EXISTS (
				SELECT 1
				FROM employee_finance_performance scoped_performance
				WHERE scoped_performance.employee_uid = target_code
				  AND scoped_performance.period_month = performance_calculation_snapshot.period_month
				  AND scoped_performance.dept_code IN (`+placeholders(len(deptCodes))+`)
			))`)
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

func requireFinancePerformanceGlobalQueryAccess(query url.Values) error {
	switch financePerformanceAccessFromQuery(query) {
	case "all":
		return nil
	case "":
		if financePerformanceCurrentUserFromQuery(query) == "" {
			return nil
		}
		return financePerformanceForbidden()
	default:
		return financePerformanceForbidden()
	}
}

func requireFinancePerformanceGlobalBodyAccess(body jsonBody) error {
	switch financePerformanceAccessFromBody(body) {
	case "all":
		return nil
	case "":
		if financePerformanceCurrentUserFromBody(body) == "" {
			return nil
		}
		return financePerformanceForbidden()
	default:
		return financePerformanceForbidden()
	}
}

func requireFinanceEmployeePerformanceQueryAccess(query url.Values, row map[string]any) error {
	return requireFinanceEmployeePerformanceRecordAccess(
		financePerformanceAccessFromQuery(query),
		financePerformanceCurrentUserFromQuery(query),
		financePerformanceDeptCodesFromQuery(query),
		row,
		nil,
	)
}

func requireFinanceEmployeePerformanceBodyAccess(body jsonBody, row map[string]any) error {
	return requireFinanceEmployeePerformanceRecordAccess(
		financePerformanceAccessFromBody(body),
		financePerformanceCurrentUserFromBody(body),
		financePerformanceDeptCodesFromBody(body),
		row,
		body,
	)
}

func requireFinanceEmployeePerformanceCreateAccess(body jsonBody) error {
	access := financePerformanceAccessFromBody(body)
	if access == "" || access == "all" {
		return nil
	}
	if access != "self" && access != "dept" {
		return financePerformanceForbidden()
	}

	uid := financePerformanceCurrentUserFromBody(body)
	if uid == "" {
		return financePerformanceForbidden()
	}
	employeeUID := cleanStringValue(bodyValue(body, "employeeUid", "employee_uid"))
	if employeeUID == "" && access == "self" {
		body["employeeUid"] = uid
		body["employee_uid"] = uid
		return nil
	}
	if employeeUID == uid {
		return nil
	}
	if access == "self" {
		return financePerformanceForbidden()
	}

	deptCode := cleanStringValue(bodyValue(body, "deptCode", "dept_code"))
	if !containsApplicantRequestDeptCode(financePerformanceDeptCodesFromBody(body), deptCode) {
		return financePerformanceForbidden()
	}
	return nil
}

func requireFinanceEmployeePerformanceRecordAccess(access string, uid string, deptCodes []string, row map[string]any, body jsonBody) error {
	switch access {
	case "", "all":
		return nil
	case "self":
		if uid == "" || cleanStringValue(row["employee_uid"]) != uid {
			return financePerformanceForbidden()
		}
		if body != nil {
			employeeUID := cleanStringValue(bodyValue(body, "employeeUid", "employee_uid"))
			if employeeUID != "" && employeeUID != uid {
				return financePerformanceForbidden()
			}
		}
		return nil
	case "dept":
		rowEmployeeUID := cleanStringValue(row["employee_uid"])
		rowDeptCode := cleanStringValue(row["dept_code"])
		if (uid == "" || rowEmployeeUID != uid) && !containsApplicantRequestDeptCode(deptCodes, rowDeptCode) {
			return financePerformanceForbidden()
		}
		if body != nil {
			employeeUID := cleanStringValue(bodyValue(body, "employeeUid", "employee_uid"))
			deptCode := cleanStringValue(bodyValue(body, "deptCode", "dept_code"))
			effectiveEmployeeUID := employeeUID
			if effectiveEmployeeUID == "" {
				effectiveEmployeeUID = rowEmployeeUID
			}
			if employeeUID != "" && employeeUID != uid {
				if deptCode == "" {
					deptCode = rowDeptCode
				}
				if !containsApplicantRequestDeptCode(deptCodes, deptCode) {
					return financePerformanceForbidden()
				}
			}
			if deptCode != "" && !containsApplicantRequestDeptCode(deptCodes, deptCode) && effectiveEmployeeUID != uid {
				return financePerformanceForbidden()
			}
		}
		return nil
	default:
		return financePerformanceForbidden()
	}
}

func requirePerformanceCalculationSnapshotQueryAccess(query url.Values, row map[string]any) error {
	switch financePerformanceAccessFromQuery(query) {
	case "", "all":
		return nil
	case "self":
		uid := financePerformanceCurrentUserFromQuery(query)
		if uid != "" && cleanStringValue(row["target_type"]) == "employee" && cleanStringValue(row["target_code"]) == uid {
			return nil
		}
		return financePerformanceForbidden()
	case "dept":
		uid := financePerformanceCurrentUserFromQuery(query)
		targetType := cleanStringValue(row["target_type"])
		targetCode := cleanStringValue(row["target_code"])
		if uid != "" && targetType == "employee" && targetCode == uid {
			return nil
		}
		if targetType == "dept" && containsApplicantRequestDeptCode(financePerformanceDeptCodesFromQuery(query), targetCode) {
			return nil
		}
		return financePerformanceForbidden()
	default:
		return financePerformanceForbidden()
	}
}

func financePerformanceForbidden() error {
	return httperror.New(http.StatusForbidden, "finance_performance_access_denied", "only authorized users can access finance performance data")
}
