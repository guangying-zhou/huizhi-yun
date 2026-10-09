package console

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const defaultCalendarCode = "CN"
const defaultRegionCode = "CN"
const defaultCalendarName = "中国大陆工作日历"
const defaultCalendarTimezone = "Asia/Shanghai"
const yearMonthIdentifier = "`year_month`"

var calendarCodePattern = regexp.MustCompile(`^[A-Z0-9][A-Z0-9_.-]{0,63}$`)
var yearMonthPattern = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)
var workCalendarDayTypes = map[string]bool{
	"workday": true, "weekend": true, "public_holiday": true,
	"transfer_workday": true, "custom_holiday": true, "custom_workday": true,
}

type workCalendar struct {
	ID                  uint64  `json:"id"`
	CalendarCode        string  `json:"calendarCode"`
	CalendarName        string  `json:"calendarName"`
	RegionCode          string  `json:"regionCode"`
	Timezone            string  `json:"timezone"`
	StandardHoursPerDay float64 `json:"standardHoursPerDay"`
	WeekendDays         []int   `json:"weekendDays"`
	Status              string  `json:"status"`
	Revision            uint64  `json:"revision"`
	UpdatedAt           string  `json:"updatedAt"`
}

type workCalendarDay struct {
	ID           uint64  `json:"id"`
	CalendarCode string  `json:"calendarCode"`
	WorkDate     string  `json:"workDate"`
	YearNo       int     `json:"yearNo"`
	YearMonth    string  `json:"yearMonth"`
	DayOfWeek    int     `json:"dayOfWeek"`
	DayType      string  `json:"dayType"`
	IsWorkday    bool    `json:"isWorkday"`
	HolidayName  *string `json:"holidayName"`
	Source       string  `json:"source"`
	SourceRef    *string `json:"sourceRef"`
	ImportBatch  *string `json:"importBatch"`
	Remark       *string `json:"remark"`
	Revision     uint64  `json:"revision"`
	UpdatedAt    string  `json:"updatedAt"`
}

type workCalendarMonth struct {
	ID                  uint64  `json:"id"`
	CalendarCode        string  `json:"calendarCode"`
	YearMonth           string  `json:"yearMonth"`
	YearNo              int     `json:"yearNo"`
	MonthNo             int     `json:"monthNo"`
	WorkdayCount        int     `json:"workdayCount"`
	NonWorkdayCount     int     `json:"nonWorkdayCount"`
	StandardHoursPerDay float64 `json:"standardHoursPerDay"`
	StandardWorkHours   float64 `json:"standardWorkHours"`
	Source              string  `json:"source"`
	Revision            uint64  `json:"revision"`
	CalculatedAt        string  `json:"calculatedAt"`
	UpdatedAt           string  `json:"updatedAt"`
}

type builtCalendarDay struct {
	WorkDate    string
	YearNo      int
	YearMonth   string
	DayOfWeek   int
	DayType     string
	IsWorkday   bool
	HolidayName *string
	Source      string
	SourceRef   *string
}

