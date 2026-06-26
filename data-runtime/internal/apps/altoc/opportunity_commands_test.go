package altoc

import (
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestOpportunityStatusForStage(t *testing.T) {
	cases := []struct {
		name     string
		stage    map[string]any
		expected string
	}{
		{name: "won", stage: map[string]any{"is_won": 1}, expected: "won"},
		{name: "lost", stage: map[string]any{"is_lost": "1"}, expected: "lost"},
		{name: "paused", stage: map[string]any{"code": "paused"}, expected: "paused"},
		{name: "active", stage: map[string]any{"code": "proposal_quotation"}, expected: "active"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if actual := opportunityStatusForStage(tc.stage); actual != tc.expected {
				t.Fatalf("expected %q, got %q", tc.expected, actual)
			}
		})
	}
}

func TestOpportunityRequiredFieldsParsesJSON(t *testing.T) {
	fields, err := opportunityRequiredFields(`["amount_tax_inclusive","expected_sign_date"]`)
	if err != nil {
		t.Fatalf("expected required fields JSON to parse: %v", err)
	}
	if len(fields) != 2 || fields[1] != "expected_sign_date" {
		t.Fatalf("unexpected fields: %#v", fields)
	}
}

func TestOpportunityCriteriaFieldsParsesExitCriteria(t *testing.T) {
	fields, err := opportunityCriteriaFields(`["next_action","next_action_due_at"]`, "exit_criteria_json")
	if err != nil {
		t.Fatalf("expected exit criteria JSON to parse: %v", err)
	}
	if len(fields) != 2 || fields[0] != "next_action" {
		t.Fatalf("unexpected fields: %#v", fields)
	}
}

func TestOpportunityCriteriaFieldsIgnoresDescriptionObject(t *testing.T) {
	fields, err := opportunityCriteriaFields(`{"description":"确认客户有初步需求意向"}`, "exit_criteria_json")
	if err != nil {
		t.Fatalf("expected description-only criteria object to parse: %v", err)
	}
	if len(fields) != 0 {
		t.Fatalf("expected no required fields, got %#v", fields)
	}
}

func TestOpportunityCriteriaFieldsParsesObjectFields(t *testing.T) {
	fields, err := opportunityCriteriaFields(`{"fields":["next_action","next_action_due_at"]}`, "exit_criteria_json")
	if err != nil {
		t.Fatalf("expected object fields criteria to parse: %v", err)
	}
	if len(fields) != 2 || fields[1] != "next_action_due_at" {
		t.Fatalf("unexpected fields: %#v", fields)
	}
}

func TestValidateOpportunityCreateInputPasses(t *testing.T) {
	body := map[string]any{
		"name":               "智慧园区项目",
		"customer_id":        10,
		"current_user":       "u1",
		"next_action":        "约需求会",
		"next_action_due_at": "2026-06-25",
	}

	if err := validateOpportunityCreateInput(body); err != nil {
		t.Fatalf("validateOpportunityCreateInput returned error: %v", err)
	}
}

func TestValidateOpportunityCreateInputRequiresNextAction(t *testing.T) {
	err := validateOpportunityCreateInput(map[string]any{
		"name":          "智慧园区项目",
		"customer_id":   10,
		"owner_user_id": "u1",
	})
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "missing_next_action")
}

func TestValidateOpportunityCreateInputRejectsLeadID(t *testing.T) {
	err := validateOpportunityCreateInput(map[string]any{
		"name":               "智慧园区项目",
		"customer_id":        10,
		"lead_id":            20,
		"owner_user_id":      "u1",
		"next_action":        "约需求会",
		"next_action_due_at": "2026-06-25",
	})
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "lead_conversion_required")
}

func TestOpportunityCreateForecastCategoryRejectsDirectCommit(t *testing.T) {
	_, err := opportunityCreateForecastCategory(map[string]any{"forecast_category": "commit"})
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "invalid_forecast_category")
}

func TestOpportunityCreateForecastCategoryRejectsInvalidValue(t *testing.T) {
	_, err := opportunityCreateForecastCategory(map[string]any{"forecast_category": "certain"})
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "invalid_forecast_category")
}

