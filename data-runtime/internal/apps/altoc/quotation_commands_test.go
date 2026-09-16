package altoc

import (
	"net/http"
	"testing"
)

func TestQuotationApprovalActionAcceptsApproveAndReject(t *testing.T) {
	for _, action := range []string{"approve", "reject"} {
		got, err := quotationApprovalAction(map[string]any{"action": action})
		if err != nil {
			t.Fatalf("quotationApprovalAction(%q) returned error: %v", action, err)
		}
		if got != action {
			t.Fatalf("quotationApprovalAction(%q) = %q, want %q", action, got, action)
		}
	}
}

func TestQuotationApprovalActionRejectsInvalidAction(t *testing.T) {
	_, err := quotationApprovalAction(map[string]any{"action": "send"})
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "invalid_approval_action")
}

func TestQuotationStatusActionAcceptsLifecycleActions(t *testing.T) {
	tests := map[string]string{
		"submit":          "submit",
		"submit_approval": "submit",
		"send":            "send",
		"mark_sent":       "send",
		"accept":          "accept",
		"mark_accepted":   "accept",
	}
	for raw, expected := range tests {
		got, err := quotationStatusAction(map[string]any{"action": raw})
		if err != nil {
			t.Fatalf("quotationStatusAction(%q) returned error: %v", raw, err)
		}
		if got != expected {
			t.Fatalf("quotationStatusAction(%q) = %q, want %q", raw, got, expected)
		}
	}
}

func TestQuotationStatusActionRejectsApprovalActions(t *testing.T) {
	_, err := quotationStatusAction(map[string]any{"action": "approve"})
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "invalid_status_action")
}

func TestQuotationStatusActionAllowed(t *testing.T) {
	tests := []struct {
		action string
		status string
		want   bool
	}{
		{action: "submit", status: "draft", want: true},
		{action: "submit", status: "rejected", want: true},
		{action: "submit", status: "approved", want: false},
		{action: "send", status: "approved", want: true},
		{action: "send", status: "draft", want: false},
		{action: "accept", status: "sent", want: true},
		{action: "accept", status: "approved", want: false},
	}
	for _, tt := range tests {
		if got := quotationStatusActionAllowed(tt.action, tt.status); got != tt.want {
			t.Fatalf("quotationStatusActionAllowed(%q, %q) = %v, want %v", tt.action, tt.status, got, tt.want)
		}
	}
}

func TestQuotationApprovalSetPartsApprovesAndClearsRejectFields(t *testing.T) {
	set, args, err := quotationApprovalSetParts(quotationApprovalTestColumns(), "approve", "旧拒绝原因", "u1")
	if err != nil {
		t.Fatalf("quotationApprovalSetParts returned error: %v", err)
	}

	assertQuotationApprovalSetContains(t, set,
		"`status` = ?",
		"`approved_at` = CURRENT_TIMESTAMP",
		"`approved_by` = ?",
		"`rejected_at` = ?",
		"`rejected_by` = ?",
		"`reject_reason` = ?",
		"`last_status_changed_at` = CURRENT_TIMESTAMP",
		"`last_status_changed_by` = ?",
		"`updated_by` = ?",
		"`updated_at` = CURRENT_TIMESTAMP",
	)
	expectedArgs := []any{"approved", "u1", nil, nil, nil, "u1", "u1"}
	if len(args) != len(expectedArgs) {
		t.Fatalf("args = %#v, want %#v", args, expectedArgs)
	}
	for i := range expectedArgs {
		if args[i] != expectedArgs[i] {
			t.Fatalf("args = %#v, want %#v", args, expectedArgs)
		}
	}
}

func TestQuotationApprovalSetPartsRejectsAndClearsApprovedFields(t *testing.T) {
	set, args, err := quotationApprovalSetParts(quotationApprovalTestColumns(), "reject", "折扣过高", "u1")
	if err != nil {
		t.Fatalf("quotationApprovalSetParts returned error: %v", err)
	}

	assertQuotationApprovalSetContains(t, set,
		"`status` = ?",
		"`rejected_at` = CURRENT_TIMESTAMP",
		"`rejected_by` = ?",
		"`reject_reason` = ?",
		"`approved_at` = ?",
		"`approved_by` = ?",
		"`last_status_changed_at` = CURRENT_TIMESTAMP",
		"`last_status_changed_by` = ?",
		"`updated_by` = ?",
		"`updated_at` = CURRENT_TIMESTAMP",
	)
	expectedArgs := []any{"rejected", "u1", "折扣过高", nil, nil, "u1", "u1"}
	if len(args) != len(expectedArgs) {
		t.Fatalf("args = %#v, want %#v", args, expectedArgs)
	}
	for i := range expectedArgs {
		if args[i] != expectedArgs[i] {
			t.Fatalf("args = %#v, want %#v", args, expectedArgs)
		}
	}
}

