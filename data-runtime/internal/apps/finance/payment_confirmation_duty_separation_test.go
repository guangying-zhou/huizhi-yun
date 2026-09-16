package finance

import (
	"net/http"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestPaymentConfirmationCreateRejectsApplicantConfirmingOwnPaymentRequest(t *testing.T) {
	body := jsonBody{
		"current_user":                        "u1",
		"current_user_expense_request_access": "self",
		"applicant_user_id":                   "u1",
		"created_by":                          "u1",
		"status":                              "paid",
	}

	err := requirePaymentConfirmationCreateDutySeparation("payment_request", body)

	assertPaymentConfirmationDutySeparationForbidden(t, err)
}

func TestPaymentConfirmationCreateAllowsNonApplicantConfirmingPaymentRequest(t *testing.T) {
	body := jsonBody{
		"current_user":      "u2",
		"applicant_user_id": "u1",
		"created_by":        "u1",
		"status":            "paid",
	}

	if err := requirePaymentConfirmationCreateDutySeparation("payment_request", body); err != nil {
		t.Fatalf("expected non-applicant payment confirmation to be allowed, got %v", err)
	}
}

func TestPaymentConfirmationCreateKeepsServiceBackfillCapabilityDriven(t *testing.T) {
	body := jsonBody{
		"applicant_user_id": "u1",
		"created_by":        "u1",
		"status":            "paid",
	}

	if err := requirePaymentConfirmationCreateDutySeparation("payment_request", body); err != nil {
		t.Fatalf("expected service context without actor to remain capability-driven, got %v", err)
	}
}

func TestPaymentConfirmationCreateIgnoresDraftStatus(t *testing.T) {
	body := jsonBody{
		"current_user":      "u1",
		"applicant_user_id": "u1",
		"status":            "draft",
	}

	if err := requirePaymentConfirmationCreateDutySeparation("payment_request", body); err != nil {
		t.Fatalf("expected draft create to skip payment confirmation duty separation, got %v", err)
	}
}

func TestPaymentConfirmationUpdateRejectsExpenseHandlerConfirmingOwnLedger(t *testing.T) {
	before := map[string]any{
		"status":          "pending_payment",
		"handler_user_id": "u1",
		"created_by":      "u2",
	}
	body := jsonBody{
		"current_user": "u1",
		"status":       "paid",
	}

	err := requirePaymentConfirmationUpdateDutySeparation("finance_expense", before, body)

	assertPaymentConfirmationDutySeparationForbidden(t, err)
}

func TestPaymentConfirmationUpdateRejectsExpenseCreatorConfirmingLedger(t *testing.T) {
	before := map[string]any{
		"status":          "pending_payment",
		"handler_user_id": "u2",
		"created_by":      "u1",
	}
	body := jsonBody{
		"current_user": "u1",
		"status":       "confirmed",
	}

	err := requirePaymentConfirmationUpdateDutySeparation("finance_expense", before, body)

	assertPaymentConfirmationDutySeparationForbidden(t, err)
}

func TestPaymentConfirmationUpdateAllowsNonMakerConfirmingLedger(t *testing.T) {
	before := map[string]any{
		"status":          "pending_payment",
		"handler_user_id": "u1",
		"created_by":      "u1",
	}
	body := jsonBody{
		"current_user": "u2",
		"status":       "paid",
	}

	if err := requirePaymentConfirmationUpdateDutySeparation("finance_expense", before, body); err != nil {
		t.Fatalf("expected non-maker expense payment confirmation to be allowed, got %v", err)
	}
}

func TestPaymentConfirmationUpdateIgnoresUnchangedConfirmedStatus(t *testing.T) {
	before := map[string]any{
		"status":          "confirmed",
		"handler_user_id": "u1",
	}
	body := jsonBody{
		"current_user": "u1",
		"status":       "confirmed",
	}

	if err := requirePaymentConfirmationUpdateDutySeparation("finance_expense", before, body); err != nil {
		t.Fatalf("expected unchanged confirmed status to skip duty separation, got %v", err)
	}
}

func assertPaymentConfirmationDutySeparationForbidden(t *testing.T, err error) {
	t.Helper()
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "payment_confirmation_duty_separation_required" {
		t.Fatalf("expected payment confirmation duty separation forbidden error, got %#v", err)
	}
}