func TestOpportunityStageAllowsInitialCreateOnlyForOpenActiveStages(t *testing.T) {
	if !opportunityStageAllowsInitialCreate(map[string]any{"code": "initial_contact", "is_closed": 0}) {
		t.Fatal("expected active open stage to be allowed")
	}
	if opportunityStageAllowsInitialCreate(map[string]any{"code": "won", "is_closed": 1, "is_won": 1}) {
		t.Fatal("expected won stage to be rejected")
	}
	if opportunityStageAllowsInitialCreate(map[string]any{"code": "paused", "is_closed": 0}) {
		t.Fatal("expected paused stage to be rejected")
	}
}

func TestOpportunityStageActionWhere(t *testing.T) {
	cases := []struct {
		action       string
		wantSnippet  string
		wantMatched  bool
		forbidPaused bool
	}{
		{action: "won", wantSnippet: "is_won = 1", wantMatched: true},
		{action: "close-won", wantSnippet: "is_won = 1", wantMatched: true},
		{action: "close_lost", wantSnippet: "is_lost = 1", wantMatched: true},
		{action: "close-lost", wantSnippet: "is_lost = 1", wantMatched: true},
		{action: "pause", wantSnippet: "code = 'paused'", wantMatched: true},
		{action: "reopen", wantSnippet: "is_closed = 0", wantMatched: true, forbidPaused: true},
		{action: "unknown"},
	}

	for _, tc := range cases {
		t.Run(tc.action, func(t *testing.T) {
			where, ok := opportunityStageActionWhere(tc.action, map[string]bool{})
			if ok != tc.wantMatched {
				t.Fatalf("ok = %v, want %v", ok, tc.wantMatched)
			}
			if tc.wantSnippet != "" && !strings.Contains(where, tc.wantSnippet) {
				t.Fatalf("where = %q, want to contain %q", where, tc.wantSnippet)
			}
			if tc.forbidPaused && !strings.Contains(where, "code <> 'paused'") {
				t.Fatalf("reopen where should exclude paused stage, got %q", where)
			}
		})
	}
}

func TestValidateOpportunityStageRequirementsUsesPendingUpdates(t *testing.T) {
	stage := map[string]any{"required_fields_json": `["lost_reason"]`}
	opportunity := map[string]any{"lost_reason": nil}
	updates := map[string]any{"lost_reason": "竞品价格更低"}

	if err := validateOpportunityStageRequirements(stage, opportunity, updates); err != nil {
		t.Fatalf("expected update value to satisfy required field: %v", err)
	}
}

