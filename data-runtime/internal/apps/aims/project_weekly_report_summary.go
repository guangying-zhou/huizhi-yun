package aims

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type projectWeeklyReportSummaryItem struct {
	ProjectID           int64                         `json:"projectId"`
	ProjectCode         string                        `json:"projectCode"`
	InternalCode        string                        `json:"internalCode"`
	ProjectName         string                        `json:"projectName"`
	ProjectCategory     string                        `json:"projectCategory"`
	LifecycleStatus     string                        `json:"lifecycleStatus"`
	DeptCode            string                        `json:"deptCode"`
	LeaderUID           string                        `json:"leaderUid"`
	ReportID            *int64                        `json:"reportId"`
	ReportYear          int                           `json:"reportYear"`
	ReportWeek          int                           `json:"reportWeek"`
	WeekStart           string                        `json:"weekStart"`
	WeekEnd             string                        `json:"weekEnd"`
	MainWork            string                        `json:"mainWork"`
	OverallProgress     string                        `json:"overallProgress"`
	DepartmentName      string                        `json:"departmentName"`
	ProjectTypeName     string                        `json:"projectTypeName"`
	ProjectManagerName  string                        `json:"projectManagerName"`
	InitiationStatus    string                        `json:"initiationStatus"`
	CurrentStage        string                        `json:"currentStage"`
	ProgressStatus      string                        `json:"progressStatus"`
	CompletionPercent   *float64                      `json:"completionPercent"`
	ContractStatus      string                        `json:"contractStatus"`
	ContractAmount      *float64                      `json:"contractAmount"`
	PaymentStatus       string                        `json:"paymentStatus"`
	CumulativeLaborCost *float64                      `json:"cumulativeLaborCost"`
	MajorRisks          string                        `json:"majorRisks"`
	CoordinationNeeds   string                        `json:"coordinationNeeds"`
	Remarks             string                        `json:"remarks"`
	Status              string                        `json:"status"`
	TotalHours          float64                       `json:"totalHours"`
	PreviousTotalHours  float64                       `json:"previousTotalHours"`
	ActualHours         float64                       `json:"actualHours"`
	MemberCount         int                           `json:"memberCount"`
	WorkItems           []projectWeeklyReportWorkItem `json:"workItems,omitempty"`
}

