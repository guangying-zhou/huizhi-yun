package finance

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestFinanceEmployeePerformanceListAccessFiltersSelf(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_finance_performance_access", "self")
	query.Set("current_user", "u1")

	where := []string{}
	args := []any{}
	applyFinanceEmployeePerformanceListAccess(&where, &args, query)

	if got := strings.Join(where, " AND "); got != "employee_uid = ?" {
		t.Fatalf("where = %q, want employee_uid = ?", got)
	}
	if len(args) != 1 || args[0] != "u1" {
		t.Fatalf("args = %#v, want u1", args)
	}
}

func TestFinanceEmployeePerformanceListAccessFiltersDeptOrSelf(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_finance_performance_access", "dept")
	query.Set("current_user", "u1")
	query.Set("current_user_finance_performance_dept_codes", "D1,D2")

	where := []string{}
	args := []any{}
	applyFinanceEmployeePerformanceListAccess(&where, &args, query)

	if got := strings.Join(where, " AND "); got != "(employee_uid = ? OR dept_code IN (?, ?))" {
		t.Fatalf("where = %q, want employee/dept predicate", got)
	}
	expected := []any{"u1", "D1", "D2"}
	if len(args) != len(expected) {
		t.Fatalf("args = %#v, want %#v", args, expected)
	}
	for index, value := range expected {
		if args[index] != value {
			t.Fatalf("args = %#v, want %#v", args, expected)
		}
	}
}

func TestPerformanceCalculationSnapshotListAccessFiltersDeptTargetsAndEmployeeSnapshots(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_finance_performance_access", "dept")
	query.Set("current_user", "u1")
	query.Set("current_user_finance_performance_dept_codes", "D1,D2")

	where := []string{}
	args := []any{}
	applyPerformanceCalculationSnapshotListAccess(&where, &args, query)

	sql := strings.Join(where, " AND ")
	for _, expected := range []string{
		"target_type = 'employee' AND target_code = ?",
		"target_type = 'dept' AND target_code IN (?, ?)",
		"FROM employee_finance_performance scoped_performance",
		"scoped_performance.dept_code IN (?, ?)",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("snapshot where = %q, missing %q", sql, expected)
		}
	}
	expectedArgs := []any{"u1", "D1", "D2", "D1", "D2"}
	if len(args) != len(expectedArgs) {
		t.Fatalf("args = %#v, want %#v", args, expectedArgs)
	}
	for index, value := range expectedArgs {
		if args[index] != value {
			t.Fatalf("args = %#v, want %#v", args, expectedArgs)
		}
	}
}

func TestFinancePerformanceGlobalQueryAccessRequiresAllForUser(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_finance_performance_access", "self")
	query.Set("current_user", "u1")

	assertFinancePerformanceForbidden(t, requireFinancePerformanceGlobalQueryAccess(query))

	allQuery := url.Values{}
	allQuery.Set("current_user_finance_performance_access", "all")
	if err := requireFinancePerformanceGlobalQueryAccess(allQuery); err != nil {
		t.Fatalf("all access should allow performance global read, got %v", err)
	}
	if err := requireFinancePerformanceGlobalQueryAccess(url.Values{}); err != nil {
		t.Fatalf("service context should allow performance global read, got %v", err)
	}
}

func TestFinancePerformanceGlobalBodyAccessRequiresAllForUser(t *testing.T) {
	assertFinancePerformanceForbidden(t, requireFinancePerformanceGlobalBodyAccess(jsonBody{
		"current_user_finance_performance_access": "dept",
		"current_user": "u1",
	}))

	if err := requireFinancePerformanceGlobalBodyAccess(jsonBody{"current_user_finance_performance_access": "all"}); err != nil {
		t.Fatalf("all access should allow performance global write, got %v", err)
	}
	if err := requireFinancePerformanceGlobalBodyAccess(jsonBody{}); err != nil {
		t.Fatalf("service context should allow performance global write, got %v", err)
	}
}

func TestFinanceEmployeePerformanceCreateAccessSelfDefaultsEmployee(t *testing.T) {
	body := jsonBody{
		"current_user_finance_performance_access": "self",
		"current_user": "u1",
	}

	if err := requireFinanceEmployeePerformanceCreateAccess(body); err != nil {
		t.Fatalf("self create should default employee uid, got %v", err)
	}
	if got := body["employee_uid"]; got != "u1" {
		t.Fatalf("employee_uid = %#v, want u1", got)
	}
}

func TestFinanceEmployeePerformanceCreateAccessRejectsOtherEmployeeForSelf(t *testing.T) {
	err := requireFinanceEmployeePerformanceCreateAccess(jsonBody{
		"current_user_finance_performance_access": "self",
		"current_user": "u1",
		"employee_uid": "u2",
	})

	assertFinancePerformanceForbidden(t, err)
}

func TestFinanceEmployeePerformanceCreateAccessAllowsAuthorizedDept(t *testing.T) {
	body := jsonBody{
		"current_user_finance_performance_access": "dept",
		"current_user": "u1",
		"current_user_finance_performance_dept_codes": "D1,D2",
		"employee_uid": "u2",
		"dept_code":    "D2",
	}

	if err := requireFinanceEmployeePerformanceCreateAccess(body); err != nil {
		t.Fatalf("dept-scoped create should allow authorized department, got %v", err)
	}
}

func TestFinanceEmployeePerformanceCreateAccessRejectsUnauthorizedDept(t *testing.T) {
	err := requireFinanceEmployeePerformanceCreateAccess(jsonBody{
		"current_user_finance_performance_access": "dept",
		"current_user": "u1",
		"current_user_finance_performance_dept_codes": "D1,D2",
		"employee_uid": "u2",
		"dept_code":    "D3",
	})

	assertFinancePerformanceForbidden(t, err)
}

func assertFinancePerformanceForbidden(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("expected finance performance forbidden error, got nil")
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) {
		t.Fatalf("err = %T, want httperror.Error", err)
	}
	if httpErr.Status != http.StatusForbidden || httpErr.Code != "finance_performance_access_denied" {
		t.Fatalf("httperror = %#v, want finance_performance_access_denied forbidden", httpErr)
	}
}