func TestValidateOpportunityStageRequirementsRejectsMissingField(t *testing.T) {
	stage := map[string]any{"required_fields_json": `["amount_tax_inclusive"]`}
	opportunity := map[string]any{"amount_tax_inclusive": nil}

	err := validateOpportunityStageRequirements(stage, opportunity, nil)
	if err == nil {
		t.Fatal("expected missing required field to fail")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "missing_required_field" {
		t.Fatalf("expected missing_required_field 400, got %#v", err)
	}
}

func TestValidateOpportunityStageRequirementsRejectsClearedRequiredField(t *testing.T) {
	stage := map[string]any{"required_fields_json": `["lost_reason"]`}
	opportunity := map[string]any{"lost_reason": "预算取消"}
	updates := map[string]any{"lost_reason": nil}

	err := validateOpportunityStageRequirements(stage, opportunity, updates)
	if err == nil {
		t.Fatal("expected cleared required field to fail")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "missing_required_field" {
		t.Fatalf("expected missing_required_field 400, got %#v", err)
	}
}

func TestValidateOpportunityStageExitCriteriaRejectsMissingFieldForActiveTarget(t *testing.T) {
	currentStage := map[string]any{"id": int64(1)}
	targetStage := map[string]any{"id": int64(2), "code": "requirement_confirmed"}
	opportunity := map[string]any{"next_action": "约需求会", "next_action_due_at": nil}

	err := validateOpportunityStageExitCriteria(currentStage, targetStage, opportunity, nil, []string{"next_action", "next_action_due_at"})
	if err == nil {
		t.Fatal("expected missing exit criteria to fail")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "missing_exit_criteria" {
		t.Fatalf("expected missing_exit_criteria 400, got %#v", err)
	}
}

func TestValidateOpportunityStageExitCriteriaUsesPendingUpdates(t *testing.T) {
	currentStage := map[string]any{"id": int64(1)}
	targetStage := map[string]any{"id": int64(2), "code": "requirement_confirmed"}
	opportunity := map[string]any{"next_action": "约需求会", "next_action_due_at": nil}
	updates := map[string]any{"next_action_due_at": "2026-06-25 00:00:00"}

	if err := validateOpportunityStageExitCriteria(currentStage, targetStage, opportunity, updates, []string{"next_action", "next_action_due_at"}); err != nil {
		t.Fatalf("expected pending update to satisfy exit criteria: %v", err)
	}
}

func TestValidateOpportunityStageExitCriteriaSkipsTerminalTarget(t *testing.T) {
	currentStage := map[string]any{"id": int64(1)}
	targetStage := map[string]any{"id": int64(7), "code": "lost", "is_lost": 1}
	opportunity := map[string]any{"next_action": nil, "next_action_due_at": nil}

	if err := validateOpportunityStageExitCriteria(currentStage, targetStage, opportunity, nil, []string{"next_action", "next_action_due_at"}); err != nil {
		t.Fatalf("expected terminal transition to skip active-stage exit criteria: %v", err)
	}
}

func TestOpportunityTransitionUpdatesNormalizesDatesAndEmptyStrings(t *testing.T) {
	updates, err := opportunityTransitionUpdates(map[string]any{
		"expectedSignDate": "2026-06-20T10:00:00Z",
		"wonReasonCode":    "business_value",
		"lostReasonCode":   "competitor_won",
		"next_action":      "",
	})
	if err != nil {
		t.Fatalf("opportunityTransitionUpdates returned error: %v", err)
	}

	if updates["expected_sign_date"] != "2026-06-20" {
		t.Fatalf("expected date to normalize to YYYY-MM-DD, got %#v", updates["expected_sign_date"])
	}
	if value, ok := updates["next_action"]; !ok || value != nil {
		t.Fatalf("expected empty next_action to normalize to nil, got %#v", updates["next_action"])
	}
	if updates["lost_reason_code"] != "competitor_won" {
		t.Fatalf("expected camelCase lost reason code to normalize, got %#v", updates["lost_reason_code"])
	}
	if updates["won_reason_code"] != "business_value" {
		t.Fatalf("expected camelCase won reason code to normalize, got %#v", updates["won_reason_code"])
	}
}

func TestOpportunityTransitionUpdatesRejectsInvalidForecastCategory(t *testing.T) {
	_, err := opportunityTransitionUpdates(map[string]any{"forecastCategory": "certain"})
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "invalid_forecast_category")
}

func TestValidateOpportunityNextActionDuePairAllowsExistingDueDate(t *testing.T) {
	err := validateOpportunityNextActionDuePair(
		map[string]any{"next_action_due_at": "2026-06-25 00:00:00"},
		map[string]any{"next_action": "约方案会"},
	)
	if err != nil {
		t.Fatalf("expected existing due date to satisfy next action, got %v", err)
	}
}

func TestValidateOpportunityNextActionDuePairRejectsMissingDueDate(t *testing.T) {
	err := validateOpportunityNextActionDuePair(
		map[string]any{},
		map[string]any{"next_action": "约方案会"},
	)
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "missing_next_action")
}

func TestValidateOpportunityNextActionDuePairRejectsClearingDueDateWithExistingAction(t *testing.T) {
	err := validateOpportunityNextActionDuePair(
		map[string]any{"next_action": "约方案会", "next_action_due_at": "2026-06-25 00:00:00"},
		map[string]any{"next_action_due_at": nil},
	)
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "missing_next_action")
}

func TestValidateOpportunityNextActionDuePairAllowsClearingAction(t *testing.T) {
	err := validateOpportunityNextActionDuePair(
		map[string]any{"next_action": "约方案会"},
		map[string]any{"next_action": nil},
	)
	if err != nil {
		t.Fatalf("expected clearing next action to pass, got %v", err)
	}
}

