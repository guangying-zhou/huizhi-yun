package compat

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestSchemaStatusReportsMissingRequiredColumns(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{
		appCode:         "aims",
		db:              db,
		dbName:          "hzy_aims",
		requiredTables:  []string{"work_item_service_ext"},
		requiredColumns: []string{"work_item_service_ext.delivery_generation", "work_item_service_ext.last_delivery_status"},
	}
	mock.ExpectQuery(`(?s)FROM information_schema\.TABLES`).
		WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("work_item_service_ext"))
	mock.ExpectQuery(`(?s)FROM information_schema\.COLUMNS`).
		WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME", "COLUMN_NAME"}).
			AddRow("work_item_service_ext", "last_delivery_status"))

	status, err := adapter.SchemaStatus(context.Background())
	if err != nil {
		t.Fatalf("SchemaStatus: %v", err)
	}
	if status.Status != "schema_mismatch" {
		t.Fatalf("status = %q, want schema_mismatch", status.Status)
	}
	if len(status.MissingColumns) != 1 || status.MissingColumns[0] != "work_item_service_ext.delivery_generation" {
		t.Fatalf("unexpected missing columns: %#v", status.MissingColumns)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestSchemaStatusAcceptsRequiredColumns(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{
		appCode:         "aims",
		db:              db,
		dbName:          "hzy_aims",
		requiredTables:  []string{"work_item_service_ext"},
		requiredColumns: []string{"work_item_service_ext.last_delivery_status", "work_item_service_ext.delivery_generation"},
	}
	mock.ExpectQuery(`(?s)FROM information_schema\.TABLES`).
		WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("work_item_service_ext"))
	mock.ExpectQuery(`(?s)FROM information_schema\.COLUMNS`).
		WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME", "COLUMN_NAME"}).
			AddRow("work_item_service_ext", "delivery_generation").
			AddRow("work_item_service_ext", "last_delivery_status"))

	status, err := adapter.SchemaStatus(context.Background())
	if err != nil {
		t.Fatalf("SchemaStatus: %v", err)
	}
	if status.Status != "ok" || len(status.MissingColumns) != 0 {
		t.Fatalf("unexpected schema status: %#v", status)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
