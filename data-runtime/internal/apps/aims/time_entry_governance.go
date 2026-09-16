package aims

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleTimeEntryGovernanceRuntime(
	ctx context.Context,
	method string,
	path string,
	query url.Values,
	body map[string]any,
) (any, string, bool, error) {
	if periodKey, ok := timesheetWeekSubmitPath(path); ok {
		if method != http.MethodPost {
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
		data, err := a.submitTimesheetWeek(ctx, periodKey, query, body)
		return data, "aims.timesheet.week.submit", true, err
	}
	if projectID, ok := pathParam(path, "/v1/aims/projects/", "/time-entry-reviews"); ok {
		switch method {
		case http.MethodGet:
			data, err := a.listProjectTimeEntryReviews(ctx, projectID, query)
			return data, "aims.projects.time_entry_reviews.list", true, err
		case http.MethodPost:
			data, err := a.reviewProjectTimeEntries(ctx, projectID, query, body)
			return data, "aims.projects.time_entry_reviews.review", true, err
		default:
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
	}
	return nil, "", false, nil
}

func (a *Adapter) submitTimesheetWeek(
	ctx context.Context,
	periodKey string,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	if !truthyQuery(query, "current_user_can_submit_timesheet", "currentUserCanSubmitTimesheet") {
		return nil, httperror.New(http.StatusForbidden, "timesheet_submit_permission_required", "timesheet submit permission required")
	}
	actor := currentUserFrom(query, body)
	if actor == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if _, _, err := parseISOPeriodKey(periodKey); err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var periodID int64
	var weekStart, weekEnd time.Time
	var periodTimezone string
	err = tx.QueryRowContext(ctx, `
		SELECT id, week_start, week_end, timezone
		FROM weekly_reporting_periods
		WHERE period_key = ?
		FOR UPDATE
	`, periodKey).Scan(&periodID, &weekStart, &weekEnd, &periodTimezone)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusConflict, "weekly_reporting_period_required", "weekly reporting period is required")
	}
	if err != nil {
		return nil, err
	}
	location, err := time.LoadLocation(periodTimezone)
	if err != nil {
		return nil, httperror.New(http.StatusConflict, "invalid_period_timezone", "weekly reporting period timezone is invalid")
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT id, project_id, entry_date, review_status
		FROM time_entries
		WHERE uid = ?
		  AND entry_date BETWEEN DATE(?) AND DATE(?)
		  AND review_status IN ('draft','returned')
		ORDER BY entry_date, id
		FOR UPDATE
	`, actor, weekStart, weekEnd)
	if err != nil {
		return nil, err
	}
	type candidate struct {
		id        int64
		projectID int64
		entryDate time.Time
		from      string
	}
	candidates := make([]candidate, 0)
	for rows.Next() {
		var item candidate
		if err := rows.Scan(&item.id, &item.projectID, &item.entryDate, &item.from); err != nil {
			rows.Close()
			return nil, err
		}
		candidates = append(candidates, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return nil, httperror.New(http.StatusConflict, "timesheet_week_has_no_editable_entries", "timesheet week has no draft or returned entries")
	}

	managerRouteCount := 0
	summaryRouteCount := 0
	entryIDs := make([]int64, 0, len(candidates))
	for _, item := range candidates {
		responsibleUID, err := projectResponsibleUIDAtDate(ctx, tx, item.projectID, item.entryDate, location)
		if err != nil {
			return nil, err
		}
		route := "project_manager"
		reviewerUID := responsibleUID
		if responsibleUID == actor {
			route = "company_summary"
			reviewerUID = ""
			summaryRouteCount++
		} else {
			managerRouteCount++
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE time_entries
			SET review_status = 'submitted',
			    review_route = ?,
			    reviewer_uid_snapshot = ?,
			    locked_report_version_id = NULL,
			    row_version = row_version + 1,
			    submitted_at = UTC_TIMESTAMP(6),
			    reviewed_by = NULL,
			    reviewed_at = NULL,
			    return_reason = NULL
			WHERE id = ? AND review_status = ?
		`, route, nullableText(reviewerUID), item.id, item.from); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO time_entry_review_events (
			  time_entry_id, from_status, to_status, actor_uid, reason
			) VALUES (?, ?, 'submitted', ?, ?)
		`, item.id, item.from, actor, "timesheet_week_submit:"+periodKey); err != nil {
			return nil, err
		}
		entryIDs = append(entryIDs, item.id)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"periodId":          periodID,
		"periodKey":         periodKey,
		"entryIds":          entryIDs,
		"submittedCount":    len(entryIDs),
		"managerRouteCount": managerRouteCount,
		"summaryRouteCount": summaryRouteCount,
	}, nil
}

func (a *Adapter) listProjectTimeEntryReviews(
	ctx context.Context,
	rawProjectID string,
	query url.Values,
) (map[string]any, error) {
	if !truthyQuery(
		query,
		"current_user_can_approve_timesheet",
		"currentUserCanApproveTimesheet",
		"current_user_can_review_assigned_timesheet",
		"currentUserCanReviewAssignedTimesheet",
	) {
		return nil, httperror.New(http.StatusForbidden, "timesheet_approve_permission_required", "timesheet approve permission required")
	}
	actor := strings.TrimSpace(query.Get("current_user"))
	if actor == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	periodKey := firstQueryText(query, "periodKey", "period_key")
	if _, _, err := parseISOPeriodKey(periodKey); err != nil {
		return nil, err
	}
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
		  entry.id,
		  entry.uid,
		  DATE_FORMAT(entry.entry_date, '%Y-%m-%d'),
		  CAST(entry.hours AS CHAR),
		  entry.description,
		  work_item.item_key,
		  work_item.title,
		  entry.review_status,
		  entry.review_route,
		  entry.reviewer_uid_snapshot,
		  entry.row_version,
		  DATE_FORMAT(entry.submitted_at, '%Y-%m-%dT%H:%i:%s.%fZ')
		FROM time_entries entry
		LEFT JOIN work_items work_item ON work_item.id = entry.work_item_id
		INNER JOIN weekly_reporting_periods period
		  ON period.period_key = ?
		 AND entry.entry_date BETWEEN DATE(period.week_start) AND DATE(period.week_end)
		WHERE entry.project_id = ?
		  AND entry.review_route = 'project_manager'
		  AND entry.reviewer_uid_snapshot = ?
		  AND entry.review_status IN ('submitted','approved','returned')
		ORDER BY entry.review_status = 'submitted' DESC, entry.entry_date, entry.id
	`, periodKey, projectID, actor)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var uid, entryDate, hours, status, route, reviewer string
		var description, itemKey, itemTitle, submittedAt sql.NullString
		var rowVersion int64
		if err := rows.Scan(
			&id, &uid, &entryDate, &hours, &description, &itemKey, &itemTitle, &status, &route,
			&reviewer, &rowVersion, &submittedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id":           id,
			"uid":          uid,
			"entryDate":    entryDate,
			"hours":        hours,
			"description":  nullableJSONText(description),
			"itemKey":      nullableJSONText(itemKey),
			"itemTitle":    nullableJSONText(itemTitle),
			"reviewStatus": status,
			"reviewRoute":  route,
			"reviewerUid":  reviewer,
			"rowVersion":   rowVersion,
			"submittedAt":  nullableJSONText(submittedAt),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"periodKey": periodKey, "items": items, "total": len(items)}, nil
}

