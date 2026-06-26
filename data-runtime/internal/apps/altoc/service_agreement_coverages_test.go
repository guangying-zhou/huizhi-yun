package altoc

import (
	"context"
	"net/http"
	"reflect"
	"testing"
	"unsafe"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestValidateServiceAgreementCoverageInputRejectsActivePendingPlan(t *testing.T) {
	err := validateServiceAgreementCoverageInput(serviceAgreementCoverageInput{
		targetType:       "pending_plan",
		sourcePlanCode:   "DAP-1",
		resolutionStatus: "pending",
		coverageStatus:   "active",
	})
	if err == nil {
		t.Fatal("expected active pending plan to be rejected")
	}
}

func TestServiceAgreementCoverageInputRejectsPlanCodeAsFormalTarget(t *testing.T) {
	_, err := serviceAgreementCoverageInputFromBody(map[string]any{
		"targetType":        "delivery_asset",
		"deliveryAssetCode": "CDAP-CL-10",
	})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "coverage_target_conflict" {
		t.Fatalf("error = %#v, want 409 coverage_target_conflict", err)
	}
}

func TestServiceAgreementCoverageFormalTargetHelpers(t *testing.T) {
	if !serviceAgreementCoverageRequiresFormalTarget("delivery_asset_environment") {
		t.Fatal("delivery_asset_environment should require duplicate formal target checks")
	}
	if serviceAgreementCoverageRequiresFormalTarget("pending_plan") {
		t.Fatal("pending_plan should not use formal target duplicate checks")
	}
	if text := serviceAgreementCoverageDateText(nil); text != "" {
		t.Fatalf("nil date text = %q, want empty", text)
	}
}

func TestListServiceAgreementCoveragesPrefersCoverageRows(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT\s+sa\.\*,.*FROM service_agreement sa\s+INNER JOIN contract ct`).
		WithArgs("SA-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "contract_id", "contract_code"}).
			AddRow(int64(10), "SA-1", int64(20), "CON-1"))
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) AS count\s+FROM information_schema\.TABLES`).
		WithArgs("service_agreement_coverage").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM service_agreement_coverage\s+WHERE service_agreement_id = \?`).
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"coverage_code",
			"target_type",
			"delivery_asset_code",
			"environment_code",
			"resolution_status",
			"coverage_status",
		}).AddRow(int64(99), "SAC-1", "delivery_asset_environment", "CDA-1", "ENV-1", "resolved", "active"))

	result, err := adapter.listServiceAgreementCoverages(context.Background(), "SA-1", true)
	if err != nil {
		t.Fatalf("listServiceAgreementCoverages: %v", err)
	}
	if result["source"] != "coverage" {
		t.Fatalf("source = %q, want coverage", result["source"])
	}
	items := result["items"].([]map[string]any)
	if len(items) != 1 || items[0]["coverage_code"] != "SAC-1" {
		t.Fatalf("items = %#v, want one coverage row", items)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestListServiceAgreementCoveragesFallsBackToLegacyAssetsWhenCoverageEmpty(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT\s+sa\.\*,.*FROM service_agreement sa\s+INNER JOIN contract ct`).
		WithArgs("SA-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "contract_id", "contract_code"}).
			AddRow(int64(10), "SA-1", int64(20), "CON-1"))
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) AS count\s+FROM information_schema\.TABLES`).
		WithArgs("service_agreement_coverage").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM service_agreement_coverage\s+WHERE service_agreement_id = \?`).
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "coverage_code", "target_type"}))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM service_agreement_asset\s+WHERE service_agreement_id = \?`).
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "service_agreement_id", "delivery_asset_code", "coverage_type"}).
			AddRow(int64(7), int64(10), "LEGACY-1", "legacy_delivery"))

	result, err := adapter.listServiceAgreementCoverages(context.Background(), "SA-1", true)
	if err != nil {
		t.Fatalf("listServiceAgreementCoverages: %v", err)
	}
	if result["source"] != "legacy_service_agreement_asset" {
		t.Fatalf("source = %q, want legacy_service_agreement_asset", result["source"])
	}
	items := result["items"].([]map[string]any)
	if len(items) != 1 {
		t.Fatalf("items = %#v, want one legacy fallback row", items)
	}
	if items[0]["target_type"] != "legacy_asset" || items[0]["resolution_status"] != "needs_review" || items[0]["legacy_reference"] != "LEGACY-1" {
		t.Fatalf("legacy fallback item = %#v, want legacy_asset needs_review", items[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestSyncServiceAgreementCoverageFromAssetResolvesPendingPlanToFormalPair(t *testing.T) {
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

	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) AS count\s+FROM information_schema\.TABLES`).
		WithArgs("service_agreement_coverage").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(`(?s)SELECT sac\.\*\s+FROM service_agreement_coverage sac\s+INNER JOIN service_agreement sa`).
		WithArgs(int64(10), "DAP-1", "CDA-1", "DAP-1", "CDA-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"coverage_code",
			"service_agreement_id",
			"target_type",
			"source_plan_code",
			"delivery_asset_code",
			"environment_code",
			"resolution_status",
			"coverage_status",
			"effective_from",
			"effective_to",
		}).AddRow(100, "SAC-1", 200, "pending_plan", "DAP-1", nil, nil, "pending", "planned", nil, nil))
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM service_agreement_coverage WHERE service_agreement_id = \?`).
		WithArgs(int64(200), "delivery_asset_environment", int64(100), "CDA-1", "ENV-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectExec(`(?s)UPDATE service_agreement_coverage\s+SET target_type = \?`).
		WithArgs("delivery_asset_environment", "DAP-1", "CDA-1", "ENV-1", "active", "tester", int64(100)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	updated, err := syncServiceAgreementCoverageFromAssetTx(context.Background(), tx, map[string]any{
		"id":                  int64(1),
		"contract_id":         int64(10),
		"code":                "DAP-1",
		"external_asset_code": "CDA-1",
	}, "CDA-1", "ENV-1", "accepted", "tester")
	if err != nil {
		t.Fatalf("syncServiceAgreementCoverageFromAssetTx: %v", err)
	}
	if updated != 1 {
		t.Fatalf("updated = %d, want 1", updated)
	}
	mock.ExpectCommit()
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestServiceAgreementCoverageTargetExistsIgnoresSourcePlanForFormalTargets(t *testing.T) {
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

	mock.ExpectQuery(`^SELECT COUNT\(\*\) FROM service_agreement_coverage WHERE service_agreement_id = \? AND target_type = \? AND deleted_at IS NULL AND coverage_status <> 'cancelled' AND id <> \? AND delivery_asset_code = \? AND environment_code = \? AND effective_from IS NULL AND effective_to IS NULL$`).
		WithArgs(int64(200), "delivery_asset_environment", int64(100), "CDA-1", "ENV-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	exists, err := serviceAgreementCoverageTargetExistsTx(context.Background(), tx, int64(200), "delivery_asset_environment", "CDA-1", "ENV-1", "", "", int64(100))
	if err != nil {
		t.Fatalf("serviceAgreementCoverageTargetExistsTx: %v", err)
	}
	if !exists {
		t.Fatal("exists = false, want true")
	}
	mock.ExpectCommit()
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func newAltocCoverageSQLMockAdapter(t *testing.T) (*Adapter, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	compatAdapter := &compat.Adapter{}
	dbField := reflect.ValueOf(compatAdapter).Elem().FieldByName("db")
	reflect.NewAt(dbField.Type(), unsafe.Pointer(dbField.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	return &Adapter{Adapter: compatAdapter}, mock, func() { _ = db.Close() }
}
