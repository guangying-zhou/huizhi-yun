package people

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const (
	offboardingHandoverDueStream = "offboarding_handover_due"
	offboardingAssetDueStream    = "offboarding_asset_recovery_due"
)

type offboardingDueCursor struct {
	DueAt string `json:"dueAt"`
	ID    int64  `json:"id"`
}

type offboardingDueFact struct {
	ID             int64
	TaskCode       string
	CaseCode       string
	TaskType       string
	ResponsibleUID string
	DueAt          time.Time
}

type offboardingDueCandidate struct {
	Stream               string   `json:"stream"`
	Phase                string   `json:"phase"`
	SourceType           string   `json:"sourceType"`
	SourceID             int64    `json:"sourceId"`
	SourceCode           string   `json:"sourceCode"`
	SourceName           string   `json:"sourceName"`
	CaseCode             string   `json:"caseCode"`
	TaskCode             string   `json:"taskCode"`
	TaskType             string   `json:"taskType"`
	DueAt                string   `json:"dueAt"`
	RecipientCandidates  []string `json:"recipientCandidates"`
	EventVersion         string   `json:"eventVersion"`
	PreviousEventVersion *string  `json:"previousEventVersion,omitempty"`
	PreviousRecipientUID *string  `json:"previousRecipientUid,omitempty"`
	IdempotencyKey       string   `json:"idempotencyKey"`
	ActionableKey        string   `json:"actionableKey"`
}

type offboardingDueClosure struct {
	CheckpointEventVersion string `json:"checkpointEventVersion"`
	ExpectedVersion        string `json:"expectedVersion"`
	ActionableKey          string `json:"actionableKey"`
	SourceType             string `json:"sourceType"`
	SourceID               int64  `json:"sourceId"`
	CaseCode               string `json:"caseCode"`
	TaskCode               string `json:"taskCode"`
	TaskType               string `json:"taskType"`
	RecipientUID           string `json:"recipientUid"`
	NextVersion            string `json:"nextVersion"`
	State                  string `json:"state"`
}

func (a *Adapter) handleOffboardingDueNotificationRuntime(ctx context.Context, method, path string, body map[string]any) (any, string, bool, error) {
	if method != http.MethodPost {
		return nil, "", false, nil
	}
	switch path {
	case "/v1/people/service/notifications:scan-due":
		result, err := a.scanOffboardingDueNotifications(ctx, body)
		return result, "people.notifications.offboarding.scan", true, err
	case "/v1/people/service/notifications:acknowledge":
		result, err := a.acknowledgeOffboardingDueNotification(ctx, body)
		return result, "people.notifications.offboarding.acknowledge", true, err
	case "/v1/people/service/notifications:acknowledge-closure":
		result, err := a.acknowledgeOffboardingDueClosure(ctx, body)
		return result, "people.notifications.offboarding.closure_acknowledge", true, err
	default:
		return nil, "", false, nil
	}
}

func (a *Adapter) scanOffboardingDueNotifications(ctx context.Context, body map[string]any) (map[string]any, error) {
	stream := strings.TrimSpace(cleanBodyString(body, "stream"))
	if !validOffboardingDueStream(stream) {
		return nil, httperror.New(http.StatusBadRequest, "offboarding_due_stream_invalid", "stream is not supported")
	}
	asOf, err := time.Parse(time.RFC3339, strings.TrimSpace(cleanBodyString(body, "asOf")))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "offboarding_due_as_of_invalid", "asOf must be an explicit RFC3339 timestamp")
	}
	asOf = asOf.UTC()
	cursor, err := decodeOffboardingDueCursor(cleanBodyString(body, "cursor"))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "offboarding_due_cursor_invalid", "cursor is invalid")
	}
	limit := int(float64FromAny(body["limit"]))
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	if err := a.reconcileOffboardingDueCheckpoints(ctx, stream); err != nil {
		return nil, err
	}
	facts, err := a.queryOffboardingDueFacts(ctx, stream, asOf, cursor, limit+1)
	if err != nil {
		return nil, err
	}
	hasMore := len(facts) > limit
	if hasMore {
		facts = facts[:limit]
	}
	items := make([]offboardingDueCandidate, 0, len(facts))
	for _, fact := range facts {
		candidate, pending, err := a.openOffboardingDueCheckpoint(ctx, stream, asOf, fact)
		if err != nil {
			return nil, err
		}
		if pending {
			items = append(items, *candidate)
		}
	}
	closures, err := a.pendingOffboardingDueClosures(ctx, stream, limit)
	if err != nil {
		return nil, err
	}
	var nextCursor any
	if hasMore && len(facts) > 0 {
		nextCursor, err = encodeOffboardingDueCursor(facts[len(facts)-1].DueAt, facts[len(facts)-1].ID)
		if err != nil {
			return nil, err
		}
	}
	return map[string]any{"stream": stream, "asOf": asOf.Format(time.RFC3339), "items": items, "closures": closures, "nextCursor": nextCursor}, nil
}

