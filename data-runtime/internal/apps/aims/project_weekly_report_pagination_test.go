package aims

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"net/url"
	"testing"
)

func TestProjectWeeklyPageRechecksAccessWithinCountCalendarSnapshot(t *testing.T) {
	a, m, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	m.ExpectBegin()
	m.ExpectQuery(`SELECT id FROM aims_projects WHERE id = \? LIMIT 1`).WithArgs("1").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))
	m.ExpectQuery(`SELECT COUNT\(\*\) FROM project_weekly_reports r WHERE r.project_id=\?`).WithArgs("1").WillReturnRows(sqlmock.NewRows([]string{"total"}).AddRow(107))
	m.ExpectQuery(`SELECT id FROM project_weekly_reports WHERE project_id=\? ORDER BY report_year DESC,report_week DESC, r.id DESC LIMIT \? OFFSET \?`).WithArgs("1", 100, 100).WillReturnRows(sqlmock.NewRows([]string{"id"}))
	m.ExpectQuery(`SELECT report_year,report_week,status FROM project_weekly_reports WHERE project_id=\? ORDER BY report_year DESC,report_week DESC,id DESC`).WithArgs("1").WillReturnRows(sqlmock.NewRows([]string{"year", "week", "status"}).AddRow(2025, 52, "draft"))
	m.ExpectCommit()
	d, e := a.projectWeeklyReportListPage(context.Background(), "1", "viewer", url.Values{"current_user_is_project_admin": {"1"}}, timeEntryPage{page: 2, size: 100}, "r.project_id=?", []any{"1"}, "SELECT id FROM project_weekly_reports WHERE project_id=? ORDER BY report_year DESC,report_week DESC")
	if e != nil || d["total"] != int64(107) || len(d["calendar"].([]weeklyReportCalendarRow)) != 1 {
		t.Fatal(d, e)
	}
	if e = m.ExpectationsWereMet(); e != nil {
		t.Fatal(e)
	}
}
