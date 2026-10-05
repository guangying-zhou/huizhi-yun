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

var costSnapshotDeptCodeKeys = []string{
	"current_user_cost_snapshot_dept_codes",
	"currentUserCostSnapshotDeptCodes",
	"current_user_cost_snapshot_dept_code",
	"currentUserCostSnapshotDeptCode",
}

var assignmentDeptCodeKeys = []string{
	"current_user_assignment_dept_codes",
	"currentUserAssignmentDeptCodes",
	"current_user_assignment_dept_code",
	"currentUserAssignmentDeptCode",
}

var performanceCycleDeptCodeKeys = []string{
	"current_user_performance_cycle_dept_codes",
	"currentUserPerformanceCycleDeptCodes",
	"current_user_performance_cycle_dept_code",
	"currentUserPerformanceCycleDeptCode",
}

var documentDeptCodeKeys = []string{
	"current_user_document_dept_codes",
	"currentUserDocumentDeptCodes",
	"current_user_document_dept_code",
	"currentUserDocumentDeptCode",
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

func peopleRuntimeActorFromRequest(query url.Values, body map[string]any, bodyKeys ...string) string {
	actor := firstCleanEmployeeAccessValue(
		query.Get("operator_uid"),
		query.Get("operatorUid"),
		query.Get("current_user"),
		query.Get("currentUser"),
	)
	if actor != "" {
		return actor
	}
	if len(bodyKeys) == 0 {
		bodyKeys = []string{"operator_uid", "operatorUid", "currentUser", "current_user"}
	}
	return cleanBodyString(body, bodyKeys...)
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
	case "all", "self", "dept":
		return nil
	default:
		return employeeAccessForbidden()
	}
}

func requireEmployeeGlobalAccess(query url.Values) error {
	switch employeeAccessFromQuery(query) {
	case "all":
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

func hasStandardCostReadAccess(query url.Values) bool {
	return standardCostAccessFromQuery(query) == "all"
}

func requireStandardCostGlobalAccess(query url.Values) error {
	switch standardCostAccessFromQuery(query) {
	case "all":
		return nil
	default:
		return employeeAccessForbidden()
	}
}

func employeeSensitiveCostFieldPresent(body map[string]any) bool {
	if body == nil {
		return false
	}
	for _, key := range []string{
		"monthly_standard_cost",
		"monthlyStandardCost",
		"cost_center_code",
		"costCenterCode",
		"rank_code",
		"rankCode",
		"rank_name",
		"rankName",
	} {
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

func redactEmployeeSensitiveCostFields(query url.Values, row map[string]any) {
	if row == nil || hasStandardCostReadAccess(query) {
		return
	}
	delete(row, "monthly_standard_cost")
	delete(row, "monthlyStandardCost")
	delete(row, "cost_center_code")
	delete(row, "costCenterCode")
	delete(row, "rank_code")
	delete(row, "rankCode")
	delete(row, "rank_name")
	delete(row, "rankName")
}

func redactEmployeeSensitiveCostFieldsInResponse(query url.Values, value any) {
	switch typed := value.(type) {
	case map[string]any:
		if data, ok := typed["data"]; ok {
			redactEmployeeSensitiveCostFieldsInResponse(query, data)
			return
		}
		if items, ok := typed["items"]; ok {
			redactEmployeeSensitiveCostFieldsInResponse(query, items)
		}
		redactEmployeeSensitiveCostFields(query, typed)
	case []map[string]any:
		for _, item := range typed {
			redactEmployeeSensitiveCostFields(query, item)
		}
	case []any:
		for _, item := range typed {
			redactEmployeeSensitiveCostFieldsInResponse(query, item)
		}
	}
}

func costSnapshotAccessFromQuery(query url.Values) string {
	return firstCleanEmployeeAccessValue(
		query.Get("current_user_cost_snapshot_access"),
		query.Get("currentUserCostSnapshotAccess"),
	)
}

func costSnapshotDeptCodesFromQuery(query url.Values) []string {
	values := make([]string, 0, len(costSnapshotDeptCodeKeys))
	for _, key := range costSnapshotDeptCodeKeys {
		values = append(values, query[key]...)
	}
	return splitEmployeeDeptCodes(values...)
}

func assignmentAccessFromQuery(query url.Values) string {
	return firstCleanEmployeeAccessValue(
		query.Get("current_user_assignment_access"),
		query.Get("currentUserAssignmentAccess"),
	)
}

func assignmentDeptCodesFromQuery(query url.Values) []string {
	values := make([]string, 0, len(assignmentDeptCodeKeys))
	for _, key := range assignmentDeptCodeKeys {
		values = append(values, query[key]...)
	}
	return splitEmployeeDeptCodes(values...)
}

func performanceCycleAccessFromQuery(query url.Values) string {
	return firstCleanEmployeeAccessValue(
		query.Get("current_user_performance_cycle_access"),
		query.Get("currentUserPerformanceCycleAccess"),
	)
}

func performanceCycleDeptCodesFromQuery(query url.Values) []string {
	values := make([]string, 0, len(performanceCycleDeptCodeKeys))
	for _, key := range performanceCycleDeptCodeKeys {
		values = append(values, query[key]...)
	}
	return splitEmployeeDeptCodes(values...)
}

func documentAccessFromQuery(query url.Values) string {
	return firstCleanEmployeeAccessValue(
		query.Get("current_user_document_access"),
		query.Get("currentUserDocumentAccess"),
	)
}

func documentDeptCodesFromQuery(query url.Values) []string {
	values := make([]string, 0, len(documentDeptCodeKeys))
	for _, key := range documentDeptCodeKeys {
		values = append(values, query[key]...)
	}
	return splitEmployeeDeptCodes(values...)
}

func canReadEmployeeProfileEmbeddedResource(query url.Values, employee map[string]any, access string, deptCodes []string) bool {
	switch access {
	case "all":
		return true
	case "self":
		uid := employeeCurrentUserFromQuery(query)
		return uid != "" && cleanAnyString(employee["employee_uid"]) == uid
	case "dept":
		uid := employeeCurrentUserFromQuery(query)
		if uid != "" && cleanAnyString(employee["employee_uid"]) == uid {
			return true
		}
		return containsEmployeeDeptCode(deptCodes, cleanAnyString(employee["dept_code"]))
	default:
		return false
	}
}

func canReadEmployeeProfileAssignments(query url.Values, employee map[string]any) bool {
	return canReadEmployeeProfileEmbeddedResource(query, employee, assignmentAccessFromQuery(query), assignmentDeptCodesFromQuery(query))
}

func canReadEmployeeProfileCostSnapshots(query url.Values, employee map[string]any) bool {
	return canReadEmployeeProfileEmbeddedResource(query, employee, costSnapshotAccessFromQuery(query), costSnapshotDeptCodesFromQuery(query))
}

func canReadEmployeeProfilePerformanceCycles(query url.Values, employee map[string]any) bool {
	return canReadEmployeeProfileEmbeddedResource(query, employee, performanceCycleAccessFromQuery(query), performanceCycleDeptCodesFromQuery(query))
}

func canReadEmployeeProfileDocuments(query url.Values, employee map[string]any) bool {
	return canReadEmployeeProfileEmbeddedResource(query, employee, documentAccessFromQuery(query), documentDeptCodesFromQuery(query))
}

func requireEmployeeRecordQueryAccess(query url.Values, row map[string]any) error {
	switch employeeAccessFromQuery(query) {
	case "all":
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
