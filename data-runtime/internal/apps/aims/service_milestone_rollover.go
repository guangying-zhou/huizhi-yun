package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type milestoneRolloverPeriod struct {
	start time.Time
	end   time.Time
}

type periodCloseGateCheck struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Passed   bool   `json:"passed"`
	Waived   bool   `json:"waived,omitempty"`
	Required bool   `json:"required"`
	Detail   string `json:"detail"`
	Link     string `json:"link,omitempty"`
}

type periodCloseGateResult struct {
	Passed bool                   `json:"passed"`
	Checks []periodCloseGateCheck `json:"checks"`
}

const milestoneCycleSnapshotInsertSQL = `
	INSERT INTO milestone_cycle_snapshots (
	  project_id, source_milestone_id, next_milestone_id, template_key,
	  period_start, period_end, carryover_mode, completed_count,
	  carryover_count, total_work_items, total_hours, gate_result, gate_passed,
	  exception_reason, exception_owner_uid, exception_due_date, confirmed_by, confirmed_at,
	  sla_snapshot, period_cost, idempotency_key,
	  source_app, source_biz_type, source_biz_code, request_id,
	  actor_uid, service_client_id
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, 'aims', 'milestone_rollover', ?, ?, ?, ?)
	ON DUPLICATE KEY UPDATE
	  next_milestone_id = VALUES(next_milestone_id),
	  completed_count = VALUES(completed_count),
	  carryover_count = VALUES(carryover_count),
	  total_work_items = VALUES(total_work_items),
	  total_hours = VALUES(total_hours),
	  gate_result = VALUES(gate_result),
	  gate_passed = VALUES(gate_passed),
	  exception_reason = VALUES(exception_reason),
	  exception_owner_uid = VALUES(exception_owner_uid),
	  exception_due_date = VALUES(exception_due_date),
	  confirmed_by = VALUES(confirmed_by),
	  confirmed_at = VALUES(confirmed_at),
	  sla_snapshot = VALUES(sla_snapshot),
	  period_cost = VALUES(period_cost),
	  actor_uid = VALUES(actor_uid),
	  updated_at = CURRENT_TIMESTAMP
`

const carryoverWorkItemsSQL = `
	UPDATE work_items
	SET carryover_origin_item_key = COALESCE(carryover_origin_item_key, item_key),
	    carryover_origin_milestone_id = COALESCE(carryover_origin_milestone_id, milestone_id),
	    carryover_count = carryover_count + 1,
	    carryover_governance_abnormal = IF(carryover_count + 1 >= 3, 1, carryover_governance_abnormal),
	    milestone_id = ?,
	    updated_at = CURRENT_TIMESTAMP
	WHERE project_id = ?
	  AND milestone_id = ?
	  AND status <> 'completed'
`

func serviceMilestoneRolloverPath(path string) (string, int64, bool) {
	const prefix = "/v1/aims/service/projects/"
	const marker = "/milestones/"
	const suffix = ":rollover"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", 0, false
	}
	body := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	parts := strings.Split(body, marker)
	if len(parts) != 2 {
		return "", 0, false
	}
	projectCode, err := url.PathUnescape(parts[0])
	if err != nil {
		return "", 0, false
	}
	milestoneID, err := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
	if err != nil || milestoneID <= 0 {
		return "", 0, false
	}
	return projectCode, milestoneID, true
}

