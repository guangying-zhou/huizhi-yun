package altoc

import (
	"net/http"
	"reflect"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestValidateLeadConversionQualificationPassesWithLeadFields(t *testing.T) {
	lead := map[string]any{
		"name":               "智慧园区项目",
		"org_name":           "示例客户",
		"need_summary":       "客户计划建设园区运营平台",
		"contact_name":       "张三",
		"owner_user_id":      "u1",
		"next_action":        "约需求会",
		"next_action_due_at": "2026-06-25",
	}
	body := map[string]any{"current_user": "u1"}

	if err := validateLeadConversionQualification(lead, body, "u1"); err != nil {
		t.Fatalf("validateLeadConversionQualification returned error: %v", err)
	}
}

func TestValidateLeadConversionQualificationPassesWithBodyEvidence(t *testing.T) {
	lead := map[string]any{
		"name":               "智慧园区项目",
		"owner_user_id":      "u1",
		"next_action":        "约需求会",
		"next_action_due_at": "2026-06-25",
	}
	body := map[string]any{
		"customer_id":         10,
		"need_summary":        "客户计划建设园区运营平台",
		"source_evidence_url": "https://example.com/tender",
	}

	if err := validateLeadConversionQualification(lead, body, "u1"); err != nil {
		t.Fatalf("validateLeadConversionQualification returned error: %v", err)
	}
}

func TestValidateLeadCreateQualificationPasses(t *testing.T) {
	body := map[string]any{
		"name":                "智慧园区项目",
		"org_name":            "示例客户",
		"source_type":         "tender",
		"need_summary":        "客户计划建设园区运营平台",
		"source_evidence_url": "https://example.com/tender",
		"owner_user_id":       "u1",
		"next_action":         "约需求会",
		"next_action_due_at":  "2026-06-25",
	}

	if err := validateLeadCreateQualification(body); err != nil {
		t.Fatalf("validateLeadCreateQualification returned error: %v", err)
	}
}

func TestValidateLeadCreateQualificationAllowsCurrentUserAsOwner(t *testing.T) {
	body := map[string]any{
		"name":               "智慧园区项目",
		"org_name":           "示例客户",
		"source_type":        "tender",
		"need_summary":       "客户计划建设园区运营平台",
		"contact_name":       "张三",
		"current_user":       "u1",
		"next_action":        "约需求会",
		"next_action_due_at": "2026-06-25",
	}

	if err := validateLeadCreateQualification(body); err != nil {
		t.Fatalf("validateLeadCreateQualification returned error: %v", err)
	}
}

func TestLeadCreateFieldsDefaultsOwnerDeptAndComputesRuleScore(t *testing.T) {
	fields, err := leadCreateFields(map[string]any{
		"name":                      "智慧园区项目",
		"orgName":                   "示例客户",
		"sourceType":                "tender",
		"sourceDetail":              "中国政府采购网",
		"needSummary":               "客户计划建设园区运营平台",
		"budgetStatus":              "",
		"estimatedBudget":           "120000.50",
		"expectedProcurementDate":   "2026-08-15T10:30:00+08:00",
		"sourceEvidenceUrl":         "https://example.com/tender",
		"contactName":               "张三",
		"current_user_dept_codes":   "dept-a dept-b",
		"nextAction":                "约需求会",
		"nextActionDueAt":           "2026-06-25",
		"status":                    "converted",
		"score":                     99,
		"converted_opportunity_id":  123,
		"qualification_result":      "passed",
		"qualification_reason_code": "manual_override",
	}, "u1", "LE-202606200001")
	if err != nil {
		t.Fatalf("leadCreateFields returned error: %v", err)
	}

	expected := map[string]any{
		"code":                      "LE-202606200001",
		"name":                      "智慧园区项目",
		"org_name":                  "示例客户",
		"source_type":               "tender",
		"source_detail":             "中国政府采购网",
		"need_summary":              "客户计划建设园区运营平台",
		"budget_status":             "unknown",
		"estimated_budget":          "120000.50",
		"expected_procurement_date": "2026-08-15",
		"source_evidence_url":       "https://example.com/tender",
		"contact_name":              "张三",
		"status":                    "following",
		"score":                     100,
		"owner_user_id":             "u1",
		"owner_dept_code":           "dept-a",
		"next_action":               "约需求会",
		"next_action_due_at":        "2026-06-25 00:00:00",
	}
	for key, want := range expected {
		if fields[key] != want {
			t.Fatalf("fields[%q] = %#v, want %#v; all fields %#v", key, fields[key], want, fields)
		}
	}
	for _, lifecycleField := range []string{"converted_opportunity_id", "qualification_result", "qualification_reason_code"} {
		if _, ok := fields[lifecycleField]; ok {
			t.Fatalf("lifecycle field %q should not be client-writable; fields = %#v", lifecycleField, fields)
		}
	}
}

func TestLeadCreateFieldsRequiresOwnerWhenActorMissing(t *testing.T) {
	_, err := leadCreateFields(map[string]any{
		"name":               "智慧园区项目",
		"org_name":           "示例客户",
		"source_type":        "tender",
		"need_summary":       "客户计划建设园区运营平台",
		"contact_name":       "张三",
		"next_action":        "约需求会",
		"next_action_due_at": "2026-06-25",
	}, "system", "LE-202606200001")
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "missing_owner_user_id")
}

