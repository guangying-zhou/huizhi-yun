package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type weeklyReportingSettings struct {
	ID                   int64           `json:"id"`
	Timezone             string          `json:"timezone"`
	DeadlineWeekday      int             `json:"deadlineWeekday"`
	DeadlineTime         string          `json:"deadlineTime"`
	SummaryTargetWeekday int             `json:"summaryTargetWeekday"`
	SummaryTargetTime    string          `json:"summaryTargetTime"`
	ReminderOffsets      json.RawMessage `json:"reminderOffsets"`
	RAGConfig            json.RawMessage `json:"ragConfig"`
	RolloutMode          string          `json:"rolloutMode"`
	ConfigVersion        int64           `json:"configVersion"`
	UpdatedBy            string          `json:"updatedBy"`
	UpdatedAt            string          `json:"updatedAt"`
}

type managerDelegation struct {
	ID                        int64   `json:"id"`
	ProjectID                 int64   `json:"projectId"`
	DelegateUID               string  `json:"delegateUid"`
	StartsAt                  string  `json:"startsAt"`
	EndsAt                    string  `json:"endsAt"`
	Reason                    *string `json:"reason"`
	AppointedBy               string  `json:"appointedBy"`
	RoleHolderRevision        int64   `json:"roleHolderRevision"`
	RevokedAt                 *string `json:"revokedAt"`
	RevokedBy                 *string `json:"revokedBy"`
	RevokedRoleHolderRevision *int64  `json:"revokedRoleHolderRevision"`
	RevokeReason              *string `json:"revokeReason"`
	CreatedAt                 string  `json:"createdAt"`
}

