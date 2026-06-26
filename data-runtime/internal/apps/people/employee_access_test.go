package people

import (
	"net/http"
	"net/url"
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
	query := url.Values{}
	query.Set("current_user_standard_cost_access", "none")
	err := requireEmployeeSensitiveCostFieldAccess(query, map[string]any{
		"monthly_standard_cost": "1000",
	})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_employee_access_denied" {
		t.Fatalf("expected people_employee_access_denied 403, got %#v", err)
	}

	query.Set("current_user_standard_cost_access", "all")
	if err := requireEmployeeSensitiveCostFieldAccess(query, map[string]any{"monthlyStandardCost": "1000"}); err != nil {
		t.Fatalf("expected standard costs all access, got %v", err)
	}

	query.Set("current_user_standard_cost_access", "none")
	if err := requireEmployeeSensitiveCostFieldAccess(query, map[string]any{"display_name": "Alice"}); err != nil {
		t.Fatalf("expected non-sensitive employee field to pass, got %v", err)
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

func TestSanitizePeopleRuntimeAuthBodyRemovesDataScope(t *testing.T) {
	body := map[string]any{
		"current_user":                      "u1",
		"current_user_employee_access":      "all",
		"current_user_employee_dept_codes":  "D1",
		"current_user_data_access":          "all",
		"current_user_data_dept_codes":      "D1",
		"current_user_standard_cost_access": "all",
		"displayName":                       "Alice",
	}

	sanitizePeopleRuntimeAuthBody(body)

	for _, key := range []string{
		"current_user_employee_access",
		"current_user_employee_dept_codes",
		"current_user_data_access",
		"current_user_data_dept_codes",
		"current_user_standard_cost_access",
	} {
		if _, ok := body[key]; ok {
			t.Fatalf("expected %s to be removed from body %#v", key, body)
		}
	}
	if body["current_user"] != "u1" || body["displayName"] != "Alice" {
		t.Fatalf("expected non-scope fields to be preserved, got %#v", body)
	}
}