func TestLeadDetailUpdatesNormalizesDatesAndSkipsLifecycleFields(t *testing.T) {
	updates, err := leadDetailUpdates(map[string]any{
		"name":                     "智慧园区项目",
		"sourceDetail":             "",
		"needSummary":              "客户计划建设园区运营平台",
		"estimatedBudget":          "200000",
		"expectedProcurementDate":  "2026-08-15T10:30:00+08:00",
		"nextAction":               "约需求会",
		"nextActionDueAt":          "2026-06-25",
		"owner_user_id":            "u2",
		"owner_dept_code":          "D2",
		"status":                   "converted",
		"score":                    99,
		"converted_customer_id":    10,
		"converted_opportunity_id": 20,
		"invalid_reason_code":      "duplicate",
	})
	if err != nil {
		t.Fatalf("leadDetailUpdates returned error: %v", err)
	}

	expected := map[string]any{
		"name":                      "智慧园区项目",
		"source_detail":             nil,
		"need_summary":              "客户计划建设园区运营平台",
		"estimated_budget":          "200000",
		"expected_procurement_date": "2026-08-15",
		"next_action":               "约需求会",
		"next_action_due_at":        "2026-06-25 00:00:00",
	}
	for key, want := range expected {
		if updates[key] != want {
			t.Fatalf("updates[%q] = %#v, want %#v; all updates %#v", key, updates[key], want, updates)
		}
	}
	for _, lifecycleField := range []string{"status", "score", "owner_user_id", "owner_dept_code", "converted_customer_id", "converted_opportunity_id", "invalid_reason_code"} {
		if _, ok := updates[lifecycleField]; ok {
			t.Fatalf("lifecycle field %q should not be client-writable; updates = %#v", lifecycleField, updates)
		}
	}
}

func TestLeadDetailUpdatesRequiresNonEmptyNameWhenProvided(t *testing.T) {
	_, err := leadDetailUpdates(map[string]any{"name": "   "})
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "missing_lead_name")
}

func TestLeadDetailUpdatesRequiresNonEmptyNextActionWhenProvided(t *testing.T) {
	_, err := leadDetailUpdates(map[string]any{"nextAction": ""})
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "missing_next_action")
}

func TestValidateLeadActivityNextActionDueAllowsBlankAction(t *testing.T) {
	if err := validateLeadActivityNextActionDue(" ", nil); err != nil {
		t.Fatalf("expected blank next action to pass, got %v", err)
	}
}

func TestValidateLeadActivityNextActionDueRequiresDueDate(t *testing.T) {
	err := validateLeadActivityNextActionDue("约需求会", nil)
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "missing_next_action")
}

func TestValidateLeadActivityNextActionDueAllowsDueDate(t *testing.T) {
	if err := validateLeadActivityNextActionDue("约需求会", "2026-06-25 00:00:00"); err != nil {
		t.Fatalf("expected next action with due date to pass, got %v", err)
	}
}

func TestLeadActivityUpdateTouchesFollowUpAndStatus(t *testing.T) {
	columns := map[string]bool{
		"last_follow_up_at":  true,
		"status":             true,
		"next_action":        true,
		"next_action_due_at": true,
		"updated_by":         true,
		"updated_at":         true,
	}
	set, args := leadActivityLeadUpdateParts(columns, "约需求会", "2026-06-25 00:00:00", "u1")

	expectedSet := []string{
		"last_follow_up_at = CURRENT_TIMESTAMP",
		"status = 'following'",
		"next_action = ?",
		"next_action_due_at = ?",
		"updated_by = ?",
		"updated_at = CURRENT_TIMESTAMP",
	}
	if !reflect.DeepEqual(set, expectedSet) {
		t.Fatalf("set = %#v, want %#v", set, expectedSet)
	}
	expectedArgs := []any{"约需求会", "2026-06-25 00:00:00", "u1"}
	if !reflect.DeepEqual(args, expectedArgs) {
		t.Fatalf("args = %#v, want %#v", args, expectedArgs)
	}
}

