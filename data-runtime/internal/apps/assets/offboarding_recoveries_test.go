package assets

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestOffboardingResponsibilityRejectsDepartedAndFallbackUIDs(t *testing.T) {
	for _, uid := range []any{"left-user", "@all", " owner ", "owner\n1", 7} {
		a, mock, closeDB := newAssetsSQLMockAdapter(t)
		mock.ExpectQuery(`SELECT departed_employee_uid`).WithArgs("AOR-1").WillReturnRows(sqlmock.NewRows([]string{"departed_employee_uid"}).AddRow("left-user"))
		_, err := a.assignOffboardingRecoveryResponsibility(context.Background(), "AOR-1", url.Values{}, map[string]any{"recoveryResponsibleUid": uid}, "operator")
		closeDB()
		if err == nil {
			t.Fatalf("invalid responsible accepted: %#v", uid)
		}
	}
}

func TestOffboardingOutstandingPredicateUsesOnlyCanonicalCurrentSnapshot(t *testing.T) {
	predicate := offboardingOutstandingPredicate("c", "ai")
	if predicate != "ai.user_uid=c.departed_employee_uid" || strings.Contains(predicate, "asset_assignments") {
		t.Fatalf("historical assignments must not be replayed as current occupancy: %s", predicate)
	}
}

func TestQueryAssetsDueFactsOffboardingUsesCaseResponsibilityNotDepartedUser(t *testing.T) {
	a, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	asOf := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	due := time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`(?s)FROM asset_offboarding_recovery_cases c.*c.status='active'.*c.recovery_responsible_uid IS NOT NULL.*c.recovery_responsible_uid<>c.departed_employee_uid.*asset_items ai.*ai.user_uid=c.departed_employee_uid.*ORDER BY c.recovery_due_at ASC, c.id ASC`).WithArgs("2026-08-09", 3).
		WillReturnRows(sqlmock.NewRows([]string{"id", "case_code", "name", "recovery_due_at", "responsible"}).AddRow(9, "AOR-9", "Left User 未归还资产", due, "asset-owner"))
	mock.ExpectQuery(`(?s)SELECT ai.id,ai.asset_code,ai.status,ai.user_uid.*c.id=\?.*ORDER BY ai.id`).WithArgs(int64(9)).WillReturnRows(sqlmock.NewRows([]string{"id", "asset_code", "status", "user_uid"}).AddRow(1, "AST-1", "in_use", "left-user"))
	facts, err := a.queryAssetsDueFacts(context.Background(), assetsDueOffboarding, asOf, nil, 3)
	if err != nil || len(facts) != 1 || facts[0].SourceType != "offboarding_recovery_case" || facts[0].HoldingsFingerprint == "" || len(facts[0].Recipients) != 1 || facts[0].Recipients[0] != "asset-owner" {
		t.Fatalf("facts=%#v err=%v", facts, err)
	}
}

func TestOffboardingHoldingsChangeSupersedesSourceVersion(t *testing.T) {
	fact := assetsDueFact{ID: 1, SourceType: "offboarding_recovery_case", Code: "AOR-1", Name: "离职未归还", DueAt: time.Date(2026, 7, 10, 23, 59, 59, 0, time.UTC), Recipients: []string{"owner"}, HoldingsFingerprint: "holdings-a"}
	first := assetsDueSourceVersion(assetsDueOffboarding, fact)
	fact.HoldingsFingerprint = "holdings-b"
	second := assetsDueSourceVersion(assetsDueOffboarding, fact)
	if first == second {
		t.Fatal("holdings change did not supersede source version")
	}
}

