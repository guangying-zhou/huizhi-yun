package aims

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type weeklyReportCalendarRow struct {
	ReportYear int    `json:"reportYear"`
	ReportWeek int    `json:"reportWeek"`
	Status     string `json:"status"`
}

func (a *Adapter) projectWeeklyReportListPage(ctx context.Context, id, actor string, q url.Values, p timeEntryPage, where string, args []any, statement string) (map[string]any, error) {
	tx, e := a.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	if e = requireProjectWeeklyReportReadWith(ctx, tx, id, actor, q); e != nil {
		return nil, e
	}
	var total int64
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM project_weekly_reports r WHERE "+where, args...).Scan(&total); e != nil {
		return nil, e
	}
	statement = strings.TrimSpace(statement) + ", r.id DESC LIMIT ? OFFSET ?"
	rows, e := tx.QueryContext(ctx, statement, append(append([]any{}, args...), p.size, (p.page-1)*p.size)...)
	if e != nil {
		return nil, e
	}
	items, e := scanProjectWeeklyReports(rows)
	rows.Close()
	if e != nil {
		return nil, e
	}
	if q.Get("includeEntries") == "1" || q.Get("week") != "" {
		if e = attachProjectWeeklyReportEntriesWith(ctx, tx, items); e != nil {
			return nil, e
		}
	}
	if q.Get("includeWorkItems") == "1" || q.Get("includeEntries") == "1" || q.Get("week") != "" {
		if e = attachProjectWeeklyReportWorkItemsWith(ctx, tx, items); e != nil {
			return nil, e
		}
	}
	calendarWhere := "project_id=?"
	calendarArgs := []any{id}
	if year := firstQueryText(q, "year", "reportYear", "report_year"); year != "" {
		calendarWhere += " AND report_year=?"
		calendarArgs = append(calendarArgs, year)
	}
	rows, e = tx.QueryContext(ctx, "SELECT report_year,report_week,status FROM project_weekly_reports WHERE "+calendarWhere+" ORDER BY report_year DESC,report_week DESC,id DESC", calendarArgs...)
	if e != nil {
		return nil, e
	}
	calendar := []weeklyReportCalendarRow{}
	for rows.Next() {
		var r weeklyReportCalendarRow
		if e = rows.Scan(&r.ReportYear, &r.ReportWeek, &r.Status); e != nil {
			rows.Close()
			return nil, e
		}
		calendar = append(calendar, r)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"items": items, "total": total, "page": p.page, "pageSize": p.size, "calendar": calendar}, nil
}

type weeklyReportHistory struct {
	CumulativeLaborCost *float64 `json:"cumulativeLaborCost"`
	ProgressPercent     *float64 `json:"progressPercent"`
	ProgressYear        int      `json:"progressYear"`
	ProgressWeek        int      `json:"progressWeek"`
}