func (a *Adapter) queryOffboardingDueFacts(ctx context.Context, stream string, asOf time.Time, cursor *offboardingDueCursor, limit int) ([]offboardingDueFact, error) {
	taskType := offboardingTaskTypeForStream(stream)
	args := []any{taskType, asOf.AddDate(0, 0, 30).UTC()}
	query := `
		SELECT t.id,t.task_code,t.case_code,t.task_type,t.responsible_uid,t.due_at
		FROM people_offboarding_tasks t
		JOIN people_offboarding_cases c ON c.case_code=t.case_code
		WHERE t.task_type=? AND t.status='pending' AND c.status='active' AND t.due_at<=?`
	if cursor != nil {
		cursorTime, _ := time.Parse(time.RFC3339, cursor.DueAt)
		query += ` AND (t.due_at>? OR (t.due_at=? AND t.id>?))`
		args = append(args, cursorTime.UTC(), cursorTime.UTC(), cursor.ID)
	}
	args = append(args, limit)
	rows, err := a.DB().QueryContext(ctx, query+` ORDER BY t.due_at ASC,t.id ASC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	facts := make([]offboardingDueFact, 0, limit)
	for rows.Next() {
		var fact offboardingDueFact
		if err := rows.Scan(&fact.ID, &fact.TaskCode, &fact.CaseCode, &fact.TaskType, &fact.ResponsibleUID, &fact.DueAt); err != nil {
			return nil, err
		}
		if validateOffboardingIdentity(fact.ResponsibleUID, "responsibleUid") == nil {
			fact.DueAt = fact.DueAt.UTC()
			facts = append(facts, fact)
		}
	}
	return facts, rows.Err()
}

func (a *Adapter) reconcileOffboardingDueCheckpoints(ctx context.Context, stream string) error {
	taskType := offboardingTaskTypeForStream(stream)
	if _, err := a.DB().ExecContext(ctx, `
		UPDATE people_offboarding_notification_checkpoint cp
		JOIN people_offboarding_tasks t ON t.id=cp.source_id
		JOIN people_offboarding_cases c ON c.case_code=t.case_code
		SET cp.state='closed',cp.close_reason='condition_resolved',cp.closed_at=UTC_TIMESTAMP(),cp.updated_at=UTC_TIMESTAMP()
		WHERE cp.event_stream=? AND cp.source_type='offboarding_task' AND cp.state='open'
		  AND t.task_type=? AND t.status='completed'`, stream, taskType); err != nil {
		return err
	}
	_, err := a.DB().ExecContext(ctx, `
		UPDATE people_offboarding_notification_checkpoint cp
		LEFT JOIN people_offboarding_tasks t ON t.id=cp.source_id
		LEFT JOIN people_offboarding_cases c ON c.case_code=t.case_code
		SET cp.state='closed',cp.close_reason='condition_cancelled',cp.closed_at=UTC_TIMESTAMP(),cp.updated_at=UTC_TIMESTAMP()
		WHERE cp.event_stream=? AND cp.source_type='offboarding_task' AND cp.state='open'
		  AND (t.id IS NULL OR t.task_type<>? OR t.status='cancelled' OR c.id IS NULL OR c.status<>'active')`, stream, taskType)
	return err
}

func (a *Adapter) openOffboardingDueCheckpoint(ctx context.Context, stream string, asOf time.Time, fact offboardingDueFact) (*offboardingDueCandidate, bool, error) {
	phase := offboardingDuePhase(asOf, fact.DueAt)
	if phase == "" {
		return nil, false, nil
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback()
	sourceVersion := offboardingDueSourceVersion(stream, fact)
	generation := int64(1)
	var latestGeneration int64
	var latestState, latestSourceVersion, latestEventVersion, latestPhase, latestCloseReason string
	var latestRecipient sql.NullString
	latestErr := tx.QueryRowContext(ctx, `
		SELECT condition_generation,state,source_version,event_version,phase,COALESCE(close_reason,''),notified_recipient_uid
		FROM people_offboarding_notification_checkpoint
		WHERE event_stream=? AND source_type='offboarding_task' AND source_id=?
		ORDER BY condition_generation DESC,id DESC LIMIT 1 FOR UPDATE`, stream, fact.ID).Scan(
		&latestGeneration, &latestState, &latestSourceVersion, &latestEventVersion, &latestPhase, &latestCloseReason, &latestRecipient)
	if latestErr != nil && latestErr != sql.ErrNoRows {
		return nil, false, latestErr
	}
	var previousEvent, previousRecipient *string
	if latestErr == nil {
		if latestSourceVersion == sourceVersion && (latestState == "open" || latestCloseReason == "superseded") {
			if offboardingDuePhaseRank(latestPhase) > offboardingDuePhaseRank(phase) {
				return nil, false, nil
			}
			generation = latestGeneration
			previousEvent = offboardingTextPointer(latestEventVersion)
			previousRecipient = offboardingNullTextPointer(latestRecipient)
		} else {
			generation = latestGeneration + 1
			if latestState == "open" {
				if _, err := tx.ExecContext(ctx, `UPDATE people_offboarding_notification_checkpoint SET state='closed',close_reason='condition_cancelled',closed_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE event_stream=? AND source_type='offboarding_task' AND source_id=? AND state='open'`, stream, fact.ID); err != nil {
					return nil, false, err
				}
			}
		}
	}
	candidate := buildOffboardingDueCandidate(stream, phase, fact, generation)
	if previousEvent != nil && *previousEvent == candidate.EventVersion {
		previousEvent, previousRecipient = nil, nil
	}
	candidate.PreviousEventVersion, candidate.PreviousRecipientUID = previousEvent, previousRecipient
	if latestErr == nil && generation == latestGeneration && latestState == "open" && latestEventVersion != candidate.EventVersion {
		if _, err := tx.ExecContext(ctx, `UPDATE people_offboarding_notification_checkpoint SET state='closed',close_reason='superseded',closed_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE event_version=? AND state='open'`, latestEventVersion); err != nil {
			return nil, false, err
		}
	}
	recipientsJSON, _ := json.Marshal([]string{fact.ResponsibleUID})
	_, err = tx.ExecContext(ctx, `
		INSERT IGNORE INTO people_offboarding_notification_checkpoint
		(event_stream,source_type,source_id,condition_generation,phase,source_version,event_version,
		 previous_event_version,previous_recipient_uid,idempotency_key,actionable_key,due_at,
		 case_code,task_code,task_type,source_name,recipient_candidates_json,state)
		VALUES (?,'offboarding_task',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open')`,
		stream, fact.ID, generation, phase, sourceVersion, candidate.EventVersion, offboardingNullableText(previousEvent),
		offboardingNullableText(previousRecipient), candidate.IdempotencyKey, candidate.ActionableKey, fact.DueAt,
		fact.CaseCode, fact.TaskCode, fact.TaskType, candidate.SourceName, string(recipientsJSON))
	if err != nil {
		return nil, false, err
	}
	var state string
	var notificationID, storedPreviousEvent, storedPreviousRecipient sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT state,notification_id,previous_event_version,previous_recipient_uid FROM people_offboarding_notification_checkpoint WHERE event_version=? LIMIT 1 FOR UPDATE`, candidate.EventVersion).Scan(&state, &notificationID, &storedPreviousEvent, &storedPreviousRecipient); err != nil {
		return nil, false, err
	}
	candidate.PreviousEventVersion = offboardingNullTextPointer(storedPreviousEvent)
	candidate.PreviousRecipientUID = offboardingNullTextPointer(storedPreviousRecipient)
	if err := tx.Commit(); err != nil {
		return nil, false, err
	}
	return &candidate, state == "open" && !notificationID.Valid, nil
}

func (a *Adapter) pendingOffboardingDueClosures(ctx context.Context, stream string, limit int) ([]offboardingDueClosure, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT cp.event_version,delivered.event_version,cp.actionable_key,cp.source_type,cp.source_id,
		       cp.case_code,cp.task_code,cp.task_type,delivered.notified_recipient_uid,cp.close_reason
		FROM people_offboarding_notification_checkpoint cp
		JOIN people_offboarding_notification_checkpoint delivered ON delivered.id=(
		 SELECT prior.id FROM people_offboarding_notification_checkpoint prior
		 WHERE prior.event_stream=cp.event_stream AND prior.source_type=cp.source_type AND prior.source_id=cp.source_id
		   AND prior.condition_generation=cp.condition_generation AND prior.id<=cp.id
		   AND prior.notification_id IS NOT NULL AND prior.notified_recipient_uid IS NOT NULL
		 ORDER BY prior.id DESC LIMIT 1)
		WHERE cp.event_stream=? AND cp.state='closed' AND cp.close_reason IN ('condition_resolved','condition_cancelled')
		  AND cp.lifecycle_closed_at IS NULL
		ORDER BY cp.closed_at ASC,cp.id ASC LIMIT ?`, stream, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]offboardingDueClosure, 0)
	for rows.Next() {
		var item offboardingDueClosure
		var reason string
		if err := rows.Scan(&item.CheckpointEventVersion, &item.ExpectedVersion, &item.ActionableKey, &item.SourceType, &item.SourceID,
			&item.CaseCode, &item.TaskCode, &item.TaskType, &item.RecipientUID, &reason); err != nil {
			return nil, err
		}
		item.State = "cancelled"
		if reason == "condition_resolved" {
			item.State = "resolved"
		}
		item.NextVersion = item.State + ":" + item.CheckpointEventVersion
		items = append(items, item)
	}
	return items, rows.Err()
}

