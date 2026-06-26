package altoc

import (
	"errors"
	"net/http"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestTenderCreateFieldsRequiresPositiveBudgetUnlessFramework(t *testing.T) {
	_, err := tenderCreateFields(map[string]any{
		"name":          "智慧园区投标",
		"opportunityId": 10,
		"ownerUserId":   "u1",
		"tenderType":    "open",
	}, "TD-1", 20, nil, "u1")
	assertTenderHTTPError(t, err, http.StatusBadRequest, "invalid_tender_budget")

	fields, err := tenderCreateFields(map[string]any{
		"name":          "框架协议入围",
		"opportunityId": 10,
		"ownerUserId":   "u1",
		"tenderType":    "framework",
	}, "TD-2", 20, nil, "u1")
	if err != nil {
		t.Fatalf("framework tender should allow empty budget, got %v", err)
	}
	if fields["status"] != "info_gathering" {
		t.Fatalf("initial status = %#v, want info_gathering", fields["status"])
	}
}

func TestTenderUpdateFieldsDoesNotMutateOpportunityLifecycle(t *testing.T) {
	updates, err := tenderUpdateFields(map[string]any{
		"status":        "won",
		"winningAmount": 1200000,
	}, map[string]any{
		"status":        "bid_opening",
		"tender_type":   "open",
		"budget_amount": 1000000,
	}, "u1")
	if err != nil {
		t.Fatalf("tenderUpdateFields returned error: %v", err)
	}
	if updates["status"] != "won" {
		t.Fatalf("status update = %#v, want won", updates["status"])
	}
	for _, forbidden := range []string{"stage_id", "won_at", "lost_at", "won_reason", "lost_reason"} {
		if _, ok := updates[forbidden]; ok {
			t.Fatalf("tender update should not contain opportunity lifecycle field %q: %#v", forbidden, updates)
		}
	}
}

func TestTenderUpdateFieldsRecordsReviewActor(t *testing.T) {
	updates, err := tenderUpdateFields(map[string]any{
		"status":           "review_done",
		"lostReasonType":   "price",
		"lostReasonDetail": "竞品价格更低",
	}, map[string]any{
		"status":        "lost",
		"tender_type":   "open",
		"budget_amount": 1000000,
	}, "u1")
	if err != nil {
		t.Fatalf("tenderUpdateFields returned error: %v", err)
	}
	if updates["review_by"] != "u1" {
		t.Fatalf("review_by = %#v, want u1", updates["review_by"])
	}
	if _, ok := updates["review_at"].(sqlLiteral); !ok {
		t.Fatalf("review_at should be sqlLiteral CURRENT_TIMESTAMP, got %#v", updates["review_at"])
	}
}

func TestTenderMilestoneUpdatesClearsCompletedAtWhenReopened(t *testing.T) {
	updates := tenderMilestoneUpdates(map[string]any{"status": "todo"})
	if _, ok := updates["completed_at"]; !ok {
		t.Fatalf("completed_at should be touched when status changes, updates=%#v", updates)
	}
	if updates["completed_at"] != nil {
		t.Fatalf("completed_at = %#v, want nil", updates["completed_at"])
	}
}

func assertTenderHTTPError(t *testing.T, err error, status int, code string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected %s error", code)
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != status || httpErr.Code != code {
		t.Fatalf("expected %s %d, got %#v", code, status, err)
	}
}