func TestReconcileOffboardingClosesReturnedAssetsAndCancelsResponsibilityDrift(t *testing.T) {
	a, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	asOf := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	mock.ExpectExec(`(?s)UPDATE assets_notification_checkpoint cp JOIN asset_offboarding_recovery_cases.*condition_resolved.*NOT EXISTS.*ai.user_uid=c.departed_employee_uid`).WithArgs(assetsDueOffboarding).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE assets_notification_checkpoint cp LEFT JOIN asset_offboarding_recovery_cases.*condition_cancelled.*JSON_CONTAINS`).WithArgs(assetsDueOffboarding).WillReturnResult(sqlmock.NewResult(0, 1))
	if err := a.reconcileAssetsDueCheckpoints(context.Background(), assetsDueOffboarding, asOf); err != nil {
		t.Fatal(err)
	}
}

func TestOffboardingNotificationDetailRequiresCurrentExplicitResponsibleAndOutstandingAsset(t *testing.T) {
	a, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectQuery(`(?s)SELECT c.id, CASE WHEN c.status='active'.*c.recovery_responsible_uid=\?.*c.recovery_responsible_uid<>c.departed_employee_uid.*asset_items ai.*ai.user_uid=c.departed_employee_uid.*c.case_code=\?`).WithArgs("asset-owner", "AOR-1").WillReturnRows(sqlmock.NewRows([]string{"id", "related"}).AddRow(1, 1))
	query := url.Values{"current_user": {"asset-owner"}, "hzy_runtime_actor_purpose": {assetsNotificationDetailActorPurpose}}
	result, _, handled, err := a.handleNotificationDetailAuthorizationRuntime(context.Background(), "POST", "/v1/assets/notification-details/authorize", query, map[string]any{"descriptor": map[string]any{"resource": "offboarding_recovery_case", "id": "AOR-1"}})
	if err != nil || !handled || result.(map[string]any)["authorized"] != true {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}

func TestOffboardingServiceUpsertRequiresTrustedPeopleAndRejectsOwnedFields(t *testing.T) {
	a, _, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	if _, err := a.upsertOffboardingRecovery(context.Background(), url.Values{"hzy_runtime_source_app": {"people"}}, map[string]any{}); err == nil {
		t.Fatal("untrusted source accepted")
	}
	wrongSource := offboardingServiceCommandBody(t, "altoc", assetsOffboardingSyncOperation, assetsOffboardingSyncCapability)
	if _, err := a.upsertOffboardingRecovery(context.Background(), nil, wrongSource); err == nil {
		t.Fatal("wrong signed source accepted")
	}
	wrongTarget := offboardingServiceCommandBody(t, "people", assetsOffboardingSyncOperation, assetsOffboardingSyncCapability)
	wrongTarget[integrationoperation.TrustedServiceCommandTargetAppKey] = "finance"
	if _, err := a.upsertOffboardingRecovery(context.Background(), nil, wrongTarget); err == nil {
		t.Fatal("wrong target accepted")
	}
	wrongCapability := offboardingServiceCommandBody(t, "people", assetsOffboardingSyncOperation, "assets:write")
	if _, err := a.upsertOffboardingRecovery(context.Background(), nil, wrongCapability); err == nil {
		t.Fatal("wrong capability accepted")
	}
	missingTenant := offboardingServiceCommandBody(t, "people", assetsOffboardingSyncOperation, assetsOffboardingSyncCapability)
	delete(missingTenant, integrationoperation.TrustedServiceCommandTenantKey)
	if _, err := a.upsertOffboardingRecovery(context.Background(), nil, missingTenant); err == nil {
		t.Fatal("missing trusted tenant accepted")
	}
	missingDeployment := offboardingServiceCommandBody(t, "people", assetsOffboardingSyncOperation, assetsOffboardingSyncCapability)
	delete(missingDeployment, integrationoperation.TrustedServiceCommandTargetDeploymentKey)
	if _, err := a.upsertOffboardingRecovery(context.Background(), nil, missingDeployment); err == nil {
		t.Fatal("missing trusted deployment accepted")
	}
	forgedQuery := url.Values{"hzy_runtime_source_app": {"people"}}
	if _, err := a.upsertOffboardingRecovery(context.Background(), forgedQuery, map[string]any{}); err == nil {
		t.Fatal("forged ordinary query source accepted")
	}

	forbidden := offboardingServiceCommandBody(t, "people", assetsOffboardingSyncOperation, assetsOffboardingSyncCapability)
	forbidden[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)["command"].(map[string]any)["recoveryResponsibleUid"] = "forged"
	digest, _ := integrationoperation.ValidateAndDigestCommand(forbidden[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)["command"])
	forbidden[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)["commandSha256"] = digest
	input, command, err := integrationoperation.ReceiptCommandFromBody(forbidden, "assets", assetsOffboardingSyncOperation, assetsOffboardingSyncCapability)
	if err != nil || input.TrustedContext.SourceApp != "people" {
		t.Fatal(err)
	}
	mockAdapter, mock, closeMock := newAssetsSQLMockAdapter(t)
	defer closeMock()
	mock.ExpectBegin()
	tx, _ := mockAdapter.DB().BeginTx(context.Background(), nil)
	mock.ExpectRollback()
	if _, err := mockAdapter.upsertOffboardingRecoveryTx(context.Background(), tx, command); err == nil {
		t.Fatal("caller-owned responsibility accepted")
	}
	_ = tx.Rollback()
}

func TestOffboardingServiceUpsertCreatesUnassignedAssetsOwnedIdentity(t *testing.T) {
	a, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	tx, err := a.DB().BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectExec(`(?s)INSERT IGNORE INTO asset_offboarding_recovery_cases`).WithArgs(sqlmock.AnyArg(), "leave:ASN-1", sqlmock.AnyArg(), "left-user", nil, sqlmock.AnyArg(), "2026-07-10", nil, nil).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT case_code,source_payload_sha256`).WithArgs("leave:ASN-1").WillReturnRows(sqlmock.NewRows([]string{"case_code", "source_payload_sha256"}).AddRow("AOR-AB0E6A3F2A7D62B2", "placeholder"))
	// First run captures derived identity/hash so the expectation can model the stored row exactly.
	_, err = a.upsertOffboardingRecoveryTx(context.Background(), tx, map[string]any{"sourceEventKey": "leave:ASN-1", "departedEmployeeUid": "left-user", "offboardedAt": "2026-07-10T00:00:00Z"})
	if err == nil || !strings.Contains(err.Error(), "different lifecycle evidence") {
		t.Fatalf("expected drift conflict from placeholder evidence, got %v", err)
	}
	mock.ExpectRollback()
	_ = tx.Rollback()
}

