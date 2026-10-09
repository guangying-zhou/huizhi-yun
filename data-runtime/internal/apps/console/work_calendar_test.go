package console

import (
	"context"
	"net/url"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/config"
)

func TestWorkCalendarMonthsQuotesYearMonthIdentifier(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	query := `
		SELECT id,calendar_code,` + "`year_month`" + `,year_no,month_no,workday_count,
			non_workday_count,standard_hours_per_day,standard_work_hours,
			source,revision,calculated_at,updated_at
		FROM work_calendar_months
		WHERE calendar_code=? AND year_no=?
		ORDER BY ` + "`year_month`"
	mock.ExpectQuery(regexp.QuoteMeta(query)).
		WithArgs("CN", 2026).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "calendar_code", "year_month", "year_no", "month_no",
			"workday_count", "non_workday_count", "standard_hours_per_day",
			"standard_work_hours", "source", "revision", "calculated_at", "updated_at",
		}).AddRow(
			1, "CN", "2026-01", 2026, 1, 21, 10, 8, 168,
			"holiday-calendar", 1,
			time.Date(2026, 6, 17, 16, 32, 54, 0, time.UTC),
			time.Date(2026, 6, 17, 16, 32, 54, 0, time.UTC),
		))

	adapter := NewWithDB(config.ConsoleConfig{}, "C000001", database)
	result, err := adapter.WorkCalendarMonths(
		context.Background(),
		"CN",
		url.Values{"year": []string{"2026"}},
	)
	if err != nil {
		t.Fatal(err)
	}
	items := result["data"].(map[string]any)["items"].([]workCalendarMonth)
	if len(items) != 1 || items[0].YearMonth != "2026-01" {
		t.Fatalf("unexpected work calendar months: %#v", items)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestWorkCalendarDaysQuotesYearMonthIdentifier(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	query := `
		SELECT id,calendar_code,work_date,year_no,` + yearMonthIdentifier + `,day_of_week,day_type,
			is_workday,holiday_name,source,source_ref,import_batch,remark,revision,updated_at
		FROM work_calendar_days
		WHERE calendar_code=? AND ` + yearMonthIdentifier + `=?
		ORDER BY work_date
	`
	mock.ExpectQuery(regexp.QuoteMeta(query)).
		WithArgs("CN", "2026-01").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "calendar_code", "work_date", "year_no", "year_month", "day_of_week",
			"day_type", "is_workday", "holiday_name", "source", "source_ref",
			"import_batch", "remark", "revision", "updated_at",
		}).AddRow(
			1, "CN", time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), 2026, "2026-01", 4,
			"public_holiday", false, "元旦", "holiday-calendar", nil,
			"wc_CN_2026", nil, 1,
			time.Date(2026, 6, 17, 16, 32, 54, 0, time.UTC),
		))

	adapter := NewWithDB(config.ConsoleConfig{}, "C000001", database)
	result, err := adapter.WorkCalendarDays(
		context.Background(),
		"CN",
		url.Values{"yearMonth": []string{"2026-01"}},
	)
	if err != nil {
		t.Fatal(err)
	}
	items := result["data"].(map[string]any)["items"].([]workCalendarDay)
	if len(items) != 1 || items[0].YearMonth != "2026-01" {
		t.Fatalf("unexpected work calendar days: %#v", items)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