func (a *Adapter) rolloverDueProjectMilestones(ctx context.Context, body map[string]any) (map[string]any, error) {
	limit := serviceBodyInt(body, "limit")
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := aimsQueryMaps(ctx, a.DB(), `
		SELECT p.project_code, m.id AS milestone_id
		FROM milestones m
		INNER JOIN aims_projects p ON p.id = m.project_id
		WHERE m.mode = 'periodic'
		  AND m.status IN ('active', 'todo')
		  AND m.end_date IS NOT NULL
		  AND m.end_date <= CURDATE()
		  AND p.lifecycle_status <> 'archived'
		ORDER BY m.end_date ASC, m.id ASC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}

	results := make([]map[string]any, 0, len(rows))
	pending := make([]map[string]any, 0)
	failures := make([]map[string]any, 0)
	for _, row := range rows {
		projectCode := strings.TrimSpace(fmt.Sprint(row["project_code"]))
		milestoneID, err := int64MapValue(row, "milestone_id")
		if err != nil {
			failures = append(failures, map[string]any{"projectCode": projectCode, "error": err.Error()})
			continue
		}
		result, err := a.rolloverProjectMilestone(ctx, projectCode, milestoneID, map[string]any{
			"carryover":       firstBodyText(body, "carryover", "carryoverMode", "carryover_mode"),
			"operator_uid":    firstNonEmptyText(firstBodyText(body, "operator_uid", "operatorUid"), "system"),
			"review_exempted": true, // 月度扫描默认采用轻量复盘豁免；季度/年度仍不可豁免。
			"scheduled":       true,
		})
		if err != nil {
			failures = append(failures, map[string]any{
				"projectCode": projectCode,
				"milestoneId": milestoneID,
				"error":       err.Error(),
			})
			continue
		}
		if bodyBool(result, "pending") {
			pending = append(pending, result)
			continue
		}
		results = append(results, result)
	}
	return map[string]any{
		"scanned":      len(rows),
		"rolled_over":  len(results),
		"pending":      len(pending),
		"failed":       len(failures),
		"items":        results,
		"pendingItems": pending,
		"failures":     failures,
	}, nil
}

func (a *Adapter) rolloverProjectMilestone(ctx context.Context, projectCode string, milestoneID int64, body map[string]any) (map[string]any, error) {
	projectCode = strings.TrimSpace(projectCode)
	if projectCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_project_code", "projectCode is required")
	}
	if milestoneID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_milestone_id", "milestoneId must be a positive integer")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	result, err := rolloverProjectMilestoneTx(ctx, tx, projectCode, milestoneID, body)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func rolloverProjectMilestoneTx(ctx context.Context, tx *sql.Tx, projectCode string, milestoneID int64, body map[string]any) (map[string]any, error) {
	row, err := aimsQueryOneMap(ctx, tx, `
		SELECT
		  p.id AS project_id,
		  p.project_code,
		  p.name AS project_name,
		  p.leader_uid,
		  m.id AS milestone_id,
		  m.name,
		  m.description,
		  m.mode,
		  DATE_FORMAT(m.start_date, '%Y-%m-%d') AS start_date,
		  DATE_FORMAT(m.end_date, '%Y-%m-%d') AS end_date,
		  m.status,
		  m.completion_lock_request_id,
		  m.pivr_stage,
		  m.template_key,
		  m.recurrence_rule,
		  m.sort_order
		FROM milestones m
		INNER JOIN aims_projects p ON p.id = m.project_id
		WHERE p.project_code = ?
		  AND p.lifecycle_status <> 'archived'
		  AND m.id = ?
		LIMIT 1
		FOR UPDATE
	`, projectCode, milestoneID)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, httperror.New(http.StatusNotFound, "milestone_not_found", "milestone not found")
	}
	if aimsAnyInt64(row["completion_lock_request_id"]) > 0 {
		return nil, httperror.New(http.StatusLocked, "milestone_completion_request_locked", "里程碑完成审批期间不可关期")
	}
	mode := strings.TrimSpace(fmt.Sprint(row["mode"]))
	if mode != "periodic" {
		return nil, httperror.New(http.StatusConflict, "milestone_not_periodic", "only periodic milestones can rollover")
	}
	templateKey := strings.TrimSpace(fmt.Sprint(row["template_key"]))
	if templateKey == "" || templateKey == "<nil>" {
		return nil, httperror.New(http.StatusBadRequest, "missing_template_key", "periodic milestone templateKey is required")
	}
	projectID, err := int64MapValue(row, "project_id")
	if err != nil {
		return nil, err
	}

	currentStart := aimsParsePeriodDate(fmt.Sprint(row["start_date"]))
	currentEnd := aimsParsePeriodDate(fmt.Sprint(row["end_date"]))
	recurrence := firstNonEmptyText(aimsMapText(row, "recurrence_rule"), "monthly")
	nextPeriod := milestoneNextRolloverPeriod(currentStart, currentEnd, recurrence, body)
	nextStartText := nextPeriod.start.Format("2006-01-02")
	nextEndText := nextPeriod.end.Format("2006-01-02")
	carryoverMode := strings.ToLower(firstNonEmptyText(firstBodyText(body, "carryover", "carryoverMode", "carryover_mode"), "auto"))
	if carryoverMode != "auto" && carryoverMode != "manual" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_carryover_mode", "carryover must be auto or manual")
	}
	idempotencyKey := firstNonEmptyText(
		firstBodyText(body, "idempotencyKey", "idempotency_key"),
		fmt.Sprintf("aims:milestone:%s:%s:%s:rollover:v1", projectCode, templateKey, nextStartText),
	)

	replayedSnapshot, err := aimsQueryOneMap(ctx, tx, `
		SELECT * FROM milestone_cycle_snapshots
		WHERE idempotency_key = ?
		LIMIT 1 FOR UPDATE
	`, idempotencyKey)
	if err != nil {
		return nil, err
	}
	if replayedSnapshot != nil {
		nextMilestone, err := aimsQueryOneMap(ctx, tx, "SELECT * FROM milestones WHERE id = ? LIMIT 1", replayedSnapshot["next_milestone_id"])
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"projectCode": projectCode, "milestoneId": milestoneID,
			"nextMilestone": nextMilestone, "snapshot": replayedSnapshot,
			"idempotencyKey": idempotencyKey, "created": false, "idempotent": true,
		}, nil
	}

	existing, err := aimsQueryOneMap(ctx, tx, `
		SELECT *
		FROM milestones
		WHERE project_id = ?
		  AND template_key = ?
		  AND start_date = ?
		ORDER BY id ASC
		LIMIT 1
		FOR UPDATE
	`, projectID, templateKey, nextStartText)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		snapshot, snapshotErr := aimsQueryOneMap(ctx, tx, `
			SELECT * FROM milestone_cycle_snapshots
			WHERE source_milestone_id = ? AND next_milestone_id = ?
			ORDER BY id ASC LIMIT 1
		`, milestoneID, existing["id"])
		if snapshotErr != nil {
			return nil, snapshotErr
		}
		return map[string]any{
			"projectCode":   projectCode,
			"milestoneId":   milestoneID,
			"nextMilestone": existing,
			"snapshot":      snapshot,
			"created":       false,
			"idempotent":    true,
		}, nil
	}

	status := strings.TrimSpace(fmt.Sprint(row["status"]))
	if status == "completed" {
		return nil, httperror.New(http.StatusConflict, "milestone_already_completed", "milestone is already completed and no next period exists")
	}
	if !bodyBool(body, "manualConfirmed", "manual_confirmed", "confirmed", "force") && !milestoneDue(currentEnd) {
		return nil, httperror.New(http.StatusConflict, "milestone_not_due", "periodic milestone is not due")
	}

	stats, err := milestoneRolloverStats(ctx, tx, projectID, milestoneID)
	if err != nil {
		return nil, err
	}
	gate := evaluatePeriodCloseGate(stats, recurrence, carryoverMode, projectID, body)
	exceptionReason := strings.TrimSpace(firstBodyText(body, "exceptionReason", "exception_reason"))
	exceptionOwner := strings.TrimSpace(firstBodyText(body, "exceptionOwnerUid", "exception_owner_uid"))
	exceptionDue := strings.TrimSpace(firstBodyText(body, "exceptionDueDate", "exception_due_date"))
	hasExceptionField, hasCompleteException, err := validatePeriodCloseExceptionFields(exceptionReason, exceptionOwner, exceptionDue)
	if err != nil {
		return nil, err
	}
	if !gate.Passed {
		if bodyBool(body, "scheduled") && !hasExceptionField {
			return map[string]any{
				"projectCode": projectCode, "milestoneId": milestoneID,
				"pending": true, "todoType": "period_close_gate", "assigneeUid": aimsMapText(row, "leader_uid"),
				"gate": gate, "failedChecks": failedPeriodCloseGateKeys(gate),
			}, nil
		}
		if !hasCompleteException {
			return nil, httperror.New(http.StatusConflict, "period_close_gate_failed", "period close gate failed: "+strings.Join(failedPeriodCloseGateKeys(gate), ", "))
		}
		if !periodCloseGateExceptionAllowed(gate, recurrence) {
			return nil, httperror.New(http.StatusConflict, "period_review_not_waivable", "quarterly and annual review confirmation cannot be waived")
		}
	}
	carryoverCount := int64(0)
	if carryoverMode == "auto" {
		carryoverCount = aimsAnyInt64(stats["incomplete_count"])
	}
	actor := firstNonEmptyText(firstBodyText(body, "operator_uid", "operatorUid", "current_user"), aimsMapText(row, "leader_uid"), "system")
	nextName := milestonePeriodName(nextPeriod.start, recurrence)

	insert, err := tx.ExecContext(ctx, `
		INSERT INTO milestones (
		  project_id, name, description, mode, start_date, end_date, status,
		  pivr_stage, template_key, recurrence_rule, sort_order, created_by
		) VALUES (?, ?, ?, 'periodic', ?, ?, 'active', ?, ?, ?, ?, ?)
	`, projectID, nextName, nullableText(aimsMapText(row, "description")), nextStartText, nextEndText, nullableText(aimsMapText(row, "pivr_stage")), templateKey, nullableText(recurrence), row["sort_order"], actor)
	if err != nil {
		return nil, err
	}
	nextMilestoneID, err := insert.LastInsertId()
	if err != nil {
		return nil, err
	}

	if carryoverMode == "auto" {
		if _, err := tx.ExecContext(ctx, carryoverWorkItemsSQL, nextMilestoneID, projectID, milestoneID); err != nil {
			return nil, err
		}
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE milestones
		SET status = 'completed',
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, milestoneID); err != nil {
		return nil, err
	}

	gateJSON, _ := json.Marshal(gate)
	slaSnapshot := map[string]any{
		"ticketCount": aimsAnyInt64(stats["sla_ticket_count"]),
		"metCount":    aimsAnyInt64(stats["sla_met_count"]),
		"reviewed":    bodyBool(body, "slaReviewed", "sla_reviewed"),
	}
	if rate := optionalBodyFloat(body, "entitlementConsumptionRate", "entitlement_consumption_rate"); rate != nil && *rate >= 0 {
		slaSnapshot["entitlementConsumptionRate"] = *rate
	}
	slaSnapshotJSON, _ := json.Marshal(slaSnapshot)
	periodCost := optionalBodyFloat(body, "periodCost", "period_cost")
	if periodCost == nil && aimsAnyInt64(stats["period_cost_summary_count"]) > 0 {
		value := aimsAnyFloat(stats["period_cost"])
		periodCost = &value
	}
	sourceBizCode := fmt.Sprintf("%s:%d:%s", projectCode, milestoneID, nextStartText)
	if _, err := tx.ExecContext(ctx, milestoneCycleSnapshotInsertSQL, projectID, milestoneID, nextMilestoneID, templateKey, nextStartText, nextEndText, carryoverMode,
		aimsAnyInt64(stats["completed_count"]), carryoverCount, aimsAnyInt64(stats["total_count"]), aimsAnyFloat(stats["total_hours"]),
		string(gateJSON), boolToInt(gate.Passed), nullableText(exceptionReason), nullableText(exceptionOwner), nullableText(exceptionDue), nullableText(actor),
		string(slaSnapshotJSON), nullableFloatValue(periodCost), idempotencyKey,
		sourceBizCode, nullableText(firstBodyText(body, "request_id", "requestId")), nullableText(actor), nullableText(firstBodyText(body, "service_client_id", "serviceClientId"))); err != nil {
		return nil, err
	}

	nextMilestone, err := aimsQueryOneMap(ctx, tx, "SELECT * FROM milestones WHERE id = ? LIMIT 1", nextMilestoneID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"projectCode":   projectCode,
		"milestoneId":   milestoneID,
		"nextMilestone": nextMilestone,
		"stats": map[string]any{
			"completedCount": aimsAnyInt64(stats["completed_count"]),
			"carryoverCount": carryoverCount,
			"totalWorkItems": aimsAnyInt64(stats["total_count"]),
			"totalHours":     aimsAnyFloat(stats["total_hours"]),
			"periodStart":    nextStartText,
			"periodEnd":      nextEndText,
		},
		"carryover":      carryoverMode,
		"gate":           gate,
		"idempotencyKey": idempotencyKey,
		"created":        true,
		"idempotent":     false,
	}, nil
}

func milestoneRolloverStats(ctx context.Context, tx *sql.Tx, projectID int64, milestoneID int64) (map[string]any, error) {
	stats, err := aimsQueryOneMap(ctx, tx, `
		SELECT
		  COUNT(*) AS total_count,
		  COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count,
		  COALESCE(SUM(CASE WHEN status <> 'completed' THEN 1 ELSE 0 END), 0) AS incomplete_count,
		  COALESCE(SUM(CASE WHEN status <> 'completed' AND (assignee_uid IS NULL OR assignee_uid = '' OR due_date IS NULL) THEN 1 ELSE 0 END), 0) AS hanging_count,
		  COALESCE(SUM(CASE WHEN status <> 'completed' AND due_date IS NOT NULL AND due_date < CURDATE() THEN 1 ELSE 0 END), 0) AS overdue_count,
		  COALESCE((
		    SELECT SUM(te.hours)
		    FROM time_entries te
		    INNER JOIN work_items twi ON twi.id = te.work_item_id
		    WHERE twi.project_id = ?
		      AND twi.milestone_id = ?
		      AND te.weekly_report_id IS NULL
		  ), 0) AS total_hours,
		  COALESCE((
		    SELECT COUNT(*)
		    FROM time_entries ute
		    INNER JOIN work_items uwi ON uwi.id = ute.work_item_id
		    WHERE uwi.project_id = ? AND uwi.milestone_id = ?
		      AND ute.review_status <> 'approved'
		  ), 0) AS unconfirmed_time_count,
		  COALESCE(SUM(CASE WHEN wse.source_ticket_code IS NOT NULL THEN 1 ELSE 0 END), 0) AS sla_ticket_count,
		  COALESCE(SUM(CASE WHEN wse.sla_status_snapshot = 'met' THEN 1 ELSE 0 END), 0) AS sla_met_count,
		  COALESCE(SUM(CASE WHEN wse.source_ticket_code IS NOT NULL AND status <> 'completed' AND wse.resolution_due_at < CURRENT_TIMESTAMP THEN 1 ELSE 0 END), 0) AS overdue_ticket_count
		FROM work_items wi
		LEFT JOIN work_item_service_ext wse ON wse.work_item_id = wi.id
		WHERE wi.project_id = ?
		  AND wi.milestone_id = ?
	`, projectID, milestoneID, projectID, milestoneID, projectID, milestoneID)
	if err != nil {
		return nil, err
	}
	var periodCostSummaryCount int64
	var periodCost float64
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(MAX(pcs.total_cost), 0)
		FROM project_cost_summary pcs
		JOIN aims_projects p ON p.project_code = pcs.project_code
		JOIN milestones m ON m.project_id = p.id
		WHERE p.id = ? AND m.id = ?
		  AND pcs.period_start = m.start_date AND pcs.period_end = m.end_date
		  AND pcs.is_current = 1 AND pcs.deleted_at IS NULL
	`, projectID, milestoneID).Scan(&periodCostSummaryCount, &periodCost); err != nil {
		return nil, err
	}
	stats["period_cost_summary_count"] = periodCostSummaryCount
	stats["period_cost"] = periodCost
	return stats, nil
}

