package aims

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strings"
	"time"
)

type weeklySummaryRank struct {
	ProjectID     int64   `json:"projectId"`
	Name          string  `json:"name"`
	Code          string  `json:"code"`
	Value         float64 `json:"value"`
	PreviousValue float64 `json:"previousValue,omitempty"`
	Delta         float64 `json:"delta,omitempty"`
}
type weeklySummaryTotals struct {
	Total               int     `json:"total"`
	Filled              int     `json:"filled"`
	CurrentDays         float64 `json:"currentDays"`
	ActualDays          float64 `json:"actualDays"`
	PreviousDays        float64 `json:"previousDays"`
	DeltaDays           float64 `json:"deltaDays"`
	MemberSlots         int     `json:"memberSlots"`
	CumulativeLaborCost float64 `json:"cumulativeLaborCost"`
}

func weeklyRound(v float64) float64 { return math.Floor(v*100+0.5) / 100 }
func weeklyRank(i projectWeeklyReportSummaryItem, value float64) weeklySummaryRank {
	name := i.ProjectName
	if name == "" {
		name = i.InternalCode
	}
	if name == "" {
		name = i.ProjectCode
	}
	code := i.InternalCode
	if code == "" {
		code = i.ProjectCode
	}
	return weeklySummaryRank{ProjectID: i.ProjectID, Name: name, Code: code, Value: weeklyRound(value)}
}
func weeklySummaryAggregates(items []projectWeeklyReportSummaryItem) (weeklySummaryTotals, map[string][]weeklySummaryRank) {
	totals := weeklySummaryTotals{Total: len(items)}
	charts := map[string][]weeklySummaryRank{"workload": {}, "members": {}, "change": {}, "cost": {}}
	for _, i := range items {
		if i.ReportID != nil {
			totals.Filled++
		}
		totals.CurrentDays += i.TotalHours / 8
		totals.ActualDays += i.ActualHours / 8
		totals.PreviousDays += i.PreviousTotalHours / 8
		totals.MemberSlots += i.MemberCount
		cost := 0.0
		if i.CumulativeLaborCost != nil {
			cost = *i.CumulativeLaborCost
		}
		totals.CumulativeLaborCost += cost
		for k, v := range map[string]float64{"workload": i.TotalHours / 8, "members": float64(i.MemberCount), "cost": cost} {
			row := weeklyRank(i, v)
			if row.Value > 0 {
				charts[k] = append(charts[k], row)
			}
		}
		change := weeklyRank(i, i.TotalHours/8-i.PreviousTotalHours/8)
		change.PreviousValue = weeklyRound(i.PreviousTotalHours / 8)
		change.Delta = change.Value
		if change.Value != 0 || change.PreviousValue != 0 {
			charts["change"] = append(charts["change"], change)
		}
	}
	// Preserve JS rounding order: delta uses rounded currentDays and unrounded previousDays.
	totals.CurrentDays = weeklyRound(totals.CurrentDays)
	totals.ActualDays = weeklyRound(totals.ActualDays)
	totals.DeltaDays = weeklyRound(totals.CurrentDays - totals.PreviousDays)
	totals.PreviousDays = weeklyRound(totals.PreviousDays)
	totals.CumulativeLaborCost = weeklyRound(totals.CumulativeLaborCost)
	for k, rows := range charts {
		sort.SliceStable(rows, func(i, j int) bool {
			a, b := rows[i].Value, rows[j].Value
			if k == "change" {
				a = math.Abs(a)
				b = math.Abs(b)
			}
			if a == b {
				return rows[i].ProjectID < rows[j].ProjectID
			}
			return a > b
		})
		limit := 14
		if k == "workload" {
			limit = 10
		}
		if len(rows) > limit {
			rest := rows[limit:]
			rows = rows[:limit]
			if k == "workload" {
				v := 0.0
				for _, r := range rest {
					v += r.Value
				}
				rows = append(rows, weeklySummaryRank{Name: "其他项目", Code: fmt.Sprintf("%d 个项目", len(rest)), Value: weeklyRound(v)})
			}
		}
		charts[k] = rows
	}
	return totals, charts
}
func weeklySummarySearch(keyword string) (string, []any) {
	if keyword == "" {
		return "1 = 1", nil
	}
	// LOCATE is literal substring matching: browser % and _ are not SQL wildcards.
	fields := []string{"project_code", "internal_code", "name", "department_name", "project_manager_name", "leader_uid", "dept_code"}
	parts := []string{}
	args := []any{}
	for _, f := range fields {
		parts = append(parts, "LOCATE(LOWER(?), LOWER(COALESCE(w."+f+", ''))) > 0")
		args = append(args, keyword)
	}
	return "(" + strings.Join(parts, " OR ") + ")", args
}
func (a *Adapter) projectWeeklyReportSummaryPage(ctx context.Context, q url.Values, p timeEntryPage, statement string, args []any, year, week int, start, end time.Time, previousYear, previousWeek int) (map[string]any, error) {
	tx, e := a.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	// The authorized base is identical for metrics and the searched list; keyword only affects the latter.
	base := statement[:strings.LastIndex(statement, "ORDER BY")]
	rows, e := tx.QueryContext(ctx, base, args...)
	if e != nil {
		return nil, e
	}
	all := []projectWeeklyReportSummaryItem{}
	for rows.Next() {
		i, err := scanProjectWeeklyReportSummaryItem(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		all = append(all, i)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	totals, charts := weeklySummaryAggregates(all)
	filter, filterArgs := weeklySummarySearch(firstQueryText(q, "search", "keyword", "q"))
	from := " FROM (" + base + ") w WHERE " + filter
	listArgs := append(append([]any{}, args...), filterArgs...)
	var total int
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*)"+from, listArgs...).Scan(&total); e != nil {
		return nil, e
	}
	pageArgs := append(append([]any{}, listArgs...), p.size, (p.page-1)*p.size)
	rows, e = tx.QueryContext(ctx, "SELECT w.*"+from+" ORDER BY department_name ASC, project_type_name ASC, name ASC, id ASC LIMIT ? OFFSET ?", pageArgs...)
	if e != nil {
		return nil, e
	}
	items := []projectWeeklyReportSummaryItem{}
	for rows.Next() {
		i, err := scanProjectWeeklyReportSummaryItem(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, i)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	if q.Get("includeWorkItems") == "1" || q.Get("include_work_items") == "1" {
		reports := []projectWeeklyReportItem{}
		for _, i := range items {
			if i.ReportID != nil {
				reports = append(reports, projectWeeklyReportItem{ID: *i.ReportID})
			}
		}
		if e = attachProjectWeeklyReportWorkItemsWith(ctx, tx, reports); e != nil {
			return nil, e
		}
		byID := map[int64][]projectWeeklyReportWorkItem{}
		for _, r := range reports {
			byID[r.ID] = r.WorkItems
		}
		for j := range items {
			if items[j].ReportID != nil {
				items[j].WorkItems = byID[*items[j].ReportID]
			}
		}
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"items": items, "total": total, "page": p.page, "pageSize": p.size, "summary": totals, "charts": charts, "meta": map[string]any{"reportYear": year, "reportWeek": week, "weekStart": start.Format("2006-01-02"), "weekEnd": end.Format("2006-01-02"), "previousReportYear": previousYear, "previousReportWeek": previousWeek}}, nil
}