func TestLeadActivityUpdateSkipsMissingOptionalColumns(t *testing.T) {
	columns := map[string]bool{
		"next_action":        true,
		"next_action_due_at": true,
		"updated_by":         true,
		"updated_at":         true,
	}
	set, args := leadActivityLeadUpdateParts(columns, "约需求会", "2026-06-25 00:00:00", "u1")

	expectedSet := []string{
		"next_action = ?",
		"next_action_due_at = ?",
		"updated_by = ?",
		"updated_at = CURRENT_TIMESTAMP",
	}
	if !reflect.DeepEqual(set, expectedSet) {
		t.Fatalf("set = %#v, want %#v", set, expectedSet)
	}
	expectedArgs := []any{"约需求会", "2026-06-25 00:00:00", "u1"}
	if !reflect.DeepEqual(args, expectedArgs) {
		t.Fatalf("args = %#v, want %#v", args, expectedArgs)
	}
}

func TestLeadActivityUpdateFallsBackWhenNoUpdateColumnsExist(t *testing.T) {
	set, args := leadActivityLeadUpdateParts(map[string]bool{}, "约需求会", "2026-06-25 00:00:00", "u1")

	expectedSet := []string{"id = id"}
	if !reflect.DeepEqual(set, expectedSet) {
		t.Fatalf("set = %#v, want %#v", set, expectedSet)
	}
	if len(args) != 0 {
		t.Fatalf("args = %#v, want empty", args)
	}
}

func TestLeadRuleScoreMatchesFrontendWeights(t *testing.T) {
	score := leadRuleScore(map[string]any{
		"name":                      "智慧园区项目",
		"org_name":                  "示例客户",
		"source_type":               "tender",
		"need_summary":              "客户计划建设园区运营平台",
		"contact_name":              "张三",
		"owner_user_id":             "u1",
		"next_action":               "约需求会",
		"next_action_due_at":        "2026-06-25 00:00:00",
		"estimated_budget":          "120000.50",
		"expected_procurement_date": "2026-08-15",
	})
	if score != 100 {
		t.Fatalf("score = %d, want 100", score)
	}
}

func TestLeadRuleScoreReturnsZeroForClosedInvalid(t *testing.T) {
	score := leadRuleScore(map[string]any{
		"name":               "智慧园区项目",
		"need_summary":       "客户计划建设园区运营平台",
		"contact_name":       "张三",
		"owner_user_id":      "u1",
		"next_action":        "约需求会",
		"next_action_due_at": "2026-06-25 00:00:00",
		"budget_status":      "approved",
		"procurement_mode":   "open_tender",
		"source_type":        "tender",
		"status":             "closed_invalid",
	})
	if score != 0 {
		t.Fatalf("score = %d, want 0", score)
	}
}

func TestLeadRuleScoreAfterUpdateRecomputesMergedRecord(t *testing.T) {
	base := map[string]any{
		"name":          "智慧园区项目",
		"need_summary":  "客户计划建设园区运营平台",
		"contact_email": "buyer@example.com",
		"source_type":   "website",
	}
	score := leadRuleScoreAfterUpdate(base, map[string]any{
		"owner_user_id":      "u1",
		"next_action":        "约需求会",
		"next_action_due_at": "2026-06-25 00:00:00",
		"budget_status":      "approved",
	})
	if score != 90 {
		t.Fatalf("score = %d, want 90", score)
	}
}

func TestLeadActivityConversionUpdatePartsPreservesExistingLinks(t *testing.T) {
	columns := map[string]bool{
		"customer_id":    true,
		"contact_id":     true,
		"opportunity_id": true,
		"updated_by":     true,
		"updated_at":     true,
	}
	set, args := leadActivityConversionUpdateParts(columns, int64(10), int64(20), int64(30), "u1")

	expectedSet := []string{
		"customer_id = COALESCE(customer_id, ?)",
		"contact_id = COALESCE(contact_id, ?)",
		"opportunity_id = COALESCE(opportunity_id, ?)",
		"updated_by = ?",
		"updated_at = CURRENT_TIMESTAMP",
	}
	if len(set) != len(expectedSet) {
		t.Fatalf("set = %#v, want %#v", set, expectedSet)
	}
	for i := range expectedSet {
		if set[i] != expectedSet[i] {
			t.Fatalf("set = %#v, want %#v", set, expectedSet)
		}
	}
	expectedArgs := []any{int64(10), int64(20), int64(30), "u1"}
	if len(args) != len(expectedArgs) {
		t.Fatalf("args = %#v, want %#v", args, expectedArgs)
	}
	for i := range expectedArgs {
		if args[i] != expectedArgs[i] {
			t.Fatalf("args = %#v, want %#v", args, expectedArgs)
		}
	}
}

