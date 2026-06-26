package aims

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const weeklyReportBaseHours = 40.0

type projectWeeklyReportItem struct {
	ID                  int64                         `json:"id"`
	ProjectID           int64                         `json:"projectId"`
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
	CreatedBy           string                        `json:"createdBy"`
	UpdatedBy           *string                       `json:"updatedBy"`
	CreatedAt           string                        `json:"createdAt"`
	UpdatedAt           string                        `json:"updatedAt"`
	TotalHours          float64                       `json:"totalHours"`
	MemberCount         int                           `json:"memberCount"`
	Entries             []projectWeeklyReportEntry    `json:"entries,omitempty"`
	WorkItems           []projectWeeklyReportWorkItem `json:"workItems,omitempty"`
}

type projectWeeklyReportEntry struct {
	ID                int64   `json:"id"`
	ReportID          int64   `json:"reportId"`
	ProjectID         int64   `json:"projectId"`
	UID               string  `json:"uid"`
	AllocationPercent float64 `json:"allocationPercent"`
	Hours             float64 `json:"hours"`
	CreatedAt         string  `json:"createdAt"`
	UpdatedAt         string  `json:"updatedAt"`
}

type projectWeeklyReportEntryInput struct {
	UID               string
	AllocationPercent float64
	Hours             float64
}

type projectWeeklyReportWorkItem struct {
	ID                int64    `json:"id"`
	ReportID          int64    `json:"reportId"`
	ProjectID         int64    `json:"projectId"`
	PlanType          string   `json:"planType"`
	SourceType        string   `json:"sourceType"`
	WorkItemID        *int64   `json:"workItemId"`
	ModuleName        string   `json:"moduleName"`
	SortOrder         int      `json:"sortOrder"`
	TaskSummary       string   `json:"taskSummary"`
	OwnerUID          string   `json:"ownerUid"`
	OwnerName         string   `json:"ownerName"`
	CompletionPercent *float64 `json:"completionPercent"`
	IncompleteReason  string   `json:"incompleteReason"`
	WorkloadDays      *float64 `json:"workloadDays"`
	CreatedAt         string   `json:"createdAt"`
	UpdatedAt         string   `json:"updatedAt"`
}

type projectWeeklyReportWorkItemInput struct {
	PlanType          string
	SourceType        string
	WorkItemID        *int64
	ModuleName        string
	SortOrder         int
	TaskSummary       string
	OwnerUID          string
	OwnerName         string
	CompletionPercent *float64
	IncompleteReason  string
	WorkloadDays      *float64
}

