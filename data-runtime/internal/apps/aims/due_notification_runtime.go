package aims

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const (
	dueStreamResponse   = "response_due"
	dueStreamResolution = "resolution_due"
	dueStreamWorkItem   = "work_item_due"
)

type aimsDueCursor struct {
	DueAt string `json:"dueAt"`
	ID    int64  `json:"id"`
}

type aimsDueFact struct {
	ID                            int64
	ProjectID                     int64
	ProjectCode                   string
	ProjectName                   string
	ItemKey                       string
	Title                         string
	Status                        string
	Priority                      string
	Severity                      sql.NullString
	AssigneeUID                   sql.NullString
	AssigneeIsActiveProjectMember bool
	ProjectLeaderUID              sql.NullString
	DeptCode                      sql.NullString
	DueAt                         time.Time
}

type aimsDueCandidate struct {
	Stream               string  `json:"stream"`
	Phase                string  `json:"phase"`
	WorkItemID           int64   `json:"workItemId"`
	ProjectID            int64   `json:"projectId"`
	ProjectCode          string  `json:"projectCode"`
	ProjectName          string  `json:"projectName"`
	ItemKey              string  `json:"itemKey"`
	Title                string  `json:"title"`
	Status               string  `json:"status"`
	Priority             string  `json:"priority"`
	Severity             *string `json:"severity"`
	AssigneeUID          *string `json:"assigneeUid"`
	ProjectLeaderUID     *string `json:"projectLeaderUid"`
	DeptCode             *string `json:"deptCode"`
	DueAt                string  `json:"dueAt"`
	EventVersion         string  `json:"eventVersion"`
	PreviousEventVersion *string `json:"previousEventVersion,omitempty"`
	PreviousRecipientUID *string `json:"previousRecipientUid,omitempty"`
	IdempotencyKey       string  `json:"idempotencyKey"`
	ActionableKey        string  `json:"actionableKey"`
}

type aimsDueClosure struct {
	CheckpointEventVersion string `json:"checkpointEventVersion"`
	ExpectedVersion        string `json:"expectedVersion"`
	ActionableKey          string `json:"actionableKey"`
	WorkItemID             int64  `json:"workItemId"`
	RecipientUID           string `json:"recipientUid"`
	NextVersion            string `json:"nextVersion"`
	State                  string `json:"state"`
}

func (a *Adapter) handleDueNotificationRuntime(ctx context.Context, method string, path string, body map[string]any) (map[string]any, string, bool, error) {
	if method != http.MethodPost {
		return nil, "", false, nil
	}
	switch path {
	case "/v1/aims/service/notifications:scan-due":
		data, err := a.legacyDueStore().scanDueNotifications(ctx, body)
		return data, "aims.notifications.due.scan", true, err
	case "/v1/aims/service/notifications:acknowledge":
		data, err := a.legacyDueStore().acknowledgeDueNotification(ctx, body)
		return data, "aims.notifications.due.acknowledge", true, err
	case "/v1/aims/service/notifications:acknowledge-closure":
		data, err := a.legacyDueStore().acknowledgeDueNotificationClosure(ctx, body)
		return data, "aims.notifications.due.closure_acknowledge", true, err
	default:
		return nil, "", false, nil
	}
}