func (a *Adapter) reviewProjectTimeEntries(
	ctx context.Context,
	rawProjectID string,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	if !truthyQuery(
		query,
		"current_user_can_approve_timesheet",
		"currentUserCanApproveTimesheet",
		"current_user_can_review_assigned_timesheet",
		"currentUserCanReviewAssignedTimesheet",
	) {
		return nil, httperror.New(http.StatusForbidden, "timesheet_approve_permission_required", "timesheet approve permission required")
	}
	actor := currentUserFrom(query, body)
	if actor == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	action := firstBodyText(body, "action")
	if action != "approve" && action != "return" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_time_review_action", "action must be approve or return")
	}
	reason := firstBodyText(body, "reason", "returnReason", "return_reason")
	if action == "return" && reason == "" {
		return nil, httperror.New(http.StatusBadRequest, "time_return_reason_required", "return reason is required")
	}
	entryIDs, err := uniqueBodyIDs(body, "entryIds", "entry_ids")
	if err != nil || len(entryIDs) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "time_entry_ids_required", "entryIds is required")
	}

	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	updated := make([]int64, 0, len(entryIDs))
	nextStatus := "approved"
	if action == "return" {
		nextStatus = "returned"
	}
	for _, entryID := range entryIDs {
		var entryProjectID int64
		var reviewerUID, fromStatus string
		err := tx.QueryRowContext(ctx, `
			SELECT project_id, reviewer_uid_snapshot, review_status
			FROM time_entries
			WHERE id = ?
			FOR UPDATE
		`, entryID).Scan(&entryProjectID, &reviewerUID, &fromStatus)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, httperror.New(http.StatusNotFound, "time_entry_not_found", "time entry not found")
		}
		if err != nil {
			return nil, err
		}
		if entryProjectID != projectID || reviewerUID != actor || fromStatus != "submitted" {
			return nil, httperror.New(http.StatusConflict, "time_entry_not_reviewable", "time entry is not assigned to the current reviewer")
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE time_entries
			SET review_status = ?,
			    row_version = row_version + 1,
			    reviewed_by = ?,
			    reviewed_at = UTC_TIMESTAMP(6),
			    return_reason = ?
			WHERE id = ? AND review_status = 'submitted'
		`, nextStatus, actor, nullableText(reason), entryID); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO time_entry_review_events (
			  time_entry_id, from_status, to_status, actor_uid, reason
			) VALUES (?, 'submitted', ?, ?, ?)
		`, entryID, nextStatus, actor, nullableText(reason)); err != nil {
			return nil, err
		}
		updated = append(updated, entryID)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"action": action, "entryIds": updated, "updatedCount": len(updated)}, nil
}