func (a *Adapter) projectWeeklyReports(ctx context.Context, projectID string, query url.Values) (map[string]any, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_project_id", "project id is required")
	}

	currentUser := strings.TrimSpace(query.Get("current_user"))
	if currentUser == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if err := a.requireProjectWeeklyReportRead(ctx, projectID, currentUser, query); err != nil {
		return nil, err
	}
	if err := a.ensureProjectWeeklyReportSummarySchema(ctx); err != nil {
		return nil, err
	}

	where := []string{"r.project_id = ?"}
	args := []any{projectID}
	if year := firstQueryText(query, "year", "reportYear", "report_year"); year != "" {
		where = append(where, "r.report_year = ?")
		args = append(args, year)
	}
	if week := firstQueryText(query, "week", "reportWeek", "report_week"); week != "" {
		where = append(where, "r.report_week = ?")
		args = append(args, week)
	}

	whereSQL := strings.Join(where, " AND ")
	var total int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM project_weekly_reports r
		WHERE `+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			r.id,
			r.project_id,
			r.report_year,
			r.report_week,
			DATE_FORMAT(r.week_start, '%Y-%m-%d') AS week_start,
			DATE_FORMAT(r.week_end, '%Y-%m-%d') AS week_end,
			r.main_work,
			r.overall_progress,
			r.department_name,
			r.project_type_name,
			r.project_manager_name,
			r.initiation_status,
			r.current_stage,
			r.progress_status,
			CAST(r.completion_percent AS CHAR) AS completion_percent,
			r.contract_status,
			CAST(r.contract_amount AS CHAR) AS contract_amount,
			r.payment_status,
			CAST(r.cumulative_labor_cost AS CHAR) AS cumulative_labor_cost,
			r.major_risks,
			r.coordination_needs,
			r.remarks,
			r.status,
			r.created_by,
			r.updated_by,
			DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(r.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
			CAST(COALESCE(SUM(e.hours), 0) AS CHAR) AS total_hours,
			COUNT(e.id) AS member_count
		FROM project_weekly_reports r
		LEFT JOIN project_weekly_report_entries e ON e.report_id = r.id
		WHERE `+whereSQL+`
		GROUP BY r.id
		ORDER BY r.report_year DESC, r.report_week DESC
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items, err := scanProjectWeeklyReports(rows)
	if err != nil {
		return nil, err
	}

	includeEntries := strings.TrimSpace(query.Get("includeEntries")) == "1" || strings.TrimSpace(query.Get("include_entries")) == "1" || firstQueryText(query, "week", "reportWeek", "report_week") != ""
	if includeEntries && len(items) > 0 {
		if err := a.attachProjectWeeklyReportEntries(ctx, items); err != nil {
			return nil, err
		}
	}
	includeWorkItems := strings.TrimSpace(query.Get("includeWorkItems")) == "1" || strings.TrimSpace(query.Get("include_work_items")) == "1" || includeEntries
	if includeWorkItems && len(items) > 0 {
		if err := a.attachProjectWeeklyReportWorkItems(ctx, items); err != nil {
			return nil, err
		}
	}

	return map[string]any{
		"items":    items,
		"total":    total,
		"page":     1,
		"pageSize": len(items),
	}, nil
}

func (a *Adapter) saveProjectWeeklyReport(ctx context.Context, projectID string, query url.Values, body map[string]any) (projectWeeklyReportItem, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return projectWeeklyReportItem{}, httperror.New(http.StatusBadRequest, "missing_project_id", "project id is required")
	}

	currentUser := currentUserFrom(query, body)
	if currentUser == "" {
		return projectWeeklyReportItem{}, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if err := a.requireProjectWeeklyReportManager(ctx, projectID, currentUser, query); err != nil {
		return projectWeeklyReportItem{}, err
	}
	if err := a.ensureProjectWeeklyReportSummarySchema(ctx); err != nil {
		return projectWeeklyReportItem{}, err
	}

	reportYear, err := bodyInt(body, "reportYear", "report_year", "year")
	if err != nil || reportYear < 1970 || reportYear > 9999 {
		return projectWeeklyReportItem{}, httperror.New(http.StatusBadRequest, "invalid_report_year", "reportYear is invalid")
	}
	reportWeek, err := bodyInt(body, "reportWeek", "report_week", "week")
	if err != nil || reportWeek < 1 || reportWeek > 53 {
		return projectWeeklyReportItem{}, httperror.New(http.StatusBadRequest, "invalid_report_week", "reportWeek must be between 1 and 53")
	}

	weekStartDate, weekEndDate := isoWeekRange(reportYear, reportWeek)
	weekStart := weekStartDate.Format("2006-01-02")
	weekEnd := weekEndDate.Format("2006-01-02")

	entriesProvided := hasAnyBodyKey(body, "entries")
	entries, err := projectWeeklyReportEntriesFromBody(body)
	if err != nil {
		return projectWeeklyReportItem{}, err
	}
	var existingReportID sql.NullInt64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT id
		FROM project_weekly_reports
		WHERE project_id = ?
		  AND report_year = ?
		  AND report_week = ?
		LIMIT 1
	`, projectID, reportYear, reportWeek).Scan(&existingReportID); err != nil && err != sql.ErrNoRows {
		return projectWeeklyReportItem{}, err
	}
	if len(entries) == 0 && (!existingReportID.Valid || entriesProvided) {
		entries, err = a.defaultProjectWeeklyReportEntries(ctx, projectID)
		if err != nil {
			return projectWeeklyReportItem{}, err
		}
	}
	if len(entries) > 0 {
		if err := a.validateProjectWeeklyReportEntries(ctx, projectID, entries); err != nil {
			return projectWeeklyReportItem{}, err
		}
	}

	mainWork := firstBodyText(body, "mainWork", "main_work")
	overallProgress := firstBodyText(body, "overallProgress", "overall_progress")
	summary := projectWeeklyReportSummaryFromBody(body)
	workItems, err := projectWeeklyReportWorkItemsFromBody(body)
	if err != nil {
		return projectWeeklyReportItem{}, err
	}
	status := firstBodyText(body, "status")
	if status == "" {
		status = "draft"
	}
	if status != "draft" && status != "submitted" {
		return projectWeeklyReportItem{}, httperror.New(http.StatusBadRequest, "invalid_report_status", "status is invalid")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return projectWeeklyReportItem{}, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO project_weekly_reports (
			project_id,
			report_year,
			report_week,
			week_start,
			week_end,
			main_work,
			overall_progress,
			department_name,
			project_type_name,
			project_manager_name,
			initiation_status,
			current_stage,
			progress_status,
			completion_percent,
			contract_status,
			contract_amount,
			payment_status,
			cumulative_labor_cost,
			major_risks,
			coordination_needs,
			remarks,
			status,
			created_by,
			updated_by
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			week_start = VALUES(week_start),
			week_end = VALUES(week_end),
			main_work = VALUES(main_work),
			overall_progress = VALUES(overall_progress),
			department_name = VALUES(department_name),
			project_type_name = VALUES(project_type_name),
			project_manager_name = VALUES(project_manager_name),
			initiation_status = VALUES(initiation_status),
			current_stage = VALUES(current_stage),
			progress_status = VALUES(progress_status),
			completion_percent = VALUES(completion_percent),
			contract_status = VALUES(contract_status),
			contract_amount = VALUES(contract_amount),
			payment_status = VALUES(payment_status),
			cumulative_labor_cost = VALUES(cumulative_labor_cost),
			major_risks = VALUES(major_risks),
			coordination_needs = VALUES(coordination_needs),
			remarks = VALUES(remarks),
			status = VALUES(status),
			updated_by = VALUES(updated_by)
	`,
		projectID,
		reportYear,
		reportWeek,
		weekStart,
		weekEnd,
		nullIfEmpty(mainWork),
		nullIfEmpty(overallProgress),
		nullIfEmpty(summary.DepartmentName),
		nullIfEmpty(summary.ProjectTypeName),
		nullIfEmpty(summary.ProjectManagerName),
		nullIfEmpty(summary.InitiationStatus),
		nullIfEmpty(summary.CurrentStage),
		nullIfEmpty(summary.ProgressStatus),
		nullableFloatValue(summary.CompletionPercent),
		nullIfEmpty(summary.ContractStatus),
		nullableFloatValue(summary.ContractAmount),
		nullIfEmpty(summary.PaymentStatus),
		nullableFloatValue(summary.CumulativeLaborCost),
		nullIfEmpty(summary.MajorRisks),
		nullIfEmpty(summary.CoordinationNeeds),
		nullIfEmpty(summary.Remarks),
		status,
		currentUser,
		currentUser,
	); err != nil {
		return projectWeeklyReportItem{}, err
	}

	var reportID int64
	if err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM project_weekly_reports
		WHERE project_id = ?
		  AND report_year = ?
		  AND report_week = ?
		LIMIT 1
	`, projectID, reportYear, reportWeek).Scan(&reportID); err != nil {
		return projectWeeklyReportItem{}, err
	}

	shouldReplaceEntries := entriesProvided || !existingReportID.Valid
	if shouldReplaceEntries {
		if _, err := tx.ExecContext(ctx, "DELETE FROM project_weekly_report_entries WHERE report_id = ?", reportID); err != nil {
			return projectWeeklyReportItem{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM project_weekly_report_work_items WHERE report_id = ?", reportID); err != nil {
		return projectWeeklyReportItem{}, err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM time_entries WHERE weekly_report_id = ?", reportID); err != nil {
		return projectWeeklyReportItem{}, err
	}

	if shouldReplaceEntries {
		for _, entry := range entries {
			if _, err := tx.ExecContext(ctx, `
			INSERT INTO project_weekly_report_entries (
				report_id,
				project_id,
				uid,
				allocation_percent,
				hours
			)
			VALUES (?, ?, ?, ?, ?)
		`, reportID, projectID, entry.UID, round2(entry.AllocationPercent), round2(entry.Hours)); err != nil {
				return projectWeeklyReportItem{}, err
			}
		}
	}

	for index, item := range workItems {
		sortOrder := item.SortOrder
		if sortOrder <= 0 {
			sortOrder = index + 1
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO project_weekly_report_work_items (
				report_id,
				project_id,
				plan_type,
				source_type,
				work_item_id,
				module_name,
				sort_order,
				task_summary,
				owner_uid,
				owner_name,
				completion_percent,
				incomplete_reason,
				workload_days
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			reportID,
			projectID,
			item.PlanType,
			item.SourceType,
			nullableInt64Value(item.WorkItemID),
			nullIfEmpty(item.ModuleName),
			sortOrder,
			item.TaskSummary,
			nullIfEmpty(item.OwnerUID),
			nullIfEmpty(item.OwnerName),
			nullableFloatValue(item.CompletionPercent),
			nullIfEmpty(item.IncompleteReason),
			nullableFloatValue(item.WorkloadDays),
		); err != nil {
			return projectWeeklyReportItem{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return projectWeeklyReportItem{}, err
	}

	report, err := a.getProjectWeeklyReport(ctx, reportID, true)
	if err != nil {
		return projectWeeklyReportItem{}, err
	}
	return report, nil
}

func (a *Adapter) getProjectWeeklyReport(ctx context.Context, reportID int64, includeEntries bool) (projectWeeklyReportItem, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			r.id,
			r.project_id,
			r.report_year,
			r.report_week,
			DATE_FORMAT(r.week_start, '%Y-%m-%d') AS week_start,
			DATE_FORMAT(r.week_end, '%Y-%m-%d') AS week_end,
			r.main_work,
			r.overall_progress,
			r.department_name,
			r.project_type_name,
			r.project_manager_name,
			r.initiation_status,
			r.current_stage,
			r.progress_status,
			CAST(r.completion_percent AS CHAR) AS completion_percent,
			r.contract_status,
			CAST(r.contract_amount AS CHAR) AS contract_amount,
			r.payment_status,
			CAST(r.cumulative_labor_cost AS CHAR) AS cumulative_labor_cost,
			r.major_risks,
			r.coordination_needs,
			r.remarks,
			r.status,
			r.created_by,
			r.updated_by,
			DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(r.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
			CAST(COALESCE(SUM(e.hours), 0) AS CHAR) AS total_hours,
			COUNT(e.id) AS member_count
		FROM project_weekly_reports r
		LEFT JOIN project_weekly_report_entries e ON e.report_id = r.id
		WHERE r.id = ?
		GROUP BY r.id
		LIMIT 1
	`, reportID)
	if err != nil {
		return projectWeeklyReportItem{}, err
	}
	defer rows.Close()

	items, err := scanProjectWeeklyReports(rows)
	if err != nil {
		return projectWeeklyReportItem{}, err
	}
	if len(items) == 0 {
		return projectWeeklyReportItem{}, httperror.New(http.StatusNotFound, "weekly_report_not_found", "weekly report not found")
	}
	if includeEntries {
		if err := a.attachProjectWeeklyReportEntries(ctx, items); err != nil {
			return projectWeeklyReportItem{}, err
		}
		if err := a.attachProjectWeeklyReportWorkItems(ctx, items); err != nil {
			return projectWeeklyReportItem{}, err
		}
	}
	return items[0], nil
}

func scanProjectWeeklyReports(rows *sql.Rows) ([]projectWeeklyReportItem, error) {
	items := make([]projectWeeklyReportItem, 0)
	for rows.Next() {
		var item projectWeeklyReportItem
		var mainWork sql.NullString
		var overallProgress sql.NullString
		var departmentName sql.NullString
		var projectTypeName sql.NullString
		var projectManagerName sql.NullString
		var initiationStatus sql.NullString
		var currentStage sql.NullString
		var progressStatus sql.NullString
		var completionPercentText sql.NullString
		var contractStatus sql.NullString
		var contractAmountText sql.NullString
		var paymentStatus sql.NullString
		var cumulativeLaborCostText sql.NullString
		var majorRisks sql.NullString
		var coordinationNeeds sql.NullString
		var remarks sql.NullString
		var updatedBy sql.NullString
		var totalHoursText string
		if err := rows.Scan(
			&item.ID,
			&item.ProjectID,
			&item.ReportYear,
			&item.ReportWeek,
			&item.WeekStart,
			&item.WeekEnd,
			&mainWork,
			&overallProgress,
			&departmentName,
			&projectTypeName,
			&projectManagerName,
			&initiationStatus,
			&currentStage,
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
			&item.CreatedBy,
			&updatedBy,
			&item.CreatedAt,
			&item.UpdatedAt,
			&totalHoursText,
			&item.MemberCount,
		); err != nil {
			return nil, err
		}
		item.MainWork = mainWork.String
		item.OverallProgress = overallProgress.String
		item.DepartmentName = departmentName.String
		item.ProjectTypeName = projectTypeName.String
		item.ProjectManagerName = projectManagerName.String
		item.InitiationStatus = initiationStatus.String
		item.CurrentStage = currentStage.String
		item.ProgressStatus = progressStatus.String
		item.CompletionPercent = nullableFloatFromText(completionPercentText)
		item.ContractStatus = contractStatus.String
		item.ContractAmount = nullableFloatFromText(contractAmountText)
		item.PaymentStatus = paymentStatus.String
		item.CumulativeLaborCost = nullableFloatFromText(cumulativeLaborCostText)
		item.MajorRisks = majorRisks.String
		item.CoordinationNeeds = coordinationNeeds.String
		item.Remarks = remarks.String
		item.UpdatedBy = nullableString(updatedBy)
		totalHours, err := strconv.ParseFloat(totalHoursText, 64)
		if err != nil {
			return nil, err
		}
		item.TotalHours = totalHours
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (a *Adapter) attachProjectWeeklyReportEntries(ctx context.Context, items []projectWeeklyReportItem) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]any, 0, len(items))
	index := map[int64]int{}
	for i := range items {
		ids = append(ids, items[i].ID)
		index[items[i].ID] = i
		items[i].Entries = []projectWeeklyReportEntry{}
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(ids)), ",")
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			id,
			report_id,
			project_id,
			uid,
			CAST(allocation_percent AS CHAR) AS allocation_percent,
			CAST(hours AS CHAR) AS hours,
			DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
		FROM project_weekly_report_entries
		WHERE report_id IN (`+placeholders+`)
		ORDER BY id ASC
	`, ids...)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var entry projectWeeklyReportEntry
		var percentText string
		var hoursText string
		if err := rows.Scan(
			&entry.ID,
			&entry.ReportID,
			&entry.ProjectID,
			&entry.UID,
			&percentText,
			&hoursText,
			&entry.CreatedAt,
			&entry.UpdatedAt,
		); err != nil {
			return err
		}
		percent, err := strconv.ParseFloat(percentText, 64)
		if err != nil {
			return err
		}
		hours, err := strconv.ParseFloat(hoursText, 64)
		if err != nil {
			return err
		}
		entry.AllocationPercent = percent
		entry.Hours = hours
		if itemIndex, ok := index[entry.ReportID]; ok {
			items[itemIndex].Entries = append(items[itemIndex].Entries, entry)
		}
	}
	return rows.Err()
}

func (a *Adapter) attachProjectWeeklyReportWorkItems(ctx context.Context, items []projectWeeklyReportItem) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]any, 0, len(items))
	index := map[int64]int{}
	for i := range items {
		ids = append(ids, items[i].ID)
		index[items[i].ID] = i
		items[i].WorkItems = []projectWeeklyReportWorkItem{}
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(ids)), ",")
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			id,
			report_id,
			project_id,
			plan_type,
			source_type,
			work_item_id,
			module_name,
			sort_order,
			task_summary,
			owner_uid,
			owner_name,
			CAST(completion_percent AS CHAR) AS completion_percent,
			incomplete_reason,
			CAST(workload_days AS CHAR) AS workload_days,
			DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
		FROM project_weekly_report_work_items
		WHERE report_id IN (`+placeholders+`)
		ORDER BY report_id ASC, sort_order ASC, id ASC
	`, ids...)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var item projectWeeklyReportWorkItem
		var workItemID sql.NullInt64
		var moduleName sql.NullString
		var ownerUID sql.NullString
		var ownerName sql.NullString
		var completionPercentText sql.NullString
		var incompleteReason sql.NullString
		var workloadDaysText sql.NullString
		if err := rows.Scan(
			&item.ID,
			&item.ReportID,
			&item.ProjectID,
			&item.PlanType,
			&item.SourceType,
			&workItemID,
			&moduleName,
			&item.SortOrder,
			&item.TaskSummary,
			&ownerUID,
			&ownerName,
			&completionPercentText,
			&incompleteReason,
			&workloadDaysText,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return err
		}
		item.WorkItemID = nullableInt64(workItemID)
		item.ModuleName = moduleName.String
		item.OwnerUID = ownerUID.String
		item.OwnerName = ownerName.String
		item.CompletionPercent = nullableFloatFromText(completionPercentText)
		item.IncompleteReason = incompleteReason.String
		item.WorkloadDays = nullableFloatFromText(workloadDaysText)
		if itemIndex, ok := index[item.ReportID]; ok {
			items[itemIndex].WorkItems = append(items[itemIndex].WorkItems, item)
		}
	}
	return rows.Err()
}

func projectWeeklyReportEntriesFromBody(body map[string]any) ([]projectWeeklyReportEntryInput, error) {
	rawEntries, ok := body["entries"]
	if !ok || rawEntries == nil {
		return []projectWeeklyReportEntryInput{}, nil
	}

	rawList, ok := rawEntries.([]any)
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "invalid_entries", "entries must be an array")
	}

	entries := make([]projectWeeklyReportEntryInput, 0, len(rawList))
	seen := map[string]bool{}
	for _, raw := range rawList {
		record, ok := raw.(map[string]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "invalid_entries", "entry must be an object")
		}
		uid := firstBodyText(record, "uid")
		if uid == "" {
			return nil, httperror.New(http.StatusBadRequest, "missing_entry_uid", "entry uid is required")
		}
		if seen[uid] {
			return nil, httperror.New(http.StatusBadRequest, "duplicate_entry_uid", "entry uid is duplicated")
		}
		seen[uid] = true

		percentProvided := hasAnyBodyKey(record, "allocationPercent", "allocation_percent")
		hoursProvided := hasAnyBodyKey(record, "hours")
		percent := 100.0
		hours := weeklyReportBaseHours
		if percentProvided {
			value, err := firstBodyNumber(record, "allocationPercent", "allocation_percent")
			if err != nil {
				return nil, httperror.New(http.StatusBadRequest, "invalid_allocation_percent", "allocationPercent is invalid")
			}
			percent = value
		}
		if hoursProvided {
			value, err := firstBodyNumber(record, "hours")
			if err != nil {
				return nil, httperror.New(http.StatusBadRequest, "invalid_hours", "hours is invalid")
			}
			hours = value
			if !percentProvided {
				percent = hours / weeklyReportBaseHours * 100
			}
		} else if percentProvided {
			hours = weeklyReportBaseHours * percent / 100
		}
		if percent < 0 || percent > 999.99 {
			return nil, httperror.New(http.StatusBadRequest, "invalid_allocation_percent", "allocationPercent must be between 0 and 999.99")
		}
		if hours < 0 || hours > 168 {
			return nil, httperror.New(http.StatusBadRequest, "invalid_hours", "hours must be between 0 and 168")
		}
		entries = append(entries, projectWeeklyReportEntryInput{
			UID:               uid,
			AllocationPercent: percent,
			Hours:             hours,
		})
	}
	return entries, nil
}

func projectWeeklyReportSummaryFromBody(body map[string]any) projectWeeklyReportItem {
	return projectWeeklyReportItem{
		DepartmentName:      firstBodyText(body, "departmentName", "department_name"),
		ProjectTypeName:     firstBodyText(body, "projectTypeName", "project_type_name"),
		ProjectManagerName:  firstBodyText(body, "projectManagerName", "project_manager_name"),
		InitiationStatus:    firstBodyText(body, "initiationStatus", "initiation_status"),
		CurrentStage:        firstBodyText(body, "currentStage", "current_stage"),
		ProgressStatus:      firstBodyText(body, "progressStatus", "progress_status"),
		CompletionPercent:   firstBodyOptionalFloat(body, "completionPercent", "completion_percent"),
		ContractStatus:      firstBodyText(body, "contractStatus", "contract_status"),
		ContractAmount:      firstBodyOptionalFloat(body, "contractAmount", "contract_amount"),
		PaymentStatus:       firstBodyText(body, "paymentStatus", "payment_status"),
		CumulativeLaborCost: firstBodyOptionalFloat(body, "cumulativeLaborCost", "cumulative_labor_cost"),
		MajorRisks:          firstBodyText(body, "majorRisks", "major_risks"),
		CoordinationNeeds:   firstBodyText(body, "coordinationNeeds", "coordination_needs"),
		Remarks:             firstBodyText(body, "remarks"),
	}
}

func projectWeeklyReportWorkItemsFromBody(body map[string]any) ([]projectWeeklyReportWorkItemInput, error) {
	rawItems, ok := body["workItems"]
	if !ok || rawItems == nil {
		rawItems = body["work_items"]
	}
	if rawItems == nil {
		return []projectWeeklyReportWorkItemInput{}, nil
	}

	rawList, ok := rawItems.([]any)
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "invalid_work_items", "workItems must be an array")
	}

	items := make([]projectWeeklyReportWorkItemInput, 0, len(rawList))
	for index, raw := range rawList {
		record, ok := raw.(map[string]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "invalid_work_items", "work item must be an object")
		}
		if emptyWeeklyReportWorkItemRecord(record) {
			continue
		}

		taskSummary := firstBodyText(record, "taskSummary", "task_summary")
		if taskSummary == "" {
			return nil, httperror.New(http.StatusBadRequest, "missing_work_item_summary", "work item taskSummary is required")
		}

		planType := firstBodyText(record, "planType", "plan_type")
		if planType == "" {
			planType = "this_week"
		}
		sourceType := firstBodyText(record, "sourceType", "source_type")
		if sourceType == "" {
			sourceType = "manual"
		}

		completionPercent, err := firstBodyOptionalNumber(record, "completionPercent", "completion_percent")
		if err != nil {
			return nil, httperror.New(http.StatusBadRequest, "invalid_work_item_completion", "work item completionPercent is invalid")
		}
		if completionPercent != nil && (*completionPercent < 0 || *completionPercent > 100) {
			return nil, httperror.New(http.StatusBadRequest, "invalid_work_item_completion", "work item completionPercent must be between 0 and 100")
		}
		workloadDays, err := firstBodyOptionalNumber(record, "workloadDays", "workload_days")
		if err != nil {
			return nil, httperror.New(http.StatusBadRequest, "invalid_workload_days", "work item workloadDays is invalid")
		}
		if workloadDays != nil && (*workloadDays < 0 || *workloadDays > 999.99) {
			return nil, httperror.New(http.StatusBadRequest, "invalid_workload_days", "work item workloadDays must be between 0 and 999.99")
		}

		workItemID, err := firstBodyOptionalInt64(record, "workItemId", "work_item_id")
		if err != nil {
			return nil, httperror.New(http.StatusBadRequest, "invalid_work_item_id", "workItemId is invalid")
		}
		sortOrder, err := firstBodyOptionalInt(record, "sortOrder", "sort_order")
		if err != nil {
			return nil, httperror.New(http.StatusBadRequest, "invalid_work_item_sort_order", "work item sortOrder is invalid")
		}
		if sortOrder <= 0 {
			sortOrder = index + 1
		}

		items = append(items, projectWeeklyReportWorkItemInput{
			PlanType:          planType,
			SourceType:        sourceType,
			WorkItemID:        workItemID,
			ModuleName:        firstBodyText(record, "moduleName", "module_name"),
			SortOrder:         sortOrder,
			TaskSummary:       taskSummary,
			OwnerUID:          firstBodyText(record, "ownerUid", "owner_uid"),
			OwnerName:         firstBodyText(record, "ownerName", "owner_name"),
			CompletionPercent: completionPercent,
			IncompleteReason:  firstBodyText(record, "incompleteReason", "incomplete_reason"),
			WorkloadDays:      workloadDays,
		})
	}
	return items, nil
}

func emptyWeeklyReportWorkItemRecord(record map[string]any) bool {
	keys := []string{
		"moduleName",
		"module_name",
		"taskSummary",
		"task_summary",
		"ownerUid",
		"owner_uid",
		"ownerName",
		"owner_name",
		"incompleteReason",
		"incomplete_reason",
	}
	for _, key := range keys {
		if firstBodyText(record, key) != "" {
			return false
		}
	}
	for _, key := range []string{"completionPercent", "completion_percent", "workloadDays", "workload_days", "workItemId", "work_item_id"} {
		if value, ok := record[key]; ok && value != nil && strings.TrimSpace(fmt.Sprint(value)) != "" {
			return false
		}
	}
	return true
}

func (a *Adapter) defaultProjectWeeklyReportEntries(ctx context.Context, projectID string) ([]projectWeeklyReportEntryInput, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT uid
		FROM aims_project_members
		WHERE project_id = ?
		  AND COALESCE(status, 'active') = 'active'
		ORDER BY FIELD(role, 'manager', 'member', 'viewer'), joined_at ASC, id ASC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []projectWeeklyReportEntryInput{}
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			return nil, err
		}
		entries = append(entries, projectWeeklyReportEntryInput{
			UID:               uid,
			AllocationPercent: 100,
			Hours:             weeklyReportBaseHours,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "project_has_no_active_members", "project has no active members")
	}
	return entries, nil
}

func (a *Adapter) validateProjectWeeklyReportEntries(ctx context.Context, projectID string, entries []projectWeeklyReportEntryInput) error {
	activeMembers := map[string]bool{}
	var leaderUID sql.NullString
	if err := a.DB().QueryRowContext(ctx, "SELECT leader_uid FROM aims_projects WHERE id = ?", projectID).Scan(&leaderUID); err == sql.ErrNoRows {
		return httperror.New(http.StatusNotFound, "project_not_found", "project not found")
	} else if err != nil {
		return err
	}
	if leaderUID.Valid && strings.TrimSpace(leaderUID.String) != "" {
		activeMembers[strings.TrimSpace(leaderUID.String)] = true
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT uid
		FROM aims_project_members
		WHERE project_id = ?
		  AND COALESCE(status, 'active') = 'active'
	`, projectID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			return err
		}
		activeMembers[uid] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, entry := range entries {
		if !activeMembers[entry.UID] {
			return httperror.New(http.StatusBadRequest, "entry_member_not_active", "entry uid is not an active project member")
		}
	}
	return nil
}

