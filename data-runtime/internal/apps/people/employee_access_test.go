package people

import (
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestEmployeeRecordSelfAccess(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_employee_access", "self")
	query.Set("current_user", "u1")

	if err := requireEmployeeRecordQueryAccess(query, map[string]any{"employee_uid": "u1"}); err != nil {
		t.Fatalf("expected self employee access, got %v", err)
	}

	err := requireEmployeeRecordQueryAccess(query, map[string]any{"employee_uid": "u2"})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_employee_access_denied" {
		t.Fatalf("expected people_employee_access_denied 403, got %#v", err)
	}
}

func TestMissingEmployeeScopeFailsClosedBeforeRuntimeRead(t *testing.T) {
	query := url.Values{}
	for name, check := range map[string]func() error{
		"query":  func() error { return requireEmployeeQueryAccess(query) },
		"global": func() error { return requireEmployeeGlobalAccess(query) },
		"record": func() error { return requireEmployeeRecordQueryAccess(query, map[string]any{"employee_uid": "u1"}) },
	} {
		err := check()
		httpErr, ok := err.(httperror.Error)
		if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_employee_access_denied" {
			t.Fatalf("%s missing scope must fail closed, got %#v", name, err)
		}
	}

	adapter := &Adapter{}
	_, operation, err := adapter.HandleRuntime(
		t.Context(),
		http.MethodGet,
		"/v1/people/employees/u1/profile",
		url.Values{},
		map[string]any{},
	)
	if operation != "people.employees.access" {
		t.Fatalf("unexpected operation %q", operation)
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden {
		t.Fatalf("profile must reject missing scope before DB access, got %#v", err)
	}
}

func TestEmployeeRecordDeptAccess(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_employee_access", "dept")
	query.Set("current_user", "u1")
	query.Set("current_user_employee_dept_codes", "D1,D2")

	if err := requireEmployeeRecordQueryAccess(query, map[string]any{"employee_uid": "u2", "dept_code": "D2"}); err != nil {
		t.Fatalf("expected dept employee access, got %v", err)
	}
	if err := requireEmployeeRecordQueryAccess(query, map[string]any{"employee_uid": "u1", "dept_code": "D3"}); err != nil {
		t.Fatalf("expected self employee access inside dept mode, got %v", err)
	}

	err := requireEmployeeRecordQueryAccess(query, map[string]any{"employee_uid": "u3", "dept_code": "D3"})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_employee_access_denied" {
		t.Fatalf("expected people_employee_access_denied 403, got %#v", err)
	}
}

func TestEmployeeRecordDeptAccessAcceptsDataRuntimeDeptKey(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_employee_access", "dept")
	query.Set("current_user_data_dept_codes", "D1,D2")

	if err := requireEmployeeRecordQueryAccess(query, map[string]any{"employee_uid": "u2", "dept_code": "D1"}); err != nil {
		t.Fatalf("expected data runtime dept key to grant access, got %v", err)
	}
}

func TestEmployeeGlobalAccess(t *testing.T) {
	selfQuery := url.Values{}
	selfQuery.Set("current_user_employee_access", "self")
	if err := requireEmployeeGlobalAccess(selfQuery); err == nil {
		t.Fatal("expected self-scoped global employee operation to be denied")
	}

	deptQuery := url.Values{}
	deptQuery.Set("current_user_employee_access", "dept")
	if err := requireEmployeeGlobalAccess(deptQuery); err == nil {
		t.Fatal("expected dept-scoped global employee operation to be denied")
	}

	allQuery := url.Values{}
	allQuery.Set("current_user_employee_access", "all")
	if err := requireEmployeeGlobalAccess(allQuery); err != nil {
		t.Fatalf("expected all-scoped global employee operation, got %v", err)
	}
}

