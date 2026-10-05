package people

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestNormalizeDirectoryDateDropsEmptySentinels(t *testing.T) {
	tests := map[string]string{
		"":                     "",
		"0000-00-00":           "",
		"1970-01-01 00:00:00":  "",
		"2026-08-27T12:30:00Z": "2026-08-27",
	}
	for input, expected := range tests {
		if actual := normalizeDirectoryDate(input); actual != expected {
			t.Fatalf("normalizeDirectoryDate(%q)=%q, want %q", input, actual, expected)
		}
	}
}

func TestDingTalkEmploymentSyncWritesActiveEmployeeAndAssignment(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT employee_no FROM people_employees WHERE employee_uid=\? FOR UPDATE`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"employee_no"}))
	mock.ExpectQuery(`SELECT next_value FROM people_employee_number_sequences`).
		WithArgs(employeeNumberSequenceCode).
		WillReturnRows(sqlmock.NewRows([]string{"next_value"}).AddRow(0))
	mock.ExpectQuery(`SELECT EXISTS.*people_employees.*EXISTS.*people_onboarding_cases`).
		WithArgs("000", "000").
		WillReturnRows(sqlmock.NewRows([]string{"employee_exists", "onboarding_exists"}).AddRow(0, 0))
	mock.ExpectExec(`UPDATE people_employee_number_sequences SET next_value=\?`).
		WithArgs(int64(1), employeeNumberSequenceCode).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO people_employees.*onboard_date_source = CASE WHEN \? THEN 'dingtalk'`).
		WithArgs(
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT assignment_code,change_type,COALESCE\(source_app,''\)`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"assignment_code", "change_type", "source_app"}))
	mock.ExpectExec(`INSERT INTO people_assignments`).
		WithArgs(
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE people_assignments a.*SET a\.effective_from = e\.onboard_date`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := adapter.syncDirectoryUsers(context.Background(), map[string]any{
		"source_app": "connector-runtime", "source_biz_type": "dingtalk_hr_employee",
		"effective_from": "2026-07-23", "items": []any{map[string]any{
			"employee_uid": "u1", "employee_no": "DINGTALK-MUST-BE-IGNORED", "display_name": "Alice",
			"dept_code": "D1", "dept_name": "研发部", "position_name": "Engineer",
			"employment_status": "active", "onboard_date": "2025-03-04", "source_biz_id": "ding-u1",
		}},
	})
	if err != nil || result["synced"] != 1 || result["assignments_synced"] != 1 {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDingTalkEmploymentSyncWritesLeaveAssignmentWithoutArchivingEmployee(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT employee_no FROM people_employees WHERE employee_uid=\? FOR UPDATE`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"employee_no"}).AddRow("007"))
	mock.ExpectExec(`(?s)INSERT INTO people_employees.*archived_at.*VALUES.*NULL\).*archived_at = NULL`).
		WithArgs(
			sqlmock.AnyArg(), "007", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
		).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE people_assignments`).
		WithArgs("2026-07-31", "connector-runtime", "u1", "2026-07-31", "2026-07-31").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO people_assignments`).
		WithArgs(
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
		).
		WillReturnResult(sqlmock.NewResult(2, 1))
	mock.ExpectCommit()

	result, err := adapter.syncDirectoryUsers(context.Background(), map[string]any{
		"source_app": "connector-runtime", "source_biz_type": "dingtalk_hr_employee",
		"effective_from": "2026-07-23", "items": []any{map[string]any{
			"employee_uid": "u1", "employee_no": "DINGTALK-MUST-BE-IGNORED", "display_name": "Alice",
			"dept_code": "D1", "employment_status": "leaving", "leave_date": "2026-07-31",
			"effective_from": "2026-07-31", "source_biz_id": "ding-u1",
		}},
	})
	if err != nil || result["synced"] != 1 || result["assignments_synced"] != 1 {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
