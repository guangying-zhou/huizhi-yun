package aims

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"net/url"
	"testing"
)

func TestTimeEntryPageStrictBoundsDatesAndLegacy(t *testing.T) {
	if _, paged, e := timeEntryPagination(url.Values{}); e != nil || paged {
		t.Fatal(paged, e)
	}
	for _, q := range []url.Values{{"page": {"01"}}, {"page": {"0"}}, {"page": {""}}, {"page": {"1", "2"}}, {"pageSize": {"101"}}, {"page": {"1"}, "limit": {"20"}}, {"page": {"1"}, "startDate": {"2026-02-30"}}, {"page": {"1"}, "startDate": {"2026-09-02"}, "endDate": {"2026-09-01"}}, {"page": {"1"}, "projectId": {"01"}}, {"page": {"1"}, "monthStart": {"2026-09-02"}, "monthEnd": {"2026-09-30"}}, {"page": {"1"}, "weekStart": {"2026-09-21"}, "weekEnd": {"2026-10-04"}}, {"page": {"1"}, "weekStart": {"2026-09-29"}, "weekEnd": {"2026-10-05"}}, {"todayDate": {"2026-09-27"}}} {
		if _, _, e := timeEntryPagination(q); e == nil {
			t.Fatal("accepted", q)
		}
	}
}
func TestTimeEntryPageAggregatesSameWhereSnapshotAndAllProjectWeekBuckets(t *testing.T) {
	a, m, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	m.ExpectBegin()
	m.ExpectQuery("SELECT timezone FROM weekly_reporting_settings").WillReturnRows(sqlmock.NewRows([]string{"timezone"}).AddRow("Asia/Shanghai"))
	where := `(?s)t.uid = \? AND t.weekly_report_id IS NULL AND t.entry_date >= \? AND t.entry_date <= \?`
	m.ExpectQuery(`SELECT DATE_FORMAT.*CAST\(SUM\(t.hours\) AS CHAR\),COUNT\(\*\).*`+where+`.*GROUP BY t.entry_date,t.project_id`).WithArgs("viewer", "2026-08-31", "2026-09-30").WillReturnRows(sqlmock.NewRows([]string{"date", "project", "code", "name", "status", "hours", "count"}).AddRow("2026-08-31", 1, "P1", "One", "draft", "2.10", 1).AddRow("2026-09-01", 1, "P1", "One", "submitted", "210.60", 101).AddRow("2026-09-01", 2, "P2", "Two", "returned", "4.20", 2))
	m.ExpectQuery(`SELECT COUNT\(\*\).*`+where+` AND t.project_id=\?`).WithArgs("viewer", "2026-08-31", "2026-09-30", "1").WillReturnRows(sqlmock.NewRows([]string{"total"}).AddRow(102))
	m.ExpectQuery(`SELECT t.id.*`+where+` AND t.project_id=\?.*ORDER BY t.entry_date ASC,t.created_at ASC,t.id ASC LIMIT \? OFFSET \?`).WithArgs("viewer", "2026-08-31", "2026-09-30", "1", 100, 100).WillReturnRows(sqlmock.NewRows([]string{"id", "wi", "pi", "code", "name", "short", "key", "title", "uid", "date", "hours", "description", "status", "route", "reviewer", "locked", "version", "submitted", "reviewedby", "reviewedat", "reason", "created", "updated"}))
	m.ExpectCommit()
	d, e := a.userTimeEntries(context.Background(), "viewer", url.Values{"current_user": {"viewer"}, "page": {"2"}, "pageSize": {"100"}, "calendarProjectId": {"1"}, "startDate": {"2026-08-31"}, "endDate": {"2026-09-30"}, "monthStart": {"2026-09-01"}, "monthEnd": {"2026-09-30"}, "todayDate": {"2026-09-01"}, "weekStart": {"2026-08-31"}, "weekEnd": {"2026-09-06"}})
	if e != nil {
		t.Fatal(e)
	}
	s := d["summary"].(timeEntrySummary)
	if d["total"] != int64(102) || s.TotalHours != 212.70 || s.MonthHours != 210.60 || s.MonthPositiveDays != 1 || s.PositiveDays != 2 || s.WeekHours != 212.70 || s.TodayHours != 210.60 || s.WeekStatusCounts["returned"] != 2 || len(s.ProjectHours) != 2 || len(s.BaseDailyProjectHours) != 3 {
		t.Fatal(d, s)
	}
	if e = m.ExpectationsWereMet(); e != nil {
		t.Fatal(e)
	}
}
func TestTimeEntryPageOtherUIDDeniedBeforeSQL(t *testing.T) {
	a, m, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	if _, e := a.userTimeEntries(context.Background(), "other", url.Values{"current_user": {"viewer"}, "page": {"1"}}); e == nil {
		t.Fatal("other uid accepted")
	}
	if e := m.ExpectationsWereMet(); e != nil {
		t.Fatal(e)
	}
}