func TestEmployeeSensitiveCostFieldRequiresStandardCostGlobalAccess(t *testing.T) {
	missingQuery := url.Values{}
	err := requireEmployeeSensitiveCostFieldAccess(missingQuery, map[string]any{
		"monthly_standard_cost": "1000",
	})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_employee_access_denied" {
		t.Fatalf("expected missing standard cost access to fail closed, got %#v", err)
	}

	query := url.Values{}
	query.Set("current_user_standard_cost_access", "none")
	err = requireEmployeeSensitiveCostFieldAccess(query, map[string]any{
		"monthly_standard_cost": "1000",
	})
	httpErr, ok = err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_employee_access_denied" {
		t.Fatalf("expected people_employee_access_denied 403, got %#v", err)
	}

	query.Set("current_user_standard_cost_access", "all")
	if err := requireEmployeeSensitiveCostFieldAccess(query, map[string]any{"monthlyStandardCost": "1000"}); err != nil {
		t.Fatalf("expected standard costs all access, got %v", err)
	}
	if err := requireEmployeeSensitiveCostFieldAccess(query, map[string]any{"cost_center_code": "CC-1"}); err != nil {
		t.Fatalf("expected standard costs all access for cost center, got %v", err)
	}
	if err := requireEmployeeSensitiveCostFieldAccess(query, map[string]any{"rank_code": "P6", "rank_name": "专业 P6"}); err != nil {
		t.Fatalf("expected standard costs all access for rank fields, got %v", err)
	}

	query.Set("current_user_standard_cost_access", "none")
	err = requireEmployeeSensitiveCostFieldAccess(query, map[string]any{"costCenterCode": "CC-1"})
	httpErr, ok = err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_employee_access_denied" {
		t.Fatalf("expected cost center update to require standard cost access, got %#v", err)
	}
	err = requireEmployeeSensitiveCostFieldAccess(query, map[string]any{"rankCode": "P6"})
	httpErr, ok = err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_employee_access_denied" {
		t.Fatalf("expected rank update to require standard cost access, got %#v", err)
	}

	if err := requireEmployeeSensitiveCostFieldAccess(query, map[string]any{"display_name": "Alice"}); err != nil {
		t.Fatalf("expected non-sensitive employee field to pass, got %v", err)
	}
}

func TestRedactEmployeeSensitiveCostFieldsRequiresStandardCostAccess(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_standard_cost_access", "none")
	row := map[string]any{
		"employee_uid":          "u1",
		"display_name":          "Alice",
		"monthly_standard_cost": "1000",
		"monthlyStandardCost":   "1000",
		"cost_center_code":      "CC-1",
		"costCenterCode":        "CC-1",
		"rank_code":             "P6",
		"rankCode":              "P6",
		"rank_name":             "专业 P6",
		"rankName":              "专业 P6",
	}

	redactEmployeeSensitiveCostFields(query, row)

	if _, ok := row["monthly_standard_cost"]; ok {
		t.Fatalf("expected snake-case standard cost to be redacted, got %#v", row)
	}
	if _, ok := row["monthlyStandardCost"]; ok {
		t.Fatalf("expected camel-case standard cost to be redacted, got %#v", row)
	}
	if _, ok := row["cost_center_code"]; ok {
		t.Fatalf("expected snake-case cost center to be redacted, got %#v", row)
	}
	if _, ok := row["costCenterCode"]; ok {
		t.Fatalf("expected camel-case cost center to be redacted, got %#v", row)
	}
	if _, ok := row["rank_code"]; ok {
		t.Fatalf("expected snake-case rank code to be redacted, got %#v", row)
	}
	if _, ok := row["rankCode"]; ok {
		t.Fatalf("expected camel-case rank code to be redacted, got %#v", row)
	}
	if _, ok := row["rank_name"]; ok {
		t.Fatalf("expected snake-case rank name to be redacted, got %#v", row)
	}
	if _, ok := row["rankName"]; ok {
		t.Fatalf("expected camel-case rank name to be redacted, got %#v", row)
	}
	if row["display_name"] != "Alice" {
		t.Fatalf("expected non-sensitive employee fields to remain, got %#v", row)
	}

	allowedQuery := url.Values{}
	allowedQuery.Set("current_user_standard_cost_access", "all")
	allowedRow := map[string]any{"monthly_standard_cost": "1000", "rank_code": "P6"}
	redactEmployeeSensitiveCostFields(allowedQuery, allowedRow)
	if allowedRow["monthly_standard_cost"] != "1000" || allowedRow["rank_code"] != "P6" {
		t.Fatalf("expected standard cost access to preserve sensitive fields, got %#v", allowedRow)
	}

	response := map[string]any{
		"data": map[string]any{
			"items": []any{
				map[string]any{
					"assignment_code": "ASN-1",
					"rank_code":       "P6",
					"rank_name":       "专业 P6",
				},
			},
		},
	}
	redactEmployeeSensitiveCostFieldsInResponse(query, response)
	items, ok := response["data"].(map[string]any)["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("expected nested response items, got %#v", response)
	}
	assignment, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("expected assignment item, got %#v", items[0])
	}
	if _, ok := assignment["rank_code"]; ok {
		t.Fatalf("expected assignment rank code to be redacted in nested response, got %#v", response)
	}
	if _, ok := assignment["rank_name"]; ok {
		t.Fatalf("expected assignment rank name to be redacted in nested response, got %#v", response)
	}
}

