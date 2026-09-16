package altoc

import (
	"net/http"
	"net/url"
	"testing"
)

func TestContractStatusActionAcceptsLifecycleActions(t *testing.T) {
	tests := map[string]string{
		"submit":          "submit",
		"submit_approval": "submit",
		"withdraw":        "withdraw",
		"approve":         "approve",
		"reject":          "reject",
		"mark_signed":     "mark_signed",
		"complete":        "close_fulfillment",
		"mark_completed":  "close_fulfillment",
		"suspend":         "suspend",
		"terminate":       "terminate",
	}
	for raw, expected := range tests {
		got, err := contractStatusAction(map[string]any{"action": raw})
		if err != nil {
			t.Fatalf("contractStatusAction(%q) returned error: %v", raw, err)
		}
		if got != expected {
			t.Fatalf("contractStatusAction(%q) = %q, want %q", raw, got, expected)
		}
	}
}

func TestContractStatusActionRejectsInvalidAction(t *testing.T) {
	_, err := contractStatusAction(map[string]any{"action": "send"})
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "invalid_status_action")
}

func TestContractStatusActionAllowed(t *testing.T) {
	tests := []struct {
		action string
		status string
		want   bool
	}{
		{action: "submit", status: "draft", want: true},
		{action: "submit", status: "rejected", want: true},
		{action: "submit", status: "approved", want: false},
		{action: "withdraw", status: "pending_approval", want: true},
		{action: "approve", status: "pending_approval", want: true},
		{action: "reject", status: "pending_approval", want: true},
		{action: "approve", status: "draft", want: false},
		{action: "mark_signed", status: "approved", want: true},
		{action: "mark_signed", status: "effective", want: true},
		{action: "close_fulfillment", status: "effective", want: true},
		{action: "close_fulfillment", status: "approved", want: false},
		{action: "suspend", status: "effective", want: true},
		{action: "terminate", status: "effective", want: true},
		{action: "terminate", status: "closed", want: false},
	}
	for _, tt := range tests {
		if got := contractStatusActionAllowed(tt.action, tt.status); got != tt.want {
			t.Fatalf("contractStatusActionAllowed(%q, %q) = %v, want %v", tt.action, tt.status, got, tt.want)
		}
	}
}

func TestContractStatusSetPartsSubmitsAndClearsApprovalFields(t *testing.T) {
	set, args, err := contractStatusSetParts(contractStatusTestColumns(), "submit", "", "u1")
	if err != nil {
		t.Fatalf("contractStatusSetParts returned error: %v", err)
	}

	assertQuotationApprovalSetContains(t, set,
		"`status` = ?",
		"`legal_status` = ?",
		"`fulfillment_status` = ?",
		"`activation_status` = ?",
		"`approved_at` = ?",
		"`approved_by` = ?",
		"`rejected_at` = ?",
		"`rejected_by` = ?",
		"`reject_reason` = ?",
		"`lock_version` = `lock_version` + 1",
		"`last_status_changed_at` = CURRENT_TIMESTAMP",
		"`last_status_changed_by` = ?",
		"`updated_by` = ?",
		"`updated_at` = CURRENT_TIMESTAMP",
	)
	expectedArgs := []any{"pending_approval", "pending_approval", "not_started", "not_planned", nil, nil, nil, nil, nil, "u1", "u1"}
	assertContractArgs(t, args, expectedArgs)
}

func TestContractStatusSetPartsApprovesAndRejects(t *testing.T) {
	approveSet, approveArgs, err := contractStatusSetParts(contractStatusTestColumns(), "approve", "", "u1")
	if err != nil {
		t.Fatalf("approve set parts returned error: %v", err)
	}
	assertQuotationApprovalSetContains(t, approveSet,
		"`status` = ?",
		"`legal_status` = ?",
		"`fulfillment_status` = ?",
		"`activation_status` = ?",
		"`approved_at` = CURRENT_TIMESTAMP",
		"`approved_by` = ?",
		"`rejected_at` = ?",
		"`rejected_by` = ?",
		"`reject_reason` = ?",
	)
	assertContractArgs(t, approveArgs, []any{"approved", "approved", "not_started", "ready", "u1", nil, nil, nil, "u1", "u1"})

	rejectSet, rejectArgs, err := contractStatusSetParts(contractStatusTestColumns(), "reject", "条款需调整", "u2")
	if err != nil {
		t.Fatalf("reject set parts returned error: %v", err)
	}
	assertQuotationApprovalSetContains(t, rejectSet,
		"`status` = ?",
		"`legal_status` = ?",
		"`fulfillment_status` = ?",
		"`activation_status` = ?",
		"`rejected_at` = CURRENT_TIMESTAMP",
		"`rejected_by` = ?",
		"`reject_reason` = ?",
		"`approved_at` = ?",
		"`approved_by` = ?",
	)
	assertContractArgs(t, rejectArgs, []any{"rejected", "draft", "not_started", "not_planned", "u2", "条款需调整", nil, nil, "u2", "u2"})
}

