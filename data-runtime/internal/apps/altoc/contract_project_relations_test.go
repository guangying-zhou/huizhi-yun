package altoc

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestContractProjectRelationTypeMapsProjectRoles(t *testing.T) {
	cases := map[string]string{
		"delivery":       "delivery",
		"implementation": "delivery",
		"development":    "customization",
		"maintenance":    "maintenance",
		"operation":      "maintenance",
		"change":         "change",
		"training":       "training",
		"other-role":     "other",
	}
	for role, want := range cases {
		if got := contractProjectRelationType(role); got != want {
			t.Fatalf("contractProjectRelationType(%q) = %q, want %q", role, got, want)
		}
	}
}

func TestContractProjectRelationInputFromBodyDeduplicatesCodesAndIDs(t *testing.T) {
	input := contractProjectRelationInputFromBody(map[string]any{
		"line_codes":       []any{"CL-1", "CL-1", "CL-2"},
		"contractLineCode": "CL-2",
		"line_ids":         []any{"10", "10", "11"},
		"obligation_codes": "[\"OB-1\",\"OB-1\",\"OB-2\"]",
		"obligation_id":    "20",
	})
	if !input.explicit {
		t.Fatal("expected explicit relation input")
	}
	if got := input.lineCodes; len(got) != 2 || got[0] != "CL-1" || got[1] != "CL-2" {
		t.Fatalf("line codes = %#v, want CL-1/CL-2", got)
	}
	if got := input.lineIDs; len(got) != 2 || got[0] != 10 || got[1] != 11 {
		t.Fatalf("line ids = %#v, want 10/11", got)
	}
	if got := input.obligationCodes; len(got) != 2 || got[0] != "OB-1" || got[1] != "OB-2" {
		t.Fatalf("obligation codes = %#v, want OB-1/OB-2", got)
	}
	if got := input.obligationIDs; len(got) != 1 || got[0] != 20 {
		t.Fatalf("obligation ids = %#v, want 20", got)
	}
	if got := input.lineRelations; len(got) != 4 {
		t.Fatalf("line relations = %#v, want 4 refs before resolution", got)
	}
	if got := input.obligationRelations; len(got) != 3 {
		t.Fatalf("obligation relations = %#v, want 3 refs before resolution", got)
	}
}

func TestContractProjectRelationInputFromBodySupportsPerLineAllocation(t *testing.T) {
	input := contractProjectRelationInputFromBody(map[string]any{
		"lines": []any{
			map[string]any{
				"lineCode":         "CL-1",
				"relationType":     "delivery",
				"allocationMethod": "ratio",
				"allocationRatio":  "60",
			},
			map[string]any{
				"contract_line_code": "CL-2",
				"relation_type":      "customization",
				"allocation_method":  "ratio",
				"allocation_ratio":   40,
			},
		},
	})
	if !input.explicit {
		t.Fatal("expected explicit relation input")
	}
	if got := input.lineCodes; len(got) != 2 || got[0] != "CL-1" || got[1] != "CL-2" {
		t.Fatalf("line codes = %#v, want CL-1/CL-2", got)
	}
	if got := input.lineRelations; len(got) != 2 {
		t.Fatalf("line relations = %#v, want 2", got)
	}
	if got := input.lineRelations[0]; got.lineCode != "CL-1" || got.relationType != "delivery" || got.allocationMethod != "ratio" || got.allocationRatio != "60" {
		t.Fatalf("first relation = %#v", got)
	}
	if got := input.lineRelations[1]; got.lineCode != "CL-2" || got.relationType != "customization" || got.allocationMethod != "ratio" || got.allocationRatio != "40" {
		t.Fatalf("second relation = %#v", got)
	}
}

func TestNormalizeContractProjectRelationInputBuildsRelationsFromCompatFields(t *testing.T) {
	input := normalizeContractProjectRelationInput(contractProjectRelationInput{
		lineCodes:       []string{"CL-1", "CL-2"},
		lineIDs:         []int64{10},
		obligationCodes: []string{"OB-1"},
		obligationIDs:   []int64{20},
		explicit:        true,
	})
	if !input.explicit {
		t.Fatal("expected explicit normalized input")
	}
	if got := input.lineRelations; len(got) != 3 {
		t.Fatalf("line relations = %#v, want 3 from compat fields", got)
	}
	if got := input.obligationRelations; len(got) != 2 {
		t.Fatalf("obligation relations = %#v, want 2 from compat fields", got)
	}
}