func (a *Adapter) WorkCalendars(ctx context.Context) (map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT id,calendar_code,calendar_name,region_code,timezone,
			standard_hours_per_day,weekend_days_json,status,revision,updated_at
		FROM work_calendars
		WHERE status='active'
		ORDER BY calendar_code
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]workCalendar, 0)
	for rows.Next() {
		item, err := scanWorkCalendar(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(items) == 0 {
		items = append(items, workCalendar{
			CalendarCode: defaultCalendarCode, CalendarName: defaultCalendarName,
			RegionCode: defaultRegionCode, Timezone: defaultCalendarTimezone,
			StandardHoursPerDay: 8, WeekendDays: []int{0, 6}, Status: "active",
		})
	}
	return map[string]any{"code": 0, "data": map[string]any{"items": items}}, nil
}

func (a *Adapter) WorkCalendarMonths(ctx context.Context, code string, query url.Values) (map[string]any, error) {
	code, err := validCalendarCode(code)
	if err != nil {
		return nil, err
	}
	year, err := validCalendarYear(query.Get("year"))
	if err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT id,calendar_code,`+yearMonthIdentifier+`,year_no,month_no,workday_count,
			non_workday_count,standard_hours_per_day,standard_work_hours,
			source,revision,calculated_at,updated_at
		FROM work_calendar_months
		WHERE calendar_code=? AND year_no=?
		ORDER BY `+yearMonthIdentifier+`
	`, code, year)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]workCalendarMonth, 0)
	for rows.Next() {
		item, err := scanWorkCalendarMonth(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return map[string]any{"code": 0, "data": map[string]any{"items": items}}, rows.Err()
}

func (a *Adapter) WorkCalendarMonth(ctx context.Context, query url.Values) (map[string]any, error) {
	code, err := validCalendarCode(query.Get("calendarCode"))
	if err != nil {
		return nil, err
	}
	yearMonth := strings.TrimSpace(firstValue(query.Get("yearMonth"), query.Get("year_month")))
	if !yearMonthPattern.MatchString(yearMonth) {
		return nil, httperror.New(http.StatusBadRequest, "year_month_invalid", "yearMonth must be YYYY-MM")
	}
	item, err := scanWorkCalendarMonth(a.db.QueryRowContext(ctx, `
		SELECT id,calendar_code,`+yearMonthIdentifier+`,year_no,month_no,workday_count,
			non_workday_count,standard_hours_per_day,standard_work_hours,
			source,revision,calculated_at,updated_at
		FROM work_calendar_months
		WHERE calendar_code=? AND `+yearMonthIdentifier+`=?
		LIMIT 1
	`, code, yearMonth))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "work_calendar_month_not_found", "Work calendar month not found")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "data": item}, nil
}

func (a *Adapter) WorkCalendarDays(ctx context.Context, code string, query url.Values) (map[string]any, error) {
	code, err := validCalendarCode(code)
	if err != nil {
		return nil, err
	}
	conditions := []string{"calendar_code=?"}
	args := []any{code}
	if yearMonth := strings.TrimSpace(firstValue(query.Get("yearMonth"), query.Get("year_month"))); yearMonth != "" {
		if !yearMonthPattern.MatchString(yearMonth) {
			return nil, httperror.New(http.StatusBadRequest, "year_month_invalid", "yearMonth must be YYYY-MM")
		}
		conditions = append(conditions, "`year_month`=?")
		args = append(args, yearMonth)
	} else {
		year, err := validCalendarYear(query.Get("year"))
		if err != nil {
			return nil, err
		}
		conditions = append(conditions, "year_no=?")
		args = append(args, year)
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT id,calendar_code,work_date,year_no,`+yearMonthIdentifier+`,day_of_week,day_type,
			is_workday,holiday_name,source,source_ref,import_batch,remark,revision,updated_at
		FROM work_calendar_days
		WHERE `+strings.Join(conditions, " AND ")+`
		ORDER BY work_date
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]workCalendarDay, 0)
	for rows.Next() {
		item, err := scanWorkCalendarDay(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return map[string]any{"code": 0, "data": map[string]any{"items": items}}, rows.Err()
}

func (a *Adapter) UpdateWorkCalendarDay(ctx context.Context, code string, workDate string, body map[string]any, meta MutationMeta) (map[string]any, error) {
	code, err := validCalendarCode(code)
	if err != nil {
		return nil, err
	}
	date, err := validWorkDate(workDate)
	if err != nil {
		return nil, err
	}
	revision, ok := positiveRevision(body["expectedRevision"])
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "expected_revision_required", "expectedRevision must be a positive integer")
	}
	isWorkday := boolField(body["isWorkday"], false)
	dayType := strings.TrimSpace(stringField(body["dayType"]))
	if dayType == "" {
		if isWorkday {
			dayType = "custom_workday"
		} else {
			dayType = "custom_holiday"
		}
	}
	if !workCalendarDayTypes[dayType] {
		return nil, httperror.New(http.StatusBadRequest, "work_calendar_day_type_invalid", "Invalid dayType")
	}
	isWorkday = dayType == "workday" || dayType == "transfer_workday" || dayType == "custom_workday"
	payload := map[string]any{
		"calendarCode": code, "workDate": date, "dayType": dayType, "isWorkday": isWorkday,
		"holidayName": nullableBodyString(body["holidayName"]), "remark": nullableBodyString(body["remark"]),
		"expectedRevision": revision,
	}
	session, replay, err := a.beginMutation(ctx, "console.work-calendar.day.update", meta.IdempotencyKey, meta.RequestID, meta.ActorID, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()
	result, err := session.tx.ExecContext(ctx, `
		UPDATE work_calendar_days
		SET day_type=?,is_workday=?,holiday_name=?,remark=?,source='manual',
			revision=revision+1,updated_at=UTC_TIMESTAMP()
		WHERE calendar_code=? AND work_date=? AND revision=?
	`, dayType, isWorkday, payload["holidayName"], payload["remark"], code, date, revision)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return nil, httperror.New(http.StatusConflict, "work_calendar_day_revision_conflict", "Work calendar day has changed; reload it before saving")
	}
	if err := recomputeCalendarMonthTx(ctx, session.tx, code, date[:7], "manual"); err != nil {
		return nil, err
	}
	item, err := scanWorkCalendarDay(session.tx.QueryRowContext(ctx, `
		SELECT id,calendar_code,work_date,year_no,`+yearMonthIdentifier+`,day_of_week,day_type,
			is_workday,holiday_name,source,source_ref,import_batch,remark,revision,updated_at
		FROM work_calendar_days WHERE calendar_code=? AND work_date=?
	`, code, date))
	if err != nil {
		return nil, err
	}
	response := map[string]any{"code": 0, "data": item}
	if err := a.finishMutation(ctx, session, "system_settings", "update_day", "work_calendar_day", code+":"+date, map[string]any{
		"previousRevision": revision, "revision": item.Revision,
	}, response); err != nil {
		return nil, err
	}
	return response, nil
}

func (a *Adapter) ImportWorkCalendarYear(ctx context.Context, body map[string]any, meta MutationMeta) (map[string]any, error) {
	code, err := validCalendarCode(stringField(body["calendarCode"]))
	if err != nil {
		return nil, err
	}
	regionCode := strings.ToUpper(strings.TrimSpace(stringField(body["regionCode"])))
	if regionCode == "" {
		regionCode = defaultRegionCode
	}
	if !regexp.MustCompile(`^[A-Z0-9][A-Z0-9_.-]{0,31}$`).MatchString(regionCode) {
		return nil, httperror.New(http.StatusBadRequest, "region_code_invalid", "Invalid regionCode")
	}
	year, err := validCalendarYear(fmt.Sprint(body["year"]))
	if err != nil {
		return nil, err
	}
	expectedRevision, ok := nonNegativeRevision(body["expectedRevision"])
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "expected_revision_required", "expectedRevision must be a non-negative integer")
	}
	mode := strings.TrimSpace(stringField(body["mode"]))
	if mode == "" {
		mode = "auto"
	}
	standardHours := floatField(body["standardHoursPerDay"], 8)
	calendarName := strings.TrimSpace(stringField(body["calendarName"]))
	if calendarName == "" {
		calendarName = defaultCalendarName
	}
	sourceURL := strings.TrimSpace(stringField(body["sourceUrl"]))
	dataset := body["dataset"]
	source := "manual-import"
	if mode != "manual" {
		source = "holiday-calendar"
		dataset, sourceURL, err = fetchHolidayDataset(ctx, regionCode, year, sourceURL)
		if err != nil {
			return nil, err
		}
	}
	holidayDates, err := holidayDateItems(dataset, year)
	if err != nil {
		return nil, err
	}
	payload := map[string]any{
		"calendarCode": code, "regionCode": regionCode, "year": year, "mode": mode,
		"standardHoursPerDay": standardHours, "expectedRevision": expectedRevision,
		"dataset": holidayDates,
	}
	session, replay, err := a.beginMutation(ctx, "console.work-calendar.year.import", meta.IdempotencyKey, meta.RequestID, meta.ActorID, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()

	calendar, exists, err := lockCalendarTx(ctx, session.tx, code)
	if err != nil {
		return nil, err
	}
	if exists && calendar.Revision != expectedRevision {
		return nil, httperror.New(http.StatusConflict, "work_calendar_revision_conflict", "Work calendar has changed; reload it before importing")
	}
	if !exists && expectedRevision != 0 {
		return nil, httperror.New(http.StatusConflict, "work_calendar_revision_conflict", "Work calendar has changed; reload it before importing")
	}
	weekendDays := []int{0, 6}
	if exists {
		weekendDays = calendar.WeekendDays
		_, err = session.tx.ExecContext(ctx, `
			UPDATE work_calendars
			SET calendar_name=?,region_code=?,standard_hours_per_day=?,
				revision=revision+1,updated_at=UTC_TIMESTAMP()
			WHERE calendar_code=? AND revision=?
		`, calendarName, regionCode, standardHours, code, expectedRevision)
	} else {
		_, err = session.tx.ExecContext(ctx, `
			INSERT INTO work_calendars (
				calendar_code,calendar_name,region_code,timezone,standard_hours_per_day,
				weekend_days_json,status,revision,created_at,updated_at
			) VALUES (?,?,?,?,?,'[0,6]','active',1,UTC_TIMESTAMP(),UTC_TIMESTAMP())
		`, code, calendarName, regionCode, defaultCalendarTimezone, standardHours)
	}
	if err != nil {
		return nil, err
	}
	nextRevision := expectedRevision + 1
	days := buildCalendarYear(year, weekendDays)
	mergeHolidayDataset(days, holidayDates, source, sourceURL)
	importBatch := fmt.Sprintf("wc_%s_%d_%d", code, year, time.Now().UTC().UnixMilli())
	for _, day := range days {
		if _, err := session.tx.ExecContext(ctx, `
			INSERT INTO work_calendar_days (
				calendar_code,work_date,year_no,`+yearMonthIdentifier+`,day_of_week,day_type,is_workday,
				holiday_name,source,source_ref,import_batch,revision,created_at,updated_at
			) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,UTC_TIMESTAMP(),UTC_TIMESTAMP())
			ON DUPLICATE KEY UPDATE
				year_no=VALUES(year_no),`+yearMonthIdentifier+`=VALUES(`+yearMonthIdentifier+`),day_of_week=VALUES(day_of_week),
				day_type=IF(source='manual',day_type,VALUES(day_type)),
				is_workday=IF(source='manual',is_workday,VALUES(is_workday)),
				holiday_name=IF(source='manual',holiday_name,VALUES(holiday_name)),
				source=IF(source='manual',source,VALUES(source)),
				source_ref=IF(source='manual',source_ref,VALUES(source_ref)),
				import_batch=IF(source='manual',import_batch,VALUES(import_batch)),
				revision=IF(source='manual',revision,revision+1),
				updated_at=UTC_TIMESTAMP()
		`, code, day.WorkDate, day.YearNo, day.YearMonth, day.DayOfWeek, day.DayType, day.IsWorkday,
			day.HolidayName, day.Source, day.SourceRef, importBatch); err != nil {
			return nil, err
		}
	}
	if err := recomputeCalendarYearTx(ctx, session.tx, code, year, source); err != nil {
		return nil, err
	}
	if _, err := session.tx.ExecContext(ctx, `
		INSERT INTO work_calendar_import_jobs (
			job_code,calendar_code,region_code,year_no,import_mode,source,source_url,
			imported_days,status,message,requested_by,created_at,completed_at
		) VALUES (?,?,?,?,?,?,?,?, 'success',?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())
	`, importBatch, code, regionCode, year, mode, source, nullableText(sourceURL), len(holidayDates),
		fmt.Sprintf("processed %d calendar days", len(days)), meta.ActorID); err != nil {
		return nil, err
	}
	response := map[string]any{"code": 0, "data": map[string]any{
		"calendarCode": code, "year": year, "importedDays": len(days), "holidayEntries": len(holidayDates),
		"importBatch": importBatch, "revision": nextRevision,
	}}
	if err := a.finishMutation(ctx, session, "system_settings", "import_year", "work_calendar", code, map[string]any{
		"year": year, "mode": mode, "importedDays": len(days),
		"previousRevision": expectedRevision, "revision": nextRevision,
	}, response); err != nil {
		return nil, err
	}
	return response, nil
}

func scanWorkCalendar(scanner rowScanner) (workCalendar, error) {
	var item workCalendar
	var weekendJSON []byte
	var updatedAt time.Time
	if err := scanner.Scan(&item.ID, &item.CalendarCode, &item.CalendarName, &item.RegionCode, &item.Timezone,
		&item.StandardHoursPerDay, &weekendJSON, &item.Status, &item.Revision, &updatedAt); err != nil {
		return workCalendar{}, err
	}
	item.WeekendDays = []int{0, 6}
	_ = json.Unmarshal(weekendJSON, &item.WeekendDays)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339Nano)
	return item, nil
}

func scanWorkCalendarDay(scanner rowScanner) (workCalendarDay, error) {
	var item workCalendarDay
	var workDate time.Time
	var holiday, sourceRef, importBatch, remark sql.NullString
	var updatedAt time.Time
	if err := scanner.Scan(
		&item.ID, &item.CalendarCode, &workDate, &item.YearNo, &item.YearMonth, &item.DayOfWeek,
		&item.DayType, &item.IsWorkday, &holiday, &item.Source, &sourceRef, &importBatch, &remark,
		&item.Revision, &updatedAt,
	); err != nil {
		return workCalendarDay{}, err
	}
	item.WorkDate = workDate.UTC().Format("2006-01-02")
	item.HolidayName = nullableString(holiday)
	item.SourceRef = nullableString(sourceRef)
	item.ImportBatch = nullableString(importBatch)
	item.Remark = nullableString(remark)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339Nano)
	return item, nil
}

func scanWorkCalendarMonth(scanner rowScanner) (workCalendarMonth, error) {
	var item workCalendarMonth
	var calculatedAt, updatedAt time.Time
	if err := scanner.Scan(
		&item.ID, &item.CalendarCode, &item.YearMonth, &item.YearNo, &item.MonthNo,
		&item.WorkdayCount, &item.NonWorkdayCount, &item.StandardHoursPerDay,
		&item.StandardWorkHours, &item.Source, &item.Revision, &calculatedAt, &updatedAt,
	); err != nil {
		return workCalendarMonth{}, err
	}
	item.CalculatedAt = calculatedAt.UTC().Format(time.RFC3339Nano)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339Nano)
	return item, nil
}

func validCalendarCode(value string) (string, error) {
	value = strings.ToUpper(strings.TrimSpace(value))
	if value == "" {
		value = defaultCalendarCode
	}
	if !calendarCodePattern.MatchString(value) {
		return "", httperror.New(http.StatusBadRequest, "calendar_code_invalid", "Invalid calendarCode")
	}
	return value, nil
}

func validCalendarYear(value string) (int, error) {
	if strings.TrimSpace(value) == "" {
		value = strconv.Itoa(time.Now().UTC().Year())
	}
	year, err := strconv.Atoi(value)
	if err != nil || year < 2000 || year > 2100 {
		return 0, httperror.New(http.StatusBadRequest, "calendar_year_invalid", "year must be between 2000 and 2100")
	}
	return year, nil
}

func validWorkDate(value string) (string, error) {
	value = strings.TrimSpace(value)
	date, err := time.Parse("2006-01-02", value)
	if err != nil || date.Format("2006-01-02") != value {
		return "", httperror.New(http.StatusBadRequest, "work_date_invalid", "workDate must be YYYY-MM-DD")
	}
	return value, nil
}

func boolField(value any, fallback bool) bool {
	switch candidate := value.(type) {
	case bool:
		return candidate
	case float64:
		return candidate != 0
	case string:
		parsed, err := strconv.ParseBool(candidate)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func floatField(value any, fallback float64) float64 {
	switch candidate := value.(type) {
	case float64:
		if candidate > 0 {
			return candidate
		}
	case string:
		parsed, err := strconv.ParseFloat(candidate, 64)
		if err == nil && parsed > 0 {
			return parsed
		}
	}
	return fallback
}

func recomputeCalendarMonthTx(ctx context.Context, tx *sql.Tx, code string, yearMonth string, source string) error {
	var year, month, workdays, nonWorkdays int
	var hours float64
	if err := tx.QueryRowContext(ctx, `
		SELECT MIN(year_no),CAST(SUBSTRING(d.`+yearMonthIdentifier+`,6,2) AS UNSIGNED),
			SUM(CASE WHEN is_workday=1 THEN 1 ELSE 0 END),
			SUM(CASE WHEN is_workday=0 THEN 1 ELSE 0 END),
			c.standard_hours_per_day
		FROM work_calendar_days d
		INNER JOIN work_calendars c ON c.calendar_code=d.calendar_code
		WHERE d.calendar_code=? AND d.`+yearMonthIdentifier+`=?
		GROUP BY d.`+yearMonthIdentifier+`,c.standard_hours_per_day
	`, code, yearMonth).Scan(&year, &month, &workdays, &nonWorkdays, &hours); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO work_calendar_months (
			calendar_code,`+yearMonthIdentifier+`,year_no,month_no,workday_count,non_workday_count,
			standard_hours_per_day,standard_work_hours,source,revision,calculated_at,updated_at
		) VALUES (?,?,?,?,?,?,?,?,?,1,UTC_TIMESTAMP(),UTC_TIMESTAMP())
		ON DUPLICATE KEY UPDATE
			workday_count=VALUES(workday_count),non_workday_count=VALUES(non_workday_count),
			standard_hours_per_day=VALUES(standard_hours_per_day),
			standard_work_hours=VALUES(standard_work_hours),source=VALUES(source),
			revision=revision+1,calculated_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
	`, code, yearMonth, year, month, workdays, nonWorkdays, hours, float64(workdays)*hours, source)
	return err
}

