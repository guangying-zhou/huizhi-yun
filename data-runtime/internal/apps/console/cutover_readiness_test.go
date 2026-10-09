package console

import (
	"context"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/config"
)

func expectCompleteConsoleSchema(mock sqlmock.Sqlmock) {
	tableRows := sqlmock.NewRows([]string{"TABLE_NAME"})
	columnRows := sqlmock.NewRows([]string{"TABLE_NAME", "COLUMN_NAME"})
	indexRows := sqlmock.NewRows([]string{"TABLE_NAME", "INDEX_NAME"})
	constraintRows := sqlmock.NewRows([]string{"TABLE_NAME", "CONSTRAINT_NAME"})
	for _, table := range requiredTables {
		tableRows.AddRow(table)
		for _, column := range consoleSchemaManifest.Tables[table].Columns {
			columnRows.AddRow(table, column)
		}
		for _, index := range consoleSchemaManifest.Tables[table].Indexes {
			indexRows.AddRow(table, index)
		}
		for _, constraint := range consoleSchemaManifest.Tables[table].Constraints {
			constraintRows.AddRow(table, constraint)
		}
	}
	mock.ExpectQuery(`(?s)FROM information_schema\.TABLES`).WillReturnRows(tableRows)
	mock.ExpectQuery(`(?s)FROM information_schema\.COLUMNS`).WillReturnRows(columnRows)
	mock.ExpectQuery(`(?s)FROM information_schema\.STATISTICS`).WillReturnRows(indexRows)
	mock.ExpectQuery(`(?s)FROM information_schema\.TABLE_CONSTRAINTS`).WillReturnRows(constraintRows)
}

func expectCutoverCounts(mock sqlmock.Sqlmock, blocking map[string]int64, metrics map[string]int64) {
	for _, spec := range cutoverBlockingChecks("C000001", "C000001-console") {
		mock.ExpectQuery("SELECT").WillReturnRows(
			sqlmock.NewRows([]string{"violations"}).AddRow(blocking[spec.code]),
		)
	}
	for _, spec := range cutoverMetrics() {
		mock.ExpectQuery("SELECT").WillReturnRows(
			sqlmock.NewRows([]string{"count"}).AddRow(metrics[spec.code]),
		)
	}
}

func TestCutoverReadinessRequiresSchemaDataIntegrityAndDrainedBacklogs(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	expectCompleteConsoleSchema(mock)
	expectCutoverCounts(mock, nil, nil)

	adapter := NewWithDB(
		config.ConsoleConfig{DB: config.DBConfig{Database: "hzy_console"}},
		"C000001",
		database,
	)
	status, err := adapter.CutoverReadiness(context.Background(), "C000001-console")
	if err != nil {
		t.Fatal(err)
	}
	if status.Status != "ready" || len(status.Blockers) != 0 ||
		len(status.Checks) != len(cutoverBlockingChecks("C000001", "C000001-console")) ||
		len(status.Metrics) != len(cutoverMetrics()) {
		t.Fatalf("unexpected cutover readiness: %#v", status)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCutoverReadinessReportsIntegrityAndBacklogBlockers(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	expectCompleteConsoleSchema(mock)
	expectCutoverCounts(mock,
		map[string]int64{
			"runtime_database_global_privileges": 1,
			"runtime_data_binding":               2,
			"stale_mutation_receipts":            1,
		},
		map[string]int64{"failed_integration_operations": 3, "pending_user_actionables": 7},
	)

	status, err := NewWithDB(config.ConsoleConfig{}, "C000001", database).
		CutoverReadiness(context.Background(), "C000001-console")
	if err != nil {
		t.Fatal(err)
	}
	if status.Status != "not_ready" {
		t.Fatalf("expected not_ready, got %#v", status)
	}
	for _, expected := range []string{
		"runtime_database_global_privileges",
		"runtime_data_binding",
		"stale_mutation_receipts",
		"failed_integration_operations",
	} {
		found := false
		for _, blocker := range status.Blockers {
			if blocker == expected {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("missing blocker %q in %#v", expected, status.Blockers)
		}
	}
	for _, blocker := range status.Blockers {
		if blocker == "pending_user_actionables" {
			t.Fatalf("legitimate pending user actionables must remain a metric, got blockers %#v", status.Blockers)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCutoverReadinessChecksRuntimeDatabaseLeastPrivilege(t *testing.T) {
	specs := cutoverBlockingChecks("C000001", "C000001-console")
	queries := map[string]string{}
	for _, spec := range specs {
		queries[spec.code] = spec.query
	}
	for _, code := range []string{
		"runtime_database_identity",
		"runtime_database_global_privileges",
		"runtime_database_schema_privileges",
	} {
		if queries[code] == "" {
			t.Fatalf("missing database least-privilege cutover check %q", code)
		}
	}
	if !strings.Contains(queries["runtime_database_identity"], "CURRENT_USER()") ||
		!strings.Contains(queries["runtime_database_global_privileges"], "USER_PRIVILEGES") ||
		!strings.Contains(queries["runtime_database_schema_privileges"], "CREATE TEMPORARY TABLES") {
		t.Fatalf("database least-privilege checks are incomplete: %#v", queries)
	}
}

func TestCutoverReadinessFailsClosedWithoutRuntimeBinding(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	expectCompleteConsoleSchema(mock)

	status, err := NewWithDB(config.ConsoleConfig{}, "", database).
		CutoverReadiness(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	if status.Status != "not_ready" || len(status.Blockers) != 2 {
		t.Fatalf("missing runtime binding must fail closed: %#v", status)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