func TestStructuredLineWithIDAndCodeDoesNotCreateCompatDuplicate(t *testing.T) {
	input := normalizeContractProjectRelationInput(contractProjectRelationInput{
		lineCodes: []string{"CL-001"},
		lineRelations: []contractProjectLineRelationInput{
			{
				lineID:           10,
				lineCode:         "CL-001",
				relationType:     "customization",
				allocationMethod: "ratio",
				allocationRatio:  "100",
			},
		},
		explicit: true,
	})
	if got := input.lineRelations; len(got) != 1 {
		t.Fatalf("line relations = %#v, want only the structured ID/code relation", got)
	}
	relation := input.lineRelations[0]
	if relation.lineID != 10 || relation.lineCode != "CL-001" || relation.relationType != "customization" || relation.allocationMethod != "ratio" {
		t.Fatalf("relation = %#v, want structured customization relation", relation)
	}
}

func TestResolveStructuredLineWithIDAndCodeDoesNotCreateFallbackRelation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}

	input := contractProjectRelationInputFromBody(map[string]any{
		"lines": []any{
			map[string]any{
				"lineId":           10,
				"lineCode":         "CL-001",
				"relationType":     "customization",
				"allocationMethod": "ratio",
				"allocationRatio":  "100",
			},
		},
	})

	mock.ExpectQuery(`(?s)SELECT id\s+FROM contract_line\s+WHERE id = \?\s+AND contract_id = \?\s+AND deleted_at IS NULL\s+LIMIT 1`).
		WithArgs(int64(10), int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(10))
	mock.ExpectQuery(`(?s)SELECT id\s+FROM contract_line\s+WHERE id = \?\s+AND contract_id = \?\s+AND code = \?\s+AND deleted_at IS NULL\s+LIMIT 1`).
		WithArgs(int64(10), int64(77), "CL-001").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(10))
	mock.ExpectCommit()

	relations, err := resolveContractProjectLineRelationsTx(context.Background(), tx, int64(77), "delivery", input, map[string]any{})
	if err != nil {
		t.Fatalf("resolveContractProjectLineRelationsTx: %v", err)
	}
	if got := relations; len(got) != 1 {
		t.Fatalf("resolved relations = %#v, want one structured relation", got)
	}
	relation := relations[0]
	if relation.lineID != 10 || relation.relationType != "customization" || relation.allocationMethod != "ratio" || relation.allocationRatio != "100" {
		t.Fatalf("resolved relation = %#v, want customization ratio relation", relation)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestSyncStructuredLineWithIDAndCodeWritesOneExplicitRelation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}

	input := contractProjectRelationInputFromBody(map[string]any{
		"lines": []any{
			map[string]any{
				"lineId":           10,
				"lineCode":         "CL-001",
				"relationType":     "customization",
				"allocationMethod": "ratio",
				"allocationRatio":  "100",
			},
		},
	})

	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) AS count.*information_schema\.TABLES.*TABLE_NAME = \?`).
		WithArgs("contract_project_line_rel").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(`(?s)SELECT id\s+FROM contract_line\s+WHERE id = \?\s+AND contract_id = \?\s+AND deleted_at IS NULL\s+LIMIT 1`).
		WithArgs(int64(10), int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(10))
	mock.ExpectQuery(`(?s)SELECT id\s+FROM contract_line\s+WHERE id = \?\s+AND contract_id = \?\s+AND code = \?\s+AND deleted_at IS NULL\s+LIMIT 1`).
		WithArgs(int64(10), int64(77), "CL-001").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(10))
	mock.ExpectExec(`(?s)UPDATE contract_project_line_rel\s+SET deleted_at = CURRENT_TIMESTAMP`).
		WithArgs("tester", int64(88)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO contract_project_line_rel`).
		WithArgs(int64(88), int64(10), "customization", "ratio", "100", nil, nil, "tester", "tester").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) AS count.*information_schema\.TABLES.*TABLE_NAME = \?`).
		WithArgs("contract_project_obligation_rel").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectCommit()

	adapter := &Adapter{}
	err = adapter.syncContractProjectStructuredRelationsTx(
		context.Background(),
		tx,
		int64(77),
		map[string]any{"id": int64(88)},
		"delivery",
		input,
		true,
		map[string]any{"operatorUid": "tester"},
	)
	if err != nil {
		t.Fatalf("syncContractProjectStructuredRelationsTx: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestStructuredObligationWithIDAndCodeDoesNotCreateCompatDuplicate(t *testing.T) {
	input := normalizeContractProjectRelationInput(contractProjectRelationInput{
		obligationCodes: []string{"OB-001"},
		obligationRelations: []contractProjectObligationRelationInput{
			{obligationID: 20, obligationCode: "OB-001"},
		},
		explicit: true,
	})
	if got := input.obligationRelations; len(got) != 1 {
		t.Fatalf("obligation relations = %#v, want only the structured ID/code relation", got)
	}
	relation := input.obligationRelations[0]
	if relation.obligationID != 20 || relation.obligationCode != "OB-001" {
		t.Fatalf("relation = %#v, want structured obligation relation", relation)
	}
}

func TestSyncContractProjectStructuredRelationsNormalizesCompatFieldsBeforeReplace(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}

	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) AS count.*information_schema\.TABLES.*TABLE_NAME = \?`).
		WithArgs("contract_project_line_rel").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(`(?s)SELECT id\s+FROM contract_line\s+WHERE contract_id = \?\s+AND code = \?`).
		WithArgs(int64(10), "CL-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(101))
	mock.ExpectQuery(`(?s)SELECT id\s+FROM contract_line\s+WHERE contract_id = \?\s+AND code = \?`).
		WithArgs(int64(10), "CL-2").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(102))
	mock.ExpectExec(`(?s)UPDATE contract_project_line_rel\s+SET deleted_at = CURRENT_TIMESTAMP`).
		WithArgs("tester", int64(77)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	for _, lineID := range []int64{101, 102} {
		mock.ExpectExec(`(?s)INSERT INTO contract_project_line_rel`).
			WithArgs(int64(77), lineID, "delivery", "unallocated", nil, nil, nil, "tester", "tester").
			WillReturnResult(sqlmock.NewResult(1, 1))
	}

	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) AS count.*information_schema\.TABLES.*TABLE_NAME = \?`).
		WithArgs("contract_project_obligation_rel").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(`(?s)SELECT id\s+FROM contract_obligation\s+WHERE contract_id = \?\s+AND code = \?`).
		WithArgs(int64(10), "OB-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(201))
	mock.ExpectExec(`(?s)UPDATE contract_project_obligation_rel\s+SET deleted_at = CURRENT_TIMESTAMP`).
		WithArgs("tester", int64(77)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO contract_project_obligation_rel`).
		WithArgs(int64(77), int64(201), "tester", "tester").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	adapter := &Adapter{}
	err = adapter.syncContractProjectStructuredRelationsTx(
		context.Background(),
		tx,
		int64(10),
		map[string]any{"id": int64(77)},
		"delivery",
		contractProjectRelationInput{
			lineCodes:       []string{"CL-1", "CL-2"},
			obligationCodes: []string{"OB-1"},
			explicit:        true,
		},
		true,
		map[string]any{"operatorUid": "tester"},
	)
	if err != nil {
		t.Fatalf("syncContractProjectStructuredRelationsTx: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestContractProjectRelationInputFromBodyPrefersStructuredLinesOverCompatCodes(t *testing.T) {
	input := contractProjectRelationInputFromBody(map[string]any{
		"line_codes": []any{"CL-001"},
		"lines": []any{
			map[string]any{
				"lineCode":         "CL-001",
				"relationType":     "delivery",
				"allocationMethod": "ratio",
				"allocationRatio":  "100",
			},
		},
	})
	if got := input.lineRelations; len(got) != 1 {
		t.Fatalf("line relations = %#v, want only explicit structured relation", got)
	}
	relation := input.lineRelations[0]
	if relation.lineCode != "CL-001" || relation.allocationMethod != "ratio" || relation.allocationRatio != "100" {
		t.Fatalf("relation = %#v, want structured allocation to win", relation)
	}
}

func TestValidateContractProjectLineAllocationRequiresRatioTotal100(t *testing.T) {
	valid := []resolvedContractProjectLineRelation{
		{lineID: 1, allocationMethod: "ratio", allocationRatio: "60"},
		{lineID: 2, allocationMethod: "ratio", allocationRatio: "40"},
	}
	if err := validateContractProjectLineAllocation(valid); err != nil {
		t.Fatalf("valid ratio allocation returned error: %v", err)
	}

	invalid := []resolvedContractProjectLineRelation{
		{lineID: 1, allocationMethod: "ratio", allocationRatio: "60"},
		{lineID: 2, allocationMethod: "ratio", allocationRatio: "30"},
	}
	err := validateContractProjectLineAllocation(invalid)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "invalid_contract_project_allocation" {
		t.Fatalf("error = %#v, want 400 invalid_contract_project_allocation", err)
	}
}

func TestValidateContractProjectLineAllocationRejectsInvalidMethodsAndValues(t *testing.T) {
	cases := []struct {
		name      string
		relations []resolvedContractProjectLineRelation
	}{
		{
			name:      "unknown method",
			relations: []resolvedContractProjectLineRelation{{lineID: 1, allocationMethod: "mystery"}},
		},
		{
			name:      "amount missing allocated amount",
			relations: []resolvedContractProjectLineRelation{{lineID: 1, allocationMethod: "amount"}},
		},
		{
			name:      "workdays missing planned workdays",
			relations: []resolvedContractProjectLineRelation{{lineID: 1, allocationMethod: "workdays"}},
		},
		{
			name:      "negative amount",
			relations: []resolvedContractProjectLineRelation{{lineID: 1, allocationMethod: "amount", allocatedAmount: "-1"}},
		},
		{
			name:      "invalid decimal",
			relations: []resolvedContractProjectLineRelation{{lineID: 1, allocationMethod: "amount", allocatedAmount: "not-a-number"}},
		},
		{
			name:      "nan decimal",
			relations: []resolvedContractProjectLineRelation{{lineID: 1, allocationMethod: "amount", allocatedAmount: "NaN"}},
		},
		{
			name:      "infinite decimal",
			relations: []resolvedContractProjectLineRelation{{lineID: 1, allocationMethod: "amount", allocatedAmount: "+Inf"}},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateContractProjectLineAllocation(tc.relations)
			httpErr, ok := err.(httperror.Error)
			if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "invalid_contract_project_allocation" {
				t.Fatalf("error = %#v, want 400 invalid_contract_project_allocation", err)
			}
		})
	}

	valid := []resolvedContractProjectLineRelation{
		{lineID: 1, allocationMethod: "amount", allocatedAmount: "0"},
		{lineID: 2, allocationMethod: "workdays", plannedWorkdays: "0"},
	}
	if err := validateContractProjectLineAllocation(valid); err != nil {
		t.Fatalf("zero amount/workdays should be valid: %v", err)
	}
}

