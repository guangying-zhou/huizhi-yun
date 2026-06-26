package assets

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

func TestAssetEnvironmentByCodeTxLocksAndScansEnvironment(t *testing.T) {
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

	mock.ExpectQuery(`(?s)SELECT \*\s+FROM asset_environments\s+WHERE environment_code = \?\s+LIMIT 1 FOR UPDATE`).
		WithArgs("ENV-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "environment_code", "customer_code", "status"}).
			AddRow(10, "ENV-1", "CUS-1", "active"))

	item, err := assetEnvironmentByCodeTx(context.Background(), tx, "ENV-1", true)
	if err != nil {
		t.Fatalf("assetEnvironmentByCodeTx: %v", err)
	}
	if item["environment_code"] != "ENV-1" || item["customer_code"] != "CUS-1" {
		t.Fatalf("environment = %#v", item)
	}
	mock.ExpectCommit()
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestClearPrimaryDeliveryAssetEnvironmentTxClearsOnlyActivePrimary(t *testing.T) {
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

	mock.ExpectExec(`(?s)UPDATE customer_delivery_asset_environment_rel\s+SET is_primary = 0`).
		WithArgs("tester", int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	if err := clearPrimaryDeliveryAssetEnvironmentTx(context.Background(), tx, int64(42), "tester"); err != nil {
		t.Fatalf("clearPrimaryDeliveryAssetEnvironmentTx: %v", err)
	}
	mock.ExpectCommit()
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestBindCustomerDeliveryAssetEnvironmentTxRejectsCrossCustomerBeforeMutation(t *testing.T) {
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

	mock.ExpectQuery(`(?s)SELECT \*\s+FROM customer_delivery_assets.*WHERE delivery_asset_code = \?.*AND deleted_at IS NULL.*LIMIT 1.*FOR UPDATE`).
		WithArgs("CDA-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "delivery_asset_code", "customer_code", "environment_code"}).
			AddRow(int64(42), "CDA-1", "CUS-1", nil))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM asset_environments\s+WHERE environment_code = \?.*LIMIT 1 FOR UPDATE`).
		WithArgs("ENV-2").
		WillReturnRows(sqlmock.NewRows([]string{"id", "environment_code", "customer_code", "status"}).
			AddRow(int64(88), "ENV-2", "CUS-2", "active"))
	mock.ExpectRollback()

	_, err = bindCustomerDeliveryAssetEnvironmentTx(context.Background(), tx, "CDA-1", map[string]any{
		"environmentCode": "ENV-2",
		"isPrimary":       true,
	}, "tester")
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "delivery_asset_environment_conflict" {
		t.Fatalf("error = %#v, want 409 delivery_asset_environment_conflict", err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatalf("Rollback: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestBindCustomerDeliveryAssetEnvironmentTxRejectsInvalidDeploymentStatus(t *testing.T) {
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
	mock.ExpectRollback()

	_, err = bindCustomerDeliveryAssetEnvironmentTx(context.Background(), tx, "CDA-1", map[string]any{
		"environmentCode":  "ENV-1",
		"deploymentStatus": "onlien",
	}, "tester")
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "invalid_environment_transition" {
		t.Fatalf("error = %#v, want 400 invalid_environment_transition", err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatalf("Rollback: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestBindCustomerDeliveryAssetEnvironmentTxSetsPrimaryAndSnapshot(t *testing.T) {
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

	mock.ExpectQuery(`(?s)SELECT \*\s+FROM customer_delivery_assets.*WHERE delivery_asset_code = \?.*AND deleted_at IS NULL.*LIMIT 1.*FOR UPDATE`).
		WithArgs("CDA-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "delivery_asset_code", "customer_code", "environment_code"}).
			AddRow(int64(42), "CDA-1", "CUS-1", nil))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM asset_environments\s+WHERE environment_code = \?.*LIMIT 1 FOR UPDATE`).
		WithArgs("ENV-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "environment_code", "customer_code", "status"}).
			AddRow(int64(88), "ENV-1", "CUS-1", "active"))
	mock.ExpectExec(`(?s)UPDATE customer_delivery_asset_environment_rel\s+SET is_primary = 0`).
		WithArgs("tester", int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO customer_delivery_asset_environment_rel`).
		WithArgs(
			int64(42),
			int64(88),
			"production",
			int64(1),
			"online",
			"v2.0",
			nil,
			nil,
			"active",
			"PRJ-1",
			"tester",
			"tester",
		).
		WillReturnResult(sqlmock.NewResult(7, 1))
	mock.ExpectExec(`(?s)UPDATE customer_delivery_assets\s+SET environment_code = \?`).
		WithArgs("ENV-1", "tester", int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO asset_events`).
		WithArgs("customer_delivery_asset", int64(42), "environment_bound", sqlmock.AnyArg(), "tester").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM customer_delivery_asset_environment_rel\s+WHERE delivery_asset_id = \?\s+AND environment_id = \?\s+AND relation_type = \?\s+AND deleted_at IS NULL\s+LIMIT 1`).
		WithArgs(int64(42), int64(88), "production").
		WillReturnRows(sqlmock.NewRows([]string{"id", "delivery_asset_id", "environment_id", "relation_type", "is_primary", "deployment_status", "deployed_version", "status", "source_project_code"}).
			AddRow(int64(7), int64(42), int64(88), "production", int64(1), "online", "v2.0", "active", "PRJ-1"))
	mock.ExpectCommit()

	result, err := bindCustomerDeliveryAssetEnvironmentTx(context.Background(), tx, "CDA-1", map[string]any{
		"environmentCode":   "ENV-1",
		"relationType":      "production",
		"deploymentStatus":  "online",
		"isPrimary":         true,
		"deployedVersion":   "v2.0",
		"sourceProjectCode": "PRJ-1",
	}, "tester")
	if err != nil {
		t.Fatalf("bindCustomerDeliveryAssetEnvironmentTx: %v", err)
	}
	relation, ok := result["relation"].(map[string]any)
	if !ok || relation["relation_type"] != "production" || relation["deployment_status"] != "online" {
		t.Fatalf("relation = %#v, want production online relation", result["relation"])
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestBindCustomerDeliveryAssetEnvironmentTxAllowsAdditionalNonPrimaryEnvironment(t *testing.T) {
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

	mock.ExpectQuery(`(?s)SELECT \*\s+FROM customer_delivery_assets.*WHERE delivery_asset_code = \?.*AND deleted_at IS NULL.*LIMIT 1.*FOR UPDATE`).
		WithArgs("CDA-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "delivery_asset_code", "customer_code", "environment_code"}).
			AddRow(int64(42), "CDA-1", "CUS-1", "ENV-PROD"))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM asset_environments\s+WHERE environment_code = \?.*LIMIT 1 FOR UPDATE`).
		WithArgs("ENV-DR").
		WillReturnRows(sqlmock.NewRows([]string{"id", "environment_code", "customer_code", "status"}).
			AddRow(int64(89), "ENV-DR", "CUS-1", "active"))
	mock.ExpectExec(`(?s)INSERT INTO customer_delivery_asset_environment_rel`).
		WithArgs(
			int64(42),
			int64(89),
			"disaster_recovery",
			int64(0),
			"deployed",
			"v2.0",
			nil,
			nil,
			"active",
			"PRJ-2",
			"tester",
			"tester",
		).
		WillReturnResult(sqlmock.NewResult(8, 1))
	mock.ExpectExec(`INSERT INTO asset_events`).
		WithArgs("customer_delivery_asset", int64(42), "environment_bound", sqlmock.AnyArg(), "tester").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM customer_delivery_asset_environment_rel\s+WHERE delivery_asset_id = \?\s+AND environment_id = \?\s+AND relation_type = \?\s+AND deleted_at IS NULL\s+LIMIT 1`).
		WithArgs(int64(42), int64(89), "disaster_recovery").
		WillReturnRows(sqlmock.NewRows([]string{"id", "delivery_asset_id", "environment_id", "relation_type", "is_primary", "deployment_status", "deployed_version", "status", "source_project_code"}).
			AddRow(int64(8), int64(42), int64(89), "disaster_recovery", int64(0), "deployed", "v2.0", "active", "PRJ-2"))
	mock.ExpectCommit()

	result, err := bindCustomerDeliveryAssetEnvironmentTx(context.Background(), tx, "CDA-1", map[string]any{
		"environmentCode":   "ENV-DR",
		"relationType":      "disaster_recovery",
		"deploymentStatus":  "deployed",
		"isPrimary":         false,
		"deployedVersion":   "v2.0",
		"sourceProjectCode": "PRJ-2",
	}, "tester")
	if err != nil {
		t.Fatalf("bindCustomerDeliveryAssetEnvironmentTx: %v", err)
	}
	relation, ok := result["relation"].(map[string]any)
	if !ok || relation["relation_type"] != "disaster_recovery" || relation["is_primary"] != int64(0) {
		t.Fatalf("relation = %#v, want non-primary disaster recovery relation", result["relation"])
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestListCustomerDeliveryAssetEnvironmentsPrefersRelationRows(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT \*\s+FROM customer_delivery_assets\s+WHERE delivery_asset_code = \?`).
		WithArgs("CDA-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "delivery_asset_code", "environment_code"}).
			AddRow(int64(42), "CDA-1", "ENV-OLD"))
	mock.ExpectQuery(`(?s)SELECT\s+rel\.\*,.*FROM customer_delivery_asset_environment_rel rel`).
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "delivery_asset_id", "environment_id", "environment_code", "source"}).
			AddRow(int64(7), int64(42), int64(88), "ENV-REL", "relation"))

	result, err := adapter.listCustomerDeliveryAssetEnvironments(context.Background(), "CDA-1")
	if err != nil {
		t.Fatalf("listCustomerDeliveryAssetEnvironments: %v", err)
	}
	items := result["items"].([]map[string]any)
	if len(items) != 1 || items[0]["environment_code"] != "ENV-REL" || items[0]["source"] != "relation" {
		t.Fatalf("items = %#v, want relation row only", items)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestListCustomerDeliveryAssetEnvironmentsFallsBackToLegacySnapshot(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT \*\s+FROM customer_delivery_assets\s+WHERE delivery_asset_code = \?`).
		WithArgs("CDA-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "delivery_asset_code", "environment_code"}).
			AddRow(int64(42), "CDA-1", "ENV-OLD"))
	mock.ExpectQuery(`(?s)SELECT\s+rel\.\*,.*FROM customer_delivery_asset_environment_rel rel`).
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "delivery_asset_id", "environment_id", "environment_code", "source"}))
	mock.ExpectQuery(`(?s)SELECT\s+id AS environment_id,.*'legacy_snapshot' AS source\s+FROM asset_environments\s+WHERE environment_code = \?`).
		WithArgs("ENV-OLD").
		WillReturnRows(sqlmock.NewRows([]string{"environment_id", "environment_code", "source"}).
			AddRow(int64(88), "ENV-OLD", "legacy_snapshot"))

	result, err := adapter.listCustomerDeliveryAssetEnvironments(context.Background(), "CDA-1")
	if err != nil {
		t.Fatalf("listCustomerDeliveryAssetEnvironments: %v", err)
	}
	items := result["items"].([]map[string]any)
	if len(items) != 1 || items[0]["environment_code"] != "ENV-OLD" || items[0]["source"] != "legacy_snapshot" {
		t.Fatalf("items = %#v, want legacy snapshot fallback", items)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestResolveServiceReferencesUsesBatchQueries(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT \*\s+FROM asset_environments\s+WHERE environment_code IN \(\?,\?\)`).
		WithArgs("ENV-1", "ENV-MISS").
		WillReturnRows(sqlmock.NewRows([]string{"id", "environment_code", "customer_code"}).
			AddRow(int64(88), "ENV-1", "CUS-1"))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM customer_delivery_assets\s+WHERE delivery_asset_code IN \(\?,\?\)\s+AND deleted_at IS NULL`).
		WithArgs("CDA-1", "CDA-MISS").
		WillReturnRows(sqlmock.NewRows([]string{"id", "delivery_asset_code", "customer_code"}).
			AddRow(int64(42), "CDA-1", "CUS-1"))
	mock.ExpectQuery(`(?s)FROM customer_delivery_asset_environment_rel rel.*WHERE rel\.deleted_at IS NULL.*AND \(\(cda\.delivery_asset_code = \? AND env\.environment_code = \?\) OR \(cda\.delivery_asset_code = \? AND env\.environment_code = \?\)\)`).
		WithArgs("CDA-1", "ENV-1", "CDA-MISS", "ENV-MISS").
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"delivery_asset_id",
			"environment_id",
			"delivery_asset_code",
			"environment_code",
			"delivery_asset_customer_code",
			"environment_customer_code",
			"status",
		}).AddRow(int64(7), int64(42), int64(88), "CDA-1", "ENV-1", "CUS-1", "CUS-1", "active"))

	result, err := adapter.resolveServiceReferences(context.Background(), map[string]any{
		"environmentCodes":   []string{"ENV-1", "ENV-MISS"},
		"deliveryAssetCodes": []string{"CDA-1", "CDA-MISS"},
		"pairs": []map[string]any{
			{"deliveryAssetCode": "CDA-1", "environmentCode": "ENV-1"},
			{"deliveryAssetCode": "CDA-MISS", "environmentCode": "ENV-MISS"},
		},
	})
	if err != nil {
		t.Fatalf("resolveServiceReferences: %v", err)
	}
	environments := result["environments"].([]map[string]any)
	if len(environments) != 2 || environments[0]["found"] != true || environments[1]["found"] != false {
		t.Fatalf("environments = %#v, want ordered found/missing results", environments)
	}
	assets := result["delivery_assets"].([]map[string]any)
	if len(assets) != 2 || assets[0]["found"] != true || assets[1]["found"] != false {
		t.Fatalf("delivery_assets = %#v, want ordered found/missing results", assets)
	}
	pairs := result["pairs"].([]map[string]any)
	if len(pairs) != 2 || pairs[0]["found"] != true || pairs[1]["found"] != false {
		t.Fatalf("pairs = %#v, want ordered found/missing pair results", pairs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestValidEnvironmentTransitionRejectsRetiredRollback(t *testing.T) {
	if validEnvironmentTransition("retired", "active") {
		t.Fatal("retired environment should not transition back to active")
	}
	if !validEnvironmentTransition("frozen", "active") {
		t.Fatal("frozen environment should be allowed to resume active")
	}
	if validEnvironmentTransition("active", "planning") {
		t.Fatal("active environment should not roll back to planning")
	}
}

func newAssetsSQLMockAdapter(t *testing.T) (*Adapter, sqlmock.Sqlmock, func()) {
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