func (a *Adapter) requireProjectWeeklyReportRead(ctx context.Context, projectID string, uid string, query url.Values) error {
	if currentUserIsProjectAdmin(query) {
		return a.requireProjectExists(ctx, projectID)
	}

	if err := a.requireProjectWeeklyReportProjectAccess(ctx, projectID, uid, query); err == nil {
		return nil
	} else if !isHTTPStatus(err, http.StatusForbidden) {
		return err
	}

	var leaderUID sql.NullString
	var memberRole sql.NullString
	err := a.DB().QueryRowContext(ctx, `
		SELECT p.leader_uid, m.role
		FROM aims_projects p
		LEFT JOIN aims_project_members m
		  ON m.project_id = p.id
		 AND m.uid = ?
		 AND COALESCE(m.status, 'active') = 'active'
		WHERE p.id = ?
	`, uid, projectID).Scan(&leaderUID, &memberRole)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusNotFound, "project_not_found", "project not found")
	}
	if err != nil {
		return err
	}
	if leaderUID.Valid && leaderUID.String == uid {
		return nil
	}
	if memberRole.Valid {
		return nil
	}
	return httperror.New(http.StatusForbidden, "forbidden_project_weekly_report", "only project members can view project weekly reports")
}

func (a *Adapter) requireProjectWeeklyReportProjectAccess(ctx context.Context, projectID string, uid string, query url.Values) error {
	visibilityWhere, visibilityArgs := projectVisibilityWhere(query, "p", uid)
	args := append([]any{projectID}, visibilityArgs...)

	var id int64
	err := a.DB().QueryRowContext(ctx, `
		SELECT p.id
		FROM aims_projects p
		WHERE p.id = ?
		  AND `+visibilityWhere+`
		LIMIT 1
	`, args...).Scan(&id)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusForbidden, "forbidden_project_weekly_report", "only users with project access can view project weekly reports")
	}
	return err
}

