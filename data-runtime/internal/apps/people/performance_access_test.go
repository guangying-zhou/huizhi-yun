package people

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestEmployeeScopedRowClauseSelf(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_employee_access", "self")
	query.Set("current_user", "u1")

	where, args, err := employeeScopedRowClause(query, "pcs.employee_uid")
	if err != nil {
		t.Fatalf("employeeScopedRowClause returned error: %v", err)
	}
	if where != "pcs.employee_uid = ?" {
		t.Fatalf("unexpected self where %q", where)
	}
	if len(args) != 1 || args[0] != "u1" {
		t.Fatalf("unexpected self args %#v", args)
	}
}

func TestEmployeeScopedRowClauseRejectsMissingAccess(t *testing.T) {
	_, _, err := employeeScopedRowClause(url.Values{}, "pcs.employee_uid")
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_employee_access_denied" {
		t.Fatalf("missing employee scope must fail closed, got %#v", err)
	}
	if err := performanceCycleForbiddenIfScoped(url.Values{}); err == nil {
		t.Fatal("missing performance cycle scope must fail closed")
	}
}

func TestEmployeeScopedRowClauseDeptUsesSelfOrEmployeeDepartment(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_employee_access", "dept")
	query.Set("current_user", "u1")
	query.Set("current_user_employee_dept_codes", "D1,D2")

	where, args, err := employeeScopedRowClause(query, "pcs.employee_uid")
	if err != nil {
		t.Fatalf("employeeScopedRowClause returned error: %v", err)
	}
	for _, expected := range []string{
		"pcs.employee_uid = ?",
		"EXISTS (SELECT 1 FROM people_employees scoped_employee",
		"scoped_employee.employee_uid = pcs.employee_uid",
		"scoped_employee.dept_code IN (?,?)",
	} {
		if !strings.Contains(where, expected) {
			t.Fatalf("expected %q in dept where %q", expected, where)
		}
	}
	expectedArgs := []any{"u1", "D1", "D2"}
	if len(args) != len(expectedArgs) {
		t.Fatalf("unexpected dept args %#v", args)
	}
	for index, expected := range expectedArgs {
		if args[index] != expected {
			t.Fatalf("unexpected dept args %#v", args)
		}
	}
}

func TestPerformanceCycleScopeWhereWrapsContributionScope(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_employee_access", "self")
	query.Set("current_user", "u1")

	where, args, err := performanceCycleScopeWhere(query)
	if err != nil {
		t.Fatalf("performanceCycleScopeWhere returned error: %v", err)
	}
	if !strings.Contains(where, "scoped_contribution.cycle_code = people_performance_cycles.cycle_code") {
		t.Fatalf("unexpected performance cycle where %q", where)
	}
	if !strings.Contains(where, "scoped_contribution.employee_uid = ?") {
		t.Fatalf("expected employee filter in performance cycle where %q", where)
	}
	if len(args) != 1 || args[0] != "u1" {
		t.Fatalf("unexpected performance cycle args %#v", args)
	}
}

func TestPerformanceCycleScopeWhereRejectsNoneAccess(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_employee_access", "none")

	_, _, err := performanceCycleScopeWhere(query)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_employee_access_denied" {
		t.Fatalf("expected people employee forbidden error, got %#v", err)
	}
}

func TestDashboardOverviewEmployeeScopeWhere(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_employee_access", "dept")
	query.Set("current_user", "u1")
	query.Set("current_user_employee_dept_codes", "D1,D2")

	where, args, err := scopedEmployeeWhere(
		query,
		"people_assignments.employee_uid",
		[]string{"effective_to IS NULL"},
		nil,
	)
	if err != nil {
		t.Fatalf("scopedEmployeeWhere returned error: %v", err)
	}
	for _, expected := range []string{
		"effective_to IS NULL",
		"people_assignments.employee_uid = ?",
		"EXISTS (SELECT 1 FROM people_employees scoped_employee",
		"scoped_employee.employee_uid = people_assignments.employee_uid",
		"scoped_employee.dept_code IN (?,?)",
	} {
		if !strings.Contains(where, expected) {
			t.Fatalf("expected %q in dashboard where %q", expected, where)
		}
	}
	expectedArgs := []any{"u1", "D1", "D2"}
	if len(args) != len(expectedArgs) {
		t.Fatalf("unexpected dashboard args %#v", args)
	}
	for index, expected := range expectedArgs {
		if args[index] != expected {
			t.Fatalf("unexpected dashboard args %#v", args)
		}
	}
}

