package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handlePIVRViewsRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	if method == http.MethodGet {
		if projectID, ok := pathParam(path, "/v1/aims/projects/", "/service-health"); ok {
			data, err := a.projectServiceHealth(ctx, projectID, query)
			return data, "aims.projects.service_health", true, err
		}
		if projectID, milestoneID, ok := projectMilestoneClosePath(path, "/close-gate"); ok {
			data, err := a.projectMilestoneCloseGate(ctx, projectID, milestoneID, query)
			return data, "aims.projects.milestones.close_gate", true, err
		}
	}
	if method == http.MethodPost {
		if projectID, milestoneID, ok := projectMilestoneClosePath(path, ":close"); ok {
			if err := a.requireProjectUpdateAccess(ctx, path, query, map[string]any{}, projectID); err != nil {
				return nil, "aims.projects.milestones.close", true, err
			}
			var projectCode string
			if err := a.DB().QueryRowContext(ctx, "SELECT project_code FROM aims_projects WHERE id = ?", projectID).Scan(&projectCode); err != nil {
				return nil, "aims.projects.milestones.close", true, err
			}
			body["current_user"] = strings.TrimSpace(query.Get("current_user"))
			data, err := a.rolloverProjectMilestone(ctx, projectCode, milestoneID, body)
			return data, "aims.projects.milestones.close", true, err
		}
	}
	if method != http.MethodGet {
		return nil, "", false, nil
	}
	if lineCode, ok := directPathParam(path, "/v1/aims/service-lines/"); ok {
		lineCode, _ = url.PathUnescape(lineCode)
		data, err := a.serviceLineHistory(ctx, lineCode, query)
		return data, "aims.service_lines.history", true, err
	}
	if projectID, ok := pathParam(path, "/v1/aims/projects/", "/routine-review"); ok {
		data, err := a.routineQuarterReview(ctx, projectID, query)
		return data, "aims.projects.routine_review", true, err
	}
	return nil, "", false, nil
}