func TestLeadActivityConversionUpdatePartsSkipsMissingOptionalContact(t *testing.T) {
	columns := map[string]bool{
		"customer_id":    true,
		"contact_id":     true,
		"opportunity_id": true,
	}
	set, args := leadActivityConversionUpdateParts(columns, int64(10), nil, int64(30), "u1")

	expectedSet := []string{
		"customer_id = COALESCE(customer_id, ?)",
		"opportunity_id = COALESCE(opportunity_id, ?)",
	}
	if len(set) != len(expectedSet) {
		t.Fatalf("set = %#v, want %#v", set, expectedSet)
	}
	for i := range expectedSet {
		if set[i] != expectedSet[i] {
			t.Fatalf("set = %#v, want %#v", set, expectedSet)
		}
	}
	expectedArgs := []any{int64(10), int64(30)}
	if len(args) != len(expectedArgs) {
		t.Fatalf("args = %#v, want %#v", args, expectedArgs)
	}
	for i := range expectedArgs {
		if args[i] != expectedArgs[i] {
			t.Fatalf("args = %#v, want %#v", args, expectedArgs)
		}
	}
}

func TestLeadAttachmentCopyStatementCopiesLeadFilesToOpportunity(t *testing.T) {
	columns := map[string]bool{
		"entity_type":     true,
		"entity_id":       true,
		"attachment_type": true,
		"file_name":       true,
		"file_key":        true,
		"file_size":       true,
		"content_type":    true,
		"uploaded_by":     true,
		"created_at":      true,
	}

	statement, args := leadAttachmentCopyStatement(columns, int64(11), int64(44))
	expectedStatement := "INSERT INTO attachment (`entity_type`, `entity_id`, `attachment_type`, `file_name`, `file_key`, `file_size`, `content_type`, `uploaded_by`, `created_at`) " +
		"SELECT ?, ?, src.`attachment_type`, src.`file_name`, src.`file_key`, src.`file_size`, src.`content_type`, src.`uploaded_by`, src.`created_at` FROM attachment src " +
		"WHERE src.entity_type = ? AND src.entity_id = ? " +
		"AND NOT EXISTS (SELECT 1 FROM attachment dst WHERE dst.entity_type = ? AND dst.entity_id = ? AND dst.file_key = src.file_key)"
	if statement != expectedStatement {
		t.Fatalf("statement = %q, want %q", statement, expectedStatement)
	}
	expectedArgs := []any{"opportunity", int64(44), "lead", int64(11), "opportunity", int64(44)}
	if len(args) != len(expectedArgs) {
		t.Fatalf("args = %#v, want %#v", args, expectedArgs)
	}
	for i := range expectedArgs {
		if args[i] != expectedArgs[i] {
			t.Fatalf("args = %#v, want %#v", args, expectedArgs)
		}
	}
}

func TestLeadAttachmentCopyStatementSkipsWhenRequiredColumnsMissing(t *testing.T) {
	statement, args := leadAttachmentCopyStatement(map[string]bool{
		"entity_type": true,
		"entity_id":   true,
		"file_name":   true,
		"file_key":    true,
	}, int64(11), int64(44))
	if statement != "" || args != nil {
		t.Fatalf("statement = %q args = %#v, want empty", statement, args)
	}
}