func TestInvalidContractProjectRefsErrorUsesStableCodes(t *testing.T) {
	err := invalidContractProjectRefsError("line", []string{"CL-MISSING"}, []string{"99"}, []string{"1/CL-OTHER"})
	httpErr, ok := err.(httperror.Error)
	if !ok {
		t.Fatalf("error = %T, want httperror.Error", err)
	}
	if httpErr.Status != http.StatusBadRequest || httpErr.Code != "invalid_contract_project_line_refs" {
		t.Fatalf("http error = %d/%s, want 400/invalid_contract_project_line_refs", httpErr.Status, httpErr.Code)
	}
	for _, want := range []string{"CL-MISSING", "99", "1/CL-OTHER"} {
		if !strings.Contains(httpErr.Message, want) {
			t.Fatalf("message %q missing %q", httpErr.Message, want)
		}
	}
}

func TestServiceAgreementProjectRelationCommandPath(t *testing.T) {
	agreementCode, projectCode, action, ok := serviceAgreementProjectRelationCommandPath("/v1/altoc/service/service-agreements/SA%2F1/project-relations/PRJ%2F1:end")
	if !ok {
		t.Fatal("expected command path to match")
	}
	if agreementCode != "SA/1" || projectCode != "PRJ/1" || action != "end" {
		t.Fatalf("parsed path = %q/%q/%q, want SA/1 PRJ/1 end", agreementCode, projectCode, action)
	}
	if _, _, _, ok := serviceAgreementProjectRelationCommandPath("/v1/altoc/service/service-agreements/SA-1/project-relations"); ok {
		t.Fatal("collection path should not match command parser")
	}
}