func (a *Adapter) projectServiceHealth(ctx context.Context, rawProjectID string, query url.Values) (map[string]any, error) {
	if err := a.requireProjectReadAccess(ctx, rawProjectID, query); err != nil {
		return nil, err
	}
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	var category string
	var serviceLine sql.NullString
	if err := a.DB().QueryRowContext(ctx, "SELECT category, service_line_code FROM aims_projects WHERE id = ?", projectID).Scan(&category, &serviceLine); err != nil {
		return nil, err
	}
	if category != "maintenance" {
		return nil, httperror.New(http.StatusBadRequest, "maintenance_project_required", "service health is only available for maintenance projects")
	}

	currentUser := strings.TrimSpace(query.Get("current_user"))
	projectFilter := "p.id = ?"
	repeatedProjectFilter := "rp.id = ?"
	projectArgs := []any{projectID}
	repeatedProjectArgs := []any{projectID}
	if serviceLine.Valid && strings.TrimSpace(serviceLine.String) != "" {
		visibility, visibilityArgs := projectVisibilityWhere(query, "p", currentUser)
		repeatedVisibility, repeatedVisibilityArgs := projectVisibilityWhere(query, "rp", currentUser)
		projectFilter = "p.service_line_code = ? AND " + visibility
		repeatedProjectFilter = "rp.service_line_code = ? AND " + repeatedVisibility
		projectArgs = append([]any{strings.TrimSpace(serviceLine.String)}, visibilityArgs...)
		repeatedProjectArgs = append([]any{strings.TrimSpace(serviceLine.String)}, repeatedVisibilityArgs...)
	}
	var tickets, slaMet, inflow, outflow, totalItems, repeatedItems int64
	healthSQL := `
		SELECT
		  COUNT(DISTINCT CASE WHEN wi.created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) AND wse.source_ticket_code IS NOT NULL THEN wi.id END),
		  COUNT(DISTINCT CASE WHEN wi.created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) AND wse.sla_status_snapshot = 'met' THEN wi.id END),
		  COUNT(DISTINCT CASE WHEN wi.created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) THEN wi.id END),
		  COUNT(DISTINCT CASE WHEN wi.status = 'completed' AND wi.updated_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) THEN wi.id END),
		  COUNT(DISTINCT CASE WHEN wi.created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) THEN wi.id END),
		  COALESCE((SELECT SUM(duplicates - 1) FROM (
		    SELECT COUNT(*) AS duplicates
		    FROM work_items rwi
		    JOIN aims_projects rp ON rp.id = rwi.project_id
		    WHERE ` + repeatedProjectFilter + ` AND rwi.created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
		    GROUP BY LOWER(TRIM(rwi.title)) HAVING COUNT(*) > 1
		  ) repeated), 0)
		FROM work_items wi
		JOIN aims_projects p ON p.id = wi.project_id
		LEFT JOIN work_item_service_ext wse ON wse.work_item_id = wi.id
		WHERE ` + projectFilter
	healthArgs := append([]any{}, repeatedProjectArgs...)
	healthArgs = append(healthArgs, projectArgs...)
	if err := a.DB().QueryRowContext(ctx, healthSQL, healthArgs...).Scan(&tickets, &slaMet, &inflow, &outflow, &totalItems, &repeatedItems); err != nil {
		return nil, err
	}

	var entitlement sql.NullFloat64
	_ = a.DB().QueryRowContext(ctx, `
		SELECT CAST(JSON_UNQUOTE(JSON_EXTRACT(sla_snapshot, '$.entitlementConsumptionRate')) AS DECIMAL(10,4))
		FROM milestone_cycle_snapshots mcs
		JOIN aims_projects p ON p.id = mcs.project_id
		WHERE `+projectFilter+` AND JSON_EXTRACT(sla_snapshot, '$.entitlementConsumptionRate') IS NOT NULL
		ORDER BY period_end DESC, mcs.id DESC LIMIT 1
	`, projectArgs...).Scan(&entitlement)

	slaRate, slaAvailable := safeHealthRatio(slaMet, tickets)
	backlogRatio, backlogAvailable := safeHealthRatio(inflow, outflow)
	repeatRate, repeatAvailable := safeHealthRatio(repeatedItems, totalItems)
	metrics := []map[string]any{
		serviceHealthMetric("sla", "SLA 达成率", slaRate, slaAvailable, 0.95, 0.90, true),
		serviceHealthMetric("backlog_flow", "积压进出比", backlogRatio, backlogAvailable, 1.0, 1.2, false),
		serviceHealthMetric("repeat_problem", "重复问题率", repeatRate, repeatAvailable, 0.10, 0.20, false),
		serviceHealthMetric("entitlement", "权益消耗率", entitlement.Float64, entitlement.Valid, 0.80, 0.95, false),
	}

	trendRows, err := aimsQueryMaps(ctx, a.DB(), `
		SELECT p.id AS project_id, p.project_code, p.service_period_seq,
		       period_end, total_work_items, carryover_count,
		       JSON_EXTRACT(sla_snapshot, '$.ticketCount') AS sla_ticket_count,
		       JSON_EXTRACT(sla_snapshot, '$.metCount') AS sla_met_count,
		       JSON_EXTRACT(sla_snapshot, '$.entitlementConsumptionRate') AS entitlement_consumption_rate
		FROM milestone_cycle_snapshots mcs
		JOIN aims_projects p ON p.id = mcs.project_id
		WHERE `+projectFilter+`
		ORDER BY period_end ASC, mcs.id ASC
	`, projectArgs...)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"projectId": projectID, "serviceLineCode": nullableText(serviceLine.String),
		"windowDays": 90, "metrics": metrics, "trends": trendRows,
	}, nil
}

func safeHealthRatio(numerator int64, denominator int64) (float64, bool) {
	if denominator <= 0 {
		return 0, false
	}
	return float64(numerator) / float64(denominator), true
}

func serviceHealthMetric(key string, label string, value float64, available bool, good float64, warning float64, higherIsBetter bool) map[string]any {
	status := "unavailable"
	if available {
		if higherIsBetter {
			if value >= good {
				status = "healthy"
			} else if value >= warning {
				status = "warning"
			} else {
				status = "critical"
			}
		} else if value <= good {
			status = "healthy"
		} else if value <= warning {
			status = "warning"
		} else {
			status = "critical"
		}
	}
	return map[string]any{"key": key, "label": label, "value": value, "available": available, "status": status, "goodThreshold": good, "warningThreshold": warning}
}

func projectMilestoneClosePath(path string, suffix string) (string, int64, bool) {
	const prefix = "/v1/aims/projects/"
	const marker = "/milestones/"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", 0, false
	}
	parts := strings.Split(strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix), marker)
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" {
		return "", 0, false
	}
	milestoneID, err := parseID(parts[1], "milestone_id")
	if err != nil {
		return "", 0, false
	}
	return parts[0], milestoneID, true
}