func (s aimsDueStore) scanDueNotifications(ctx context.Context, body map[string]any) (map[string]any, error) {
	stream := strings.TrimSpace(firstBodyText(body, "stream"))
	if !validAimsDueStream(stream) {
		return nil, httperror.New(http.StatusBadRequest, "aims_due_stream_invalid", "stream must be response_due, resolution_due or work_item_due")
	}
	asOf, err := time.Parse(time.RFC3339, strings.TrimSpace(firstBodyText(body, "asOf", "as_of")))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "aims_due_as_of_invalid", "asOf must be an explicit RFC3339 timestamp")
	}
	asOf = asOf.UTC()
	cursor, err := decodeAimsDueCursor(firstBodyText(body, "cursor"))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "aims_due_cursor_invalid", "cursor is invalid")
	}
	limit := serviceBodyInt(body, "limit")
	if limit <= 0 || limit > 200 {
		limit = 100
	}

	if err := s.reconcileDueNotificationCheckpoints(ctx, stream, asOf); err != nil {
		return nil, err
	}
	facts, err := s.queryDueFacts(ctx, stream, asOf, cursor, limit+1)
	if err != nil {
		return nil, err
	}
	hasMore := len(facts) > limit
	if hasMore {
		facts = facts[:limit]
	}
	items := make([]aimsDueCandidate, 0, len(facts))
	for _, fact := range facts {
		candidate, pending, err := s.openDueNotificationCheckpoint(ctx, stream, asOf, fact)
		if err != nil {
			return nil, err
		}
		if candidate == nil {
			continue
		}
		if pending {
			items = append(items, *candidate)
		}
	}
	closures, err := s.pendingDueNotificationClosures(ctx, stream, limit)
	if err != nil {
		return nil, err
	}

	var nextCursor any
	if hasMore && len(facts) > 0 {
		encoded, err := encodeAimsDueCursor(facts[len(facts)-1].DueAt, facts[len(facts)-1].ID)
		if err != nil {
			return nil, err
		}
		nextCursor = encoded
	}
	return map[string]any{
		"stream": stream, "asOf": asOf.Format(time.RFC3339), "items": items,
		"nextCursor": nextCursor, "closures": closures,
	}, nil
}

