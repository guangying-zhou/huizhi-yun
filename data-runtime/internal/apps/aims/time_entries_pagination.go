package aims

import (
	"context"
	"database/sql"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type timeEntryPage struct {
	includeUIDHours                                 bool
	page, size                                      int
	calendarProjectID                               string
	monthStart, monthEnd, today, weekStart, weekEnd string
}

func timeEntryPagination(q url.Values) (timeEntryPage, bool, error) {
	p := timeEntryPage{page: 1, size: 20}
	_, hasPage := q["page"]
	_, hasSize := q["pageSize"]
	paged := hasPage || hasSize
	bad := httperror.New(400, "time_entry_pagination_invalid", "Invalid time entry pagination")
	keys := []string{"page", "pageSize", "projectId", "calendarProjectId", "monthStart", "monthEnd", "todayDate", "weekStart", "weekEnd", "startDate", "endDate", "uid"}
	for _, key := range keys {
		if values, ok := q[key]; ok {
			if len(values) != 1 || values[0] == "" || len(values[0]) > 200 || strings.ContainsAny(values[0], "\x00\r\n") {
				return p, paged, bad
			}
		}
	}
	for key, max := range map[string]int{"page": 1000000, "pageSize": 100} {
		if _, ok := q[key]; ok {
			n, e := strconv.Atoi(q.Get(key))
			if e != nil || n < 1 || n > max || strconv.Itoa(n) != q.Get(key) {
				return p, paged, bad
			}
			if key == "page" {
				p.page = n
			} else {
				p.size = n
			}
		}
	}
	for _, key := range []string{"projectId", "calendarProjectId"} {
		if _, ok := q[key]; ok {
			n, e := strconv.ParseInt(q.Get(key), 10, 64)
			if e != nil || n < 1 || strconv.FormatInt(n, 10) != q.Get(key) {
				return p, paged, bad
			}
		}
	}
	if values, ok := q["includeUidHours"]; ok {
		if len(values) != 1 || values[0] != "1" || !paged {
			return p, paged, bad
		}
		p.includeUIDHours = true
	}
	p.calendarProjectID = q.Get("calendarProjectId")
	p.monthStart = q.Get("monthStart")
	p.monthEnd = q.Get("monthEnd")
	p.today = q.Get("todayDate")
	p.weekStart = q.Get("weekStart")
	p.weekEnd = q.Get("weekEnd")
	for _, key := range []string{"monthStart", "monthEnd", "todayDate", "weekStart", "weekEnd", "startDate", "endDate"} {
		if _, ok := q[key]; ok {
			d, e := time.Parse("2006-01-02", q.Get(key))
			if e != nil || d.Format("2006-01-02") != q.Get(key) {
				return p, paged, bad
			}
		}
	}
	if q.Get("startDate") != "" && q.Get("endDate") != "" && q.Get("startDate") > q.Get("endDate") {
		return p, paged, bad
	}
	if (p.monthStart == "") != (p.monthEnd == "") {
		return p, paged, bad
	}
	if p.monthStart != "" {
		start, _ := time.Parse("2006-01-02", p.monthStart)
		if start.Day() != 1 || start.AddDate(0, 1, -1).Format("2006-01-02") != p.monthEnd {
			return p, paged, bad
		}
	}
	if (p.weekStart == "") != (p.weekEnd == "") {
		return p, paged, bad
	}
	if p.weekStart != "" {
		start, _ := time.Parse("2006-01-02", p.weekStart)
		if start.Weekday() != time.Monday || start.AddDate(0, 0, 6).Format("2006-01-02") != p.weekEnd {
			return p, paged, bad
		}
	}
	if !paged && (p.calendarProjectID != "" || p.monthStart != "" || p.today != "" || p.weekStart != "") {
		return p, false, bad
	}
	for _, key := range []string{"cursor", "limit", "page_size"} {
		if paged {
			if _, ok := q[key]; ok {
				return p, true, bad
			}
		}
	}
	return p, paged, nil
}

type timeEntryHourBucket struct {
	Hours      float64 `json:"hours"`
	EntryCount int64   `json:"entryCount"`
}
type timeEntryDailyHours struct {
	Date string `json:"date"`
	timeEntryHourBucket
}
type timeEntryWeeklyHours struct {
	WeekStart string `json:"weekStart"`
	WeekEnd   string `json:"weekEnd"`
	timeEntryHourBucket
}
type timeEntryProjectHours struct {
	ProjectID         int64   `json:"projectId"`
	Hours             float64 `json:"hours"`
	DistinctEntryDays int     `json:"distinctEntryDays"`
}
type timeEntryDailyProjectHours struct {
	Date        string `json:"date"`
	ProjectID   int64  `json:"projectId"`
	ProjectCode string `json:"projectCode"`
	ProjectName string `json:"projectName"`
	timeEntryHourBucket
}
type timeEntryUIDHours struct {
	UID   string  `json:"uid"`
	Hours float64 `json:"hours"`
}
type timeEntrySummary struct {
	UIDHours              []timeEntryUIDHours          `json:"uidHours,omitempty"`
	TotalHours            float64                      `json:"totalHours"`
	MonthHours            float64                      `json:"monthHours"`
	TodayHours            float64                      `json:"todayHours"`
	WeekHours             float64                      `json:"weekHours"`
	PositiveDays          int                          `json:"positiveDays"`
	MonthPositiveDays     int                          `json:"monthPositiveDays"`
	MonthMissingDays      int                          `json:"monthMissingDays"`
	DailyHours            []timeEntryDailyHours        `json:"dailyHours"`
	DailyProjectHours     []timeEntryDailyProjectHours `json:"dailyProjectHours"`
	ProjectHours          []timeEntryProjectHours      `json:"projectHours"`
	BaseDailyProjectHours []timeEntryDailyProjectHours `json:"baseDailyProjectHours"`
	WeeklyHours           []timeEntryWeeklyHours       `json:"weeklyHours"`
	WeekStatusCounts      map[string]int64             `json:"weekStatusCounts"`
}

// SQL supplies complete grouped facts, never paged records. Accumulate cents
// rather than binary floating point to keep DECIMAL(6,2) hours exact.
func timeEntrySummaryForPage(ctx context.Context, tx *sql.Tx, fromWhere string, args []any, p timeEntryPage) (timeEntrySummary, error) {
	result := timeEntrySummary{DailyHours: []timeEntryDailyHours{}, DailyProjectHours: []timeEntryDailyProjectHours{}, BaseDailyProjectHours: []timeEntryDailyProjectHours{}, WeeklyHours: []timeEntryWeeklyHours{}, ProjectHours: []timeEntryProjectHours{}, WeekStatusCounts: map[string]int64{"draft": 0, "returned": 0, "submitted": 0, "approved": 0}}
	rows, err := tx.QueryContext(ctx, `SELECT DATE_FORMAT(t.entry_date,'%Y-%m-%d'),t.project_id,p.project_code,COALESCE(NULLIF(p.short_name,''),p.name),t.review_status,CAST(SUM(t.hours) AS CHAR),COUNT(*)`+fromWhere+` GROUP BY t.entry_date,t.project_id,p.project_code,p.short_name,p.name,t.review_status ORDER BY t.entry_date,t.project_id,t.review_status`, args...)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	type daily struct{ cents, count int64 }
	type project struct {
		cents int64
		days  map[string]bool
	}
	type dailyProject struct {
		date, code, name string
		id, cents, count int64
	}
	days := map[string]*daily{}
	projects := map[int64]*project{}
	dailyProjects := map[string]*dailyProject{}
	baseDailyProjects := map[string]*dailyProject{}
	weeks := map[string]*daily{}
	var total, month, today, week int64
	for rows.Next() {
		var date, code, name, status, hours string
		var id, count int64
		if err = rows.Scan(&date, &id, &code, &name, &status, &hours, &count); err != nil {
			return result, err
		}
		parts := strings.Split(hours, ".")
		if len(parts) > 2 {
			return result, httperror.New(503, "time_entry_hours_invalid", "Hours unavailable")
		}
		fraction := "00"
		if len(parts) == 2 {
			fraction = parts[1]
			if len(fraction) > 2 {
				return result, httperror.New(503, "time_entry_hours_invalid", "Hours unavailable")
			}
			for len(fraction) < 2 {
				fraction += "0"
			}
		}
		cents, e := strconv.ParseInt(parts[0]+fraction, 10, 64)
		if e != nil {
			return result, httperror.New(503, "time_entry_hours_invalid", "Hours unavailable")
		}
		if projects[id] == nil {
			projects[id] = &project{days: map[string]bool{}}
		}
		projects[id].cents += cents
		projects[id].days[date] = true
		if p.weekStart != "" && date >= p.weekStart && date <= p.weekEnd {
			result.WeekStatusCounts[status] += count
		}
		key := date + ":" + strconv.FormatInt(id, 10)
		if baseDailyProjects[key] == nil {
			baseDailyProjects[key] = &dailyProject{date: date, id: id, code: code, name: name}
		}
		baseDailyProjects[key].cents += cents
		baseDailyProjects[key].count += count
		if p.calendarProjectID != "" && strconv.FormatInt(id, 10) != p.calendarProjectID {
			continue
		}
		parsed, _ := time.Parse("2006-01-02", date)
		weekday := int(parsed.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		weekKey := parsed.AddDate(0, 0, 1-weekday).Format("2006-01-02")
		if weeks[weekKey] == nil {
			weeks[weekKey] = &daily{}
		}
		weeks[weekKey].cents += cents
		weeks[weekKey].count += count
		total += cents
		if p.monthStart != "" && date >= p.monthStart && date <= p.monthEnd {
			month += cents
		}
		if date == p.today {
			today += cents
		}
		if p.weekStart != "" && date >= p.weekStart && date <= p.weekEnd {
			week += cents
		}
		if days[date] == nil {
			days[date] = &daily{}
		}
		days[date].cents += cents
		days[date].count += count
		if dailyProjects[key] == nil {
			dailyProjects[key] = &dailyProject{date: date, id: id, code: code, name: name}
		}
		dailyProjects[key].cents += cents
		dailyProjects[key].count += count
	}
	if err = rows.Err(); err != nil {
		return result, err
	}
	if err = rows.Close(); err != nil {
		return result, err
	}
	result.TotalHours = float64(total) / 100
	result.MonthHours = float64(month) / 100
	result.TodayHours = float64(today) / 100
	result.WeekHours = float64(week) / 100
	for date, d := range days {
		result.DailyHours = append(result.DailyHours, timeEntryDailyHours{Date: date, timeEntryHourBucket: timeEntryHourBucket{Hours: float64(d.cents) / 100, EntryCount: d.count}})
		if d.cents > 0 {
			result.PositiveDays++
			if p.monthStart != "" && date >= p.monthStart && date <= p.monthEnd {
				result.MonthPositiveDays++
			}
		}
	}
	if p.monthStart != "" && p.today != "" {
		start, _ := time.Parse("2006-01-02", p.monthStart)
		for date := start; date.Format("2006-01-02") <= p.monthEnd && date.Format("2006-01-02") <= p.today; date = date.AddDate(0, 0, 1) {
			d := days[date.Format("2006-01-02")]
			if d == nil || d.cents <= 0 {
				result.MonthMissingDays++
			}
		}
	}
	for id, d := range projects {
		result.ProjectHours = append(result.ProjectHours, timeEntryProjectHours{ProjectID: id, Hours: float64(d.cents) / 100, DistinctEntryDays: len(d.days)})
	}
	for _, d := range dailyProjects {
		result.DailyProjectHours = append(result.DailyProjectHours, timeEntryDailyProjectHours{Date: d.date, ProjectID: d.id, ProjectCode: d.code, ProjectName: d.name, timeEntryHourBucket: timeEntryHourBucket{Hours: float64(d.cents) / 100, EntryCount: d.count}})
	}
	for _, d := range baseDailyProjects {
		result.BaseDailyProjectHours = append(result.BaseDailyProjectHours, timeEntryDailyProjectHours{Date: d.date, ProjectID: d.id, ProjectCode: d.code, ProjectName: d.name, timeEntryHourBucket: timeEntryHourBucket{Hours: float64(d.cents) / 100, EntryCount: d.count}})
	}
	for start, d := range weeks {
		date, _ := time.Parse("2006-01-02", start)
		result.WeeklyHours = append(result.WeeklyHours, timeEntryWeeklyHours{WeekStart: start, WeekEnd: date.AddDate(0, 0, 6).Format("2006-01-02"), timeEntryHourBucket: timeEntryHourBucket{Hours: float64(d.cents) / 100, EntryCount: d.count}})
	}
	sort.Slice(result.WeeklyHours, func(i, j int) bool { return result.WeeklyHours[i].WeekStart < result.WeeklyHours[j].WeekStart })
	sort.Slice(result.BaseDailyProjectHours, func(i, j int) bool {
		a, b := result.BaseDailyProjectHours[i], result.BaseDailyProjectHours[j]
		if a.Date != b.Date {
			return a.Date < b.Date
		}
		return a.ProjectID < b.ProjectID
	})
	sort.Slice(result.DailyHours, func(i, j int) bool { return result.DailyHours[i].Date < result.DailyHours[j].Date })
	sort.Slice(result.ProjectHours, func(i, j int) bool { return result.ProjectHours[i].ProjectID < result.ProjectHours[j].ProjectID })
	sort.Slice(result.DailyProjectHours, func(i, j int) bool {
		a, b := result.DailyProjectHours[i], result.DailyProjectHours[j]
		if a.Date != b.Date {
			return a.Date < b.Date
		}
		if a.Hours != b.Hours {
			return a.Hours > b.Hours
		}
		return a.ProjectID < b.ProjectID
	})
	return result, nil
}

func (a *Adapter) listTimeEntriesPage(ctx context.Context, where []string, args []any, p timeEntryPage) (map[string]any, error) {
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	calendarTimezone := "Asia/Shanghai"
	var configuredTimezone sql.NullString
	if err := tx.QueryRowContext(ctx, "SELECT timezone FROM weekly_reporting_settings WHERE config_key='default' LIMIT 1").Scan(&configuredTimezone); err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if configuredTimezone.Valid && configuredTimezone.String != "" {
		calendarTimezone = configuredTimezone.String
	}
	location, err := time.LoadLocation(calendarTimezone)
	if err != nil {
		return nil, httperror.New(503, "weekly_reporting_timezone_invalid", "Weekly reporting timezone unavailable")
	}
	calendarToday := time.Now().In(location).Format("2006-01-02")
	from := ` FROM time_entries t JOIN aims_projects p ON p.id=t.project_id LEFT JOIN work_items w ON w.id=t.work_item_id WHERE `
	summary, err := timeEntrySummaryForPage(ctx, tx, from+strings.Join(where, " AND "), args, p)
	if err != nil {
		return nil, err
	}
	where = append([]string(nil), where...)
	args = append([]any(nil), args...)
	if p.calendarProjectID != "" {
		where = append(where, "t.project_id=?")
		args = append(args, p.calendarProjectID)
	}
	if p.includeUIDHours {
		grouped, e := tx.QueryContext(ctx, "SELECT t.uid,CAST(SUM(t.hours) AS CHAR)"+from+strings.Join(where, " AND ")+" GROUP BY BINARY t.uid,t.uid ORDER BY BINARY t.uid", args...)
		if e != nil {
			return nil, e
		}
		summary.UIDHours = []timeEntryUIDHours{}
		for grouped.Next() {
			var uid, h string
			if e = grouped.Scan(&uid, &h); e != nil {
				grouped.Close()
				return nil, e
			}
			summary.UIDHours = append(summary.UIDHours, timeEntryUIDHours{UID: uid, Hours: parseFloatOrZero(h)})
		}
		e = grouped.Err()
		grouped.Close()
		if e != nil {
			return nil, e
		}
	}
	var total int64
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*)"+from+strings.Join(where, " AND "), args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, timeEntryListSelect()+from+strings.Join(where, " AND ")+" ORDER BY t.entry_date ASC,t.created_at ASC,t.id ASC LIMIT ? OFFSET ?", append(args, p.size, (p.page-1)*p.size)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanTimeEntries(rows)
	if err != nil {
		return nil, err
	}
	if err = rows.Close(); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": total, "page": p.page, "pageSize": p.size, "summary": summary, "calendarTimezone": calendarTimezone, "calendarToday": calendarToday}, nil
}

func timeEntryListSelect() string {
	return `SELECT t.id,t.work_item_id,t.project_id,p.project_code,p.name,p.short_name,w.item_key,w.title,t.uid,DATE_FORMAT(t.entry_date,'%Y-%m-%d'),CAST(t.hours AS CHAR),t.description,t.review_status,t.review_route,t.reviewer_uid_snapshot,t.locked_report_version_id,t.row_version,DATE_FORMAT(t.submitted_at,'%Y-%m-%dT%H:%i:%s.%fZ'),t.reviewed_by,DATE_FORMAT(t.reviewed_at,'%Y-%m-%dT%H:%i:%s.%fZ'),t.return_reason,DATE_FORMAT(t.created_at,'%Y-%m-%d %H:%i:%s'),DATE_FORMAT(t.updated_at,'%Y-%m-%d %H:%i:%s')`
}