func projectWeeklyHistory(ctx context.Context, tx *sql.Tx, id int64, year, week int) (weeklyReportHistory, error) {
	rows, e := tx.QueryContext(ctx, `SELECT report_year,report_week,CAST(cumulative_labor_cost AS CHAR),CAST(completion_percent AS CHAR) FROM project_weekly_reports WHERE project_id=? AND (report_year<? OR (report_year=? AND report_week<?)) ORDER BY report_year DESC,report_week DESC,id DESC`, id, year, year, week)
	if e != nil {
		return weeklyReportHistory{}, e
	}
	defer rows.Close()
	history := weeklyReportHistory{}
	var prior *float64
	priorYear, priorWeek := 0, 0
	for rows.Next() {
		var y, w int
		var cost, progress sql.NullString
		if e = rows.Scan(&y, &w, &cost, &progress); e != nil {
			return history, e
		}
		if history.CumulativeLaborCost == nil && cost.Valid {
			history.CumulativeLaborCost = nullableFloatFromText(cost)
		}
		value := nullableFloatFromText(progress)
		if value == nil {
			continue
		}
		if prior != nil && history.ProgressPercent == nil && weeklyRound(*prior) != weeklyRound(*value) {
			history.ProgressPercent = prior
			history.ProgressYear = priorYear
			history.ProgressWeek = priorWeek
		}
		prior = value
		priorYear = y
		priorWeek = w
	}
	if history.ProgressPercent == nil && prior != nil {
		history.ProgressPercent = prior
		history.ProgressYear = priorYear
		history.ProgressWeek = priorWeek
	}
	return history, rows.Err()
}
func (a *Adapter) projectWeeklyReportPeriodPage(ctx context.Context, rawID, key string, q url.Values, p timeEntryPage) (map[string]any, error) {
	year, week, e := parseISOPeriodKey(key)
	if e != nil {
		return nil, e
	}
	id, e := parseID(rawID, "project_id")
	if e != nil {
		return nil, e
	}
	actor := strings.TrimSpace(q.Get("current_user"))
	if actor == "" {
		return nil, httperror.New(401, "missing_current_user", "current_user is required")
	}
	for _, k := range []string{"includeBaseline"} {
		if values, ok := q[k]; ok && (len(values) != 1 || values[0] != "1") {
			return nil, httperror.New(400, "weekly_report_page_invalid", "Invalid weekly report page")
		}
	}
	tx, e := a.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	if e = requireProjectWeeklyReportReadWith(ctx, tx, rawID, actor, q); e != nil {
		return nil, e
	}
	editable := requireProjectWeeklyReportManagerWith(ctx, tx, rawID, actor, q) == nil
	var reportID int64
	var status string
	var version int
	var submitted, reviewed, frozen sql.NullInt64
	e = tx.QueryRowContext(ctx, `SELECT id,status,current_version_no,current_submitted_version_id,current_reviewed_version_id,current_frozen_version_id FROM project_weekly_reports WHERE project_id=? AND report_year=? AND report_week=?`, id, year, week).Scan(&reportID, &status, &version, &submitted, &reviewed, &frozen)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return nil, e
	}
	var report *projectWeeklyReportItem
	if e == nil {
		r, err := getProjectWeeklyReportWith(ctx, tx, reportID, q.Get("includeBaseline") == "1")
		if err != nil {
			return nil, err
		}
		report = &r
	}
	history, e := projectWeeklyHistory(ctx, tx, id, year, week)
	if e != nil {
		return nil, e
	}
	memberFrom := ` FROM (SELECT BINARY uid AS uid FROM aims_project_members WHERE project_id=? AND COALESCE(status,'active')='active' UNION SELECT BINARY uid AS uid FROM project_weekly_report_entries WHERE report_id=?) member_rows`
	var memberTotal int64
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*)"+memberFrom, id, reportID).Scan(&memberTotal); e != nil {
		return nil, e
	}
	rows, e := tx.QueryContext(ctx, "SELECT uid"+memberFrom+" ORDER BY BINARY uid LIMIT ? OFFSET ?", id, reportID, p.size, (p.page-1)*p.size)
	if e != nil {
		return nil, e
	}
	memberIDs := []string{}
	for rows.Next() {
		var uid string
		if e = rows.Scan(&uid); e != nil {
			rows.Close()
			return nil, e
		}
		memberIDs = append(memberIDs, uid)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	var workTotal int64
	var workloadText string
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*),CAST(COALESCE(SUM(workload_days),0) AS CHAR) FROM project_weekly_report_work_items WHERE report_id=?", reportID).Scan(&workTotal, &workloadText); e != nil {
		return nil, e
	}
	rows, e = tx.QueryContext(ctx, "SELECT id FROM project_weekly_report_work_items WHERE report_id=? ORDER BY sort_order,id LIMIT ? OFFSET ?", reportID, p.size, (p.page-1)*p.size)
	if e != nil {
		return nil, e
	}
	workIDs := []int64{}
	for rows.Next() {
		var wid int64
		if e = rows.Scan(&wid); e != nil {
			rows.Close()
			return nil, e
		}
		workIDs = append(workIDs, wid)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	out := map[string]any{"periodKey": key, "editableByCurrentUser": editable, "status": status, "currentVersionNo": version, "currentSubmittedVersionId": nullableInt64(submitted), "currentReviewedVersionId": nullableInt64(reviewed), "currentFrozenVersionId": nullableInt64(frozen), "history": history, "entriesPage": map[string]any{"items": memberIDs, "total": memberTotal, "page": p.page, "pageSize": p.size}, "workItemsPage": map[string]any{"items": workIDs, "total": workTotal, "page": p.page, "pageSize": p.size}}
	var allocationAverage sql.NullString
	if e = tx.QueryRowContext(ctx, "SELECT CAST(AVG(allocation_percent) AS CHAR) FROM project_weekly_report_entries WHERE report_id=?", reportID).Scan(&allocationAverage); e != nil {
		return nil, e
	}
	persistedHours := 0.0
	persistedMembers := 0
	if report != nil {
		persistedHours = report.TotalHours
		persistedMembers = report.MemberCount
	}
	out["summary"] = map[string]any{"persistedRecognizedHours": persistedHours, "persistedMemberCount": persistedMembers, "initializationMemberCount": memberTotal, "persistedAllocationPercentAverage": parseFloatOrZero(allocationAverage.String), "persistedWorkloadDays": parseFloatOrZero(workloadText)}
	if q.Get("includeBaseline") == "1" {
		out["baseline"] = report
	}
	if report == nil {
		out["report"] = nil
	} else {
		metadata := *report
		metadata.Entries = nil
		metadata.WorkItems = nil
		out["report"] = metadata
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return out, nil
}