func queryDueFactsWith(ctx context.Context, q aimsDueQuerier, stream string, asOf time.Time, cursor *aimsDueCursor, limit int) ([]aimsDueFact, error) {
	dueColumn := "wse.response_due_at"
	completionPredicate := "wse.first_responded_at IS NULL"
	windowEnd := asOf.Add(4 * time.Hour)
	from := `
		FROM work_items wi
		INNER JOIN aims_projects p ON p.id = wi.project_id
		INNER JOIN work_item_service_ext wse ON wse.work_item_id = wi.id`
	where := `
		WHERE wi.status <> 'completed'
		  AND p.lifecycle_status <> 'archived'
		  AND ` + dueColumn + ` IS NOT NULL
		  AND ` + completionPredicate + `
		  AND ` + dueColumn + ` <= ?`
	args := []any{windowEnd}

	if stream == dueStreamResolution {
		dueColumn = "wse.resolution_due_at"
		completionPredicate = "wse.resolved_at IS NULL"
		where = `
		WHERE wi.status <> 'completed'
		  AND p.lifecycle_status <> 'archived'
		  AND ` + dueColumn + ` IS NOT NULL
		  AND ` + completionPredicate + `
		  AND ` + dueColumn + ` <= ?`
	}
	if stream == dueStreamWorkItem {
		dueColumn = "wi.due_date"
		from = `
		FROM work_items wi
		INNER JOIN aims_projects p ON p.id = wi.project_id`
		where = `
		WHERE wi.status <> 'completed'
		  AND p.lifecycle_status <> 'archived'
		  AND wi.due_date IS NOT NULL
		  AND (wi.priority IN ('P0', 'P1') OR wi.severity IN ('critical', 'high'))
		  AND wi.due_date <= DATE(?)`
		args = []any{asOf.AddDate(0, 0, 3)}
	}
	if cursor != nil {
		cursorTime, _ := time.Parse(time.RFC3339, cursor.DueAt)
		cursorValue := any(cursorTime.UTC())
		if stream == dueStreamWorkItem {
			cursorValue = cursorTime.UTC().Format("2006-01-02")
		}
		where += " AND (" + dueColumn + " > ? OR (" + dueColumn + " = ? AND wi.id > ?))"
		args = append(args, cursorValue, cursorValue, cursor.ID)
	}
	args = append(args, limit)
	rows, err := q.QueryContext(ctx, `
		SELECT wi.id, wi.project_id, p.project_code, p.name, wi.item_key, wi.title,
		       wi.status, wi.priority, wi.severity, wi.assignee_uid,
		       EXISTS (SELECT 1 FROM aims_project_members due_pm WHERE due_pm.project_id=wi.project_id AND due_pm.uid=wi.assignee_uid AND due_pm.status='active') AS assignee_is_active_project_member,
		       p.leader_uid, p.dept_code,
		       `+dueColumn+` AS due_at
		`+from+where+`
		ORDER BY `+dueColumn+` ASC, wi.id ASC
		LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	facts := make([]aimsDueFact, 0, limit)
	for rows.Next() {
		var fact aimsDueFact
		if err := rows.Scan(&fact.ID, &fact.ProjectID, &fact.ProjectCode, &fact.ProjectName, &fact.ItemKey, &fact.Title,
			&fact.Status, &fact.Priority, &fact.Severity, &fact.AssigneeUID, &fact.AssigneeIsActiveProjectMember, &fact.ProjectLeaderUID, &fact.DeptCode, &fact.DueAt); err != nil {
			return nil, err
		}
		fact.AssigneeUID = eligibleAimsDueAssignee(fact)
		if stream == dueStreamWorkItem {
			fact.DueAt = time.Date(fact.DueAt.Year(), fact.DueAt.Month(), fact.DueAt.Day(), 23, 59, 59, 0, time.UTC)
		} else {
			fact.DueAt = fact.DueAt.UTC()
		}
		facts = append(facts, fact)
	}
	return facts, rows.Err()
}

func eligibleAimsDueAssignee(fact aimsDueFact) sql.NullString {
	if !fact.AssigneeUID.Valid || strings.TrimSpace(fact.AssigneeUID.String) == "" {
		return sql.NullString{}
	}
	if fact.ProjectLeaderUID.Valid && fact.AssigneeUID.String == fact.ProjectLeaderUID.String {
		return fact.AssigneeUID
	}
	if fact.AssigneeIsActiveProjectMember {
		return fact.AssigneeUID
	}
	return sql.NullString{}
}

func reconcileDueNotificationCheckpointsWith(ctx context.Context, q aimsDueQuerier, stream string, asOf time.Time) error {
	resolved := "wse.first_responded_at IS NOT NULL"
	cancelled := "wse.response_due_at IS NULL OR wse.response_due_at > ?"
	cancelledArgs := []any{asOf.Add(4 * time.Hour)}
	join := `LEFT JOIN work_item_service_ext wse ON wse.work_item_id = c.source_id`
	if stream == dueStreamResolution {
		resolved = "wse.resolved_at IS NOT NULL"
		cancelled = "wse.resolution_due_at IS NULL OR wse.resolution_due_at > ?"
	}
	if stream == dueStreamWorkItem {
		resolved = "wi.status = 'completed'"
		cancelled = "wi.due_date IS NULL OR wi.due_date > DATE(?) OR NOT (wi.priority IN ('P0', 'P1') OR wi.severity IN ('critical', 'high'))"
		cancelledArgs = []any{asOf.AddDate(0, 0, 3)}
		join = ""
	}
	_, err := q.ExecContext(ctx, `
		UPDATE aims_notification_checkpoint c
		LEFT JOIN work_items wi ON wi.id = c.source_id
		LEFT JOIN aims_projects p ON p.id = wi.project_id
		`+join+`
		SET c.state = 'closed', c.close_reason = 'condition_resolved', c.closed_at = UTC_TIMESTAMP(), c.updated_at = UTC_TIMESTAMP()
		WHERE c.event_stream = ? AND c.state = 'open'
		  AND (wi.id IS NULL OR wi.status = 'completed' OR `+resolved+`)`, stream)
	if err != nil {
		return err
	}
	args := []any{stream}
	args = append(args, cancelledArgs...)
	_, err = q.ExecContext(ctx, `
		UPDATE aims_notification_checkpoint c
		LEFT JOIN work_items wi ON wi.id = c.source_id
		LEFT JOIN aims_projects p ON p.id = wi.project_id
		`+join+`
		SET c.state = 'closed', c.close_reason = 'condition_cancelled', c.closed_at = UTC_TIMESTAMP(), c.updated_at = UTC_TIMESTAMP()
		WHERE c.event_stream = ? AND c.state = 'open'
		  AND (p.id IS NULL OR p.lifecycle_status = 'archived' OR `+cancelled+`)`, args...)
	return err
}

func (s aimsDueStore) openDueNotificationCheckpoint(ctx context.Context, stream string, asOf time.Time, fact aimsDueFact) (*aimsDueCandidate, bool, error) {
	phase := aimsDuePhase(stream, asOf, fact.DueAt)
	if phase == "" {
		return nil, false, nil
	}
	tx, err := s.begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback()
	sourceVersion := aimsDueSourceVersion(stream, fact)
	generation := int64(1)
	var latestGeneration int64
	var latestState, latestSourceVersion, latestEventVersion, latestPhase, latestCloseReason string
	var latestRecipient sql.NullString
	latestErr := tx.QueryRowContext(ctx, `
		SELECT condition_generation, state, source_version, event_version, phase, COALESCE(close_reason, ''), notified_recipient_uid
		FROM aims_notification_checkpoint
		WHERE event_stream = ? AND source_id = ?
		ORDER BY condition_generation DESC, id DESC
		LIMIT 1 FOR UPDATE`, stream, fact.ID).Scan(
		&latestGeneration, &latestState, &latestSourceVersion, &latestEventVersion, &latestPhase, &latestCloseReason, &latestRecipient)
	if latestErr != nil && latestErr != sql.ErrNoRows {
		return nil, false, latestErr
	}
	var previousEventVersion, previousRecipientUID *string
	if latestErr == nil {
		sameIncarnation := latestSourceVersion == sourceVersion && (latestState == "open" || latestCloseReason == "superseded")
		if sameIncarnation {
			if aimsDuePhaseRank(stream, latestPhase) > aimsDuePhaseRank(stream, phase) {
				return nil, false, nil
			}
			generation = latestGeneration
			previousEventVersion = stringPointer(latestEventVersion)
			previousRecipientUID = nullStringPointer(latestRecipient)
		} else {
			generation = latestGeneration + 1
			if latestState == "open" {
				if _, err := tx.ExecContext(ctx, `
					UPDATE aims_notification_checkpoint
					SET state = 'closed', close_reason = 'condition_cancelled', closed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
					WHERE event_stream = ? AND source_id = ? AND state = 'open'`, stream, fact.ID); err != nil {
					return nil, false, err
				}
			}
		}
	}
	candidate, ok := buildAimsDueCandidate(stream, asOf, fact, generation)
	if !ok {
		return nil, false, nil
	}
	if previousEventVersion != nil && *previousEventVersion == candidate.EventVersion {
		previousEventVersion = nil
		previousRecipientUID = nil
	}
	candidate.PreviousEventVersion = previousEventVersion
	candidate.PreviousRecipientUID = previousRecipientUID
	if latestErr == nil && generation == latestGeneration && latestEventVersion != candidate.EventVersion && latestState == "open" {
		if _, err := tx.ExecContext(ctx, `
			UPDATE aims_notification_checkpoint
			SET state = 'closed', close_reason = 'superseded', closed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
			WHERE event_stream = ? AND source_id = ? AND state = 'open' AND event_version = ?`,
			stream, fact.ID, latestEventVersion); err != nil {
			return nil, false, err
		}
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT IGNORE INTO aims_notification_checkpoint (
		  event_stream, source_id, condition_generation, phase, source_version, event_version, previous_event_version,
		  previous_recipient_uid, idempotency_key, actionable_key,
		  due_at, work_item_status, priority, severity, assignee_uid, project_leader_uid, dept_code, state
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
		candidate.Stream, candidate.WorkItemID, generation, candidate.Phase, sourceVersion, candidate.EventVersion,
		nullableAimsPointerText(candidate.PreviousEventVersion), nullableAimsPointerText(candidate.PreviousRecipientUID),
		candidate.IdempotencyKey, candidate.ActionableKey, fact.DueAt,
		fact.Status, fact.Priority, nullableAimsSQLText(fact.Severity), nullableAimsSQLText(fact.AssigneeUID),
		nullableAimsSQLText(fact.ProjectLeaderUID), nullableAimsSQLText(fact.DeptCode)); err != nil {
		return nil, false, err
	}
	var state string
	var notificationID, storedPreviousVersion, storedPreviousRecipient sql.NullString
	if err := tx.QueryRowContext(ctx, `
		SELECT state, notification_id, previous_event_version, previous_recipient_uid
		FROM aims_notification_checkpoint
		WHERE event_version = ?
		LIMIT 1 FOR UPDATE`, candidate.EventVersion).Scan(&state, &notificationID, &storedPreviousVersion, &storedPreviousRecipient); err != nil {
		return nil, false, err
	}
	candidate.PreviousEventVersion = nullStringPointer(storedPreviousVersion)
	candidate.PreviousRecipientUID = nullStringPointer(storedPreviousRecipient)
	if err := tx.Commit(); err != nil {
		return nil, false, err
	}
	return &candidate, state == "open" && !notificationID.Valid, nil
}

func pendingDueNotificationClosuresWith(ctx context.Context, q aimsDueQuerier, stream string, limit int) ([]aimsDueClosure, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT c.event_version, delivered.event_version, c.actionable_key, c.source_id,
		       delivered.notified_recipient_uid, c.close_reason
		FROM aims_notification_checkpoint c
		INNER JOIN aims_notification_checkpoint delivered ON delivered.id = (
		  SELECT prior.id
		  FROM aims_notification_checkpoint prior
		  WHERE prior.event_stream = c.event_stream
		    AND prior.source_id = c.source_id
		    AND prior.condition_generation = c.condition_generation
		    AND prior.id <= c.id
		    AND prior.notification_id IS NOT NULL
		    AND prior.notified_recipient_uid IS NOT NULL
		  ORDER BY prior.id DESC
		  LIMIT 1
		)
		WHERE c.event_stream = ? AND c.state = 'closed'
		  AND c.close_reason IN ('condition_resolved', 'condition_cancelled')
		  AND c.lifecycle_closed_at IS NULL
		ORDER BY c.closed_at ASC, c.id ASC
		LIMIT ?`, stream, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	closures := make([]aimsDueClosure, 0)
	for rows.Next() {
		var item aimsDueClosure
		var reason string
		if err := rows.Scan(&item.CheckpointEventVersion, &item.ExpectedVersion, &item.ActionableKey, &item.WorkItemID, &item.RecipientUID, &reason); err != nil {
			return nil, err
		}
		item.State = "cancelled"
		if reason == "condition_resolved" {
			item.State = "resolved"
		}
		item.NextVersion = item.State + ":" + item.CheckpointEventVersion
		closures = append(closures, item)
	}
	return closures, rows.Err()
}

func acknowledgeDueNotificationWith(ctx context.Context, q aimsDueQuerier, body map[string]any) (map[string]any, error) {
	eventVersion := strings.TrimSpace(firstBodyText(body, "eventVersion", "event_version"))
	notificationID := strings.TrimSpace(firstBodyText(body, "notificationId", "notification_id"))
	recipientUID := strings.TrimSpace(firstBodyText(body, "recipientUid", "recipient_uid"))
	if eventVersion == "" || notificationID == "" || recipientUID == "" || strings.EqualFold(recipientUID, "@all") {
		return nil, httperror.New(http.StatusBadRequest, "aims_due_ack_invalid", "eventVersion, notificationId and an explicit recipientUid are required")
	}
	result, err := q.ExecContext(ctx, `
		UPDATE aims_notification_checkpoint
		SET notification_id = ?, notified_recipient_uid = ?, acknowledged_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
		WHERE event_version = ?
		  AND (notification_id IS NULL OR notification_id = ?)`, notificationID, recipientUID, eventVersion, notificationID)
	if err != nil {
		return nil, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		var state string
		var existingNotificationID, existingRecipientUID sql.NullString
		err := q.QueryRowContext(ctx, `
			SELECT state, notification_id, notified_recipient_uid
			FROM aims_notification_checkpoint
			WHERE event_version = ?
			LIMIT 1`, eventVersion).Scan(&state, &existingNotificationID, &existingRecipientUID)
		if err == nil && (state == "open" || state == "closed") && existingNotificationID.String == notificationID && existingRecipientUID.String == recipientUID {
			return map[string]any{"eventVersion": eventVersion, "notificationId": notificationID, "recipientUid": recipientUID, "acknowledged": true, "idempotent": true}, nil
		}
		return nil, httperror.New(http.StatusConflict, "aims_due_ack_conflict", "notification checkpoint is stale, closed or conflicts with existing evidence")
	}
	return map[string]any{"eventVersion": eventVersion, "notificationId": notificationID, "recipientUid": recipientUID, "acknowledged": true}, nil
}

func acknowledgeDueNotificationClosureWith(ctx context.Context, q aimsDueQuerier, body map[string]any) (map[string]any, error) {
	eventVersion := strings.TrimSpace(firstBodyText(body, "eventVersion", "event_version"))
	nextVersion := strings.TrimSpace(firstBodyText(body, "nextVersion", "next_version"))
	if eventVersion == "" || nextVersion == "" {
		return nil, httperror.New(http.StatusBadRequest, "aims_due_closure_ack_invalid", "eventVersion and nextVersion are required")
	}
	result, err := q.ExecContext(ctx, `
		UPDATE aims_notification_checkpoint
		SET lifecycle_closed_at = UTC_TIMESTAMP(), lifecycle_next_version = ?, updated_at = UTC_TIMESTAMP()
		WHERE event_version = ? AND state = 'closed'
		  AND close_reason IN ('condition_resolved', 'condition_cancelled')
		  AND (lifecycle_next_version IS NULL OR lifecycle_next_version = ?)`, nextVersion, eventVersion, nextVersion)
	if err != nil {
		return nil, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		var storedNextVersion sql.NullString
		var closedAt sql.NullTime
		err := q.QueryRowContext(ctx, `
			SELECT lifecycle_next_version, lifecycle_closed_at
			FROM aims_notification_checkpoint
			WHERE event_version = ?
			LIMIT 1`, eventVersion).Scan(&storedNextVersion, &closedAt)
		if err == nil && closedAt.Valid && storedNextVersion.String == nextVersion {
			return map[string]any{"eventVersion": eventVersion, "nextVersion": nextVersion, "acknowledged": true, "idempotent": true}, nil
		}
		return nil, httperror.New(http.StatusConflict, "aims_due_closure_ack_conflict", "closure checkpoint is stale or conflicts with existing evidence")
	}
	return map[string]any{"eventVersion": eventVersion, "nextVersion": nextVersion, "acknowledged": true}, nil
}

func validAimsDueStream(stream string) bool {
	return stream == dueStreamResponse || stream == dueStreamResolution || stream == dueStreamWorkItem
}

func buildAimsDueCandidate(stream string, asOf time.Time, fact aimsDueFact, generation int64) (aimsDueCandidate, bool) {
	phase := aimsDuePhase(stream, asOf, fact.DueAt)
	if phase == "" {
		return aimsDueCandidate{}, false
	}
	versionHash := aimsDueHash(strings.Join([]string{
		"v1", stream, strconv.FormatInt(fact.ID, 10), strconv.FormatInt(generation, 10), fact.DueAt.UTC().Format(time.RFC3339), phase,
		fact.Status, fact.Priority, fact.Severity.String, fact.AssigneeUID.String,
		fact.ProjectLeaderUID.String, fact.DeptCode.String,
	}, "|"))[:24]
	eventVersion := "v1:" + versionHash
	return aimsDueCandidate{
		Stream: stream, Phase: phase, WorkItemID: fact.ID, ProjectID: fact.ProjectID,
		ProjectCode: fact.ProjectCode, ProjectName: fact.ProjectName, ItemKey: fact.ItemKey, Title: fact.Title,
		Status: fact.Status, Priority: fact.Priority, Severity: nullStringPointer(fact.Severity),
		AssigneeUID: nullStringPointer(fact.AssigneeUID), ProjectLeaderUID: nullStringPointer(fact.ProjectLeaderUID),
		DeptCode: nullStringPointer(fact.DeptCode), DueAt: fact.DueAt.UTC().Format(time.RFC3339), EventVersion: eventVersion,
		IdempotencyKey: fmt.Sprintf("aims-due:%s:%d:g%d:%s:%s", stream, fact.ID, generation, phase, versionHash),
		ActionableKey:  fmt.Sprintf("aims:work-item:%d:%s:g%d", fact.ID, stream, generation),
	}, true
}

func aimsDueSourceVersion(stream string, fact aimsDueFact) string {
	return aimsDueHash(strings.Join([]string{
		stream, strconv.FormatInt(fact.ID, 10), fact.DueAt.UTC().Format(time.RFC3339),
		fact.Status, fact.Priority, fact.Severity.String, fact.AssigneeUID.String,
		fact.ProjectLeaderUID.String, fact.DeptCode.String,
	}, "|"))
}

func aimsDuePhase(stream string, asOf time.Time, dueAt time.Time) string {
	asOf, dueAt = asOf.UTC(), dueAt.UTC()
	if stream == dueStreamWorkItem {
		asOfDate := time.Date(asOf.Year(), asOf.Month(), asOf.Day(), 0, 0, 0, 0, time.UTC)
		dueDate := time.Date(dueAt.Year(), dueAt.Month(), dueAt.Day(), 0, 0, 0, 0, time.UTC)
		days := int(dueDate.Sub(asOfDate) / (24 * time.Hour))
		switch {
		case days < 0:
			return "overdue"
		case days <= 1:
			return "D1"
		case days <= 3:
			return "D3"
		default:
			return ""
		}
	}
	remaining := dueAt.Sub(asOf)
	switch {
	case remaining <= 0:
		return "breached"
	case remaining <= time.Hour:
		return "T-1h"
	case remaining <= 4*time.Hour:
		return "T-4h"
	default:
		return ""
	}
}

func aimsDuePhaseRank(stream string, phase string) int {
	if stream == dueStreamWorkItem {
		return map[string]int{"D3": 1, "D1": 2, "overdue": 3}[phase]
	}
	return map[string]int{"T-4h": 1, "T-1h": 2, "breached": 3}[phase]
}

func encodeAimsDueCursor(dueAt time.Time, id int64) (string, error) {
	payload, err := json.Marshal(aimsDueCursor{DueAt: dueAt.UTC().Format(time.RFC3339), ID: id})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeAimsDueCursor(raw string) (*aimsDueCursor, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, err
	}
	var cursor aimsDueCursor
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return nil, err
	}
	if cursor.ID <= 0 {
		return nil, fmt.Errorf("cursor id must be positive")
	}
	if _, err := time.Parse(time.RFC3339, cursor.DueAt); err != nil {
		return nil, err
	}
	return &cursor, nil
}

func aimsDueHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func nullableAimsSQLText(value sql.NullString) any {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}
	return strings.TrimSpace(value.String)
}

func nullableAimsPointerText(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}

func stringPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func nullStringPointer(value sql.NullString) *string {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}
	result := strings.TrimSpace(value.String)
	return &result
}

// aimsDueQuerier is satisfied by both *sql.DB and *sql.Tx.
type aimsDueQuerier interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// aimsDueStore decides where due-notification statements run. The legacy store
// keeps its original autocommit statements; the unified scheduler store runs
// every step inside a generation-fenced transaction.
type aimsDueStore struct {
	statement func(context.Context, func(aimsDueQuerier) error) error
	begin     func(context.Context) (*sql.Tx, error)
}

func (a *Adapter) legacyDueStore() aimsDueStore {
	return aimsDueStore{
		statement: func(ctx context.Context, run func(aimsDueQuerier) error) error { return run(a.DB()) },
		begin:     func(ctx context.Context) (*sql.Tx, error) { return a.DB().BeginTx(ctx, nil) },
	}
}

func schedulerDueStore(begin func(context.Context) (*sql.Tx, error)) aimsDueStore {
	return aimsDueStore{
		statement: func(ctx context.Context, run func(aimsDueQuerier) error) error {
			tx, err := begin(ctx)
			if err != nil {
				return err
			}
			defer tx.Rollback()
			if err = run(tx); err != nil {
				return err
			}
			return tx.Commit()
		},
		begin: begin,
	}
}