func (a *Adapter) projectMilestoneCloseGate(ctx context.Context, projectID string, milestoneID int64, query url.Values) (map[string]any, error) {
	if err := a.requireProjectReadAccess(ctx, projectID, query); err != nil {
		return nil, err
	}
	parsedProjectID, err := parseID(projectID, "project_id")
	if err != nil {
		return nil, err
	}
	var recurrence string
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COALESCE(recurrence_rule, 'monthly')
		FROM milestones WHERE id = ? AND project_id = ? AND mode = 'periodic'
	`, milestoneID, parsedProjectID).Scan(&recurrence); err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "periodic_milestone_not_found", "periodic milestone not found")
	} else if err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	stats, err := milestoneRolloverStats(ctx, tx, parsedProjectID, milestoneID)
	if err != nil {
		return nil, err
	}
	previewBody := map[string]any{
		"carryoverConfirmed": strings.TrimSpace(query.Get("carryoverConfirmed")),
		"overdueReviewed":    strings.TrimSpace(query.Get("overdueReviewed")),
		"costConfirmed":      strings.TrimSpace(query.Get("costConfirmed")),
		"slaReviewed":        strings.TrimSpace(query.Get("slaReviewed")),
		"reviewCompleted":    strings.TrimSpace(query.Get("reviewCompleted")),
		"reviewExempted":     strings.TrimSpace(query.Get("reviewExempted")),
	}
	gate := evaluatePeriodCloseGate(stats, recurrence, "auto", parsedProjectID, previewBody)
	return map[string]any{
		"projectId": parsedProjectID, "milestoneId": milestoneID, "recurrence": recurrence,
		"gate": gate, "stats": stats,
	}, nil
}

func (a *Adapter) serviceLineHistory(ctx context.Context, lineCode string, query url.Values) (map[string]any, error) {
	lineCode = strings.TrimSpace(lineCode)
	currentUser := strings.TrimSpace(query.Get("current_user"))
	if lineCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_service_line_code", "service line code is required")
	}
	if currentUser == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	visibility, visibilityArgs := projectVisibilityWhere(query, "p", currentUser)
	args := append([]any{lineCode}, visibilityArgs...)
	rows, err := aimsQueryMaps(ctx, a.DB(), `
		SELECT p.id, p.project_code, p.name, p.lifecycle_status,
		       p.service_line_code, p.service_period_seq,
		       DATE_FORMAT(p.service_period_start, '%Y-%m-%d') AS service_period_start,
		       DATE_FORMAT(p.service_period_end, '%Y-%m-%d') AS service_period_end,
		       p.service_period_label,
		       (SELECT COUNT(*) FROM work_items wi WHERE wi.project_id = p.id) AS total_work_items,
		       (SELECT COUNT(*) FROM work_items wi WHERE wi.project_id = p.id AND wi.status = 'completed') AS completed_work_items,
		       (SELECT COALESCE(SUM(te.hours), 0) FROM time_entries te WHERE te.project_id = p.id AND te.review_status = 'approved') AS total_hours,
		       (SELECT COUNT(*) FROM work_item_service_ext wse JOIN work_items wi ON wi.id = wse.work_item_id WHERE wi.project_id = p.id) AS sla_ticket_count,
		       (SELECT COUNT(*) FROM work_item_service_ext wse JOIN work_items wi ON wi.id = wse.work_item_id WHERE wi.project_id = p.id AND wse.sla_status_snapshot = 'met') AS sla_met_count
		FROM aims_projects p
		WHERE p.category = 'maintenance' AND p.service_line_code = ? AND `+visibility+`
		ORDER BY p.service_period_seq ASC, p.service_period_start ASC, p.id ASC
	`, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, httperror.New(http.StatusNotFound, "service_line_not_found", "service line not found or not visible")
	}
	var totalItems, completedItems int64
	var totalHours float64
	var slaTickets, slaMet int64
	for _, row := range rows {
		totalItems += aimsAnyInt64(row["total_work_items"])
		completedItems += aimsAnyInt64(row["completed_work_items"])
		totalHours += aimsAnyFloat(row["total_hours"])
		slaTickets += aimsAnyInt64(row["sla_ticket_count"])
		slaMet += aimsAnyInt64(row["sla_met_count"])
	}
	slaRate := float64(0)
	if slaTickets > 0 {
		slaRate = float64(slaMet) / float64(slaTickets)
	}
	return map[string]any{
		"serviceLineCode": lineCode,
		"items":           rows,
		"cumulative": map[string]any{
			"projectCount": len(rows), "totalWorkItems": totalItems, "completedWorkItems": completedItems,
			"totalHours": totalHours, "slaTicketCount": slaTickets, "slaMetCount": slaMet, "slaAchievementRate": slaRate,
		},
	}, nil
}

func (a *Adapter) routineQuarterReview(ctx context.Context, rawProjectID string, query url.Values) (map[string]any, error) {
	if err := a.requireProjectReadAccess(ctx, rawProjectID, query); err != nil {
		return nil, err
	}
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	var category, deptCode string
	if err := a.DB().QueryRowContext(ctx, "SELECT category, COALESCE(dept_code, '') FROM aims_projects WHERE id = ?", projectID).Scan(&category, &deptCode); err != nil {
		return nil, err
	}
	if category != "routine" {
		return nil, httperror.New(http.StatusBadRequest, "routine_project_required", "quarter review is only available for routine projects")
	}
	periodStart, periodEnd, err := routineReviewPeriod(query)
	if err != nil {
		return nil, err
	}
	var accepted, departmentItems, crossDeptItems, unplannedItems int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*),
		       COALESCE(SUM(routine_scope = 'department'), 0),
		       COALESCE(SUM(routine_scope = 'cross_dept'), 0),
		       COALESCE(SUM(is_unplanned = 1), 0)
		FROM work_items
		WHERE project_id = ? AND DATE(created_at) BETWEEN ? AND ?
	`, projectID, periodStart, periodEnd).Scan(&accepted, &departmentItems, &crossDeptItems, &unplannedItems); err != nil {
		return nil, err
	}
	var totalHours, unplannedHours float64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COALESCE(SUM(te.hours), 0),
		       COALESCE(SUM(CASE WHEN wi.is_unplanned = 1 THEN te.hours ELSE 0 END), 0)
		FROM time_entries te
		JOIN work_items wi ON wi.id = te.work_item_id
		WHERE wi.project_id = ? AND te.entry_date BETWEEN ? AND ? AND te.review_status = 'approved'
	`, projectID, periodStart, periodEnd).Scan(&totalHours, &unplannedHours); err != nil {
		return nil, err
	}
	flowRows, err := a.DB().QueryContext(ctx, `
		SELECT wi.beneficiary_dept_code, COUNT(DISTINCT wi.id), COALESCE(SUM(te.hours), 0)
		FROM work_items wi
		LEFT JOIN time_entries te ON te.work_item_id = wi.id AND te.entry_date BETWEEN ? AND ? AND te.review_status = 'approved'
		WHERE wi.project_id = ? AND wi.routine_scope = 'cross_dept'
		  AND wi.beneficiary_dept_code IS NOT NULL AND wi.beneficiary_dept_code <> ''
		GROUP BY wi.beneficiary_dept_code
		ORDER BY COALESCE(SUM(te.hours), 0) DESC, wi.beneficiary_dept_code ASC
	`, periodStart, periodEnd, projectID)
	if err != nil {
		return nil, err
	}
	defer flowRows.Close()
	flows := make([]map[string]any, 0)
	for flowRows.Next() {
		var beneficiary string
		var itemCount int64
		var hours float64
		if err := flowRows.Scan(&beneficiary, &itemCount, &hours); err != nil {
			return nil, err
		}
		flows = append(flows, map[string]any{"beneficiaryDeptCode": beneficiary, "workItemCount": itemCount, "hours": hours})
	}
	if err := flowRows.Err(); err != nil {
		return nil, err
	}
	unplannedRatio := float64(0)
	if totalHours > 0 {
		unplannedRatio = unplannedHours / totalHours
	}
	return map[string]any{
		"projectId": projectID, "providerDeptCode": deptCode,
		"periodStart": periodStart, "periodEnd": periodEnd,
		"acceptedCount":     accepted,
		"scopeDistribution": map[string]any{"department": departmentItems, "crossDept": crossDeptItems},
		"unplannedCount":    unplannedItems, "totalHours": totalHours, "unplannedHours": unplannedHours,
		"unplannedRatio": unplannedRatio, "crossDepartmentFlows": flows,
	}, nil
}

func routineReviewPeriod(query url.Values) (string, string, error) {
	startText := strings.TrimSpace(firstNonEmptyProjectParam(query, "periodStart", "period_start"))
	endText := strings.TrimSpace(firstNonEmptyProjectParam(query, "periodEnd", "period_end"))
	if startText == "" && endText == "" {
		now := time.Now().UTC()
		month := time.Month(((int(now.Month())-1)/3)*3 + 1)
		start := time.Date(now.Year(), month, 1, 0, 0, 0, 0, time.UTC)
		end := start.AddDate(0, 3, 0).AddDate(0, 0, -1)
		return start.Format("2006-01-02"), end.Format("2006-01-02"), nil
	}
	start, startErr := time.Parse("2006-01-02", startText)
	end, endErr := time.Parse("2006-01-02", endText)
	if startErr != nil || endErr != nil || end.Before(start) {
		return "", "", httperror.New(http.StatusBadRequest, "invalid_review_period", fmt.Sprintf("invalid review period %s to %s", startText, endText))
	}
	return startText, endText, nil
}
