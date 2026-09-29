package aims

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestWeeklySummaryCompleteAggregatesAndCostUnits(t *testing.T) {
	id := int64(1)
	cost := 10000.0
	items := []projectWeeklyReportSummaryItem{}
	for j := 1; j <= 105; j++ {
		items = append(items, projectWeeklyReportSummaryItem{ProjectID: int64(j), ProjectName: "P", ReportID: &id, TotalHours: 8, PreviousTotalHours: 16, ActualHours: 4, MemberCount: 2, CumulativeLaborCost: &cost})
	}
	s, c := weeklySummaryAggregates(items)
	if s.Total != 105 || s.Filled != 105 || s.CurrentDays != 105 || s.ActualDays != 52.5 || s.PreviousDays != 210 || s.DeltaDays != -105 || s.MemberSlots != 210 || s.CumulativeLaborCost != 1050000 {
		t.Fatal(s)
	}
	if len(c["workload"]) != 11 || c["workload"][10].Value != 95 || len(c["cost"]) != 14 || c["cost"][0].Value != 10000 || c["change"][0].Value != -1 {
		t.Fatal(c)
	}
	if c["cost"][0].ProjectID != 1 || c["cost"][13].ProjectID != 14 {
		t.Fatal("unstable ties", c)
	}
}
func TestWeeklySummaryKeywordMatchesSnapshotAndIDsLiterally(t *testing.T) {
	where, args := weeklySummarySearch("新_%部门")
	if !strings.Contains(where, "department_name") || !strings.Contains(where, "project_manager_name") || !strings.Contains(where, "dept_code") || strings.Contains(where, "LIKE") || len(args) != 7 {
		t.Fatal(where, args)
	}
	if !reflect.DeepEqual(args, []any{"新_%部门", "新_%部门", "新_%部门", "新_%部门", "新_%部门", "新_%部门", "新_%部门"}) {
		t.Fatal(args)
	}
	for _, q := range []url.Values{{"page": {"0"}}, {"page": {"1", "2"}}, {"pageSize": {"101"}}, {"page": {"1.0"}}} {
		if _, _, e := timeEntryPagination(q); e == nil {
			t.Fatal(q)
		}
	}
}

func TestWeeklySummaryCountPageAndAggregatesShareSnapshot(t *testing.T) {
	a, m, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	m.ExpectBegin()
	m.ExpectQuery("SELECT id FROM fixture WHERE visible=1").WillReturnRows(sqlmock.NewRows([]string{"id"}))
	m.ExpectQuery(`SELECT COUNT\(\*\).*LOCATE.*department_name.*project_manager_name`).WithArgs("snap", "snap", "snap", "snap", "snap", "snap", "snap").WillReturnRows(sqlmock.NewRows([]string{"total"}).AddRow(0))
	m.ExpectQuery(`SELECT w.\*.*LOCATE.*ORDER BY department_name ASC, project_type_name ASC, name ASC, id ASC LIMIT \? OFFSET \?`).WithArgs("snap", "snap", "snap", "snap", "snap", "snap", "snap", 20, 20).WillReturnRows(sqlmock.NewRows([]string{"id"}))
	m.ExpectCommit()
	now := time.Now()
	d, e := a.projectWeeklyReportSummaryPage(context.Background(), url.Values{"search": {"snap"}}, timeEntryPage{page: 2, size: 20}, "SELECT id FROM fixture WHERE visible=1 ORDER BY id", nil, 2026, 1, now, now, 2025, 52)
	if e != nil || d["total"] != 0 {
		t.Fatal(d, e)
	}
	if e = m.ExpectationsWereMet(); e != nil {
		t.Fatal(e)
	}
}