func TestContractStatusSetPartsClosesFulfillment(t *testing.T) {
	set, args, err := contractStatusSetParts(contractStatusTestColumns(), "close_fulfillment", "", "u1")
	if err != nil {
		t.Fatalf("contractStatusSetParts returned error: %v", err)
	}

	assertQuotationApprovalSetContains(t, set,
		"`status` = ?",
		"`legal_status` = ?",
		"`fulfillment_status` = ?",
		"`activation_status` = ?",
		"`completed_at` = CURRENT_TIMESTAMP",
		"`lock_version` = `lock_version` + 1",
		"`last_status_changed_at` = CURRENT_TIMESTAMP",
		"`last_status_changed_by` = ?",
		"`updated_by` = ?",
		"`updated_at` = CURRENT_TIMESTAMP",
	)
	assertContractArgs(t, args, []any{"completed", "closed", "fulfilled", "completed", "u1", "u1"})
}

func TestContractStageActionAllowedEnforcesOrder(t *testing.T) {
	if !contractStageActionAllowed("contract_signed", "approved", nil) {
		t.Fatal("contract_signed should be allowed for approved contract")
	}
	if contractStageActionAllowed("delivery", "approved", map[string]bool{"contract_signed": true}) {
		t.Fatal("delivery should require active contract")
	}
	if !contractStageActionAllowed("delivery", "effective", map[string]bool{"contract_signed": true}) {
		t.Fatal("delivery should be allowed after contract_signed")
	}
	if contractStageActionAllowed("acceptance", "effective", map[string]bool{"contract_signed": true}) {
		t.Fatal("acceptance should require delivery")
	}
	if !contractStageActionAllowed("service_end", "effective", map[string]bool{"contract_signed": true, "delivery": true, "acceptance": true}) {
		t.Fatal("service_end should be allowed after acceptance")
	}
	if contractStageActionAllowed("service_end", "completed", map[string]bool{"contract_signed": true, "delivery": true, "acceptance": true}) {
		t.Fatal("completed contract should reject new stages")
	}
}

func TestContractStageTypeAndDateValidation(t *testing.T) {
	stageType, err := contractStageType(map[string]any{"stageType": "acceptance"})
	if err != nil {
		t.Fatalf("contractStageType returned error: %v", err)
	}
	if stageType != "acceptance" {
		t.Fatalf("stageType = %q, want acceptance", stageType)
	}
	if _, err := contractStageType(map[string]any{"stage_type": "unknown"}); err == nil {
		t.Fatal("expected invalid stage type error")
	}
	if _, err := contractStageDate(map[string]any{"stage_date": "2026-06-20"}); err != nil {
		t.Fatalf("contractStageDate returned error: %v", err)
	}
	if _, err := contractStageDate(map[string]any{"stage_date": "invalid"}); err == nil {
		t.Fatal("expected invalid stage date error")
	}
}

