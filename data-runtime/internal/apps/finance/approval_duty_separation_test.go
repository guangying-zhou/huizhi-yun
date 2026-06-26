package finance

import (
	"net/http"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestApprovalDutySeparationRejectsSelfApplicantApproval(t *testing.T) {
	err := requireApprovalDutySeparation(
		approvalTargets["expense_claim"],
		map[string]any{"applicant_user_id": "u1"},
		"approved",
		approvalOptions{ApprovalActorUIDs: []string{"u1"}},
	)

	assertApprovalDutySeparationForbidden(t, err)
}

func TestApprovalDutySeparationAllowsNonApplicantApproval(t *testing.T) {
	err := requireApprovalDutySeparation(
		approvalTargets["payment_request"],
		map[string]any{"applicant_user_id": "u1"},
		"approved",
		approvalOptions{ApprovalActorUIDs: []string{"u1", "u2"}},
	)

	if err != nil {
		t.Fatalf("expected non-applicant approval to be allowed, got %v", err)
	}
}

func TestApprovalDutySeparationRequiresApprovalActor(t *testing.T) {
	err := requireApprovalDutySeparation(
		approvalTargets["project_expense_request"],
		map[string]any{"applicant_user_id": "u1"},
		"rejected",
		approvalOptions{},
	)

	assertApprovalDutySeparationForbidden(t, err)
}

func TestApprovalDutySeparationUsesInvoiceRequester(t *testing.T) {
	err := requireApprovalDutySeparation(
		approvalTargets["invoice_request"],
		map[string]any{"requested_by": "u1"},
		"approved",
		approvalOptions{Operator: "u1"},
	)

	assertApprovalDutySeparationForbidden(t, err)
}

func TestApprovalDutySeparationAllowsApplicantCancel(t *testing.T) {
	err := requireApprovalDutySeparation(
		approvalTargets["expense_claim"],
		map[string]any{"applicant_user_id": "u1"},
		"canceled",
		approvalOptions{Operator: "u1"},
	)

	if err != nil {
		t.Fatalf("expected applicant cancel to be allowed, got %v", err)
	}
}

func TestApprovalActorUIDsFromBodyNormalizesCommonCallbackFields(t *testing.T) {
	body := jsonBody{
		"approval_actor_uids":          []any{"u1", "u2"},
		"non_self_approval_actor_uids": "u2,u3",
		"approval_operator_uid":        "u3",
	}

	actors := approvalActorUIDsFromBody(body)
	expected := []string{"u1", "u2", "u3"}
	if len(actors) != len(expected) {
		t.Fatalf("expected actors %#v, got %#v", expected, actors)
	}
	for index, value := range expected {
		if actors[index] != value {
			t.Fatalf("expected actors %#v, got %#v", expected, actors)
		}
	}
}

func assertApprovalDutySeparationForbidden(t *testing.T, err error) {
	t.Helper()
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "approval_duty_separation_required" {
		t.Fatalf("expected approval duty separation forbidden error, got %#v", err)
	}
}