func (a *Adapter) projectWeeklyReportSummary(ctx context.Context, query url.Values) (map[string]any, error) {
	currentUser := strings.TrimSpace(query.Get("current_user"))
	if currentUser == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if !currentUserCanViewWeeklyReportSummary(query) {
		return nil, httperror.New(http.StatusForbidden, "forbidden_weekly_report_summary", "only authorized users can view project weekly report summary")
	}
	if err := a.ensureProjectWeeklyReportSummarySchema(ctx); err != nil {
		return nil, err
	}

	reportYear, reportWeek, err := weeklyReportQueryYearWeek(query)
	if err != nil {
		return nil, err
	}
	weekStartDate, weekEndDate := isoWeekRange(reportYear, reportWeek)
	previousYear, previousWeek := weekStartDate.AddDate(0, 0, -7).ISOWeek()

	where := []string{"1 = 1"}
	args := []any{
		reportYear,
		reportWeek,
		previousYear,
		previousWeek,
		weekStartDate.Format("2006-01-02"),
		weekEndDate.Format("2006-01-02"),
	}
	if strings.TrimSpace(query.Get("includeArchived")) != "1" && strings.TrimSpace(query.Get("include_archived")) != "1" {
		where = append(where, "p.lifecycle_status <> 'archived'")
	}
	if keyword := firstQueryText(query, "search", "keyword", "q"); keyword != "" {
		where = append(where, "(p.project_code LIKE ? OR p.internal_code LIKE ? OR p.name LIKE ? OR p.leader_uid LIKE ?)")
		like := "%" + keyword + "%"
		args = append(args, like, like, like, like)
	}
	if deptCode := firstQueryText(query, "deptCode", "dept_code"); deptCode != "" && deptCode != "all" {
		where = append(where, "p.dept_code = ?")
		args = append(args, deptCode)
	}
	if category := firstQueryText(query, "category"); category != "" && category != "all" {
		where = append(where, "p.category = ?")
		args = append(args, category)
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			p.id,
			p.project_code,
			p.internal_code,
			p.name,
			p.category,
			p.lifecycle_status,
			p.dept_code,
			p.leader_uid,
			r.id AS report_id,
			COALESCE(r.report_year, ?) AS report_year,
			COALESCE(r.report_week, ?) AS report_week,
			COALESCE(DATE_FORMAT(r.week_start, '%Y-%m-%d'), ?) AS week_start,
			COALESCE(DATE_FORMAT(r.week_end, '%Y-%m-%d'), ?) AS week_end,
			r.main_work,
			r.overall_progress,
			COALESCE(r.department_name, p.dept_code, '') AS department_name,
			COALESCE(r.project_type_name, p.category, '') AS project_type_name,
			COALESCE(r.project_manager_name, p.leader_uid, '') AS project_manager_name,
			r.initiation_status,
			COALESCE(r.current_stage, p.lifecycle_status, '') AS current_stage,
			r.progress_status,
			CAST(r.completion_percent AS CHAR) AS completion_percent,
			r.contract_status,
			CAST(r.contract_amount AS CHAR) AS contract_amount,
			r.payment_status,
			CAST(r.cumulative_labor_cost AS CHAR) AS cumulative_labor_cost,
			r.major_risks,
			r.coordination_needs,
			r.remarks,
			COALESCE(r.status, 'missing') AS status,
			CAST(COALESCE(curr.total_hours, 0) AS CHAR) AS total_hours,
			CAST(COALESCE(prev.total_hours, 0) AS CHAR) AS previous_total_hours,
			CAST(COALESCE(actual.total_hours, 0) AS CHAR) AS actual_hours,
			COALESCE(curr.member_count, mc.member_count, 0) AS member_count
		FROM aims_projects p
		LEFT JOIN project_weekly_reports r
		  ON r.project_id = p.id
		 AND r.report_year = ?
		 AND r.report_week = ?
		LEFT JOIN (
			SELECT report_id, COUNT(*) AS member_count, SUM(hours) AS total_hours
			FROM project_weekly_report_entries
			GROUP BY report_id
		) curr ON curr.report_id = r.id
		LEFT JOIN project_weekly_reports pr
		  ON pr.project_id = p.id
		 AND pr.report_year = ?
		 AND pr.report_week = ?
		LEFT JOIN (
			SELECT report_id, SUM(hours) AS total_hours
			FROM project_weekly_report_entries
			GROUP BY report_id
		) prev ON prev.report_id = pr.id
		LEFT JOIN (
			SELECT project_id, SUM(hours) AS total_hours
			FROM time_entries
			WHERE entry_date BETWEEN ? AND ?
			  AND weekly_report_id IS NULL
			GROUP BY project_id
		) actual ON actual.project_id = p.id
		LEFT JOIN (
			SELECT project_id, COUNT(*) AS member_count
			FROM aims_project_members
			WHERE COALESCE(status, 'active') = 'active'
			GROUP BY project_id
		) mc ON mc.project_id = p.id
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY department_name ASC, project_type_name ASC, p.name ASC, p.id ASC
	`, append([]any{reportYear, reportWeek, weekStartDate.Format("2006-01-02"), weekEndDate.Format("2006-01-02")}, args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []projectWeeklyReportSummaryItem{}
	for rows.Next() {
		item, err := scanProjectWeeklyReportSummaryItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	includeWorkItems := strings.TrimSpace(query.Get("includeWorkItems")) == "1" || strings.TrimSpace(query.Get("include_work_items")) == "1"
	if includeWorkItems {
		if err := a.attachProjectWeeklyReportSummaryWorkItems(ctx, items); err != nil {
			return nil, err
		}
	}

	return map[string]any{
		"items":    items,
		"total":    len(items),
		"page":     1,
		"pageSize": len(items),
		"meta": map[string]any{
			"reportYear":         reportYear,
			"reportWeek":         reportWeek,
			"weekStart":          weekStartDate.Format("2006-01-02"),
			"weekEnd":            weekEndDate.Format("2006-01-02"),
			"previousReportYear": previousYear,
			"previousReportWeek": previousWeek,
		},
	}, nil
}

func scanProjectWeeklyReportSummaryItem(rows *sql.Rows) (projectWeeklyReportSummaryItem, error) {
	var item projectWeeklyReportSummaryItem
	var internalCode sql.NullString
	var deptCode sql.NullString
	var leaderUID sql.NullString
	var reportID sql.NullInt64
	var mainWork sql.NullString
	var overallProgress sql.NullString
	var initiationStatus sql.NullString
	var progressStatus sql.NullString
	var completionPercentText sql.NullString
	var contractStatus sql.NullString
	var contractAmountText sql.NullString
	var paymentStatus sql.NullString
	var cumulativeLaborCostText sql.NullString
	var majorRisks sql.NullString
	var coordinationNeeds sql.NullString
	var remarks sql.NullString
	var totalHoursText string
	var previousTotalHoursText string
	var actualHoursText string
	if err := rows.Scan(
		&item.ProjectID,
		&item.ProjectCode,
		&internalCode,
		&item.ProjectName,
		&item.ProjectCategory,
		&item.LifecycleStatus,
		&deptCode,
		&leaderUID,
		&reportID,
		&item.ReportYear,
		&item.ReportWeek,
		&item.WeekStart,
		&item.WeekEnd,
		&mainWork,
		&overallProgress,
		&item.DepartmentName,
		&item.ProjectTypeName,
		&item.ProjectManagerName,
		&initiationStatus,
		&item.CurrentStage,
		&progressStatus,
		&completionPercentText,
		&contractStatus,
		&contractAmountText,
		&paymentStatus,
		&cumulativeLaborCostText,
		&majorRisks,
		&coordinationNeeds,
		&remarks,
		&item.Status,
		&totalHoursText,
		&previousTotalHoursText,
		&actualHoursText,
		&item.MemberCount,
	); err != nil {
		return item, err
	}
	item.InternalCode = internalCode.String
	item.DeptCode = deptCode.String
	item.LeaderUID = leaderUID.String
	item.ReportID = nullableInt64(reportID)
	item.MainWork = mainWork.String
	item.OverallProgress = overallProgress.String
	item.InitiationStatus = initiationStatus.String
	item.ProgressStatus = progressStatus.String
	item.CompletionPercent = nullableFloatFromText(completionPercentText)
	item.ContractStatus = contractStatus.String
	item.ContractAmount = nullableFloatFromText(contractAmountText)
	item.PaymentStatus = paymentStatus.String
	item.CumulativeLaborCost = nullableFloatFromText(cumulativeLaborCostText)
	item.MajorRisks = majorRisks.String
	item.CoordinationNeeds = coordinationNeeds.String
	item.Remarks = remarks.String
	item.TotalHours = parseFloatOrZero(totalHoursText)
	item.PreviousTotalHours = parseFloatOrZero(previousTotalHoursText)
	item.ActualHours = parseFloatOrZero(actualHoursText)
	return item, nil
}

func (a *Adapter) attachProjectWeeklyReportSummaryWorkItems(ctx context.Context, items []projectWeeklyReportSummaryItem) error {
	reportItems := []projectWeeklyReportItem{}
	for _, item := range items {
		if item.ReportID == nil {
			continue
		}
		reportItems = append(reportItems, projectWeeklyReportItem{ID: *item.ReportID})
	}
	if len(reportItems) == 0 {
		return nil
	}
	if err := a.attachProjectWeeklyReportWorkItems(ctx, reportItems); err != nil {
		return err
	}
	byReportID := map[int64][]projectWeeklyReportWorkItem{}
	for _, report := range reportItems {
		byReportID[report.ID] = report.WorkItems
	}
	for i := range items {
		if items[i].ReportID == nil {
			continue
		}
		items[i].WorkItems = byReportID[*items[i].ReportID]
	}
	return nil
}

func weeklyReportQueryYearWeek(query url.Values) (int, int, error) {
	now := time.Now().UTC()
	defaultYear, defaultWeek := now.ISOWeek()
	year := defaultYear
	week := defaultWeek
	if yearText := firstQueryText(query, "year", "reportYear", "report_year"); yearText != "" {
		value, err := strconv.Atoi(yearText)
		if err != nil || value < 1970 || value > 9999 {
			return 0, 0, httperror.New(http.StatusBadRequest, "invalid_report_year", "report year is invalid")
		}
		year = value
	}
	if weekText := firstQueryText(query, "week", "reportWeek", "report_week"); weekText != "" {
		value, err := strconv.Atoi(weekText)
		if err != nil || value < 1 || value > 53 {
			return 0, 0, httperror.New(http.StatusBadRequest, "invalid_report_week", "report week must be between 1 and 53")
		}
		week = value
	}
	return year, week, nil
}

func parseFloatOrZero(value string) float64 {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil {
		return 0
	}
	return parsed
}