func TestContractStatusActionAlreadyApplied(t *testing.T) {
	tests := []struct {
		action   string
		contract map[string]any
		want     bool
	}{
		{
			action: "mark_signed",
			contract: map[string]any{
				"status":       "effective",
				"legal_status": "effective",
			},
			want: true,
		},
		{
			action: "close_fulfillment",
			contract: map[string]any{
				"status":             "completed",
				"legal_status":       "closed",
				"fulfillment_status": "fulfilled",
			},
			want: true,
		},
		{
			action: "reject",
			contract: map[string]any{
				"status":       "draft",
				"legal_status": "draft",
			},
			want: false,
		},
		{
			action: "reject",
			contract: map[string]any{
				"status":       "rejected",
				"legal_status": "draft",
			},
			want: true,
		},
	}
	for _, tt := range tests {
		if got := contractStatusActionAlreadyApplied(tt.action, tt.contract); got != tt.want {
			t.Fatalf("contractStatusActionAlreadyApplied(%q, %#v) = %v, want %v", tt.action, tt.contract, got, tt.want)
		}
	}
}

func TestContractDomainEventKeyIsStable(t *testing.T) {
	got := contractDomainEventKey("contract.status", 42, "mark_signed", "approved", "effective", "7")
	want := "altoc:contract.status:42:mark_signed:approved:effective:7"
	if got != want {
		t.Fatalf("contractDomainEventKey = %q, want %q", got, want)
	}
	if again := contractDomainEventKey("contract.status", 42, "mark_signed", "approved", "effective", "7"); again != got {
		t.Fatalf("contractDomainEventKey should be deterministic, got %q then %q", got, again)
	}
}

func TestContractCommandSummaryHasNoChanges(t *testing.T) {
	if !contractCommandSummaryHasNoChanges(map[string]any{
		"generated_obligations":       int64(0),
		"generated_billing_schedules": 0,
	}) {
		t.Fatal("zero summary should be treated as no-op")
	}
	if contractCommandSummaryHasNoChanges(map[string]any{
		"generated_obligations":       int64(0),
		"generated_billing_schedules": 1,
	}) {
		t.Fatal("non-zero summary should be treated as a real command change")
	}
}

func TestContractObligationStatusRules(t *testing.T) {
	if !contractObligationActionKnown("submit") {
		t.Fatal("submit should be a known obligation action")
	}
	if contractObligationActionKnown("complete") {
		t.Fatal("complete should not bypass explicit obligation actions")
	}
	if !contractObligationActionAllowed("start", "not_started") {
		t.Fatal("not_started obligation should allow start")
	}
	if contractObligationActionAllowed("accept", "in_progress") {
		t.Fatal("in_progress obligation should not allow accept")
	}
	if got := contractObligationTargetStatus("submit", false); got != "completed" {
		t.Fatalf("submit without acceptance = %q, want completed", got)
	}
	if got := contractObligationTargetStatus("submit", true); got != "submitted" {
		t.Fatalf("submit with acceptance = %q, want submitted", got)
	}
	if got := contractObligationTargetStatus("accept", true); got != "accepted" {
		t.Fatalf("accept target = %q, want accepted", got)
	}
}

func TestLegacyPaymentTermReceivablePlanSQLParts(t *testing.T) {
	codeExpr, joinSQL := legacyPaymentTermReceivablePlanSQLParts(false, nil)
	if codeExpr != "NULL" || joinSQL != "" {
		t.Fatalf("missing receivable_plan parts = (%q, %q), want NULL and empty join", codeExpr, joinSQL)
	}

	codeExpr, joinSQL = legacyPaymentTermReceivablePlanSQLParts(true, map[string]bool{
		"payment_term_id": true,
		"code":            true,
	})
	if codeExpr != "rp.code" {
		t.Fatalf("finance plan expression = %q, want rp.code", codeExpr)
	}
	if joinSQL != "LEFT JOIN receivable_plan rp ON rp.payment_term_id = cpt.id" {
		t.Fatalf("join without deleted_at = %q", joinSQL)
	}

	codeExpr, joinSQL = legacyPaymentTermReceivablePlanSQLParts(true, map[string]bool{
		"payment_term_id": true,
		"code":            true,
		"deleted_at":      true,
	})
	if codeExpr != "rp.code" {
		t.Fatalf("finance plan expression with deleted_at = %q, want rp.code", codeExpr)
	}
	if joinSQL != "LEFT JOIN receivable_plan rp ON rp.payment_term_id = cpt.id AND rp.deleted_at IS NULL" {
		t.Fatalf("join with deleted_at = %q", joinSQL)
	}
}