func (a *Adapter) handleProjectGovernanceResponsibilityRuntime(
	ctx context.Context,
	method string,
	path string,
	query url.Values,
	body map[string]any,
) (any, string, bool, error) {
	if path == "/v1/aims/admin/weekly-reporting-settings" {
		switch method {
		case http.MethodGet:
			data, err := a.getWeeklyReportingSettings(ctx, query)
			return data, "aims.admin.weekly_reporting_settings.read", true, err
		case http.MethodPut:
			data, err := a.putWeeklyReportingSettings(ctx, query, body)
			return data, "aims.admin.weekly_reporting_settings.update", true, err
		default:
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
	}

	if projectID, ok := pathParam(path, "/v1/aims/projects/", "/manager-delegations"); ok {
		switch method {
		case http.MethodGet:
			data, err := a.listProjectManagerDelegations(ctx, projectID, query)
			return data, "aims.projects.manager_delegations.list", true, err
		case http.MethodPost:
			data, err := a.createProjectManagerDelegation(ctx, projectID, query, body)
			return data, "aims.projects.manager_delegations.create", true, err
		default:
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
	}

	if projectID, delegationID, ok := managerDelegationRevokePath(path); ok {
		if method != http.MethodPost {
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
		data, err := a.revokeProjectManagerDelegation(ctx, projectID, delegationID, query, body)
		return data, "aims.projects.manager_delegations.revoke", true, err
	}

	if periodKey, ok := weeklyReportingPeriodGeneratePath(path); ok {
		if method != http.MethodPost {
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
		data, err := a.generateWeeklyReportingPeriod(ctx, periodKey, query)
		return data, "aims.weekly_reporting_periods.generate", true, err
	}

	return nil, "", false, nil
}

func (a *Adapter) getWeeklyReportingSettings(ctx context.Context, query url.Values) (map[string]any, error) {
	if !currentUserCanConfigureWeeklyReports(query) {
		return nil, httperror.New(http.StatusForbidden, "weekly_reporting_configure_required", "weekly reporting configure permission required")
	}
	settings, err := a.loadWeeklyReportingSettings(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return map[string]any{"configured": false, "settings": nil}, nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"configured": true, "settings": settings}, nil
}

func (a *Adapter) putWeeklyReportingSettings(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	if !currentUserCanConfigureWeeklyReports(query) {
		return nil, httperror.New(http.StatusForbidden, "weekly_reporting_configure_required", "weekly reporting configure permission required")
	}
	actor := currentUserFrom(query, body)
	if actor == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	timezone := firstBodyText(body, "timezone")
	if timezone == "" {
		return nil, httperror.New(http.StatusBadRequest, "timezone_required", "timezone is required")
	}
	if _, err := time.LoadLocation(timezone); err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_timezone", "timezone is invalid")
	}
	deadlineWeekday, err := bodyInt(body, "deadlineWeekday", "deadline_weekday")
	if err != nil || deadlineWeekday < 1 || deadlineWeekday > 7 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_deadline_weekday", "deadlineWeekday must be between 1 and 7")
	}
	summaryWeekday, err := bodyInt(body, "summaryTargetWeekday", "summary_target_weekday")
	if err != nil || summaryWeekday < 1 || summaryWeekday > 7 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_summary_target_weekday", "summaryTargetWeekday must be between 1 and 7")
	}
	deadlineTime := firstBodyText(body, "deadlineTime", "deadline_time")
	summaryTime := firstBodyText(body, "summaryTargetTime", "summary_target_time")
	if !validClockTime(deadlineTime) || !validClockTime(summaryTime) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_weekly_reporting_time", "deadlineTime and summaryTargetTime must use HH:mm or HH:mm:ss")
	}
	rolloutMode := firstBodyText(body, "rolloutMode", "rollout_mode")
	switch rolloutMode {
	case "disabled", "pilot", "company":
	default:
		return nil, httperror.New(http.StatusBadRequest, "invalid_rollout_mode", "rolloutMode must be disabled, pilot or company")
	}
	reminders, err := normalizedJSONBody(body, "reminderOffsets", "reminder_offsets")
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_reminder_offsets", "reminderOffsets must be valid JSON")
	}
	ragConfig, err := normalizedJSONBody(body, "ragConfig", "rag_config")
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_rag_config", "ragConfig must be valid JSON")
	}

	_, err = a.DB().ExecContext(ctx, `
		INSERT INTO weekly_reporting_settings (
		  config_key, timezone, deadline_weekday, deadline_time,
		  summary_target_weekday, summary_target_time, reminder_offsets_json,
		  rag_config_json, rollout_mode, config_version, updated_by
		) VALUES ('default', ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, 1, ?)
		ON DUPLICATE KEY UPDATE
		  timezone = VALUES(timezone),
		  deadline_weekday = VALUES(deadline_weekday),
		  deadline_time = VALUES(deadline_time),
		  summary_target_weekday = VALUES(summary_target_weekday),
		  summary_target_time = VALUES(summary_target_time),
		  reminder_offsets_json = VALUES(reminder_offsets_json),
		  rag_config_json = VALUES(rag_config_json),
		  rollout_mode = VALUES(rollout_mode),
		  config_version = config_version + 1,
		  updated_by = VALUES(updated_by),
		  updated_at = CURRENT_TIMESTAMP
	`, timezone, deadlineWeekday, normalizedClockTime(deadlineTime), summaryWeekday,
		normalizedClockTime(summaryTime), reminders, ragConfig, rolloutMode, actor)
	if err != nil {
		return nil, err
	}
	settings, err := a.loadWeeklyReportingSettings(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{"configured": true, "settings": settings}, nil
}

func (a *Adapter) loadWeeklyReportingSettings(ctx context.Context) (weeklyReportingSettings, error) {
	var item weeklyReportingSettings
	var reminderOffsets, ragConfig []byte
	err := a.DB().QueryRowContext(ctx, `
		SELECT
		  id, timezone, deadline_weekday, TIME_FORMAT(deadline_time, '%H:%i:%s'),
		  summary_target_weekday, TIME_FORMAT(summary_target_time, '%H:%i:%s'),
		  JSON_EXTRACT(reminder_offsets_json, '$'),
		  JSON_EXTRACT(rag_config_json, '$'),
		  rollout_mode, config_version, updated_by,
		  DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ')
		FROM weekly_reporting_settings
		WHERE config_key = 'default'
		LIMIT 1
	`).Scan(
		&item.ID,
		&item.Timezone,
		&item.DeadlineWeekday,
		&item.DeadlineTime,
		&item.SummaryTargetWeekday,
		&item.SummaryTargetTime,
		&reminderOffsets,
		&ragConfig,
		&item.RolloutMode,
		&item.ConfigVersion,
		&item.UpdatedBy,
		&item.UpdatedAt,
	)
	item.ReminderOffsets = json.RawMessage(reminderOffsets)
	item.RAGConfig = json.RawMessage(ragConfig)
	return item, err
}

