package aims

import (
	"context"
	"reflect"
	"testing"
	"unsafe"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
)

func TestRecalculateProjectCostSummaryAggregatesWorklogsAndWritesIdempotentSummary(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT \*\s+FROM aims_projects\s+WHERE project_code = \?\s+AND lifecycle_status <> 'archived'\s+LIMIT 1`).
		WithArgs("PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_code", "name", "lifecycle_status"}).
			AddRow(int64(10), "PRJ-1", "交付项目", "active"))
	mock.ExpectQuery(`(?s)SELECT\s+t\.uid,\s+COUNT\(\*\) AS worklog_count,\s+COALESCE\(SUM\(t\.hours\), 0\) AS total_hours\s+FROM time_entries t\s+INNER JOIN aims_projects p ON p\.id = t\.project_id`).
		WithArgs("PRJ-1", "2026-06-01", "2026-06-30").
		WillReturnRows(sqlmock.NewRows([]string{"uid", "worklog_count", "total_hours"}).
			AddRow("u1", int64(2), float64(10)).
			AddRow("u2", int64(1), float64(5)))
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM project_cost_summary\s+WHERE project_code = \?`).
		WithArgs("PRJ-1", "2026-06-01", "2026-06-30", "calc-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectExec(`(?s)UPDATE project_cost_summary\s+SET is_current = 0`).
		WithArgs("tester", "PRJ-1", "2026-06-01", "2026-06-30").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT COALESCE\(MAX\(version\), 0\) \+ 1\s+FROM project_cost_summary`).
		WithArgs("PRJ-1", "2026-06-01", "2026-06-30").
		WillReturnRows(sqlmock.NewRows([]string{"version"}).AddRow(int64(1)))
	mock.ExpectExec(`(?s)INSERT INTO project_cost_summary`).
		WithArgs(
			"PRJ-1",
			"2026-06-01",
			"2026-06-30",
			int64(3),
			float64(15),
			float64(2000),
			float64(300),
			float64(50),
			float64(2350),
			"calc-1",
			"people-202606",
			int64(1),
			sqlmock.AnyArg(),
			"tester",
			"tester",
		).
		WillReturnResult(sqlmock.NewResult(88, 1))
	mock.ExpectQuery(`SELECT \* FROM project_cost_summary WHERE id = \? LIMIT 1`).
		WithArgs(int64(88)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "project_code", "period_start", "period_end", "total_worklogs", "total_hours", "labor_cost", "outsourced_cost", "other_cost", "total_cost", "calculation_key", "version", "is_current",
		}).AddRow(int64(88), "PRJ-1", "2026-06-01", "2026-06-30", int64(3), float64(15), float64(2000), float64(300), float64(50), float64(2350), "calc-1", int64(1), int64(1)))
	mock.ExpectCommit()

	result, err := adapter.recalculateProjectCostSummary(context.Background(), "PRJ-1", map[string]any{
		"periodStart":    "2026-06-01",
		"periodEnd":      "2026-06-30",
		"calculationKey": "calc-1",
		"sourceVersion":  "people-202606",
		"hourlyCosts": map[string]any{
			"u1": float64(100),
			"u2": float64(200),
		},
		"outsourcedCost": float64(300),
		"otherCost":      float64(50),
		"operator_uid":   "tester",
	})
	if err != nil {
		t.Fatalf("recalculateProjectCostSummary: %v", err)
	}
	if result["idempotent"] != false {
		t.Fatalf("idempotent = %#v, want false", result["idempotent"])
	}
	summary := result["summary"].(map[string]any)
	if summary["total_cost"] != float64(2350) {
		t.Fatalf("summary = %#v, want total_cost 2350", summary)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRecalculateProjectCostSummaryReturnsExistingCalculation(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT \*\s+FROM aims_projects\s+WHERE project_code = \?\s+AND lifecycle_status <> 'archived'\s+LIMIT 1`).
		WithArgs("PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_code", "lifecycle_status"}).
			AddRow(int64(10), "PRJ-1", "active"))
	mock.ExpectQuery(`(?s)SELECT\s+t\.uid,\s+COUNT\(\*\) AS worklog_count,\s+COALESCE\(SUM\(t\.hours\), 0\) AS total_hours\s+FROM time_entries t`).
		WithArgs("PRJ-1", "2026-06-01", "2026-06-30").
		WillReturnRows(sqlmock.NewRows([]string{"uid", "worklog_count", "total_hours"}).
			AddRow("u1", int64(1), float64(8)))
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM project_cost_summary\s+WHERE project_code = \?`).
		WithArgs("PRJ-1", "2026-06-01", "2026-06-30", "calc-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_code", "calculation_key"}).
			AddRow(int64(77), "PRJ-1", "calc-1"))
	mock.ExpectCommit()

	result, err := adapter.recalculateProjectCostSummary(context.Background(), "PRJ-1", map[string]any{
		"periodStart":       "2026-06-01",
		"periodEnd":         "2026-06-30",
		"calculationKey":    "calc-1",
		"defaultHourlyCost": float64(100),
	})
	if err != nil {
		t.Fatalf("recalculateProjectCostSummary: %v", err)
	}
	if result["idempotent"] != true {
		t.Fatalf("idempotent = %#v, want true", result["idempotent"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func newAimsSQLMockAdapter(t *testing.T) (*Adapter, sqlmock.Sqlmock, func()) {
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