func TestServiceAllowMissingDefault(t *testing.T) {
	if !serviceAllowMissingDefault(url.Values{"allow_missing": []string{"true"}}) {
		t.Fatal("allow_missing=true should be accepted")
	}
	if !serviceAllowMissingDefault(url.Values{"allowMissing": []string{"1"}}) {
		t.Fatal("allowMissing=1 should be accepted")
	}
	if serviceAllowMissingDefault(url.Values{"allow_missing": []string{"false"}}) {
		t.Fatal("allow_missing=false should not be accepted")
	}
}

func TestServiceAgreementRelationDefaultInputDistinguishesAbsentAndFalse(t *testing.T) {
	if value, provided := serviceAgreementRelationDefaultInput(map[string]any{}); value || provided {
		t.Fatalf("absent default = %v/%v, want false/false", value, provided)
	}
	if value, provided := serviceAgreementRelationDefaultInput(map[string]any{"is_default": false}); value || !provided {
		t.Fatalf("explicit false = %v/%v, want false/true", value, provided)
	}
	if value, provided := serviceAgreementRelationDefaultInput(map[string]any{"isDefault": "true"}); !value || !provided {
		t.Fatalf("explicit true = %v/%v, want true/true", value, provided)
	}
}

func TestServiceAgreementProjectRoleRejectsInvalidProvidedRole(t *testing.T) {
	role, err := serviceAgreementProjectRoleInput(map[string]any{})
	if err != nil || role != "maintenance" {
		t.Fatalf("absent role = %q, err = %v, want maintenance", role, err)
	}
	role, err = serviceAgreementProjectRoleInput(map[string]any{"project_role": "operation"})
	if err != nil || role != "operation" {
		t.Fatalf("valid role = %q, err = %v, want operation", role, err)
	}
	_, err = serviceAgreementProjectRoleInput(map[string]any{"project_role": "maintenace"})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "invalid_service_agreement_project_role" {
		t.Fatalf("error = %#v, want 400 invalid_service_agreement_project_role", err)
	}
}