func (a *Adapter) listProjectManagerDelegations(ctx context.Context, rawProjectID string, query url.Values) (map[string]any, error) {
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	if !currentUserIsProjectDirector(query) {
		if err := a.requireProjectReadAccess(ctx, rawProjectID, query); err != nil {
			return nil, err
		}
	}
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
		  id, project_id, delegate_uid,
		  DATE_FORMAT(starts_at, '%Y-%m-%dT%H:%i:%sZ'),
		  DATE_FORMAT(ends_at, '%Y-%m-%dT%H:%i:%sZ'),
		  reason, appointed_by, role_holder_revision,
		  DATE_FORMAT(revoked_at, '%Y-%m-%dT%H:%i:%sZ'),
		  revoked_by, revoked_role_holder_revision, revoke_reason,
		  DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ')
		FROM project_manager_delegations
		WHERE project_id = ?
		ORDER BY starts_at DESC, id DESC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]managerDelegation, 0)
	for rows.Next() {
		var item managerDelegation
		var reason, revokedAt, revokedBy, revokeReason sql.NullString
		var revokedRevision sql.NullInt64
		if err := rows.Scan(
			&item.ID, &item.ProjectID, &item.DelegateUID, &item.StartsAt, &item.EndsAt,
			&reason, &item.AppointedBy, &item.RoleHolderRevision, &revokedAt, &revokedBy,
			&revokedRevision, &revokeReason, &item.CreatedAt,
		); err != nil {
			return nil, err
		}
		item.Reason = nullableString(reason)
		item.RevokedAt = nullableString(revokedAt)
		item.RevokedBy = nullableString(revokedBy)
		item.RevokedRoleHolderRevision = nullableInt64(revokedRevision)
		item.RevokeReason = nullableString(revokeReason)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (a *Adapter) createProjectManagerDelegation(
	ctx context.Context,
	rawProjectID string,
	query url.Values,
	body map[string]any,
) (managerDelegation, error) {
	if !currentUserIsProjectDirector(query) {
		return managerDelegation{}, httperror.New(http.StatusForbidden, "project_director_required", "current project director is required")
	}
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return managerDelegation{}, err
	}
	actor := currentUserFrom(query, body)
	if actor == "" {
		return managerDelegation{}, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	roleHolderRevision, err := projectDirectorRoleHolderRevision(query)
	if err != nil {
		return managerDelegation{}, err
	}
	delegateUID := firstBodyText(body, "delegateUid", "delegate_uid")
	if delegateUID == "" {
		return managerDelegation{}, httperror.New(http.StatusBadRequest, "delegate_uid_required", "delegateUid is required")
	}
	startsAt, err := parseGovernanceTime(firstBodyText(body, "startsAt", "starts_at"))
	if err != nil {
		return managerDelegation{}, httperror.New(http.StatusBadRequest, "invalid_delegation_start", "startsAt is invalid")
	}
	endsAt, err := parseGovernanceTime(firstBodyText(body, "endsAt", "ends_at"))
	if err != nil || !endsAt.After(startsAt) {
		return managerDelegation{}, httperror.New(http.StatusBadRequest, "invalid_delegation_end", "endsAt must be later than startsAt")
	}

	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return managerDelegation{}, err
	}
	defer tx.Rollback()

	var memberStatus string
	err = tx.QueryRowContext(ctx, `
		SELECT status
		FROM aims_project_members
		WHERE project_id = ? AND uid = ?
		FOR UPDATE
	`, projectID, delegateUID).Scan(&memberStatus)
	if errors.Is(err, sql.ErrNoRows) || memberStatus != "active" {
		return managerDelegation{}, httperror.New(http.StatusBadRequest, "delegate_not_active_project_member", "delegate must be an active project member")
	}
	if err != nil {
		return managerDelegation{}, err
	}

	overlapRows, err := tx.QueryContext(ctx, `
		SELECT id
		FROM project_manager_delegations
		WHERE project_id = ?
		  AND revoked_at IS NULL
		  AND starts_at < ?
		  AND ends_at > ?
		FOR UPDATE
	`, projectID, endsAt.UTC(), startsAt.UTC())
	if err != nil {
		return managerDelegation{}, err
	}
	hasOverlap := overlapRows.Next()
	if rowsErr := overlapRows.Err(); rowsErr != nil {
		overlapRows.Close()
		return managerDelegation{}, rowsErr
	}
	if closeErr := overlapRows.Close(); closeErr != nil {
		return managerDelegation{}, closeErr
	}
	if hasOverlap {
		return managerDelegation{}, httperror.New(http.StatusConflict, "manager_delegation_overlap", "manager delegation term overlaps an existing active term")
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO project_manager_delegations (
		  project_id, delegate_uid, starts_at, ends_at, reason, appointed_by, role_holder_revision
		) VALUES (?, ?, ?, ?, ?, ?, ?)
	`, projectID, delegateUID, startsAt.UTC(), endsAt.UTC(), nullableText(firstBodyText(body, "reason")), actor, roleHolderRevision)
	if err != nil {
		return managerDelegation{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return managerDelegation{}, err
	}
	if err := tx.Commit(); err != nil {
		return managerDelegation{}, err
	}
	return a.getProjectManagerDelegation(ctx, id)
}

func (a *Adapter) revokeProjectManagerDelegation(
	ctx context.Context,
	rawProjectID string,
	rawDelegationID string,
	query url.Values,
	body map[string]any,
) (managerDelegation, error) {
	if !currentUserIsProjectDirector(query) {
		return managerDelegation{}, httperror.New(http.StatusForbidden, "project_director_required", "current project director is required")
	}
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return managerDelegation{}, err
	}
	delegationID, err := parseID(rawDelegationID, "delegation_id")
	if err != nil {
		return managerDelegation{}, err
	}
	actor := currentUserFrom(query, body)
	if actor == "" {
		return managerDelegation{}, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	roleHolderRevision, err := projectDirectorRoleHolderRevision(query)
	if err != nil {
		return managerDelegation{}, err
	}

	result, err := a.DB().ExecContext(ctx, `
		UPDATE project_manager_delegations
		SET revoked_at = UTC_TIMESTAMP(6),
		    revoked_by = ?,
		    revoked_role_holder_revision = ?,
		    revoke_reason = ?
		WHERE id = ?
		  AND project_id = ?
		  AND revoked_at IS NULL
	`, actor, roleHolderRevision, nullableText(firstBodyText(body, "reason", "revokeReason", "revoke_reason")), delegationID, projectID)
	if err != nil {
		return managerDelegation{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return managerDelegation{}, err
	}
	if affected != 1 {
		return managerDelegation{}, httperror.New(http.StatusConflict, "delegation_not_active", "delegation does not exist or is already revoked")
	}
	return a.getProjectManagerDelegation(ctx, delegationID)
}

func (a *Adapter) getProjectManagerDelegation(ctx context.Context, id int64) (managerDelegation, error) {
	var item managerDelegation
	var reason, revokedAt, revokedBy, revokeReason sql.NullString
	var revokedRevision sql.NullInt64
	err := a.DB().QueryRowContext(ctx, `
		SELECT
		  id, project_id, delegate_uid,
		  DATE_FORMAT(starts_at, '%Y-%m-%dT%H:%i:%sZ'),
		  DATE_FORMAT(ends_at, '%Y-%m-%dT%H:%i:%sZ'),
		  reason, appointed_by, role_holder_revision,
		  DATE_FORMAT(revoked_at, '%Y-%m-%dT%H:%i:%sZ'),
		  revoked_by, revoked_role_holder_revision, revoke_reason,
		  DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ')
		FROM project_manager_delegations
		WHERE id = ?
	`, id).Scan(
		&item.ID, &item.ProjectID, &item.DelegateUID, &item.StartsAt, &item.EndsAt,
		&reason, &item.AppointedBy, &item.RoleHolderRevision, &revokedAt, &revokedBy,
		&revokedRevision, &revokeReason, &item.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return managerDelegation{}, httperror.New(http.StatusNotFound, "manager_delegation_not_found", "manager delegation not found")
	}
	item.Reason = nullableString(reason)
	item.RevokedAt = nullableString(revokedAt)
	item.RevokedBy = nullableString(revokedBy)
	item.RevokedRoleHolderRevision = nullableInt64(revokedRevision)
	item.RevokeReason = nullableString(revokeReason)
	return item, err
}

func (a *Adapter) generateWeeklyReportingPeriod(ctx context.Context, periodKey string, query url.Values) (map[string]any, error) {
	if !currentUserIsProjectDirector(query) && !currentUserCanConfigureWeeklyReports(query) {
		return nil, httperror.New(http.StatusForbidden, "weekly_period_generate_required", "project director or weekly reporting configurator required")
	}
	if currentUserIsProjectDirector(query) && !currentUserCanConfigureWeeklyReports(query) {
		if _, err := projectDirectorRoleHolderRevision(query); err != nil {
			return nil, err
		}
	}
	settings, err := a.loadWeeklyReportingSettings(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusConflict, "weekly_reporting_not_configured", "weekly reporting settings are not configured")
	}
	if err != nil {
		return nil, err
	}
	if settings.RolloutMode == "disabled" {
		return nil, httperror.New(http.StatusConflict, "weekly_reporting_disabled", "weekly reporting rollout is disabled")
	}
	startLocal, endLocal, deadlineLocal, summaryTargetLocal, err := weeklyPeriodTimes(periodKey, settings)
	if err != nil {
		return nil, err
	}
	snapshot, err := json.Marshal(settings)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	responsibilityAt := now
	if deadlineLocal.UTC().Before(now) {
		responsibilityAt = deadlineLocal.UTC()
	}

	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, `
		INSERT INTO weekly_reporting_periods (
		  period_key, week_start, week_end, deadline_at, summary_target_at,
		  timezone, config_version, settings_snapshot_json, status
		) VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), 'open')
		ON DUPLICATE KEY UPDATE period_key = VALUES(period_key)
	`, periodKey, startLocal.UTC(), endLocal.UTC(), deadlineLocal.UTC(), summaryTargetLocal.UTC(),
		settings.Timezone, settings.ConfigVersion, string(snapshot))
	if err != nil {
		return nil, err
	}

	var periodID int64
	var status string
	var frozenAt sql.NullTime
	if err := tx.QueryRowContext(ctx, `
		SELECT id, status, obligations_frozen_at
		FROM weekly_reporting_periods
		WHERE period_key = ?
		FOR UPDATE
	`, periodKey).Scan(&periodID, &status, &frozenAt); err != nil {
		return nil, err
	}
	if frozenAt.Valid {
		return nil, httperror.New(http.StatusConflict, "weekly_period_obligations_frozen", "weekly reporting obligations are already frozen")
	}

	pilotClause := ""
	args := []any{
		periodID,
		responsibilityAt,
		responsibilityAt,
		responsibilityAt,
		responsibilityAt,
		responsibilityAt,
		startLocal.UTC(),
		responsibilityAt,
	}
	if settings.RolloutMode == "pilot" {
		pilotClause = `
		  AND EXISTS (
		    SELECT 1
		    FROM weekly_reporting_pilot_projects pilot
		    WHERE pilot.project_id = p.id
		      AND pilot.effective_from <= DATE(?)
		      AND (pilot.effective_to IS NULL OR pilot.effective_to >= DATE(?))
		  )`
		args = append(args, startLocal.UTC(), endLocal.UTC())
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO weekly_report_obligations (
		  period_id, project_id, responsible_uid_snapshot, responsibility_type,
		  project_status_snapshot, due_status
		)
		SELECT
		  ?,
		  p.id,
		  COALESCE((
		    SELECT delegation.delegate_uid
		    FROM project_manager_delegations delegation
		    WHERE delegation.project_id = p.id
		      AND delegation.revoked_at IS NULL
		      AND delegation.starts_at <= ?
		      AND delegation.ends_at > ?
		    ORDER BY delegation.starts_at DESC, delegation.id DESC
		    LIMIT 1
		  ), p.leader_uid),
		  CASE WHEN EXISTS (
		    SELECT 1
		    FROM project_manager_delegations delegation
		    WHERE delegation.project_id = p.id
		      AND delegation.revoked_at IS NULL
		      AND delegation.starts_at <= ?
		      AND delegation.ends_at > ?
		  ) THEN 'acting_project_manager' ELSE 'project_manager' END,
		  p.lifecycle_status,
		  'pending'
		FROM aims_projects p
		WHERE p.leader_uid IS NOT NULL
		  AND TRIM(p.leader_uid) <> ''
		  AND (
		    COALESCE((
		      SELECT lifecycle.to_status
		      FROM project_lifecycle_events lifecycle
		      WHERE lifecycle.project_id = p.id
		        AND lifecycle.effective_at <= ?
		      ORDER BY lifecycle.effective_at DESC, lifecycle.id DESC
		      LIMIT 1
		    ), p.lifecycle_status) = 'active'
		    OR EXISTS (
		      SELECT 1
		      FROM project_lifecycle_events lifecycle
		      WHERE lifecycle.project_id = p.id
		        AND lifecycle.to_status = 'active'
		        AND lifecycle.effective_at >= ?
		        AND lifecycle.effective_at <= ?
		    )
		  )
		`+pilotClause+`
		ON DUPLICATE KEY UPDATE
		  responsible_uid_snapshot = IF(frozen_at IS NULL, VALUES(responsible_uid_snapshot), responsible_uid_snapshot),
		  responsibility_type = IF(frozen_at IS NULL, VALUES(responsibility_type), responsibility_type),
		  project_status_snapshot = IF(frozen_at IS NULL, VALUES(project_status_snapshot), project_status_snapshot),
		  updated_at = CURRENT_TIMESTAMP(6)
	`, args...)
	if err != nil {
		return nil, err
	}

	if !deadlineLocal.UTC().After(now) {
		if _, err := tx.ExecContext(ctx, `
			UPDATE weekly_report_obligations
			SET due_status = CASE WHEN due_status IN ('pending','draft') THEN 'missing' ELSE due_status END,
			    frozen_at = COALESCE(frozen_at, UTC_TIMESTAMP(6))
			WHERE period_id = ?
		`, periodID); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE weekly_reporting_periods
			SET status = CASE WHEN status = 'open' THEN 'deadline_frozen' ELSE status END,
			    obligations_frozen_at = COALESCE(obligations_frozen_at, UTC_TIMESTAMP(6))
			WHERE id = ?
		`, periodID); err != nil {
			return nil, err
		}
		status = "deadline_frozen"
	}

	var obligationCount int64
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM weekly_report_obligations WHERE period_id = ?", periodID).Scan(&obligationCount); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"periodId":        periodID,
		"periodKey":       periodKey,
		"status":          status,
		"obligationCount": obligationCount,
		"weekStart":       startLocal.Format(time.RFC3339),
		"weekEnd":         endLocal.Format(time.RFC3339),
		"deadlineAt":      deadlineLocal.Format(time.RFC3339),
		"summaryTargetAt": summaryTargetLocal.Format(time.RFC3339),
		"timezone":        settings.Timezone,
		"configVersion":   settings.ConfigVersion,
	}, nil
}

func weeklyPeriodTimes(periodKey string, settings weeklyReportingSettings) (time.Time, time.Time, time.Time, time.Time, error) {
	year, week, err := parseISOPeriodKey(periodKey)
	if err != nil {
		return time.Time{}, time.Time{}, time.Time{}, time.Time{}, err
	}
	location, err := time.LoadLocation(settings.Timezone)
	if err != nil {
		return time.Time{}, time.Time{}, time.Time{}, time.Time{}, httperror.New(http.StatusConflict, "invalid_configured_timezone", "configured timezone is invalid")
	}
	startDate, _ := isoWeekRange(year, week)
	start := time.Date(startDate.Year(), startDate.Month(), startDate.Day(), 0, 0, 0, 0, location)
	end := start.AddDate(0, 0, 7).Add(-time.Microsecond)
	deadline, err := periodClock(start, settings.DeadlineWeekday, settings.DeadlineTime)
	if err != nil {
		return time.Time{}, time.Time{}, time.Time{}, time.Time{}, err
	}
	summaryTarget, err := periodClock(start, settings.SummaryTargetWeekday, settings.SummaryTargetTime)
	if err != nil {
		return time.Time{}, time.Time{}, time.Time{}, time.Time{}, err
	}
	return start, end, deadline, summaryTarget, nil
}

func periodClock(start time.Time, weekday int, clock string) (time.Time, error) {
	parts := strings.Split(normalizedClockTime(clock), ":")
	if len(parts) != 3 {
		return time.Time{}, fmt.Errorf("invalid clock %q", clock)
	}
	hour, err := strconv.Atoi(parts[0])
	if err != nil {
		return time.Time{}, err
	}
	minute, err := strconv.Atoi(parts[1])
	if err != nil {
		return time.Time{}, err
	}
	second, err := strconv.Atoi(parts[2])
	if err != nil {
		return time.Time{}, err
	}
	date := start.AddDate(0, 0, weekday-1)
	return time.Date(date.Year(), date.Month(), date.Day(), hour, minute, second, 0, start.Location()), nil
}

func parseISOPeriodKey(value string) (int, int, error) {
	value = strings.TrimSpace(value)
	var year, week int
	if _, err := fmt.Sscanf(value, "%d-W%d", &year, &week); err != nil || year < 1970 || week < 1 || week > 53 {
		return 0, 0, httperror.New(http.StatusBadRequest, "invalid_period_key", "periodKey must use ISO YYYY-Www")
	}
	start, _ := isoWeekRange(year, week)
	actualYear, actualWeek := start.ISOWeek()
	if actualYear != year || actualWeek != week {
		return 0, 0, httperror.New(http.StatusBadRequest, "invalid_period_key", "periodKey does not identify a valid ISO week")
	}
	return year, week, nil
}

func parseGovernanceTime(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05", "2006-01-02T15:04:05"} {
		parsed, err := time.Parse(layout, value)
		if err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid time")
}

func normalizedJSONBody(body map[string]any, keys ...string) (string, error) {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		var raw []byte
		switch typed := value.(type) {
		case string:
			raw = []byte(typed)
		default:
			var err error
			raw, err = json.Marshal(typed)
			if err != nil {
				return "", err
			}
		}
		if !json.Valid(raw) {
			return "", fmt.Errorf("invalid JSON")
		}
		return string(raw), nil
	}
	return "{}", nil
}

func validClockTime(value string) bool {
	_, err := time.Parse("15:04:05", normalizedClockTime(value))
	return err == nil
}

func normalizedClockTime(value string) string {
	value = strings.TrimSpace(value)
	if len(value) == 5 {
		return value + ":00"
	}
	return value
}

func managerDelegationRevokePath(path string) (string, string, bool) {
	const prefix = "/v1/aims/projects/"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, ":revoke") {
		return "", "", false
	}
	rest := strings.TrimSuffix(strings.TrimPrefix(path, prefix), ":revoke")
	parts := strings.Split(rest, "/manager-delegations/")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

func weeklyReportingPeriodGeneratePath(path string) (string, bool) {
	const prefix = "/v1/aims/weekly-reporting-periods/"
	const suffix = ":generate"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	periodKey := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	return periodKey, strings.TrimSpace(periodKey) != "" && !strings.Contains(periodKey, "/")
}

func currentUserIsProjectDirector(query url.Values) bool {
	return truthyQuery(query, "current_user_is_project_director", "currentUserIsProjectDirector")
}

func projectDirectorRoleHolderRevision(query url.Values) (int64, error) {
	raw := firstQueryText(query, "current_user_project_director_revision", "currentUserProjectDirectorRevision")
	revision, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || revision <= 0 {
		return 0, httperror.New(
			http.StatusForbidden,
			"project_director_role_holder_revision_required",
			"a fresh project director role holder revision is required",
		)
	}
	return revision, nil
}

func currentUserCanConfigureWeeklyReports(query url.Values) bool {
	return truthyQuery(query, "current_user_can_configure_weekly_reports", "currentUserCanConfigureWeeklyReports")
}

func truthyQuery(query url.Values, keys ...string) bool {
	switch strings.ToLower(strings.TrimSpace(firstQueryText(query, keys...))) {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}