func TestLeadDocumentLinkCopyStatementCopiesStableReferences(t *testing.T) {
	columns := map[string]bool{
		"entity_type":        true,
		"entity_id":          true,
		"document_uuid":      true,
		"external_url":       true,
		"external_mime_type": true,
		"document_title":     true,
		"link_type":          true,
		"source_type":        true,
		"created_by":         true,
		"created_at":         true,
	}

	statement, args := leadDocumentLinkCopyStatement(columns, int64(11), int64(44))
	expectedStatement := "INSERT INTO document_link (`entity_type`, `entity_id`, `document_uuid`, `external_url`, `external_mime_type`, `document_title`, `link_type`, `source_type`, `created_by`, `created_at`) " +
		"SELECT ?, ?, src.`document_uuid`, src.`external_url`, src.`external_mime_type`, src.`document_title`, src.`link_type`, src.`source_type`, src.`created_by`, src.`created_at` FROM document_link src " +
		"WHERE src.entity_type = ? AND src.entity_id = ? " +
		"AND NOT EXISTS (SELECT 1 FROM document_link dst WHERE dst.entity_type = ? AND dst.entity_id = ? AND ((src.document_uuid IS NOT NULL AND dst.document_uuid = src.document_uuid) OR (src.document_uuid IS NULL AND src.external_url IS NOT NULL AND dst.external_url = src.external_url)))"
	if statement != expectedStatement {
		t.Fatalf("statement = %q, want %q", statement, expectedStatement)
	}
	expectedArgs := []any{"opportunity", int64(44), "lead", int64(11), "opportunity", int64(44)}
	if len(args) != len(expectedArgs) {
		t.Fatalf("args = %#v, want %#v", args, expectedArgs)
	}
	for i := range expectedArgs {
		if args[i] != expectedArgs[i] {
			t.Fatalf("args = %#v, want %#v", args, expectedArgs)
		}
	}
}

func TestLeadDocumentLinkCopyStatementSkipsWithoutDedupColumns(t *testing.T) {
	statement, args := leadDocumentLinkCopyStatement(map[string]bool{
		"entity_type": true,
		"entity_id":   true,
		"link_type":   true,
	}, int64(11), int64(44))
	if statement != "" || args != nil {
		t.Fatalf("statement = %q args = %#v, want empty", statement, args)
	}
}

func TestLeadConvertedOutboxFieldsBuildsStableEvent(t *testing.T) {
	fields := leadConvertedOutboxFields(int64(11), int64(22), int64(33), int64(44), true, false, map[string]any{
		"idempotency_key": "convert-11",
	}, "u1")

	expectedTopLevel := map[string]any{
		"event_key":      "altoc.lead.converted:11",
		"event_type":     "LeadConverted",
		"aggregate_type": "lead",
		"aggregate_id":   int64(11),
		"status":         "pending",
		"attempts":       0,
		"created_by":     "u1",
		"updated_by":     "u1",
	}
	for key, want := range expectedTopLevel {
		if fields[key] != want {
			t.Fatalf("fields[%q] = %#v, want %#v; all fields %#v", key, fields[key], want, fields)
		}
	}
	payload, ok := fields["payload_json"].(map[string]any)
	if !ok {
		t.Fatalf("payload_json = %#v, want map[string]any", fields["payload_json"])
	}
	expectedPayload := map[string]any{
		"event_type":      "LeadConverted",
		"lead_id":         int64(11),
		"customer_id":     int64(22),
		"contact_id":      int64(33),
		"opportunity_id":  int64(44),
		"customer_reused": true,
		"contact_reused":  false,
		"converted_by":    "u1",
		"idempotency_key": "convert-11",
		"source_app":      "altoc",
		"schema_version":  1,
	}
	for key, want := range expectedPayload {
		if payload[key] != want {
			t.Fatalf("payload[%q] = %#v, want %#v; payload %#v", key, payload[key], want, payload)
		}
	}
	if len(payload) != len(expectedPayload) {
		t.Fatalf("payload = %#v, want only %#v", payload, expectedPayload)
	}
}

func TestLeadConvertedEventKeyHandlesStringID(t *testing.T) {
	key := leadConvertedEventKey(" 42 ")
	if key != "altoc.lead.converted:42" {
		t.Fatalf("key = %q, want altoc.lead.converted:42", key)
	}
}

func TestValidateLeadCreateQualificationRequiresCustomer(t *testing.T) {
	err := validateLeadCreateQualification(map[string]any{
		"name":               "智慧园区项目",
		"source_type":        "tender",
		"need_summary":       "客户计划建设园区运营平台",
		"contact_name":       "张三",
		"owner_user_id":      "u1",
		"next_action":        "约需求会",
		"next_action_due_at": "2026-06-25",
	})
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "missing_customer")
}

func TestValidateLeadCreateQualificationRequiresSourceType(t *testing.T) {
	err := validateLeadCreateQualification(map[string]any{
		"name":               "智慧园区项目",
		"org_name":           "示例客户",
		"need_summary":       "客户计划建设园区运营平台",
		"contact_name":       "张三",
		"owner_user_id":      "u1",
		"next_action":        "约需求会",
		"next_action_due_at": "2026-06-25",
	})
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "missing_source_type")
}