func TestServiceAgreementDefaultProjectRoleUsesExistingRoleOrRejectsAmbiguity(t *testing.T) {
	role, err := serviceAgreementDefaultProjectRole("PRJ-1", "maintenance", false, []map[string]any{
		{"project_code": "PRJ-1", "project_role": "operation"},
	})
	if err != nil || role != "operation" {
		t.Fatalf("role = %q, err = %v, want existing operation role", role, err)
	}

	role, err = serviceAgreementDefaultProjectRole("PRJ-2", "maintenance", false, nil)
	if err != nil || role != "maintenance" {
		t.Fatalf("role = %q, err = %v, want maintenance for new relation", role, err)
	}

	role, err = serviceAgreementDefaultProjectRole("PRJ-1", "maintenance", true, []map[string]any{
		{"project_code": "PRJ-1", "project_role": "operation"},
		{"project_code": "PRJ-1", "project_role": "inspection"},
	})
	if err != nil || role != "maintenance" {
		t.Fatalf("provided role = %q, err = %v, want requested maintenance", role, err)
	}

	_, err = serviceAgreementDefaultProjectRole("PRJ-1", "maintenance", false, []map[string]any{
		{"project_code": "PRJ-1", "project_role": "operation"},
		{"project_code": "PRJ-1", "project_role": "inspection"},
	})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "relation_ambiguous" {
		t.Fatalf("error = %#v, want 409 relation_ambiguous", err)
	}
}

func TestContractProjectCostLookupStatusesIncludeClosed(t *testing.T) {
	for _, want := range []string{"planned", "active", "closed"} {
		if !strings.Contains(contractProjectCostLookupStatusesSQL, want) {
			t.Fatalf("cost lookup statuses %q missing %q", contractProjectCostLookupStatusesSQL, want)
		}
	}
	if strings.Contains(contractProjectCostLookupStatusesSQL, "cancelled") {
		t.Fatalf("cost lookup statuses %q should not include cancelled", contractProjectCostLookupStatusesSQL)
	}
}