func TestQuotationStatusSetPartsSubmitsAndClearsLifecycleFields(t *testing.T) {
	set, args, err := quotationStatusSetParts(quotationApprovalTestColumns(), "submit", "u1")
	if err != nil {
		t.Fatalf("quotationStatusSetParts returned error: %v", err)
	}

	assertQuotationApprovalSetContains(t, set,
		"`status` = ?",
		"`approved_at` = ?",
		"`approved_by` = ?",
		"`rejected_at` = ?",
		"`rejected_by` = ?",
		"`reject_reason` = ?",
		"`sent_at` = ?",
		"`accepted_at` = ?",
		"`expired_at` = ?",
		"`last_status_changed_at` = CURRENT_TIMESTAMP",
		"`last_status_changed_by` = ?",
		"`updated_by` = ?",
		"`updated_at` = CURRENT_TIMESTAMP",
	)
	expectedArgs := []any{"pending_approval", nil, nil, nil, nil, nil, nil, nil, nil, "u1", "u1"}
	if len(args) != len(expectedArgs) {
		t.Fatalf("args = %#v, want %#v", args, expectedArgs)
	}
	for i := range expectedArgs {
		if args[i] != expectedArgs[i] {
			t.Fatalf("args = %#v, want %#v", args, expectedArgs)
		}
	}
}

func TestQuotationStatusSetPartsMarksSent(t *testing.T) {
	set, args, err := quotationStatusSetParts(quotationApprovalTestColumns(), "send", "u1")
	if err != nil {
		t.Fatalf("quotationStatusSetParts returned error: %v", err)
	}

	assertQuotationApprovalSetContains(t, set,
		"`status` = ?",
		"`sent_at` = CURRENT_TIMESTAMP",
		"`accepted_at` = ?",
		"`expired_at` = ?",
		"`last_status_changed_at` = CURRENT_TIMESTAMP",
		"`last_status_changed_by` = ?",
		"`updated_by` = ?",
		"`updated_at` = CURRENT_TIMESTAMP",
	)
	expectedArgs := []any{"sent", nil, nil, "u1", "u1"}
	if len(args) != len(expectedArgs) {
		t.Fatalf("args = %#v, want %#v", args, expectedArgs)
	}
	for i := range expectedArgs {
		if args[i] != expectedArgs[i] {
			t.Fatalf("args = %#v, want %#v", args, expectedArgs)
		}
	}
}

func TestQuotationStatusSetPartsMarksAccepted(t *testing.T) {
	set, args, err := quotationStatusSetParts(quotationApprovalTestColumns(), "accept", "u1")
	if err != nil {
		t.Fatalf("quotationStatusSetParts returned error: %v", err)
	}

	assertQuotationApprovalSetContains(t, set,
		"`status` = ?",
		"`accepted_at` = CURRENT_TIMESTAMP",
		"`last_status_changed_at` = CURRENT_TIMESTAMP",
		"`last_status_changed_by` = ?",
		"`updated_by` = ?",
		"`updated_at` = CURRENT_TIMESTAMP",
	)
	expectedArgs := []any{"accepted", "u1", "u1"}
	if len(args) != len(expectedArgs) {
		t.Fatalf("args = %#v, want %#v", args, expectedArgs)
	}
	for i := range expectedArgs {
		if args[i] != expectedArgs[i] {
			t.Fatalf("args = %#v, want %#v", args, expectedArgs)
		}
	}
}

func quotationApprovalTestColumns() map[string]bool {
	columns := map[string]bool{}
	for _, name := range []string{
		"status",
		"approved_at",
		"approved_by",
		"rejected_at",
		"rejected_by",
		"reject_reason",
		"sent_at",
		"accepted_at",
		"expired_at",
		"last_status_changed_at",
		"last_status_changed_by",
		"updated_by",
		"updated_at",
	} {
		columns[name] = true
	}
	return columns
}

func assertQuotationApprovalSetContains(t *testing.T, set []string, expected ...string) {
	t.Helper()
	for _, want := range expected {
		found := false
		for _, got := range set {
			if got == want {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("missing set part %q in %#v", want, set)
		}
	}
}