func TestValidateLeadCreateQualificationRequiresContactOrEvidence(t *testing.T) {
	err := validateLeadCreateQualification(map[string]any{
		"name":               "智慧园区项目",
		"org_name":           "示例客户",
		"source_type":        "tender",
		"need_summary":       "客户计划建设园区运营平台",
		"owner_user_id":      "u1",
		"next_action":        "约需求会",
		"next_action_due_at": "2026-06-25",
	})
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "missing_contact_or_evidence")
}

func TestValidateLeadCreateQualificationRequiresNextAction(t *testing.T) {
	err := validateLeadCreateQualification(map[string]any{
		"name":          "智慧园区项目",
		"org_name":      "示例客户",
		"source_type":   "tender",
		"need_summary":  "客户计划建设园区运营平台",
		"contact_name":  "张三",
		"owner_user_id": "u1",
	})
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "missing_next_action")
}

func TestValidateLeadConversionQualificationRequiresNeedSummary(t *testing.T) {
	err := validateLeadConversionQualification(map[string]any{
		"name":               "智慧园区项目",
		"contact_name":       "张三",
		"owner_user_id":      "u1",
		"next_action":        "约需求会",
		"next_action_due_at": "2026-06-25",
	}, nil, "u1")
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "missing_need_summary")
}

func TestValidateLeadConversionQualificationRequiresPositiveCustomerIDOrName(t *testing.T) {
	err := validateLeadConversionQualification(map[string]any{
		"need_summary":       "客户计划建设园区运营平台",
		"contact_name":       "张三",
		"owner_user_id":      "u1",
		"next_action":        "约需求会",
		"next_action_due_at": "2026-06-25",
	}, map[string]any{"customer_id": 0}, "u1")
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "missing_customer")
}

func TestValidateLeadConversionQualificationRequiresContactOrEvidence(t *testing.T) {
	err := validateLeadConversionQualification(map[string]any{
		"name":               "智慧园区项目",
		"need_summary":       "客户计划建设园区运营平台",
		"owner_user_id":      "u1",
		"next_action":        "约需求会",
		"next_action_due_at": "2026-06-25",
	}, nil, "u1")
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "missing_contact_or_evidence")
}

func TestValidateLeadConversionQualificationRequiresOwnerWhenNoOperator(t *testing.T) {
	err := validateLeadConversionQualification(map[string]any{
		"name":               "智慧园区项目",
		"need_summary":       "客户计划建设园区运营平台",
		"contact_name":       "张三",
		"next_action":        "约需求会",
		"next_action_due_at": "2026-06-25",
	}, nil, "")
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "missing_owner_user_id")
}

func TestValidateLeadConversionQualificationRequiresNextAction(t *testing.T) {
	err := validateLeadConversionQualification(map[string]any{
		"name":          "智慧园区项目",
		"need_summary":  "客户计划建设园区运营平台",
		"contact_name":  "张三",
		"owner_user_id": "u1",
	}, nil, "u1")
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "missing_next_action")
}

func TestLeadConversionForecastCategoryDefaultsToPipeline(t *testing.T) {
	category, err := leadConversionForecastCategory(nil)
	if err != nil {
		t.Fatalf("leadConversionForecastCategory returned error: %v", err)
	}
	if category != "pipeline" {
		t.Fatalf("category = %q, want pipeline", category)
	}
}

func TestLeadConversionForecastCategoryAllowsBestCase(t *testing.T) {
	category, err := leadConversionForecastCategory(map[string]any{"forecast_category": "best_case"})
	if err != nil {
		t.Fatalf("leadConversionForecastCategory returned error: %v", err)
	}
	if category != "best_case" {
		t.Fatalf("category = %q, want best_case", category)
	}
}

func TestLeadConversionForecastCategoryRejectsCommit(t *testing.T) {
	_, err := leadConversionForecastCategory(map[string]any{"forecast_category": "commit"})
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "invalid_forecast_category")
}

func TestLeadConversionOpportunityRemarkPrefersExplicitOpportunityRemark(t *testing.T) {
	remark := leadConversionOpportunityRemark(map[string]any{
		"opportunityRemark": "商机专属备注",
		"remark":            "通用备注",
	}, map[string]any{
		"remark":       "线索备注",
		"need_summary": "客户计划建设园区运营平台",
	})

	if remark != "商机专属备注" {
		t.Fatalf("remark = %#v, want 商机专属备注", remark)
	}
}