func (a *Adapter) requireProjectWeeklyReportManager(ctx context.Context, projectID string, uid string, query url.Values) error {
	if currentUserIsProjectAdmin(query) {
		return a.requireProjectExists(ctx, projectID)
	}

	var leaderUID sql.NullString
	var memberRole sql.NullString
	err := a.DB().QueryRowContext(ctx, `
		SELECT p.leader_uid, m.role
		FROM aims_projects p
		LEFT JOIN aims_project_members m
		  ON m.project_id = p.id
		 AND m.uid = ?
		 AND COALESCE(m.status, 'active') = 'active'
		WHERE p.id = ?
	`, uid, projectID).Scan(&leaderUID, &memberRole)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusNotFound, "project_not_found", "project not found")
	}
	if err != nil {
		return err
	}
	if leaderUID.Valid && leaderUID.String == uid {
		return nil
	}
	if memberRole.Valid && memberRole.String == "manager" {
		return nil
	}
	return httperror.New(http.StatusForbidden, "forbidden_project_weekly_report_manage", "only project managers can edit project weekly reports")
}

func (a *Adapter) requireProjectExists(ctx context.Context, projectID string) error {
	var id int64
	err := a.DB().QueryRowContext(ctx, "SELECT id FROM aims_projects WHERE id = ? LIMIT 1", projectID).Scan(&id)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusNotFound, "project_not_found", "project not found")
	}
	return err
}