func TestOffboardingServiceSameEventDifferentPayloadConflicts(t *testing.T) {
	a, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	tx, err := a.DB().BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectExec(`(?s)INSERT IGNORE INTO asset_offboarding_recovery_cases`).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`SELECT case_code,source_payload_sha256`).WithArgs("leave:ASN-1").WillReturnRows(sqlmock.NewRows([]string{"case_code", "source_payload_sha256"}).AddRow("different-case", "different-hash"))
	_, err = a.upsertOffboardingRecoveryTx(context.Background(), tx, map[string]any{"sourceEventKey": "leave:ASN-1", "departedEmployeeUid": "left-user", "offboardedAt": "2026-07-10T00:00:00Z"})
	if err == nil {
		t.Fatal("same event with different payload was accepted")
	}
	mock.ExpectRollback()
	_ = tx.Rollback()
}

func offboardingServiceCommandBody(t *testing.T, source, operation, capability string) map[string]any {
	t.Helper()
	command := map[string]any{"sourceEventKey": "leave:ASN-1", "departedEmployeeUid": "left-user", "offboardedAt": "2026-07-10T00:00:00Z"}
	digest, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatal(err)
	}
	return map[string]any{integrationoperation.TrustedServiceCommandTenantKey: "TENANT-A", integrationoperation.TrustedServiceCommandSourceDeploymentKey: "PEOPLE-DEPLOYMENT", integrationoperation.TrustedServiceCommandTargetDeploymentKey: "ASSETS-DEPLOYMENT", integrationoperation.TrustedServiceCommandSourceAppKey: source, integrationoperation.TrustedServiceCommandTargetAppKey: "assets", integrationoperation.TrustedServiceCommandSourceClientKey: "people.runtime", integrationoperation.TrustedRequestIDKey: "REQ-1", integrationoperation.ServiceCommandEnvelopeKey: map[string]any{"operationId": "550e8400-e29b-41d4-a716-446655440000", "targetApp": "assets", "operationCode": operation, "requiredCapability": capability, "idempotencyKey": "people:leave:ASN-1:assets-recovery", "commandSchemaVersion": "v1", "commandSha256": digest, "command": command}}
}