func TestCanReadEmployeeProfileCostSnapshotsUsesDedicatedAccess(t *testing.T) {
	employee := map[string]any{"employee_uid": "u1", "dept_code": "D1"}

	noneQuery := url.Values{}
	if canReadEmployeeProfileCostSnapshots(noneQuery, employee) {
		t.Fatal("missing cost snapshot access must not expose embedded profile snapshots")
	}

	selfQuery := url.Values{}
	selfQuery.Set("current_user_cost_snapshot_access", "self")
	selfQuery.Set("current_user", "u1")
	if !canReadEmployeeProfileCostSnapshots(selfQuery, employee) {
		t.Fatal("expected self cost snapshot access to expose own embedded snapshots")
	}

	deptQuery := url.Values{}
	deptQuery.Set("current_user_cost_snapshot_access", "dept")
	deptQuery.Set("current_user_cost_snapshot_dept_codes", "D1,D2")
	if !canReadEmployeeProfileCostSnapshots(deptQuery, employee) {
		t.Fatal("expected department cost snapshot access to expose department embedded snapshots")
	}

	otherDeptQuery := url.Values{}
	otherDeptQuery.Set("current_user_cost_snapshot_access", "dept")
	otherDeptQuery.Set("current_user_cost_snapshot_dept_codes", "D3")
	if canReadEmployeeProfileCostSnapshots(otherDeptQuery, employee) {
		t.Fatal("department cost snapshot access must not expose other departments")
	}
}