func projectResponsibleUIDAtDate(
	ctx context.Context,
	tx *sql.Tx,
	projectID int64,
	entryDate time.Time,
	location *time.Location,
) (string, error) {
	startLocal := time.Date(entryDate.Year(), entryDate.Month(), entryDate.Day(), 0, 0, 0, 0, location)
	start := startLocal.UTC()
	end := startLocal.AddDate(0, 0, 1).UTC()
	var responsibleUID string
	err := tx.QueryRowContext(ctx, `
		SELECT COALESCE((
		  SELECT delegation.delegate_uid
		  FROM project_manager_delegations delegation
		  WHERE delegation.project_id = project.id
		    AND delegation.revoked_at IS NULL
		    AND delegation.starts_at < ?
		    AND delegation.ends_at > ?
		  ORDER BY delegation.starts_at DESC, delegation.id DESC
		  LIMIT 1
		), project.leader_uid)
		FROM aims_projects project
		WHERE project.id = ?
	`, end, start, projectID).Scan(&responsibleUID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", httperror.New(http.StatusNotFound, "project_not_found", "project not found")
	}
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(responsibleUID) == "" {
		return "", httperror.New(http.StatusConflict, "project_manager_required", "project manager is required")
	}
	return responsibleUID, nil
}

func timesheetWeekSubmitPath(path string) (string, bool) {
	const prefix = "/v1/aims/timesheet/weeks/"
	const suffix = ":submit"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	periodKey := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	return periodKey, periodKey != "" && !strings.Contains(periodKey, "/")
}

func uniqueBodyIDs(body map[string]any, keys ...string) ([]int64, error) {
	var raw any
	for _, key := range keys {
		if value, ok := body[key]; ok {
			raw = value
			break
		}
	}
	values, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("ids must be an array")
	}
	seen := map[int64]bool{}
	ids := make([]int64, 0, len(values))
	for _, value := range values {
		id, err := bodyInt64(map[string]any{"id": value}, "id")
		if err != nil || id <= 0 {
			return nil, fmt.Errorf("invalid id")
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids, nil
}