func TestValidateOpportunityTerminalReasonsRequiresWonReason(t *testing.T) {
	err := validateOpportunityTerminalReasons(
		"won",
		map[string]any{"won_reason_code": "business_value", "won_reason": nil},
		nil,
	)
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "missing_won_reason")

	err = validateOpportunityTerminalReasons(
		"won",
		map[string]any{"won_reason_code": nil, "won_reason": "价值匹配"},
		map[string]any{"won_reason_code": "business_value"},
	)
	if err != nil {
		t.Fatalf("expected pending won reason code update to satisfy requirement: %v", err)
	}
}

func TestOpportunityDetailUpdatesNormalizesDatesAndSkipsLifecycleFields(t *testing.T) {
	updates, err := opportunityDetailUpdates(map[string]any{
		"name":               "智慧园区项目",
		"expectedSignDate":   "2026-06-20T10:00:00Z",
		"next_action_due_at": "2026-06-25",
		"source_detail":      "",
		"stage_id":           6,
		"status":             "won",
		"won_at":             "2026-06-20",
		"forecast_category":  "commit",
		"lead_id":            88,
		"last_follow_up_at":  "2026-06-20",
		"owner_user_id":      "u2",
		"owner_dept_code":    "D2",
		"version_no":         100,
	})
	if err != nil {
		t.Fatalf("opportunityDetailUpdates returned error: %v", err)
	}
	if updates["expected_sign_date"] != "2026-06-20" {
		t.Fatalf("expected date to normalize to YYYY-MM-DD, got %#v", updates["expected_sign_date"])
	}
	if updates["next_action_due_at"] != "2026-06-25 00:00:00" {
		t.Fatalf("expected next action due date to normalize, got %#v", updates["next_action_due_at"])
	}
	if value, ok := updates["source_detail"]; !ok || value != nil {
		t.Fatalf("expected empty source_detail to normalize to nil, got %#v", updates["source_detail"])
	}
	for _, lifecycleField := range []string{"stage_id", "status", "won_at", "forecast_category", "lead_id", "last_follow_up_at", "owner_user_id", "owner_dept_code", "version_no"} {
		if _, ok := updates[lifecycleField]; ok {
			t.Fatalf("lifecycle field %q should be ignored, updates = %#v", lifecycleField, updates)
		}
	}
}

func TestOpportunityDetailUpdatesIgnoresForecastCategory(t *testing.T) {
	updates, err := opportunityDetailUpdates(map[string]any{"forecast_category": "certain"})
	if err != nil {
		t.Fatalf("opportunityDetailUpdates returned error: %v", err)
	}
	if _, ok := updates["forecast_category"]; ok {
		t.Fatalf("forecast_category should be transition-only, updates = %#v", updates)
	}
}

func TestOpportunityDetailUpdatesRequiresNonEmptyNameWhenProvided(t *testing.T) {
	_, err := opportunityDetailUpdates(map[string]any{"name": "   "})
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "missing_name")
}

func TestOpportunityPipelineCodeFromBodyNormalizesAliases(t *testing.T) {
	code, explicit, err := opportunityPipelineCodeFromBody(map[string]any{"pipelineCode": "ToG"})
	if err != nil {
		t.Fatalf("opportunityPipelineCodeFromBody returned error: %v", err)
	}
	if !explicit || code != "tog_project" {
		t.Fatalf("pipeline = %q explicit=%v, want tog_project/true", code, explicit)
	}

	code, explicit, err = opportunityPipelineCodeFromBody(map[string]any{})
	if err != nil {
		t.Fatalf("opportunityPipelineCodeFromBody default returned error: %v", err)
	}
	if explicit || code != "default" {
		t.Fatalf("pipeline = %q explicit=%v, want default/false", code, explicit)
	}
}

func TestOpportunityPipelineCodeFromBodyRejectsInvalidCode(t *testing.T) {
	_, _, err := opportunityPipelineCodeFromBody(map[string]any{"pipeline_code": "政府 项目"})
	assertLeadQualificationHTTPError(t, err, http.StatusBadRequest, "invalid_pipeline_code")
}