func TestDashboardPerformanceCycleWhereUsesContributionScope(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_employee_access", "self")
	query.Set("current_user", "u1")

	where, args, err := dashboardPerformanceCycleWhere(query)
	if err != nil {
		t.Fatalf("dashboardPerformanceCycleWhere returned error: %v", err)
	}
	for _, expected := range []string{
		"status IN ('draft', 'collecting', 'calculating')",
		"scoped_contribution.cycle_code = people_performance_cycles.cycle_code",
		"scoped_contribution.employee_uid = ?",
	} {
		if !strings.Contains(where, expected) {
			t.Fatalf("expected %q in dashboard cycle where %q", expected, where)
		}
	}
	if len(args) != 1 || args[0] != "u1" {
		t.Fatalf("unexpected dashboard cycle args %#v", args)
	}
}

func TestDashboardCurrentCostRequiresStandardCostReadAccess(t *testing.T) {
	var adapter Adapter
	value, err := adapter.currentMonthActualCost(context.Background(), url.Values{})
	if err != nil {
		t.Fatalf("expected missing standard cost access to skip cost query, got %v", err)
	}
	if value != 0 {
		t.Fatalf("expected hidden dashboard cost to be zero, got %v", value)
	}
}

func TestRejectGenericPerformanceCycleTerminalMutation(t *testing.T) {
	err := rejectGenericPerformanceCycleTerminalMutation(
		http.MethodPost,
		"/v1/people/performance-cycles",
		map[string]any{"status": "confirmed"},
	)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_performance_cycle_status_requires_approval" {
		t.Fatalf("expected performance cycle status forbidden error, got %#v", err)
	}

	err = rejectGenericPerformanceCycleTerminalMutation(
		http.MethodPatch,
		"/v1/people/performance-cycles/PC-1",
		map[string]any{"closedAt": "2026-06-30 10:00:00"},
	)
	httpErr, ok = err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_performance_cycle_status_requires_approval" {
		t.Fatalf("expected performance cycle close timestamp forbidden error, got %#v", err)
	}

	if err := rejectGenericPerformanceCycleTerminalMutation(
		http.MethodPatch,
		"/v1/people/performance-cycles/PC-1",
		map[string]any{"cycle_name": "Q3 Review"},
	); err != nil {
		t.Fatalf("expected ordinary performance cycle metadata update to pass, got %v", err)
	}
}

func TestRejectGenericContributionSnapshotMutation(t *testing.T) {
	for _, test := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/v1/people/contribution-snapshots"},
		{method: http.MethodPatch, path: "/v1/people/contribution-snapshots/CONTR-1"},
		{method: http.MethodPut, path: "/v1/people/contribution-snapshots/CONTR-1"},
		{method: http.MethodDelete, path: "/v1/people/contribution-snapshots/CONTR-1"},
	} {
		err := rejectGenericContributionSnapshotMutation(test.method, test.path)
		httpErr, ok := err.(httperror.Error)
		if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_contribution_snapshot_requires_sync" {
			t.Fatalf("%s %s: expected service-managed forbidden error, got %#v", test.method, test.path, err)
		}
	}
	if err := rejectGenericContributionSnapshotMutation(http.MethodGet, "/v1/people/contribution-snapshots/CONTR-1"); err != nil {
		t.Fatalf("expected contribution snapshot reads to remain available, got %v", err)
	}
}
