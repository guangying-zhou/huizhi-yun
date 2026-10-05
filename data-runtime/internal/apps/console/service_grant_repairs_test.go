package console

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/config"
)

func TestReconcileAimsCodocsRuntimeReadGrantIsFixedCredentialBackedAndAudited(t *testing.T) {
	database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := NewWithDB(config.ConsoleConfig{}, "tenant-1", database)

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT id,current_credential_id,status.*app_code='aims'.*client_code='aims\.runtime'.*FOR UPDATE`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "current_credential_id", "status"}).AddRow(41, 82, "active"))
	mock.ExpectExec(`(?s)INSERT INTO service_client_grants.*VALUES \(\?,\?,'read',CAST\(\? AS JSON\),'active'.*ON DUPLICATE KEY UPDATE`).
		WithArgs(uint64(41), "data-runtime:codocs", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(101, 1))
	mock.ExpectExec(`(?s)INSERT INTO service_client_grants.*VALUES \(\?,\?,'read',CAST\(\? AS JSON\),'active'.*ON DUPLICATE KEY UPDATE`).
		WithArgs(uint64(41), "tenant-runtime:codocs", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(102, 1))
	mock.ExpectExec(`(?s)INSERT INTO operation_logs.*reconcile_aims_codocs_runtime_read.*'aims\.runtime','human',\?,\?,CAST\(\? AS JSON\)`).
		WithArgs("admin:admin", "request-1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(103, 1))
	mock.ExpectCommit()

	result, err := adapter.ReconcileAimsCodocsRuntimeReadGrant(context.Background(), "admin:admin", "request-1")
	if err != nil {
		t.Fatal(err)
	}
	if result["status"] != "reconciled" || result["serviceClientCode"] != "aims.runtime" {
		t.Fatalf("unexpected repair result: %#v", result)
	}
	grants, ok := result["grants"].([]string)
	if !ok || len(grants) != 2 || grants[0] != "data-runtime:codocs:read" || grants[1] != "tenant-runtime:codocs:read" {
		t.Fatalf("unexpected repaired grants: %#v", result["grants"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