func TestInitialOpportunityStageWhereFiltersByPipelineWhenColumnExists(t *testing.T) {
	where, args, pipelineCode, hasPipelineColumn, err := initialOpportunityStageWhere(
		map[string]bool{"pipeline_code": true, "stage_kind": true},
		map[string]any{"pipeline_code": "solution"},
	)
	if err != nil {
		t.Fatalf("initialOpportunityStageWhere returned error: %v", err)
	}
	expectedWhere := []string{
		"is_enabled = 1",
		"is_closed = 0",
		"COALESCE(stage_kind, 'normal') <> 'paused'",
		"pipeline_code = ?",
	}
	if !reflect.DeepEqual(where, expectedWhere) {
		t.Fatalf("where = %#v, want %#v", where, expectedWhere)
	}
	if !hasPipelineColumn || pipelineCode != "solution" {
		t.Fatalf("pipeline = %q hasColumn=%v, want solution/true", pipelineCode, hasPipelineColumn)
	}
	if !reflect.DeepEqual(args, []any{"solution"}) {
		t.Fatalf("args = %#v, want [solution]", args)
	}
}

func TestInitialOpportunityStageWhereKeepsLegacySchemaCompatible(t *testing.T) {
	where, args, pipelineCode, hasPipelineColumn, err := initialOpportunityStageWhere(
		map[string]bool{},
		map[string]any{"pipeline_code": "tog_project"},
	)
	if err != nil {
		t.Fatalf("initialOpportunityStageWhere returned error: %v", err)
	}
	expectedWhere := []string{"is_enabled = 1", "is_closed = 0", "code <> 'paused'"}
	if !reflect.DeepEqual(where, expectedWhere) {
		t.Fatalf("where = %#v, want %#v", where, expectedWhere)
	}
	if hasPipelineColumn || pipelineCode != "tog_project" {
		t.Fatalf("pipeline = %q hasColumn=%v, want tog_project/false", pipelineCode, hasPipelineColumn)
	}
	if len(args) != 0 {
		t.Fatalf("args = %#v, want empty", args)
	}
}

func TestOpportunityStageActionWhereUsesStageKindWhenAvailable(t *testing.T) {
	where, ok := opportunityStageActionWhere("pause", map[string]bool{"stage_kind": true})
	if !ok || !strings.Contains(where, "stage_kind = 'paused'") {
		t.Fatalf("pause where = %q ok=%v, want stage_kind-aware filter", where, ok)
	}

	where, ok = opportunityStageActionWhere("reopen", map[string]bool{"stage_kind": true})
	if !ok || !strings.Contains(where, "COALESCE(stage_kind, 'normal') <> 'paused'") {
		t.Fatalf("reopen where = %q ok=%v, want stage_kind-aware filter", where, ok)
	}
}

func TestOpportunityStageActionWhereKeepsLegacySchemaCompatible(t *testing.T) {
	where, ok := opportunityStageActionWhere("pause", map[string]bool{})
	if !ok || where != "code = 'paused'" {
		t.Fatalf("pause where = %q ok=%v, want legacy code filter", where, ok)
	}

	where, ok = opportunityStageActionWhere("reopen", map[string]bool{})
	if !ok || strings.Contains(where, "stage_kind") || !strings.Contains(where, "code <> 'paused'") {
		t.Fatalf("reopen where = %q ok=%v, want legacy filter without stage_kind", where, ok)
	}
}

func TestOpportunityTransitionSetPartsKeepsWonStatusConsistent(t *testing.T) {
	set, args := opportunityTransitionSetParts(
		opportunityTransitionTestColumns(),
		map[string]any{"id": int64(6), "win_rate": "100.00"},
		"won",
		map[string]any{
			"amount_tax_inclusive": "100000",
			"lost_reason":          "old reason must be cleared",
			"pause_reason":         "old pause must be cleared",
		},
		"u1",
	)

	assertOpportunityTransitionSetContains(t, set,
		"`amount_tax_inclusive` = ?",
		"`stage_id` = ?",
		"`win_rate` = ?",
		"`status` = ?",
		"`won_at` = COALESCE(won_at, CURRENT_TIMESTAMP)",
		"`lost_at` = ?",
		"`lost_reason_code` = ?",
		"`lost_reason` = ?",
		"`pause_reason_code` = ?",
		"`pause_reason` = ?",
		"`last_status_changed_at` = CURRENT_TIMESTAMP",
		"`last_status_changed_by` = ?",
	)
	if countOpportunityTransitionAssignment(set, "lost_reason") != 1 {
		t.Fatalf("won transition should clear lost_reason exactly once, set = %#v", set)
	}
	if countOpportunityTransitionAssignment(set, "pause_reason") != 1 {
		t.Fatalf("won transition should clear pause_reason exactly once, set = %#v", set)
	}
	if len(args) < 4 || args[0] != "100000" || args[3] != "won" {
		t.Fatalf("unexpected args prefix: %#v", args)
	}
}