func recomputeCalendarYearTx(ctx context.Context, tx *sql.Tx, code string, year int, source string) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT `+yearMonthIdentifier+` FROM work_calendar_days
		WHERE calendar_code=? AND year_no=?
		GROUP BY `+yearMonthIdentifier+` ORDER BY `+yearMonthIdentifier+`
	`, code, year)
	if err != nil {
		return err
	}
	months := make([]string, 0, 12)
	for rows.Next() {
		var month string
		if err := rows.Scan(&month); err != nil {
			rows.Close()
			return err
		}
		months = append(months, month)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, month := range months {
		if err := recomputeCalendarMonthTx(ctx, tx, code, month, source); err != nil {
			return err
		}
	}
	return nil
}

func lockCalendarTx(ctx context.Context, tx *sql.Tx, code string) (workCalendar, bool, error) {
	item, err := scanWorkCalendar(tx.QueryRowContext(ctx, `
		SELECT id,calendar_code,calendar_name,region_code,timezone,
			standard_hours_per_day,weekend_days_json,status,revision,updated_at
		FROM work_calendars WHERE calendar_code=? FOR UPDATE
	`, code))
	if errors.Is(err, sql.ErrNoRows) {
		return workCalendar{}, false, nil
	}
	return item, err == nil, err
}

func buildCalendarYear(year int, weekends []int) []builtCalendarDay {
	weekendSet := map[int]bool{}
	for _, day := range weekends {
		weekendSet[day] = true
	}
	start := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	days := make([]builtCalendarDay, 0, 366)
	for date := start; date.Year() == year; date = date.AddDate(0, 0, 1) {
		isWeekend := weekendSet[int(date.Weekday())]
		dayType := "workday"
		if isWeekend {
			dayType = "weekend"
		}
		workDate := date.Format("2006-01-02")
		days = append(days, builtCalendarDay{
			WorkDate: workDate, YearNo: year, YearMonth: workDate[:7], DayOfWeek: int(date.Weekday()),
			DayType: dayType, IsWorkday: !isWeekend, Source: "generated",
		})
	}
	return days
}

func holidayDateItems(dataset any, year int) ([]map[string]any, error) {
	if text, ok := dataset.(string); ok {
		if json.Unmarshal([]byte(text), &dataset) != nil {
			return nil, httperror.New(http.StatusBadRequest, "holiday_dataset_invalid", "Holiday dataset is invalid JSON")
		}
	}
	if record, ok := dataset.(map[string]any); ok {
		dataset = record["dates"]
	}
	raw, ok := dataset.([]any)
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "holiday_dataset_invalid", "Holiday dataset must contain a dates array")
	}
	items := make([]map[string]any, 0, len(raw))
	for _, value := range raw {
		record, ok := value.(map[string]any)
		if !ok {
			continue
		}
		date := strings.TrimSpace(stringField(record["date"]))
		if strings.HasPrefix(date, strconv.Itoa(year)+"-") {
			items = append(items, record)
		}
	}
	return items, nil
}

func mergeHolidayDataset(days []builtCalendarDay, holidays []map[string]any, source string, sourceURL string) {
	byDate := make(map[string]*builtCalendarDay, len(days))
	for index := range days {
		byDate[days[index].WorkDate] = &days[index]
	}
	for _, holiday := range holidays {
		day := byDate[strings.TrimSpace(stringField(holiday["date"]))]
		if day == nil {
			continue
		}
		switch stringField(holiday["type"]) {
		case "public_holiday":
			day.DayType, day.IsWorkday = "public_holiday", false
		case "transfer_workday":
			day.DayType, day.IsWorkday = "transfer_workday", true
		default:
			continue
		}
		name := strings.TrimSpace(firstValue(stringField(holiday["name_cn"]), stringField(holiday["name"]), stringField(holiday["name_en"])))
		if name != "" {
			day.HolidayName = &name
		}
		day.Source = source
		if sourceURL != "" {
			value := sourceURL
			day.SourceRef = &value
		}
	}
}

func fetchHolidayDataset(ctx context.Context, region string, year int, configuredURL string) (any, string, error) {
	urls := []string{
		strings.TrimSpace(configuredURL),
		fmt.Sprintf("https://unpkg.com/holiday-calendar/data/%s/%d.json", url.PathEscape(region), year),
		fmt.Sprintf("https://cdn.jsdelivr.net/gh/cg-zhou/holiday-calendar@main/data/%s/%d.json", url.PathEscape(region), year),
	}
	client := &http.Client{Timeout: 10 * time.Second}
	var lastStatus string
	for _, candidate := range urls {
		if candidate == "" {
			continue
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, candidate, nil)
		if err != nil {
			continue
		}
		response, err := client.Do(request)
		if err != nil {
			lastStatus = "network error"
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(response.Body, 5<<20))
		response.Body.Close()
		if readErr != nil || response.StatusCode < 200 || response.StatusCode >= 300 {
			lastStatus = strconv.Itoa(response.StatusCode)
			continue
		}
		var dataset any
		if json.Unmarshal(body, &dataset) != nil {
			lastStatus = "invalid JSON"
			continue
		}
		return dataset, candidate, nil
	}
	return nil, "", httperror.New(http.StatusBadGateway, "holiday_calendar_unavailable", "Holiday calendar provider is unavailable: "+lastStatus)
}