func TestEmployeeProfileEmbeddedResourcesUseDedicatedAccess(t *testing.T) {
	employee := map[string]any{"employee_uid": "u1", "dept_code": "D1"}

	noAssignmentQuery := url.Values{}
	if canReadEmployeeProfileAssignments(noAssignmentQuery, employee) {
		t.Fatal("missing assignment access must not expose embedded assignments")
	}
	assignmentSelfQuery := url.Values{}
	assignmentSelfQuery.Set("current_user_assignment_access", "self")
	assignmentSelfQuery.Set("current_user", "u1")
	if !canReadEmployeeProfileAssignments(assignmentSelfQuery, employee) {
		t.Fatal("expected assignment self access to expose own embedded assignments")
	}

	noPerformanceQuery := url.Values{}
	if canReadEmployeeProfilePerformanceCycles(noPerformanceQuery, employee) {
		t.Fatal("missing performance cycle access must not expose embedded performance data")
	}
	performanceDeptQuery := url.Values{}
	performanceDeptQuery.Set("current_user_performance_cycle_access", "dept")
	performanceDeptQuery.Set("current_user_performance_cycle_dept_codes", "D1,D2")
	if !canReadEmployeeProfilePerformanceCycles(performanceDeptQuery, employee) {
		t.Fatal("expected performance cycle department access to expose department embedded data")
	}
	otherDeptQuery := url.Values{}
	otherDeptQuery.Set("current_user_performance_cycle_access", "dept")
	otherDeptQuery.Set("current_user_performance_cycle_dept_codes", "D3")
	if canReadEmployeeProfilePerformanceCycles(otherDeptQuery, employee) {
		t.Fatal("performance cycle department access must not expose other departments")
	}

	noDocumentQuery := url.Values{}
	if canReadEmployeeProfileDocuments(noDocumentQuery, employee) {
		t.Fatal("missing document access must not expose embedded profile documents")
	}
	documentSelfQuery := url.Values{}
	documentSelfQuery.Set("current_user_document_access", "self")
	documentSelfQuery.Set("current_user", "u1")
	if !canReadEmployeeProfileDocuments(documentSelfQuery, employee) {
		t.Fatal("expected document self access to expose own embedded profile documents")
	}
	documentDeptQuery := url.Values{}
	documentDeptQuery.Set("current_user_document_access", "dept")
	documentDeptQuery.Set("current_user_document_dept_codes", "D1,D2")
	if !canReadEmployeeProfileDocuments(documentDeptQuery, employee) {
		t.Fatal("expected document department access to expose department embedded profile documents")
	}
	otherDocumentDeptQuery := url.Values{}
	otherDocumentDeptQuery.Set("current_user_document_access", "dept")
	otherDocumentDeptQuery.Set("current_user_document_dept_codes", "D3")
	if canReadEmployeeProfileDocuments(otherDocumentDeptQuery, employee) {
		t.Fatal("document department access must not expose other departments")
	}
}

func TestEmployeeScopedRuntimePathIncludesAssignments(t *testing.T) {
	for _, path := range []string{
		"/v1/people/employees",
		"/v1/people/employees/u1",
		"/v1/people/employees/u1/profile",
		"/v1/people/assignments",
		"/v1/people/assignments/ASN-1",
	} {
		if !isEmployeeScopedRuntimePath(path) {
			t.Fatalf("expected %s to use employee scoped access", path)
		}
	}
	if isEmployeeScopedRuntimePath("/v1/people/cost-snapshots") {
		t.Fatal("cost snapshots should not use employee scoped access in this batch")
	}
}

func TestPeopleScopedSensitiveRuntimePathIncludesCostAndPerformance(t *testing.T) {
	for _, path := range []string{
		"/v1/people/cost-snapshots",
		"/v1/people/cost-snapshots/COST-1",
		"/v1/people/performance-cycles",
		"/v1/people/performance-cycles/PC-1",
		"/v1/people/performance-cycles/PC-1/detail",
		"/v1/people/contribution-snapshots",
		"/v1/people/contribution-snapshots/CONTR-1",
		"/v1/people/documents",
		"/v1/people/documents/PDOC-1",
	} {
		if !isPeopleScopedSensitiveRuntimePath(path) {
			t.Fatalf("expected %s to use sensitive people scoped access", path)
		}
	}
	if isPeopleScopedSensitiveRuntimePath("/v1/people/standard-costs") {
		t.Fatal("standard cost settings should not use employee sensitive scoped access")
	}
}

func TestPeopleGlobalSensitiveRuntimePathIncludesStandardCosts(t *testing.T) {
	for _, path := range []string{
		"/v1/people/standard-costs",
		"/v1/people/standard-costs/SCR-P6-2026",
	} {
		if !isPeopleGlobalSensitiveRuntimePath(path) {
			t.Fatalf("expected %s to use global sensitive people access", path)
		}
	}
	if isPeopleGlobalSensitiveRuntimePath("/v1/people/cost-snapshots") {
		t.Fatal("cost snapshots should keep employee scoped sensitive access")
	}
}