func currentUserIsProjectAdmin(query url.Values) bool {
	value := strings.TrimSpace(firstQueryText(query, "current_user_is_project_admin", "currentUserIsProjectAdmin"))
	switch strings.ToLower(value) {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}

func currentUserCanViewWeeklyReportSummary(query url.Values) bool {
	value := strings.TrimSpace(firstQueryText(query, "current_user_can_view_weekly_report_summary", "currentUserCanViewWeeklyReportSummary"))
	if value == "" {
		return currentUserIsProjectAdmin(query)
	}
	switch strings.ToLower(value) {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}

func isHTTPStatus(err error, status int) bool {
	httpErr, ok := err.(httperror.Error)
	return ok && httpErr.Status == status
}

func isoWeekRange(year int, week int) (time.Time, time.Time) {
	jan4 := time.Date(year, time.January, 4, 0, 0, 0, 0, time.UTC)
	weekday := int(jan4.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	week1Monday := jan4.AddDate(0, 0, -weekday+1)
	start := week1Monday.AddDate(0, 0, (week-1)*7)
	return start, start.AddDate(0, 0, 6)
}

func bodyInt(body map[string]any, keys ...string) (int, error) {
	value, err := firstBodyNumber(body, keys...)
	if err != nil {
		return 0, err
	}
	return int(value), nil
}

func firstBodyOptionalInt(body map[string]any, keys ...string) (int, error) {
	value, err := firstBodyOptionalNumber(body, keys...)
	if err != nil || value == nil {
		return 0, err
	}
	return int(*value), nil
}

func firstBodyOptionalInt64(body map[string]any, keys ...string) (*int64, error) {
	value, err := firstBodyOptionalNumber(body, keys...)
	if err != nil || value == nil {
		return nil, err
	}
	intValue := int64(*value)
	return &intValue, nil
}

func firstBodyOptionalFloat(body map[string]any, keys ...string) *float64 {
	value, err := firstBodyOptionalNumber(body, keys...)
	if err != nil {
		return nil
	}
	return value
}

func firstBodyOptionalNumber(body map[string]any, keys ...string) (*float64, error) {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		if strings.TrimSpace(fmt.Sprint(value)) == "" {
			return nil, nil
		}
		number, err := anyNumber(value)
		if err != nil {
			return nil, err
		}
		return &number, nil
	}
	return nil, nil
}

func firstBodyNumber(body map[string]any, keys ...string) (float64, error) {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		return anyNumber(value)
	}
	return 0, fmt.Errorf("number is required")
}

func anyNumber(value any) (float64, error) {
	switch typed := value.(type) {
	case float64:
		return typed, nil
	case float32:
		return float64(typed), nil
	case int:
		return float64(typed), nil
	case int64:
		return float64(typed), nil
	case jsonNumber:
		return strconv.ParseFloat(string(typed), 64)
	case string:
		return strconv.ParseFloat(strings.TrimSpace(typed), 64)
	default:
		return strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(value)), 64)
	}
}

func nullableFloatFromText(value sql.NullString) *float64 {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value.String), 64)
	if err != nil {
		return nil
	}
	return &parsed
}

func nullableInt64Value(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullIfEmpty(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func round2(value float64) float64 {
	return math.Round(value*100) / 100
}
