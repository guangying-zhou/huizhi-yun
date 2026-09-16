package altoc

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestContractActivationProjectCodeIsStablePerPlan(t *testing.T) {
	tests := map[string]string{
		"delivery-main": "PRJ-CT-001",
		"maintenance":   "PRJ-CT-001-MAINTENANCE",
		"项目 A":          "PRJ-CT-001-A",
	}
	for plan, want := range tests {
		if got := contractActivationProjectCode("CT-001", plan, "delivery"); got != want {
			t.Errorf("contractActivationProjectCode(%q) = %q, want %q", plan, got, want)
		}
	}
}

func TestContractActivationMilestonesStayWithinPlan(t *testing.T) {
	terms := []map[string]any{{"id": 1}, {"id": 2}}
	schedules := []map[string]any{
		{"code": "BS-A", "contract_line_code": "LINE-A"},
		{"code": "BS-B", "contract_line_code": "LINE-B"},
	}
	plan := map[string]any{"line_codes": []any{"LINE-B"}}
	planTerms, planSchedules := contractActivationMilestonesForPlan(terms, schedules, plan, 1)
	if len(planTerms) != 0 || len(planSchedules) != 1 || altocMapText(planSchedules[0], "code") != "BS-B" {
		t.Fatalf("unexpected plan milestone scope: terms=%#v schedules=%#v", planTerms, planSchedules)
	}
}

func TestStableActivationKeyPartRejectsRouteShapingCharacters(t *testing.T) {
	if got := stableActivationKeyPart(" Plan/../A "); got != "plan-a" {
		t.Fatalf("stableActivationKeyPart() = %q", got)
	}
}

func TestContractActivationNormalizesExplicitProjectCodeBeforeFreezingDependencies(t *testing.T) {
	if got := contractActivationNormalizeProjectCode(" prj/客户 A "); got != "PRJ-A" {
		t.Fatalf("contractActivationNormalizeProjectCode() = %q", got)
	}
}

func TestContractActivationReceiptTargetsAreFixedByOperationCode(t *testing.T) {
	command := map[string]any{"projectCode": "PRJ-CT-1"}
	if kind, code := altocIntegrationOperationExpectedTarget(altocActivationProjectOperation, command); kind != "project" || code != "PRJ-CT-1" {
		t.Fatalf("project target = (%q, %q)", kind, code)
	}
	if kind, code := altocIntegrationOperationExpectedTarget(altocActivationMilestoneOperation, command); kind != "project_milestones" || code != "PRJ-CT-1" {
		t.Fatalf("milestone target = (%q, %q)", kind, code)
	}
}

func TestInsertContractActivationOperationScopesReplayAndKeepsActorOutOfHash(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	trusted := integrationoperation.TrustedContext{TenantCode: "tenant-1", DeploymentCode: "deployment-1", SourceApp: "altoc", ServiceClientID: "altoc.runtime"}
	command := map[string]any{"contractCode": "CT-1", "projectCode": "PRJ-CT-1", "planKey": "delivery-main"}
	hash, _ := integrationoperation.ValidateAndDigestCommand(command)
	mock.ExpectQuery(`(?s)SELECT operation_id, operation_code, required_capability, command_sha256, status.*FROM integration_operation.*WHERE tenant_code = \? AND deployment_code = \? AND source_app = 'altoc' AND operation_key = \?.*FOR UPDATE`).
		WithArgs("tenant-1", "deployment-1", "operation-key").
		WillReturnRows(sqlmock.NewRows([]string{"operation_id", "operation_code", "required_capability", "command_sha256", "status"}).AddRow("123e4567-e89b-42d3-a456-426614174000", altocActivationProjectOperation, altocActivationAimsCapability, hash, "succeeded"))
	got, status, err := insertContractActivationOperationTx(context.Background(), tx, trusted, "different-actor", "CT-1", "correlation", "operation-key", "", 1, altocActivationProjectOperation, command)
	if err != nil || got != "123e4567-e89b-42d3-a456-426614174000" || status != "succeeded" {
		t.Fatalf("replay = (%q, %q, %v)", got, status, err)
	}
	mock.ExpectRollback()
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestInsertContractActivationOperationRejectsExistingDifferentCommandHash(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.BeginTx(context.Background(), &sql.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	trusted := integrationoperation.TrustedContext{TenantCode: "tenant-1", DeploymentCode: "deployment-1", SourceApp: "altoc"}
	mock.ExpectQuery("SELECT operation_id, operation_code, required_capability, command_sha256, status").
		WithArgs("tenant-1", "deployment-1", "operation-key").
		WillReturnRows(sqlmock.NewRows([]string{"operation_id", "operation_code", "required_capability", "command_sha256", "status"}).AddRow("123e4567-e89b-42d3-a456-426614174000", altocActivationProjectOperation, altocActivationAimsCapability, strings.Repeat("b", 64), "succeeded"))
	_, _, err = insertContractActivationOperationTx(context.Background(), tx, trusted, "actor", "CT-1", "correlation", "operation-key", "", 1, altocActivationProjectOperation, map[string]any{"contractCode": "CT-1"})
	if !errors.Is(err, integrationoperation.ErrImmutableIdentity) {
		t.Fatalf("error = %v", err)
	}
	_ = tx.Rollback()
}