func TestPeopleDocumentsUseEmployeeParentScope(t *testing.T) {
	content, err := os.ReadFile("adapter.go")
	if err != nil {
		t.Fatalf("failed to read adapter.go: %v", err)
	}
	source := string(content)

	documentsIndex := strings.Index(source, `Path:           "documents"`)
	if documentsIndex < 0 {
		t.Fatal("expected documents resource to be registered")
	}
	for _, expected := range []string{
		"ParentScope: &compat.ParentScopeSpec",
		`Table:            "people_employees"`,
		`LocalColumn:      "employee_uid"`,
		`OwnerColumn:      "employee_uid"`,
		`DepartmentColumn: "dept_code"`,
	} {
		foundIndex := strings.Index(source[documentsIndex:], expected)
		if foundIndex < 0 {
			t.Fatalf("expected documents resource to include %s", expected)
		}
	}
}

func TestPeopleEmployeeListSupportsUIDAndDepartmentSetFilters(t *testing.T) {
	content, err := os.ReadFile("adapter.go")
	if err != nil {
		t.Fatalf("failed to read adapter.go: %v", err)
	}
	source := string(content)

	employeesIndex := strings.Index(source, `Path:             "employees"`)
	positionsIndex := strings.Index(source, `Path:           "positions"`)
	if employeesIndex < 0 || positionsIndex <= employeesIndex {
		t.Fatal("expected employees resource before positions resource")
	}
	employeeSpec := source[employeesIndex:positionsIndex]
	for _, expected := range []string{
		`"employee_uids": "employee_uid"`,
		`"dept_codes":    "dept_code"`,
	} {
		if !strings.Contains(employeeSpec, expected) {
			t.Fatalf("expected employees resource to include %s", expected)
		}
	}
}

func TestPeopleGlobalSensitiveAccessRequiresAll(t *testing.T) {
	selfQuery := url.Values{}
	selfQuery.Set("current_user_employee_access", "self")
	if err := requireEmployeeGlobalAccess(selfQuery); err == nil {
		t.Fatal("expected self-scoped standard costs access to be denied")
	}

	deptQuery := url.Values{}
	deptQuery.Set("current_user_employee_access", "dept")
	if err := requireEmployeeGlobalAccess(deptQuery); err == nil {
		t.Fatal("expected dept-scoped standard costs access to be denied")
	}

	allQuery := url.Values{}
	allQuery.Set("current_user_employee_access", "all")
	if err := requireEmployeeGlobalAccess(allQuery); err != nil {
		t.Fatalf("expected all-scoped standard costs access, got %v", err)
	}
}

func TestAssignmentRuntimePath(t *testing.T) {
	if !isAssignmentRuntimePath("/v1/people/assignments/ASN-1") {
		t.Fatal("expected assignment detail path to match")
	}
	if isAssignmentRuntimePath("/v1/people/employees/u1") {
		t.Fatal("employee detail path should not match assignment path")
	}
}

func TestEmployeeRuntimePathExcludesProfile(t *testing.T) {
	if !isEmployeeRuntimePath("/v1/people/employees/u1") {
		t.Fatal("expected employee detail path to match")
	}
	if isEmployeeRuntimePath("/v1/people/employees/u1/profile") {
		t.Fatal("employee profile path should not be treated as writable employee record")
	}
}

