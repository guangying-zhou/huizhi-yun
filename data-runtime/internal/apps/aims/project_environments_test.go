package aims

import (
	"context"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestProjectEnvironmentCommandPathParsesNestedEnvironmentCommand(t *testing.T) {
	projectCode, environmentCode, action, ok := projectEnvironmentCommandPath("/v1/aims/service/projects/PRJ%2F1/environments/ENV%2F1:assets-sync")
	if !ok {
		t.Fatal("expected path to parse")
	}
	if projectCode != "PRJ/1" || environmentCode != "ENV/1" || action != "assets-sync" {
		t.Fatalf("parsed = %q/%q/%q", projectCode, environmentCode, action)
	}
	if _, _, _, ok := projectEnvironmentCommandPath("/v1/aims/service/projects/PRJ-1/environments"); ok {
		t.Fatal("collection path should not parse as command")
	}
}

func TestLockProjectEnvironmentForCommandRequiresDisambiguation(t *testing.T) {
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

	mock.ExpectQuery(`(?s)SELECT \*\s+FROM project_environments\s+WHERE project_id = \? AND environment_code = \? AND deleted_at IS NULL`).
		WithArgs(int64(10), "ENV-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "environment_code", "delivery_asset_code", "relation_type", "delivery_status"}).
			AddRow(1, 10, "ENV-1", "CDA-1", "initial_delivery", "planned").
			AddRow(2, 10, "ENV-1", "CDA-2", "upgrade", "planned"))

	_, err = lockProjectEnvironmentForCommandTx(context.Background(), tx, int64(10), "ENV-1", map[string]any{})
	if err == nil {
		t.Fatal("expected ambiguity error")
	}
	if httpErr, ok := err.(httperror.Error); !ok || httpErr.Code != "environment_reference_ambiguous" {
		t.Fatalf("err = %#v, want environment_reference_ambiguous", err)
	}
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestUpsertProjectEnvironmentTxWritesFormalEnvironmentRelation(t *testing.T) {
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

	mock.ExpectQuery(`(?s)SELECT \*\s+FROM aims_projects\s+WHERE project_code = \?\s+AND lifecycle_status <> 'archived'\s+LIMIT 1\s+FOR UPDATE`).
		WithArgs("PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_code", "name", "customer_code", "contract_code", "lifecycle_status"}).
			AddRow(int64(10), "PRJ-1", "交付项目", "CUS-1", "CON-1", "active"))
	mock.ExpectExec(`(?s)UPDATE project_environments\s+SET is_primary = 0`).
		WithArgs("tester", int64(10)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO project_environments`).
		WithArgs(
			int64(10),
			"ENV-1",
			"CDA-1",
			"initial_delivery",
			"planned",
			int64(1),
			"2026-07-01 00:00:00",
			nil,
			nil,
			"pending",
			nil,
			"1.0.0",
			"pending",
			nil,
			nil,
			"CL-1",
			"OB-1",
			"10:ENV-1:CDA-1:initial_delivery",
			"tester",
			"tester",
		).
		WillReturnResult(sqlmock.NewResult(99, 1))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM project_environments\s+WHERE project_id = \? AND environment_code = \? AND relation_type = \? AND deleted_at IS NULL AND delivery_asset_code = \?\s+LIMIT 1`).
		WithArgs(int64(10), "ENV-1", "initial_delivery", "CDA-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "environment_code", "delivery_asset_code", "relation_type", "delivery_status", "assets_sync_status", "is_primary"}).
			AddRow(int64(99), int64(10), "ENV-1", "CDA-1", "initial_delivery", "planned", "pending", int64(1)))
	mock.ExpectCommit()

	result, err := upsertProjectEnvironmentTx(context.Background(), tx, "PRJ-1", map[string]any{
		"environmentCode":         "ENV-1",
		"deliveryAssetCode":       "CDA-1",
		"isPrimary":               true,
		"plannedGoLiveAt":         "2026-07-01 00:00:00",
		"deliveryVersionSnapshot": "1.0.0",
		"sourceContractLineCode":  "CL-1",
		"sourceObligationCode":    "OB-1",
		"operator_uid":            "tester",
	})
	if err != nil {
		t.Fatalf("upsertProjectEnvironmentTx: %v", err)
	}
	relation, ok := result["relation"].(map[string]any)
	if !ok || relation["environment_code"] != "ENV-1" || relation["assets_sync_status"] != "pending" {
		t.Fatalf("relation = %#v, want ENV-1 pending relation", result["relation"])
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestUpsertProjectEnvironmentTxRejectsPlaceholderEnvironmentCode(t *testing.T) {
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

	_, err = upsertProjectEnvironmentTx(context.Background(), tx, "PRJ-1", map[string]any{
		"environmentCode": "TEMP-ENV-1",
	})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "invalid_environment_code" {
		t.Fatalf("error = %#v, want 400 invalid_environment_code", err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatalf("Rollback: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestUpsertProjectEnvironmentTxRejectsInvalidDeliveryStatus(t *testing.T) {
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

	_, err = upsertProjectEnvironmentTx(context.Background(), tx, "PRJ-1", map[string]any{
		"environmentCode": "ENV-1",
		"deliveryStatus":  "onlien",
	})
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

func TestChangeProjectEnvironmentTxStatusMarksAssetsSyncPending(t *testing.T) {
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

	mock.ExpectQuery(`(?s)SELECT \*\s+FROM aims_projects\s+WHERE project_code = \?\s+AND lifecycle_status <> 'archived'\s+LIMIT 1\s+FOR UPDATE`).
		WithArgs("PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_code", "lifecycle_status"}).
			AddRow(int64(10), "PRJ-1", "active"))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM project_environments\s+WHERE project_id = \? AND environment_code = \? AND deleted_at IS NULL AND relation_type = \? AND delivery_asset_code = \?`).
		WithArgs(int64(10), "ENV-1", "initial_delivery", "CDA-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "environment_code", "delivery_asset_code", "relation_type", "delivery_status"}).
			AddRow(int64(99), int64(10), "ENV-1", "CDA-1", "initial_delivery", "deployed"))
	mock.ExpectExec(`(?s)UPDATE project_environments\s+SET delivery_status = \?`).
		WithArgs("online", sqlmock.AnyArg(), nil, nil, nil, "tester", int64(99)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT \* FROM project_environments WHERE id = \? LIMIT 1`).
		WithArgs(int64(99)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "delivery_status", "assets_sync_status", "assets_sync_error"}).
			AddRow(int64(99), "online", "pending", nil))
	mock.ExpectCommit()

	result, err := changeProjectEnvironmentTx(context.Background(), tx, "PRJ-1", "ENV-1", "status", map[string]any{
		"deliveryStatus":    "online",
		"relationType":      "initial_delivery",
		"deliveryAssetCode": "CDA-1",
		"operator_uid":      "tester",
	})
	if err != nil {
		t.Fatalf("changeProjectEnvironmentTx: %v", err)
	}
	relation := result["relation"].(map[string]any)
	if relation["assets_sync_status"] != "pending" || relation["assets_sync_error"] != nil {
		t.Fatalf("relation = %#v, want pending sync without error", relation)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestChangeProjectEnvironmentTxRejectsInvalidDeliveryStatus(t *testing.T) {
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

	_, err = changeProjectEnvironmentTx(context.Background(), tx, "PRJ-1", "ENV-1", "status", map[string]any{
		"deliveryStatus": "onlien",
	})
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

func TestChangeProjectEnvironmentTxAssetsSyncFailureIsObservable(t *testing.T) {
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

	mock.ExpectQuery(`(?s)SELECT \*\s+FROM aims_projects\s+WHERE project_code = \?\s+AND lifecycle_status <> 'archived'\s+LIMIT 1\s+FOR UPDATE`).
		WithArgs("PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_code", "lifecycle_status"}).
			AddRow(int64(10), "PRJ-1", "active"))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM project_environments\s+WHERE project_id = \? AND environment_code = \? AND deleted_at IS NULL AND relation_type = \? AND delivery_asset_code = \?`).
		WithArgs(int64(10), "ENV-1", "initial_delivery", "CDA-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "environment_code", "delivery_asset_code", "relation_type", "delivery_status"}).
			AddRow(int64(99), int64(10), "ENV-1", "CDA-1", "initial_delivery", "online"))
	mock.ExpectExec(`(?s)UPDATE project_environments\s+SET assets_sync_status = \?`).
		WithArgs("failed", "Assets timeout", nil, "tester", int64(99)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT \* FROM project_environments WHERE id = \? LIMIT 1`).
		WithArgs(int64(99)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "delivery_status", "assets_sync_status", "assets_sync_error"}).
			AddRow(int64(99), "online", "failed", "Assets timeout"))
	mock.ExpectCommit()

	result, err := changeProjectEnvironmentTx(context.Background(), tx, "PRJ-1", "ENV-1", "assets-sync", map[string]any{
		"status":            "failed",
		"error":             "Assets timeout",
		"relationType":      "initial_delivery",
		"deliveryAssetCode": "CDA-1",
		"operator_uid":      "tester",
	})
	if err != nil {
		t.Fatalf("changeProjectEnvironmentTx: %v", err)
	}
	relation := result["relation"].(map[string]any)
	if relation["assets_sync_status"] != "failed" || relation["assets_sync_error"] != "Assets timeout" {
		t.Fatalf("relation = %#v, want failed sync with diagnostic error", relation)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestChangeProjectEnvironmentTxRejectsInvalidAssetsSyncStatus(t *testing.T) {
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

	mock.ExpectQuery(`(?s)SELECT \*\s+FROM aims_projects\s+WHERE project_code = \?\s+AND lifecycle_status <> 'archived'\s+LIMIT 1\s+FOR UPDATE`).
		WithArgs("PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_code", "lifecycle_status"}).
			AddRow(int64(10), "PRJ-1", "active"))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM project_environments\s+WHERE project_id = \? AND environment_code = \? AND deleted_at IS NULL AND relation_type = \? AND delivery_asset_code = \?`).
		WithArgs(int64(10), "ENV-1", "initial_delivery", "CDA-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "environment_code", "delivery_asset_code", "relation_type", "delivery_status"}).
			AddRow(int64(99), int64(10), "ENV-1", "CDA-1", "initial_delivery", "online"))
	mock.ExpectRollback()

	_, err = changeProjectEnvironmentTx(context.Background(), tx, "PRJ-1", "ENV-1", "assets-sync", map[string]any{
		"status":            "done",
		"relationType":      "initial_delivery",
		"deliveryAssetCode": "CDA-1",
	})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "invalid_assets_sync_status" {
		t.Fatalf("error = %#v, want 400 invalid_assets_sync_status", err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatalf("Rollback: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestChangeProjectEnvironmentTxAssetsSyncRetryMarksSynced(t *testing.T) {
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

	mock.ExpectQuery(`(?s)SELECT \*\s+FROM aims_projects\s+WHERE project_code = \?\s+AND lifecycle_status <> 'archived'\s+LIMIT 1\s+FOR UPDATE`).
		WithArgs("PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_code", "lifecycle_status"}).
			AddRow(int64(10), "PRJ-1", "active"))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM project_environments\s+WHERE project_id = \? AND environment_code = \? AND deleted_at IS NULL AND relation_type = \? AND delivery_asset_code = \?`).
		WithArgs(int64(10), "ENV-1", "initial_delivery", "CDA-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "environment_code", "delivery_asset_code", "relation_type", "delivery_status", "assets_sync_status"}).
			AddRow(int64(99), int64(10), "ENV-1", "CDA-1", "initial_delivery", "online", "failed"))
	mock.ExpectExec(`(?s)UPDATE project_environments\s+SET assets_sync_status = \?`).
		WithArgs("synced", nil, "2026-07-01 10:00:00", "tester", int64(99)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT \* FROM project_environments WHERE id = \? LIMIT 1`).
		WithArgs(int64(99)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "delivery_status", "assets_sync_status", "assets_sync_error", "assets_synced_at"}).
			AddRow(int64(99), "online", "synced", nil, "2026-07-01 10:00:00"))
	mock.ExpectCommit()

	result, err := changeProjectEnvironmentTx(context.Background(), tx, "PRJ-1", "ENV-1", "assets-sync", map[string]any{
		"status":            "synced",
		"assetsSyncedAt":    "2026-07-01 10:00:00",
		"relationType":      "initial_delivery",
		"deliveryAssetCode": "CDA-1",
		"operator_uid":      "tester",
	})
	if err != nil {
		t.Fatalf("changeProjectEnvironmentTx: %v", err)
	}
	relation := result["relation"].(map[string]any)
	if relation["assets_sync_status"] != "synced" || relation["assets_synced_at"] != "2026-07-01 10:00:00" {
		t.Fatalf("relation = %#v, want synced retry with timestamp", relation)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestChangeProjectEnvironmentTxRemoveClearsActiveRelationKey(t *testing.T) {
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

	mock.ExpectQuery(`(?s)SELECT \*\s+FROM aims_projects\s+WHERE project_code = \?\s+AND lifecycle_status <> 'archived'\s+LIMIT 1\s+FOR UPDATE`).
		WithArgs("PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_code", "lifecycle_status"}).
			AddRow(int64(10), "PRJ-1", "active"))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM project_environments\s+WHERE project_id = \? AND environment_code = \? AND deleted_at IS NULL AND relation_type = \? AND delivery_asset_code = \?`).
		WithArgs(int64(10), "ENV-1", "verification", "CDA-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "environment_code", "delivery_asset_code", "relation_type", "delivery_status"}).
			AddRow(int64(99), int64(10), "ENV-1", "CDA-1", "verification", "planned"))
	mock.ExpectExec(`(?s)UPDATE project_environments\s+SET deleted_at = CURRENT_TIMESTAMP,\s+delivery_status = 'cancelled',\s+is_primary = 0,\s+active_relation_key = NULL`).
		WithArgs("tester", int64(99)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT \* FROM project_environments WHERE id = \? LIMIT 1`).
		WithArgs(int64(99)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "delivery_status", "deleted_at", "active_relation_key"}).
			AddRow(int64(99), "cancelled", "2026-07-01 10:00:00", nil))
	mock.ExpectCommit()

	result, err := changeProjectEnvironmentTx(context.Background(), tx, "PRJ-1", "ENV-1", "remove", map[string]any{
		"relationType":      "verification",
		"deliveryAssetCode": "CDA-1",
		"operator_uid":      "tester",
	})
	if err != nil {
		t.Fatalf("changeProjectEnvironmentTx: %v", err)
	}
	relation := result["relation"].(map[string]any)
	if relation["delivery_status"] != "cancelled" || relation["active_relation_key"] != nil {
		t.Fatalf("relation = %#v, want cancelled relation with cleared active key", relation)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestValidProjectEnvironmentTransitionPreventsAcceptedRollback(t *testing.T) {
	if validProjectEnvironmentTransition("accepted", "deployed") {
		t.Fatal("accepted should not roll back to deployed")
	}
	if !validProjectEnvironmentTransition("accepted", "handed_over") {
		t.Fatal("accepted should progress to handed_over")
	}
}
