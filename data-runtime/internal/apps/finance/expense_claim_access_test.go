package finance

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestApplicantRequestListAccessSelfFiltersApplicant(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "u1")
	query.Set("current_user_expense_request_access", "self")
	where := []string{"deleted_at IS NULL"}
	args := make([]any, 0)

	applyApplicantRequestListAccess(&where, &args, query)

	if len(where) != 2 || where[1] != "applicant_user_id = ?" {
		t.Fatalf("expected applicant filter, got %#v", where)
	}
	if len(args) != 1 || args[0] != "u1" {
		t.Fatalf("expected current user arg, got %#v", args)
	}
}

func TestApplicantRequestListAccessNoneReturnsEmptySet(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_expense_request_access", "none")
	where := make([]string, 0)
	args := make([]any, 0)

	applyApplicantRequestListAccess(&where, &args, query)

	if len(where) != 1 || where[0] != "1 = 0" {
		t.Fatalf("expected empty-set filter, got %#v", where)
	}
	if len(args) != 0 {
		t.Fatalf("expected no args, got %#v", args)
	}
}

func TestApplicantRequestListAccessDeptFiltersApplicantOrDept(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "u1")
	query.Set("current_user_expense_request_access", "dept")
	query.Set("current_user_expense_request_dept_codes", "D1,D2")
	where := []string{"deleted_at IS NULL"}
	args := make([]any, 0)

	applyApplicantRequestListAccess(&where, &args, query)

	expectedWhere := "(applicant_user_id = ? OR applicant_dept_code IN (?, ?))"
	if len(where) != 2 || where[1] != expectedWhere {
		t.Fatalf("expected applicant/dept filter %q, got %#v", expectedWhere, where)
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

func TestApplicantRequestRecordAccessRejectsOtherApplicant(t *testing.T) {
	body := jsonBody{
		"current_user":                        "u1",
		"current_user_expense_request_access": "self",
	}
	row := map[string]any{"applicant_user_id": "u2"}

	err := requireApplicantRequestBodyAccess(body, row)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "finance_request_access_denied" {
		t.Fatalf("expected finance request forbidden error, got %#v", err)
	}
}

func TestApplicantRequestRecordAccessDeptAllowsAuthorizedDepartment(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "u1")
	query.Set("current_user_expense_request_access", "dept")
	query.Set("current_user_expense_request_dept_codes", "D1,D2")
	row := map[string]any{"applicant_user_id": "u2", "applicant_dept_code": "D2"}

	if err := requireApplicantRequestQueryAccess(query, row); err != nil {
		t.Fatalf("expected department record access, got %v", err)
	}
}

func TestApplicantRequestCreateAccessDefaultsSelfApplicant(t *testing.T) {
	body := jsonBody{
		"current_user":                        "u1",
		"current_user_expense_request_access": "self",
	}

	if err := requireApplicantRequestCreateAccess(body); err != nil {
		t.Fatalf("expected create access, got %v", err)
	}
	if body["applicantUserId"] != "u1" || body["applicant_user_id"] != "u1" {
		t.Fatalf("expected applicant defaults, got %#v", body)
	}
}

func TestApplicantRequestCreateAccessDeptAllowsAuthorizedDepartmentApplicant(t *testing.T) {
	body := jsonBody{
		"current_user":                            "u1",
		"current_user_expense_request_access":     "dept",
		"current_user_expense_request_dept_codes": "D1,D2",
		"applicantUserId":                         "u2",
		"applicantDeptCode":                       "D2",
	}

	if err := requireApplicantRequestCreateAccess(body); err != nil {
		t.Fatalf("expected department create access, got %v", err)
	}
}

func TestApplicantRequestCreateAccessDeptRejectsUnauthorizedDepartmentApplicant(t *testing.T) {
	body := jsonBody{
		"current_user":                            "u1",
		"current_user_expense_request_access":     "dept",
		"current_user_expense_request_dept_codes": "D1,D2",
		"applicantUserId":                         "u2",
		"applicantDeptCode":                       "D3",
	}

	err := requireApplicantRequestCreateAccess(body)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "finance_request_access_denied" {
		t.Fatalf("expected finance request forbidden error, got %#v", err)
	}
}

func TestApplicantRequestAccessAcceptsLegacyExpenseClaimKey(t *testing.T) {
	body := jsonBody{
		"current_user":                      "u1",
		"current_user_expense_claim_access": "self",
	}

	if err := requireApplicantRequestCreateAccess(body); err != nil {
		t.Fatalf("expected legacy access key to be accepted, got %v", err)
	}
	if body["applicant_user_id"] != "u1" {
		t.Fatalf("expected applicant default from legacy key, got %#v", body)
	}
}

func TestApplicantRequestDeptAccessAcceptsLegacyExpenseClaimDeptKey(t *testing.T) {
	body := jsonBody{
		"current_user":                         "u1",
		"current_user_expense_claim_access":    "dept",
		"current_user_expense_claim_dept_code": "D1",
		"applicantUserId":                      "u2",
		"applicantDeptCode":                    "D1",
	}

	if err := requireApplicantRequestCreateAccess(body); err != nil {
		t.Fatalf("expected legacy dept access key to be accepted, got %v", err)
	}
}

func TestApplicantRequestTablesIncludeExpenseProjectAndPaymentRequests(t *testing.T) {
	for _, table := range []string{"expense_claim", "project_expense_request", "payment_request"} {
		if !isApplicantRequestTable(table) {
			t.Fatalf("expected %s to be applicant request table", table)
		}
	}
	if isApplicantRequestTable("finance_expense") {
		t.Fatalf("finance_expense should not use applicant request self-scope")
	}
}