func TestOpportunityTransitionSetPartsWritesWonReasonOnWonStatus(t *testing.T) {
	set, _ := opportunityTransitionSetParts(
		opportunityTransitionTestColumns(),
		map[string]any{"id": int64(6), "win_rate": "100.00"},
		"won",
		map[string]any{
			"won_reason_code":  "business_value",
			"won_reason":       "业务价值明确",
			"lost_reason_code": "must be cleared",
		},
		"u1",
	)

	assertOpportunityTransitionSetContains(t, set,
		"`won_reason` = ?",
		"`won_reason_code` = ?",
		"`lost_reason_code` = ?",
		"`lost_reason` = ?",
	)
	if countOpportunityTransitionAssignment(set, "won_reason") != 1 {
		t.Fatalf("won transition should write won_reason exactly once, set = %#v", set)
	}
	if countOpportunityTransitionAssignment(set, "lost_reason") != 1 {
		t.Fatalf("won transition should clear lost_reason exactly once, set = %#v", set)
	}
}

func TestOpportunityTransitionSetPartsKeepsLostStatusConsistent(t *testing.T) {
	set, _ := opportunityTransitionSetParts(
		opportunityTransitionTestColumns(),
		map[string]any{"id": int64(7), "win_rate": "0.00"},
		"lost",
		map[string]any{
			"lost_reason_code": "competitor_won",
			"lost_reason":      "竞品胜出",
			"pause_reason":     "stale pause reason must be cleared",
		},
		"u1",
	)

	assertOpportunityTransitionSetContains(t, set,
		"`lost_reason` = ?",
		"`lost_reason_code` = ?",
		"`lost_at` = COALESCE(lost_at, CURRENT_TIMESTAMP)",
		"`won_at` = ?",
		"`pause_reason_code` = ?",
		"`pause_reason` = ?",
	)
	if countOpportunityTransitionAssignment(set, "lost_reason") != 1 {
		t.Fatalf("lost transition should write lost_reason exactly once, set = %#v", set)
	}
	if countOpportunityTransitionAssignment(set, "pause_reason") != 1 {
		t.Fatalf("lost transition should clear pause_reason exactly once, set = %#v", set)
	}
}

func TestOpportunityTransitionSetPartsClearsTerminalFieldsForActiveStage(t *testing.T) {
	set, _ := opportunityTransitionSetParts(
		opportunityTransitionTestColumns(),
		map[string]any{"id": int64(2), "win_rate": "25.00"},
		"active",
		map[string]any{
			"lost_reason":  "must not survive reopen",
			"pause_reason": "must not survive reopen",
		},
		"u1",
	)

	assertOpportunityTransitionSetContains(t, set,
		"`status` = ?",
		"`won_at` = ?",
		"`lost_at` = ?",
		"`lost_reason_code` = ?",
		"`lost_reason` = ?",
		"`pause_reason_code` = ?",
		"`pause_reason` = ?",
	)
	if countOpportunityTransitionAssignment(set, "lost_reason") != 1 {
		t.Fatalf("active transition should clear lost_reason exactly once, set = %#v", set)
	}
	if countOpportunityTransitionAssignment(set, "pause_reason") != 1 {
		t.Fatalf("active transition should clear pause_reason exactly once, set = %#v", set)
	}
}