func TestLeadConversionOpportunityRemarkFallsBackToLeadRemark(t *testing.T) {
	remark := leadConversionOpportunityRemark(nil, map[string]any{
		"remark":       "线索备注",
		"need_summary": "客户计划建设园区运营平台",
	})

	if remark != "线索备注" {
		t.Fatalf("remark = %#v, want 线索备注", remark)
	}
}

func TestLeadConversionOpportunityRemarkFallsBackToNeedSummary(t *testing.T) {
	remark := leadConversionOpportunityRemark(map[string]any{
		"opportunity_remark": " ",
	}, map[string]any{
		"need_summary": "客户计划建设园区运营平台",
	})

	if remark != "客户计划建设园区运营平台" {
		t.Fatalf("remark = %#v, want 客户计划建设园区运营平台", remark)
	}
}

func TestLeadConversionOpportunityRemarkReturnsNilWhenEmpty(t *testing.T) {
	remark := leadConversionOpportunityRemark(map[string]any{
		"remark": " ",
	}, nil)

	if remark != nil {
		t.Fatalf("remark = %#v, want nil", remark)
	}
}

func TestLeadConversionSimilarOpportunityAcknowledgedAcceptsAliases(t *testing.T) {
	cases := []map[string]any{
		{"ackSimilarOpportunity": true},
		{"ack_similar_open_opportunity": "yes"},
		{"confirmSimilarOpportunity": "1"},
	}

	for _, body := range cases {
		if !leadConversionSimilarOpportunityAcknowledged(body) {
			t.Fatalf("leadConversionSimilarOpportunityAcknowledged(%#v) = false, want true", body)
		}
	}
}

func TestLeadConversionSimilarOpportunityAcknowledgedRejectsMissingOrFalse(t *testing.T) {
	for _, body := range []map[string]any{
		nil,
		{"ack_similar_opportunity": false},
		{"confirm_similar_opportunity": "no"},
	} {
		if leadConversionSimilarOpportunityAcknowledged(body) {
			t.Fatalf("leadConversionSimilarOpportunityAcknowledged(%#v) = true, want false", body)
		}
	}
}

func TestLeadConversionOpportunityNamePrefersBody(t *testing.T) {
	name := leadConversionOpportunityName(map[string]any{
		"opportunityName": "商机名称",
	}, map[string]any{
		"name": "线索名称",
	})

	if name != "商机名称" {
		t.Fatalf("name = %q, want 商机名称", name)
	}
}

func TestLeadSimilarOpenOpportunityFiltersBuildsScopedQuery(t *testing.T) {
	where, args, err := leadSimilarOpenOpportunityFilters(int64(42), " 智慧园区项目 ", map[string]any{
		"current_user":            "u1",
		"current_user_dept_codes": []string{"dept-a"},
	})
	if err != nil {
		t.Fatalf("leadSimilarOpenOpportunityFilters returned error: %v", err)
	}
	expectedWhere := []string{
		"op.deleted_at IS NULL",
		"op.customer_id = ?",
		"op.status IN ('active', 'paused')",
		"(op.name = ? OR op.name LIKE ? OR ? LIKE CONCAT('%', op.name, '%'))",
		"(op.owner_user_id = ? OR op.owner_dept_code IN (?))",
	}
	if len(where) != len(expectedWhere) {
		t.Fatalf("where = %#v, want %#v", where, expectedWhere)
	}
	for i := range expectedWhere {
		if where[i] != expectedWhere[i] {
			t.Fatalf("where = %#v, want %#v", where, expectedWhere)
		}
	}
	expectedArgs := []any{int64(42), "智慧园区项目", "%智慧园区项目%", "智慧园区项目", "u1", "dept-a"}
	if len(args) != len(expectedArgs) {
		t.Fatalf("args = %#v, want %#v", args, expectedArgs)
	}
	for i := range expectedArgs {
		if args[i] != expectedArgs[i] {
			t.Fatalf("args = %#v, want %#v", args, expectedArgs)
		}
	}
}

func TestLeadSimilarOpenOpportunityFiltersSkipsMissingInputs(t *testing.T) {
	where, args, err := leadSimilarOpenOpportunityFilters(nil, "智慧园区项目", map[string]any{"current_user": "u1"})
	if err != nil {
		t.Fatalf("leadSimilarOpenOpportunityFilters returned error: %v", err)
	}
	if where != nil || args != nil {
		t.Fatalf("where = %#v args = %#v, want nil", where, args)
	}
}

