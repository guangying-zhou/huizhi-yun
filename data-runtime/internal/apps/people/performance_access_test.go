package people

import (
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