func evaluatePeriodCloseGate(stats map[string]any, recurrence string, carryoverMode string, projectID int64, body map[string]any) periodCloseGateResult {
	incomplete := aimsAnyInt64(stats["incomplete_count"])
	hanging := aimsAnyInt64(stats["hanging_count"])
	overdue := aimsAnyInt64(stats["overdue_count"]) + aimsAnyInt64(stats["overdue_ticket_count"])
	unconfirmedTime := aimsAnyInt64(stats["unconfirmed_time_count"])
	slaTickets := aimsAnyInt64(stats["sla_ticket_count"])

	terminalPassed := incomplete == 0 || carryoverMode == "auto" || bodyBool(body, "carryoverConfirmed", "carryover_confirmed")
	overduePassed := overdue == 0 || bodyBool(body, "overdueReviewed", "overdue_reviewed")
	hasCostSummary := aimsAnyInt64(stats["period_cost_summary_count"]) > 0
	timePassed := unconfirmedTime == 0 && (aimsAnyFloat(stats["total_hours"]) == 0 || hasCostSummary || bodyBool(body, "costConfirmed", "cost_confirmed"))
	slaPassed := slaTickets == 0 || bodyBool(body, "slaReviewed", "sla_reviewed")
	reviewPassed := bodyBool(body, "reviewCompleted", "review_completed", "customerConfirmed", "customer_confirmed")
	reviewWaived := false
	if !reviewPassed && isMonthlyMilestoneRecurrence(recurrence) && bodyBool(body, "reviewExempted", "review_exempted") {
		reviewPassed = true
		reviewWaived = true
	}

	checks := []periodCloseGateCheck{
		{Key: "terminal_or_carryover", Label: "工单完结或显式结转", Passed: terminalPassed, Required: true, Detail: fmt.Sprintf("未完结 %d 项，悬空 %d 项", incomplete, hanging), Link: fmt.Sprintf("/projects/%d/service-desk?status=open", projectID)},
		{Key: "overdue_remediation", Label: "超时与高优先级补救", Passed: overduePassed, Required: true, Detail: fmt.Sprintf("待解释超时 %d 项", overdue), Link: fmt.Sprintf("/projects/%d/service-desk?slaStatus=breached", projectID)},
		{Key: "time_and_cost", Label: "工时确认与成本归集", Passed: timePassed, Required: true, Detail: fmt.Sprintf("未确认工时记录 %d 条，成本快照 %d 份", unconfirmedTime, aimsAnyInt64(stats["period_cost_summary_count"])), Link: fmt.Sprintf("/projects/%d/timesheet", projectID)},
		{Key: "sla_review", Label: "SLA 复核", Passed: slaPassed, Required: true, Detail: fmt.Sprintf("SLA 工单 %d 项", slaTickets), Link: fmt.Sprintf("/projects/%d/service-desk", projectID)},
		{Key: "period_review", Label: "周期复盘与客户确认", Passed: reviewPassed, Waived: reviewWaived, Required: true, Detail: periodCloseReviewDetail(recurrence, reviewWaived), Link: fmt.Sprintf("/projects/%d/weekly-reports", projectID)},
	}
	passed := true
	for _, check := range checks {
		if check.Required && !check.Passed {
			passed = false
		}
	}
	return periodCloseGateResult{Passed: passed, Checks: checks}
}

