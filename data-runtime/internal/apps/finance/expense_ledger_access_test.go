package finance

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestExpenseLedgerListAccessDeptFiltersHandlerOrDepartment(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "u1")
	query.Set("current_user_expense_request_access", "dept")
	query.Set("current_user_expense_request_dept_codes", "D1,D2")
	where := []string{"deleted_at IS NULL"}
	args := make([]any, 0)

	applyExpenseLedgerListAccess(&where, &args, query)

	expectedWhere := "(handler_user_id = ? OR department_code IN (?, ?))"
	if len(where) != 2 || where[1] != expectedWhere {
		t.Fatalf("expected handler/dept filter %q, got %#v", expectedWhere, where)
	}
	expectedArgs := []any{"u1", "D1", "D2"}
	if len(args) != len(expectedArgs) {
		t.Fatalf("expected args %#v, got %#v", expectedArgs, args)
	}
	for index, expected := range expectedArgs {
		if args[index] != expected {
			t.Fatalf("expected args %#v, got %#v", expectedArgs, args)
		}
	}
}

func TestExpenseLedgerRecordAccessDeptAllowsAuthorizedDepartment(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "u1")
	query.Set("current_user_expense_request_access", "dept")
	query.Set("current_user_expense_request_dept_codes", "D1,D2")
	row := map[string]any{"handler_user_id": "u2", "department_code": "D2"}

	if err := requireExpenseLedgerQueryAccess(query, row); err != nil {
		t.Fatalf("expected department ledger access, got %v", err)
	}
}

func TestExpenseLedgerRecordAccessRejectsUnauthorizedDepartment(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "u1")
	query.Set("current_user_expense_request_access", "dept")
	query.Set("current_user_expense_request_dept_codes", "D1,D2")
	row := map[string]any{"handler_user_id": "u3", "department_code": "D3"}

	err := requireExpenseLedgerQueryAccess(query, row)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "finance_expense_access_denied" {
		t.Fatalf("expected finance expense forbidden error, got %#v", err)
	}
}

func TestExpenseLedgerCreateAccessDefaultsSelfHandler(t *testing.T) {
	body := jsonBody{
		"current_user":                        "u1",
		"current_user_expense_request_access": "self",
	}

	if err := requireExpenseLedgerCreateAccess(body); err != nil {
		t.Fatalf("expected self scoped ledger create to default handler, got %v", err)
	}
	if body["handler_user_id"] != "u1" || body["handlerUserId"] != "u1" {
		t.Fatalf("expected handler to default to current user, got %#v", body)
	}
}

func TestExpenseLedgerCreateAccessDeptAllowsAuthorizedDepartment(t *testing.T) {
	body := jsonBody{
		"current_user":                            "u1",
		"current_user_expense_request_access":     "dept",
		"current_user_expense_request_dept_codes": "D1,D2",
		"handler_user_id":                         "u2",
		"department_code":                         "D2",
	}

	if err := requireExpenseLedgerCreateAccess(body); err != nil {
		t.Fatalf("expected department scoped ledger create, got %v", err)
	}
}

func TestExpenseLedgerCreateAccessRejectsUnauthorizedScopedWrite(t *testing.T) {
	body := jsonBody{
		"current_user":                            "u1",
		"current_user_expense_request_access":     "dept",
		"current_user_expense_request_dept_codes": "D1,D2",
		"handler_user_id":                         "u3",
		"department_code":                         "D3",
	}

	err := requireExpenseLedgerCreateAccess(body)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "finance_expense_access_denied" {
		t.Fatalf("expected finance expense forbidden error, got %#v", err)
	}
}

func TestExpenseLedgerCreateAccessAllowsAllAndServiceContext(t *testing.T) {
	if err := requireExpenseLedgerCreateAccess(jsonBody{"current_user_expense_request_access": "all"}); err != nil {
		t.Fatalf("expected all access to allow ledger write, got %v", err)
	}
	if err := requireExpenseLedgerCreateAccess(jsonBody{}); err != nil {
		t.Fatalf("expected service context without user data scope to remain capability-driven, got %v", err)
	}
}

func TestExpenseLedgerBodyAccessRejectsMovingRecordOutOfScope(t *testing.T) {
	body := jsonBody{
		"current_user":                            "u1",
		"current_user_expense_request_access":     "dept",
		"current_user_expense_request_dept_codes": "D1,D2",
		"handler_user_id":                         "u3",
		"department_code":                         "D3",
	}
	row := map[string]any{"handler_user_id": "u2", "department_code": "D2"}

	err := requireExpenseLedgerBodyAccess(body, row)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "finance_expense_access_denied" {
		t.Fatalf("expected finance expense forbidden error, got %#v", err)
	}
}

func TestExpenseLedgerBodyRecordAccessAllowsDeleteInScope(t *testing.T) {
	body := jsonBody{
		"current_user":                            "u1",
		"current_user_expense_request_access":     "dept",
		"current_user_expense_request_dept_codes": "D1,D2",
	}
	row := map[string]any{"handler_user_id": "u2", "department_code": "D2"}

	if err := requireExpenseLedgerBodyRecordAccess(body, row); err != nil {
		t.Fatalf("expected department scoped ledger delete access, got %v", err)
	}
}