func (s aimsDueStore) queryDueFacts(ctx context.Context, stream string, asOf time.Time, cursor *aimsDueCursor, limit int) ([]aimsDueFact, error) {
	var facts []aimsDueFact
	err := s.statement(ctx, func(q aimsDueQuerier) error {
		var err error
		facts, err = queryDueFactsWith(ctx, q, stream, asOf, cursor, limit)
		return err
	})
	return facts, err
}

func (s aimsDueStore) reconcileDueNotificationCheckpoints(ctx context.Context, stream string, asOf time.Time) error {
	return s.statement(ctx, func(q aimsDueQuerier) error { return reconcileDueNotificationCheckpointsWith(ctx, q, stream, asOf) })
}

func (s aimsDueStore) pendingDueNotificationClosures(ctx context.Context, stream string, limit int) ([]aimsDueClosure, error) {
	var closures []aimsDueClosure
	err := s.statement(ctx, func(q aimsDueQuerier) error {
		var err error
		closures, err = pendingDueNotificationClosuresWith(ctx, q, stream, limit)
		return err
	})
	return closures, err
}

func (s aimsDueStore) acknowledgeDueNotification(ctx context.Context, body map[string]any) (map[string]any, error) {
	var out map[string]any
	err := s.statement(ctx, func(q aimsDueQuerier) error {
		var err error
		out, err = acknowledgeDueNotificationWith(ctx, q, body)
		return err
	})
	return out, err
}

func (s aimsDueStore) acknowledgeDueNotificationClosure(ctx context.Context, body map[string]any) (map[string]any, error) {
	var out map[string]any
	err := s.statement(ctx, func(q aimsDueQuerier) error {
		var err error
		out, err = acknowledgeDueNotificationClosureWith(ctx, q, body)
		return err
	})
	return out, err
}

// Legacy entry points kept for the original adapter path and its tests.
func (a *Adapter) openDueNotificationCheckpoint(ctx context.Context, stream string, asOf time.Time, fact aimsDueFact) (*aimsDueCandidate, bool, error) {
	return a.legacyDueStore().openDueNotificationCheckpoint(ctx, stream, asOf, fact)
}

func (a *Adapter) queryDueFacts(ctx context.Context, stream string, asOf time.Time, cursor *aimsDueCursor, limit int) ([]aimsDueFact, error) {
	return a.legacyDueStore().queryDueFacts(ctx, stream, asOf, cursor, limit)
}