func failedPeriodCloseGateKeys(gate periodCloseGateResult) []string {
	keys := make([]string, 0)
	for _, check := range gate.Checks {
		if check.Required && !check.Passed {
			keys = append(keys, check.Key)
		}
	}
	return keys
}

func validPeriodCloseExceptionDate(value string) bool {
	_, err := time.Parse("2006-01-02", strings.TrimSpace(value))
	return err == nil
}

func validatePeriodCloseExceptionFields(reason string, owner string, due string) (bool, bool, error) {
	hasAny := strings.TrimSpace(reason) != "" || strings.TrimSpace(owner) != "" || strings.TrimSpace(due) != ""
	if !hasAny {
		return false, false, nil
	}
	complete := strings.TrimSpace(reason) != "" && strings.TrimSpace(owner) != "" && validPeriodCloseExceptionDate(due)
	if !complete {
		return true, false, httperror.New(http.StatusBadRequest, "incomplete_close_exception", "exceptionReason, exceptionOwnerUid and a valid exceptionDueDate are all required")
	}
	return true, true, nil
}

func periodCloseGateExceptionAllowed(gate periodCloseGateResult, recurrence string) bool {
	if isMonthlyMilestoneRecurrence(recurrence) {
		return true
	}
	for _, check := range gate.Checks {
		if check.Key == "period_review" && !check.Passed {
			return false
		}
	}
	return true
}