func (a *Adapter) acknowledgeOffboardingDueNotification(ctx context.Context, body map[string]any) (map[string]any, error) {
	eventVersion := strings.TrimSpace(cleanBodyString(body, "eventVersion"))
	notificationID := strings.TrimSpace(cleanBodyString(body, "notificationId"))
	recipientUID := strings.TrimSpace(cleanBodyString(body, "recipientUid"))
	if eventVersion == "" || notificationID == "" || validateOffboardingIdentity(recipientUID, "recipientUid") != nil {
		return nil, httperror.New(http.StatusBadRequest, "offboarding_due_ack_invalid", "eventVersion, notificationId and an explicit recipientUid are required")
	}
	result, err := a.DB().ExecContext(ctx, `UPDATE people_offboarding_notification_checkpoint
		SET notification_id=?,notified_recipient_uid=?,acknowledged_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
		WHERE event_version=? AND JSON_CONTAINS(recipient_candidates_json,JSON_QUOTE(?))
		  AND (notification_id IS NULL OR (notification_id=? AND notified_recipient_uid=?))`, notificationID, recipientUID, eventVersion, recipientUID, notificationID, recipientUID)
	if err != nil {
		return nil, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		var state string
		var storedNotification, storedRecipient sql.NullString
		err := a.DB().QueryRowContext(ctx, `SELECT state,notification_id,notified_recipient_uid FROM people_offboarding_notification_checkpoint WHERE event_version=? LIMIT 1`, eventVersion).Scan(&state, &storedNotification, &storedRecipient)
		if err == nil && (state == "open" || state == "closed") && storedNotification.String == notificationID && storedRecipient.String == recipientUID {
			return map[string]any{"eventVersion": eventVersion, "notificationId": notificationID, "recipientUid": recipientUID, "acknowledged": true, "idempotent": true}, nil
		}
		return nil, httperror.New(http.StatusConflict, "offboarding_due_ack_conflict", "notification checkpoint is stale or recipient evidence conflicts")
	}
	return map[string]any{"eventVersion": eventVersion, "notificationId": notificationID, "recipientUid": recipientUID, "acknowledged": true}, nil
}