func TestOpportunityActivityUpdateAlwaysTouchesLastFollowUp(t *testing.T) {
	columns := map[string]bool{
		"last_follow_up_at": true,
		"updated_by":        true,
		"updated_at":        true,
	}
	set, args := opportunityActivityOpportunityUpdateParts(columns, "", nil, "u1")

	expectedSet := []string{
		"last_follow_up_at = CURRENT_TIMESTAMP",
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
	if len(args) != 1 || args[0] != "u1" {
		t.Fatalf("args = %#v, want [u1]", args)
	}
}

func opportunityTransitionTestColumns() map[string]bool {
	columns := map[string]bool{}
	for _, name := range []string{
		"amount_tax_inclusive",
		"stage_id",
		"win_rate",
		"status",
		"won_at",
		"won_reason_code",
		"won_reason",
		"lost_at",
		"lost_reason_code",
		"lost_reason",
		"pause_reason_code",
		"pause_reason",
		"last_status_changed_at",
		"last_status_changed_by",
		"updated_by",
		"updated_at",
		"version_no",
	} {
		columns[name] = true
	}
	return columns
}

func assertOpportunityTransitionSetContains(t *testing.T, set []string, expected ...string) {
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

func countOpportunityTransitionAssignment(set []string, column string) int {
	prefix := "`" + column + "` ="
	count := 0
	for _, part := range set {
		if strings.HasPrefix(part, prefix) {
			count++
		}
	}
	return count
}

func TestOpportunityActivityUpdateIncludesNextActionWhenPresent(t *testing.T) {
	columns := map[string]bool{
		"last_follow_up_at":  true,
		"next_action":        true,
		"next_action_due_at": true,
		"updated_by":         true,
		"updated_at":         true,
	}
	set, args := opportunityActivityOpportunityUpdateParts(columns, "约方案会", "2026-06-25 00:00:00", "u1")

	expectedSet := []string{
		"last_follow_up_at = CURRENT_TIMESTAMP",
		"next_action = ?",
		"next_action_due_at = ?",
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
	expectedArgs := []any{"约方案会", "2026-06-25 00:00:00", "u1"}
	if len(args) != len(expectedArgs) {
		t.Fatalf("args = %#v, want %#v", args, expectedArgs)
	}
	for i := range expectedArgs {
		if args[i] != expectedArgs[i] {
			t.Fatalf("args = %#v, want %#v", args, expectedArgs)
		}
	}
}

func TestOpportunityActivityUpdateSkipsMissingLastFollowUpColumn(t *testing.T) {
	columns := map[string]bool{
		"next_action":        true,
		"next_action_due_at": true,
		"updated_by":         true,
		"updated_at":         true,
	}
	set, args := opportunityActivityOpportunityUpdateParts(columns, "约方案会", "2026-06-25 00:00:00", "u1")

	expectedSet := []string{
		"next_action = ?",
		"next_action_due_at = ?",
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
	expectedArgs := []any{"约方案会", "2026-06-25 00:00:00", "u1"}
	if len(args) != len(expectedArgs) {
		t.Fatalf("args = %#v, want %#v", args, expectedArgs)
	}
	for i := range expectedArgs {
		if args[i] != expectedArgs[i] {
			t.Fatalf("args = %#v, want %#v", args, expectedArgs)
		}
	}
}

func TestOpportunityActivityCustomerUpdateTouchesLastFollowUp(t *testing.T) {
	columns := map[string]bool{
		"last_follow_up_at": true,
		"updated_by":        true,
		"updated_at":        true,
	}
	set, args := opportunityActivityCustomerUpdateParts(columns, "u1")

	expectedSet := []string{
		"last_follow_up_at = CURRENT_TIMESTAMP",
		"updated_by = ?",
		"updated_at = CURRENT_TIMESTAMP",
	}
	if !reflect.DeepEqual(set, expectedSet) {
		t.Fatalf("set = %#v, want %#v", set, expectedSet)
	}
	if !reflect.DeepEqual(args, []any{"u1"}) {
		t.Fatalf("args = %#v, want [u1]", args)
	}
}

func TestOpportunityActivityCustomerUpdateFallsBackWhenNoUpdateColumnsExist(t *testing.T) {
	set, args := opportunityActivityCustomerUpdateParts(map[string]bool{}, "u1")

	expectedSet := []string{"id = id"}
	if !reflect.DeepEqual(set, expectedSet) {
		t.Fatalf("set = %#v, want %#v", set, expectedSet)
	}
	if len(args) != 0 {
		t.Fatalf("args = %#v, want empty", args)
	}
}
