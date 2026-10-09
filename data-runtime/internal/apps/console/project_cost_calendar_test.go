package console

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"regexp"
	"testing"
)

func TestProjectCostCalendarOwningDecimalFacts(t *testing.T) {
	db, m, e := sqlmock.New()
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	a := &Adapter{db: db}
	q := regexp.QuoteMeta("SELECT CAST(standard_work_hours AS CHAR),CAST(standard_hours_per_day AS CHAR),workday_count,revision FROM work_calendar_months WHERE calendar_code='CN' AND " + yearMonthIdentifier + "=?")
	m.ExpectQuery(q).WithArgs("2026-10").WillReturnRows(sqlmock.NewRows([]string{"hours", "per_day", "days", "revision"}).AddRow("160.1250", "8.00625", 20, 7))
	v, e := a.ReadCNMonth(context.Background(), "2026-10")
	if e != nil || v.StandardHours != "160.1250" || v.HoursPerDay != "8.00625" || v.SourceVersion != "7" || v.SHA256 == "" {
		t.Fatal(v, e)
	}
	if _, e = a.ReadCNMonth(context.Background(), "2026-13"); e == nil {
		t.Fatal("invalid month")
	}
	if e = m.ExpectationsWereMet(); e != nil {
		t.Fatal(e)
	}
}