func isMonthlyMilestoneRecurrence(recurrence string) bool {
	normalized := strings.ToLower(strings.TrimSpace(recurrence))
	return !strings.Contains(normalized, "week") && !strings.Contains(normalized, "quarter") && !strings.Contains(normalized, "year") && !strings.Contains(normalized, "annual")
}

func periodCloseReviewDetail(recurrence string, waived bool) string {
	if waived {
		return "月度复盘已登记豁免"
	}
	if isMonthlyMilestoneRecurrence(recurrence) {
		return "月度复盘可登记豁免"
	}
	return "季度/年度复盘不可豁免"
}

func aimsMapText(row map[string]any, key string) string {
	value := row[key]
	if value == nil {
		return ""
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "<nil>" {
		return ""
	}
	return text
}

func aimsParsePeriodDate(value string) time.Time {
	value = strings.TrimSpace(value)
	if len(value) >= 10 {
		if parsed, err := time.Parse("2006-01-02", value[:10]); err == nil {
			return parsed
		}
	}
	return time.Time{}
}

func milestoneDue(end time.Time) bool {
	if end.IsZero() {
		return false
	}
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	return !end.After(today)
}

func milestoneNextRolloverPeriod(start time.Time, end time.Time, recurrence string, body map[string]any) milestoneRolloverPeriod {
	nextStart := aimsParsePeriodDate(firstBodyText(body, "periodStart", "period_start"))
	if nextStart.IsZero() {
		switch {
		case !end.IsZero():
			nextStart = end.AddDate(0, 0, 1)
		case !start.IsZero():
			nextStart = addMilestonePeriod(start, recurrence)
		default:
			now := time.Now()
			nextStart = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		}
	}
	nextEnd := aimsParsePeriodDate(firstBodyText(body, "periodEnd", "period_end"))
	if nextEnd.IsZero() {
		nextEnd = addMilestonePeriod(nextStart, recurrence).AddDate(0, 0, -1)
	}
	return milestoneRolloverPeriod{start: nextStart, end: nextEnd}
}

func addMilestonePeriod(start time.Time, recurrence string) time.Time {
	normalized := strings.ToLower(strings.TrimSpace(recurrence))
	switch {
	case strings.Contains(normalized, "week"):
		return start.AddDate(0, 0, 7)
	case strings.Contains(normalized, "quarter"):
		return start.AddDate(0, 3, 0)
	case strings.Contains(normalized, "year") || strings.Contains(normalized, "annual"):
		return start.AddDate(1, 0, 0)
	default:
		return start.AddDate(0, 1, 0)
	}
}

func milestonePeriodName(start time.Time, recurrence string) string {
	normalized := strings.ToLower(strings.TrimSpace(recurrence))
	switch {
	case strings.Contains(normalized, "week"):
		year, week := start.ISOWeek()
		return fmt.Sprintf("%04d-W%02d 周度运维", year, week)
	case strings.Contains(normalized, "quarter"):
		quarter := (int(start.Month())-1)/3 + 1
		return fmt.Sprintf("%04d-Q%d 季度运维", start.Year(), quarter)
	case strings.Contains(normalized, "year") || strings.Contains(normalized, "annual"):
		return fmt.Sprintf("%04d 年度运维", start.Year())
	default:
		return fmt.Sprintf("%04d-%02d 月度运维", start.Year(), int(start.Month()))
	}
}