func (a *Adapter) acknowledgeOffboardingDueClosure(ctx context.Context, body map[string]any) (map[string]any, error) {
	eventVersion := strings.TrimSpace(cleanBodyString(body, "eventVersion"))
	nextVersion := strings.TrimSpace(cleanBodyString(body, "nextVersion"))
	if eventVersion == "" || nextVersion == "" {
		return nil, httperror.New(http.StatusBadRequest, "offboarding_due_closure_ack_invalid", "eventVersion and nextVersion are required")
	}
	result, err := a.DB().ExecContext(ctx, `UPDATE people_offboarding_notification_checkpoint SET lifecycle_closed_at=UTC_TIMESTAMP(),lifecycle_next_version=?,updated_at=UTC_TIMESTAMP() WHERE event_version=? AND state='closed' AND close_reason IN ('condition_resolved','condition_cancelled') AND (lifecycle_next_version IS NULL OR lifecycle_next_version=?)`, nextVersion, eventVersion, nextVersion)
	if err != nil {
		return nil, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		var stored sql.NullString
		var closed sql.NullTime
		err := a.DB().QueryRowContext(ctx, `SELECT lifecycle_next_version,lifecycle_closed_at FROM people_offboarding_notification_checkpoint WHERE event_version=? LIMIT 1`, eventVersion).Scan(&stored, &closed)
		if err == nil && closed.Valid && stored.String == nextVersion {
			return map[string]any{"eventVersion": eventVersion, "nextVersion": nextVersion, "acknowledged": true, "idempotent": true}, nil
		}
		return nil, httperror.New(http.StatusConflict, "offboarding_due_closure_ack_conflict", "closure checkpoint is stale or conflicts with existing evidence")
	}
	return map[string]any{"eventVersion": eventVersion, "nextVersion": nextVersion, "acknowledged": true}, nil
}