func TestLeadCustomerLookupConditionsIncludesDuplicateSignals(t *testing.T) {
	conditions, args := leadCustomerLookupConditions(map[string]bool{
		"normalized_name":            true,
		"unified_social_credit_code": true,
		"organization_domain":        true,
	}, " 上海 汇智（集团） ", map[string]any{
		"unifiedSocialCreditCode": "91310000MA1K000000",
		"organizationDomain":      "HTTPS://WWW.Example.COM/path",
	})

	expectedConditions := []string{
		"cu.unified_social_credit_code = ?",
		"cu.organization_domain = ?",
		"cu.name = ?",
		"cu.normalized_name = ?",
		"LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(cu.name), ' ', ''), '　', ''), '（', '('), '）', ')')) = ?",
	}
	if len(conditions) != len(expectedConditions) {
		t.Fatalf("conditions = %#v, want %#v", conditions, expectedConditions)
	}
	for i := range expectedConditions {
		if conditions[i] != expectedConditions[i] {
			t.Fatalf("conditions = %#v, want %#v", conditions, expectedConditions)
		}
	}

	expectedArgs := []any{
		"91310000MA1K000000",
		"example.com",
		"上海 汇智（集团）",
		"上海汇智(集团)",
		"上海汇智(集团)",
	}
	if len(args) != len(expectedArgs) {
		t.Fatalf("args = %#v, want %#v", args, expectedArgs)
	}
	for i := range expectedArgs {
		if args[i] != expectedArgs[i] {
			t.Fatalf("args = %#v, want %#v", args, expectedArgs)
		}
	}
}

func TestLeadCustomerLookupConditionsFallsBackToNameWithoutOptionalColumns(t *testing.T) {
	conditions, args := leadCustomerLookupConditions(map[string]bool{}, "示例客户", map[string]any{
		"unified_social_credit_code": "91310000MA1K000000",
		"organization_domain":        "example.com",
	})

	expectedConditions := []string{
		"cu.name = ?",
		"LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(cu.name), ' ', ''), '　', ''), '（', '('), '）', ')')) = ?",
	}
	if len(conditions) != len(expectedConditions) {
		t.Fatalf("conditions = %#v, want %#v", conditions, expectedConditions)
	}
	for i := range expectedConditions {
		if conditions[i] != expectedConditions[i] {
			t.Fatalf("conditions = %#v, want %#v", conditions, expectedConditions)
		}
	}
	expectedArgs := []any{"示例客户", "示例客户"}
	if len(args) != len(expectedArgs) {
		t.Fatalf("args = %#v, want %#v", args, expectedArgs)
	}
	for i := range expectedArgs {
		if args[i] != expectedArgs[i] {
			t.Fatalf("args = %#v, want %#v", args, expectedArgs)
		}
	}
}

func TestLeadConversionQualificationUpdatesCollectsQualificationFields(t *testing.T) {
	updates := leadConversionQualificationUpdates(map[string]any{
		"needSummary":              "客户计划建设园区运营平台",
		"project_type":             "tog",
		"budgetStatus":             "approved",
		"procurement_mode":         "open_tender",
		"expectedProcurementDate":  "2026-08-15T10:30:00+08:00",
		"source_evidence_url":      "https://example.com/tender",
		"unrelated_lifecycle_data": "ignored",
	})

	expected := map[string]any{
		"qualification_result":      "passed",
		"need_summary":              "客户计划建设园区运营平台",
		"project_type":              "tog",
		"budget_status":             "approved",
		"procurement_mode":          "open_tender",
		"expected_procurement_date": "2026-08-15",
		"source_evidence_url":       "https://example.com/tender",
	}
	for key, want := range expected {
		if updates[key] != want {
			t.Fatalf("updates[%q] = %#v, want %#v; all updates %#v", key, updates[key], want, updates)
		}
	}
	if len(updates) != len(expected) {
		t.Fatalf("updates = %#v, want only %#v", updates, expected)
	}
}

func assertLeadQualificationHTTPError(t *testing.T, err error, status int, code string) {
	t.Helper()
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok {
		t.Fatalf("expected httperror.Error, got %T", err)
	}
	if httpErr.Status != status || httpErr.Code != code {
		t.Fatalf("expected %d/%s, got %d/%s", status, code, httpErr.Status, httpErr.Code)
	}
}