func TestRejectGenericAssignmentApprovalMutation(t *testing.T) {
	err := rejectGenericAssignmentApprovalMutation(
		http.MethodPost,
		"/v1/people/assignments",
		map[string]any{"approval_status": "approved"},
	)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_assignment_approval_requires_workflow" {
		t.Fatalf("expected assignment approval forbidden error, got %#v", err)
	}

	err = rejectGenericAssignmentApprovalMutation(
		http.MethodPatch,
		"/v1/people/assignments/ASN-1",
		map[string]any{"workflowInstanceId": "wf-1"},
	)
	httpErr, ok = err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_assignment_approval_requires_workflow" {
		t.Fatalf("expected workflow instance forbidden error, got %#v", err)
	}

	if err := rejectGenericAssignmentApprovalMutation(
		http.MethodPatch,
		"/v1/people/assignments/ASN-1",
		map[string]any{"dept_code": "D1"},
	); err != nil {
		t.Fatalf("expected ordinary assignment metadata update to pass, got %v", err)
	}
}

func TestRejectGenericCostSnapshotConfirmationMutation(t *testing.T) {
	err := rejectGenericCostSnapshotConfirmationMutation(
		http.MethodPost,
		"/v1/people/cost-snapshots",
		map[string]any{"confirmed_at": "2026-06-30 12:00:00"},
	)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_cost_snapshot_confirmation_requires_approval" {
		t.Fatalf("expected cost snapshot confirmation forbidden error, got %#v", err)
	}

	err = rejectGenericCostSnapshotConfirmationMutation(
		http.MethodPatch,
		"/v1/people/cost-snapshots/COST-1",
		map[string]any{"confirmedAt": "2026-06-30T12:00:00Z"},
	)
	httpErr, ok = err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_cost_snapshot_confirmation_requires_approval" {
		t.Fatalf("expected camel-case confirmation forbidden error, got %#v", err)
	}

	if err := rejectGenericCostSnapshotConfirmationMutation(
		http.MethodPatch,
		"/v1/people/cost-snapshots/COST-1",
		map[string]any{"actual_cost": 12000},
	); err != nil {
		t.Fatalf("expected ordinary cost snapshot metadata update to pass, got %v", err)
	}
}

func TestSanitizePeopleRuntimeAuthBodyRemovesDataScope(t *testing.T) {
	body := map[string]any{
		"current_user":                      "u1",
		"current_user_employee_access":      "all",
		"current_user_employee_dept_codes":  "D1",
		"current_user_data_access":          "all",
		"current_user_data_dept_codes":      "D1",
		"current_user_standard_cost_access": "all",
		"current_user_document_access":      "all",
		"current_user_document_dept_codes":  "D1",
		"displayName":                       "Alice",
	}

	sanitizePeopleRuntimeAuthBody(body)

	for _, key := range []string{
		"current_user_employee_access",
		"current_user_employee_dept_codes",
		"current_user_data_access",
		"current_user_data_dept_codes",
		"current_user_standard_cost_access",
		"current_user_document_access",
		"current_user_document_dept_codes",
	} {
		if _, ok := body[key]; ok {
			t.Fatalf("expected %s to be removed from body %#v", key, body)
		}
	}
	if body["current_user"] != "u1" || body["displayName"] != "Alice" {
		t.Fatalf("expected non-scope fields to be preserved, got %#v", body)
	}
}

func TestPeopleRuntimeActorFromRequestPrefersTrustedQuery(t *testing.T) {
	query := url.Values{}
	query.Set("operator_uid", "trusted-operator")
	query.Set("current_user", "trusted-user")
	body := map[string]any{
		"operator_uid": "body-operator",
		"current_user": "body-user",
	}

	if actor := peopleRuntimeActorFromRequest(query, body); actor != "trusted-operator" {
		t.Fatalf("expected query operator to win, got %#v", actor)
	}
}

func TestPeopleRuntimeActorFromRequestAllowsBodyFallback(t *testing.T) {
	body := map[string]any{
		"currentUser": "legacy-user",
	}

	if actor := peopleRuntimeActorFromRequest(url.Values{}, body); actor != "legacy-user" {
		t.Fatalf("expected body actor fallback, got %#v", actor)
	}
}