func buildOffboardingDueCandidate(stream, phase string, fact offboardingDueFact, generation int64) offboardingDueCandidate {
	sourceName := "Offboarding handover"
	if fact.TaskType == offboardingTaskAssetRecovery {
		sourceName = "Offboarding asset recovery coordination"
	}
	hash := offboardingHash(strings.Join([]string{"v1", stream, strconv.FormatInt(fact.ID, 10), strconv.FormatInt(generation, 10), fact.CaseCode, fact.TaskCode, fact.TaskType, fact.ResponsibleUID, fact.DueAt.Format(time.RFC3339), phase}, "|"))[:24]
	return offboardingDueCandidate{
		Stream: stream, Phase: phase, SourceType: "offboarding_task", SourceID: fact.ID,
		SourceCode: fact.TaskCode, SourceName: sourceName, CaseCode: fact.CaseCode, TaskCode: fact.TaskCode,
		TaskType: fact.TaskType, DueAt: fact.DueAt.Format(time.RFC3339), RecipientCandidates: []string{fact.ResponsibleUID},
		EventVersion:   "v1:" + hash,
		IdempotencyKey: fmt.Sprintf("people-offboarding:%s:%d:g%d:%s:%s", stream, fact.ID, generation, phase, hash),
		ActionableKey:  fmt.Sprintf("people:offboarding_task:%d:%s:g%d", fact.ID, stream, generation),
	}
}

func offboardingDueSourceVersion(stream string, fact offboardingDueFact) string {
	return offboardingHash(strings.Join([]string{stream, strconv.FormatInt(fact.ID, 10), fact.CaseCode, fact.TaskCode, fact.TaskType, fact.ResponsibleUID, fact.DueAt.Format(time.RFC3339)}, "|"))
}

func offboardingDuePhase(asOf, dueAt time.Time) string {
	asOf, dueAt = asOf.UTC(), dueAt.UTC()
	if !dueAt.After(asOf) {
		return "expired"
	}
	duration := dueAt.Sub(asOf)
	switch {
	case duration <= 24*time.Hour:
		return "D1"
	case duration <= 7*24*time.Hour:
		return "D7"
	case duration <= 30*24*time.Hour:
		return "D30"
	default:
		return ""
	}
}

func offboardingDuePhaseRank(phase string) int {
	return map[string]int{"D30": 1, "D7": 2, "D1": 3, "expired": 4}[phase]
}

func validOffboardingDueStream(stream string) bool {
	return stream == offboardingHandoverDueStream || stream == offboardingAssetDueStream
}

func offboardingTaskTypeForStream(stream string) string {
	if stream == offboardingAssetDueStream {
		return offboardingTaskAssetRecovery
	}
	return offboardingTaskHandover
}

func encodeOffboardingDueCursor(dueAt time.Time, id int64) (string, error) {
	payload, err := json.Marshal(offboardingDueCursor{DueAt: dueAt.UTC().Format(time.RFC3339), ID: id})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeOffboardingDueCursor(raw string) (*offboardingDueCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, err
	}
	var cursor offboardingDueCursor
	if err := json.Unmarshal(payload, &cursor); err != nil || cursor.ID <= 0 {
		return nil, fmt.Errorf("invalid cursor")
	}
	if _, err := time.Parse(time.RFC3339, cursor.DueAt); err != nil {
		return nil, err
	}
	return &cursor, nil
}

func offboardingTextPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func offboardingNullTextPointer(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return offboardingTextPointer(value.String)
}

func offboardingNullableText(value *string) any {
	if value == nil {
		return nil
	}
	return strings.TrimSpace(*value)
}