func TestContractDraftFieldsIncludesParentContract(t *testing.T) {
	fields := contractDraftFields(map[string]any{
		"name":               "补充协议",
		"customer_id":        10,
		"parent_contract_id": 42,
		"agreement_form":     "supplement",
		"owner_user_id":      "u1",
	}, "CT001", "u1")
	if fields["parent_contract_id"] != 42 {
		t.Fatalf("parent_contract_id = %#v, want 42", fields["parent_contract_id"])
	}
	if fields["agreement_form"] != "supplement" {
		t.Fatalf("agreement_form = %#v, want supplement", fields["agreement_form"])
	}
	if fields["is_master_contract"] != 0 {
		t.Fatalf("is_master_contract = %#v, want 0", fields["is_master_contract"])
	}
}

func TestContractDraftFieldsMarksMasterWhenNoParentContract(t *testing.T) {
	fields := contractDraftFields(map[string]any{
		"name":          "标准合同",
		"customer_id":   10,
		"owner_user_id": "u1",
	}, "CT001", "u1")
	if fields["parent_contract_id"] != nil {
		t.Fatalf("parent_contract_id = %#v, want nil", fields["parent_contract_id"])
	}
	if fields["is_master_contract"] != 1 {
		t.Fatalf("is_master_contract = %#v, want 1", fields["is_master_contract"])
	}
}

func TestContractMasterFlagUpdateRespectsExplicitFlag(t *testing.T) {
	value, ok := contractMasterFlagUpdate(map[string]any{
		"parent_contract_id": 42,
		"is_master_contract": true,
	})
	if !ok || value != 1 {
		t.Fatalf("explicit master flag update = (%d, %v), want (1, true)", value, ok)
	}

	value, ok = contractMasterFlagUpdate(map[string]any{
		"parent_contract_id": nil,
		"is_master_contract": false,
	})
	if !ok || value != 0 {
		t.Fatalf("explicit non-master flag update = (%d, %v), want (0, true)", value, ok)
	}

	value, ok = contractMasterFlagUpdate(map[string]any{
		"parent_contract_id": 42,
	})
	if !ok || value != 0 {
		t.Fatalf("derived child flag update = (%d, %v), want (0, true)", value, ok)
	}
}

func TestExistingContractColumnsFiltersMissingSchemaColumns(t *testing.T) {
	got := existingContractColumns(
		[]string{"name", "removed_column", "end_date", "future_column"},
		map[string]bool{"name": true, "end_date": true},
	)
	want := []string{"name", "end_date"}
	if len(got) != len(want) {
		t.Fatalf("existingContractColumns length = %d, want %d (%#v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("existingContractColumns[%d] = %q, want %q (%#v)", i, got[i], want[i], got)
		}
	}
}

func TestContractWherePartsSupportsMasterOnly(t *testing.T) {
	query := url.Values{}
	query.Set("master_only", "1")
	query.Set("customer_id", "10")
	query.Set("exclude_id", "20")
	query.Set("direction", "sales")

	where, args := contractWhereParts(query, map[string]bool{"is_master_contract": true})
	assertQuotationApprovalSetContains(t, where,
		"COALESCE(ct.is_master_contract, 0) = 1",
		"ct.customer_id = ?",
		"ct.id <> ?",
		"ct.direction = ?",
	)
	assertContractArgs(t, args, []any{"10", "sales", int64(20)})

	fallbackWhere, _ := contractWhereParts(url.Values{"masterOnly": []string{"true"}}, nil)
	assertQuotationApprovalSetContains(t, fallbackWhere, "ct.parent_contract_id IS NULL")
}

func contractStatusTestColumns() map[string]bool {
	columns := map[string]bool{}
	for _, name := range []string{
		"status",
		"legal_status",
		"fulfillment_status",
		"activation_status",
		"approved_at",
		"approved_by",
		"rejected_at",
		"rejected_by",
		"reject_reason",
		"completed_at",
		"terminated_at",
		"effective_date",
		"financial_status",
		"lock_version",
		"last_status_changed_at",
		"last_status_changed_by",
		"updated_by",
		"updated_at",
	} {
		columns[name] = true
	}
	return columns
}

func assertContractArgs(t *testing.T, got []any, want []any) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("args = %#v, want %#v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("args = %#v, want %#v", got, want)
		}
	}
}
