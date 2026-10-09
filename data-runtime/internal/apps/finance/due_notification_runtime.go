package finance

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
	financeInvoiceIssuanceDueStream       = "invoice_issuance_due"
	financeReceiptReconciliationDueStream = "receipt_reconciliation_due"
)

type financeDueCursor struct {
	DueAt string `json:"dueAt"`
	ID    int64  `json:"id"`
}

type financeDueFact struct {
	ID             int64
	SourceType     string
	Code           string
	Name           string
	ResponsibleUID string
	DueAt          time.Time
}

type financeDueCandidate struct {
	Stream               string   `json:"stream"`
	Phase                string   `json:"phase"`
	SourceType           string   `json:"sourceType"`
	SourceID             int64    `json:"sourceId"`
	SourceCode           string   `json:"sourceCode"`
	SourceName           string   `json:"sourceName"`
	DueAt                string   `json:"dueAt"`
	RecipientCandidates  []string `json:"recipientCandidates"`
	EventVersion         string   `json:"eventVersion"`
	PreviousEventVersion *string  `json:"previousEventVersion,omitempty"`
	PreviousRecipientUID *string  `json:"previousRecipientUid,omitempty"`
	IdempotencyKey       string   `json:"idempotencyKey"`
	ActionableKey        string   `json:"actionableKey"`
}

type financeDueClosure struct {
	CheckpointEventVersion string `json:"checkpointEventVersion"`
	ExpectedVersion        string `json:"expectedVersion"`
	ActionableKey          string `json:"actionableKey"`
	SourceType             string `json:"sourceType"`
	SourceID               int64  `json:"sourceId"`
	SourceCode             string `json:"sourceCode"`
	RecipientUID           string `json:"recipientUid"`
	NextVersion            string `json:"nextVersion"`
	State                  string `json:"state"`
}

func (a *Adapter) HandleDueNotificationRuntime(ctx context.Context, path string, body map[string]any) (any, string, error) {
	switch path {
	case "/v1/finance/service/notifications:scan-due":
		result, err := a.scanFinanceDueNotifications(ctx, body)
		return result, "finance.notifications.due.scan", err
	case "/v1/finance/service/notifications:acknowledge":
		result, err := a.acknowledgeFinanceDueNotification(ctx, body)
		return result, "finance.notifications.due.acknowledge", err
	case "/v1/finance/service/notifications:acknowledge-closure":
		result, err := a.acknowledgeFinanceDueClosure(ctx, body)
		return result, "finance.notifications.due.closure_acknowledge", err
	default:
		return nil, "", httperror.New(http.StatusNotFound, "not_found", "Route not found")
	}
}

func (a *Adapter) scanFinanceDueNotifications(ctx context.Context, body map[string]any) (map[string]any, error) {
	stream := cleanStringValue(bodyValue(jsonBody(body), "stream"))
	if !validFinanceDueStream(stream) {
		return nil, httperror.New(http.StatusBadRequest, "finance_due_stream_invalid", "stream is not supported")
	}
	asOf, err := time.Parse(time.RFC3339, cleanStringValue(bodyValue(jsonBody(body), "asOf")))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "finance_due_as_of_invalid", "asOf must be an explicit RFC3339 timestamp")
	}
	asOf = asOf.UTC()
	cursor, err := decodeFinanceDueCursor(cleanStringValue(bodyValue(jsonBody(body), "cursor")))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "finance_due_cursor_invalid", "cursor is invalid")
	}
	limit := int(amountAsFloat(body["limit"]))
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	if err := a.reconcileFinanceDueCheckpoints(ctx, stream); err != nil {
		return nil, err
	}
	facts, err := a.queryFinanceDueFacts(ctx, stream, asOf, cursor, limit+1)
	if err != nil {
		return nil, err
	}
	hasMore := len(facts) > limit
	if hasMore {
		facts = facts[:limit]
	}
	items := make([]financeDueCandidate, 0, len(facts))
	for _, fact := range facts {
		candidate, pending, err := a.openFinanceDueCheckpoint(ctx, stream, fact, asOf)
		if err != nil {
			return nil, err
		}
		if pending {
			items = append(items, *candidate)
		}
	}
	closures, err := a.pendingFinanceDueClosures(ctx, stream, limit)
	if err != nil {
		return nil, err
	}
	var nextCursor any
	if hasMore && len(facts) > 0 {
		nextCursor, err = encodeFinanceDueCursor(facts[len(facts)-1].DueAt, facts[len(facts)-1].ID)
		if err != nil {
			return nil, err
		}
	}
	return map[string]any{"stream": stream, "asOf": asOf.Format(time.RFC3339), "items": items, "closures": closures, "nextCursor": nextCursor}, nil
}

func (a *Adapter) queryFinanceDueFacts(ctx context.Context, stream string, asOf time.Time, cursor *financeDueCursor, limit int) ([]financeDueFact, error) {
	args := []any{asOf.AddDate(0, 0, 30).UTC()}
	query := ""
	if stream == financeInvoiceIssuanceDueStream {
		query = `SELECT id,code,COALESCE(customer_name,code),issuance_responsible_uid,issuance_due_at
			FROM invoice_request
			WHERE deleted_at IS NULL AND status='approved' AND issued_invoice_id IS NULL
			  AND issuance_responsible_uid IS NOT NULL AND issuance_due_at IS NOT NULL AND issuance_due_at<=?`
	} else {
		query = `SELECT r.id,r.code,COALESCE(r.customer_name,r.payer_name,r.code),r.reconciliation_responsible_uid,r.reconciliation_due_at
			FROM finance_receipt r
			WHERE r.deleted_at IS NULL AND r.status IN ('confirmed','partially_reconciled')
			  AND r.received_amount>COALESCE((SELECT SUM(rec.reconciled_amount) FROM finance_reconciliation rec WHERE rec.receipt_id=r.id AND rec.status='active'),0)
			  AND r.reconciliation_responsible_uid IS NOT NULL AND r.reconciliation_due_at IS NOT NULL AND r.reconciliation_due_at<=?`
	}
	if cursor != nil {
		cursorTime, _ := time.Parse(time.RFC3339, cursor.DueAt)
		dueColumn := "issuance_due_at"
		if stream == financeReceiptReconciliationDueStream {
			dueColumn = "reconciliation_due_at"
		}
		columnPrefix := ""
		if stream == financeReceiptReconciliationDueStream {
			columnPrefix = "r."
		}
		query += ` AND (` + columnPrefix + dueColumn + `>? OR (` + columnPrefix + dueColumn + `=? AND ` + columnPrefix + `id>?))`
		args = append(args, cursorTime.UTC(), cursorTime.UTC(), cursor.ID)
	}
	args = append(args, limit)
	dueColumn := "issuance_due_at"
	sourceType := "invoice_request"
	if stream == financeReceiptReconciliationDueStream {
		dueColumn, sourceType = "reconciliation_due_at", "finance_receipt"
	}
	columnPrefix := ""
	if stream == financeReceiptReconciliationDueStream {
		columnPrefix = "r."
	}
	rows, err := a.db.QueryContext(ctx, query+` ORDER BY `+columnPrefix+dueColumn+` ASC,`+columnPrefix+`id ASC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	facts := make([]financeDueFact, 0, limit)
	for rows.Next() {
		var fact financeDueFact
		if err := rows.Scan(&fact.ID, &fact.Code, &fact.Name, &fact.ResponsibleUID, &fact.DueAt); err != nil {
			return nil, err
		}
		fact.SourceType = sourceType
		if validFinanceResponsibleUID(fact.ResponsibleUID) {
			fact.DueAt = fact.DueAt.UTC()
			facts = append(facts, fact)
		}
	}
	return facts, rows.Err()
}

func (a *Adapter) reconcileFinanceDueCheckpoints(ctx context.Context, stream string) error {
	if stream == financeInvoiceIssuanceDueStream {
		if _, err := a.db.ExecContext(ctx, `UPDATE finance_notification_checkpoint cp JOIN invoice_request r ON r.id=cp.source_id
			SET cp.state='closed',cp.close_reason='condition_resolved',cp.closed_at=UTC_TIMESTAMP(),cp.updated_at=UTC_TIMESTAMP()
			WHERE cp.event_stream=? AND cp.source_type='invoice_request' AND cp.state='open'
			  AND (r.status='issued' OR r.issued_invoice_id IS NOT NULL)`, stream); err != nil {
			return err
		}
		_, err := a.db.ExecContext(ctx, `UPDATE finance_notification_checkpoint cp LEFT JOIN invoice_request r ON r.id=cp.source_id
			SET cp.state='closed',cp.close_reason='condition_cancelled',cp.closed_at=UTC_TIMESTAMP(),cp.updated_at=UTC_TIMESTAMP()
			WHERE cp.event_stream=? AND cp.source_type='invoice_request' AND cp.state='open'
			  AND (r.id IS NULL OR r.deleted_at IS NOT NULL OR r.status<>'approved' OR r.issued_invoice_id IS NOT NULL
			    OR r.issuance_responsible_uid IS NULL OR r.issuance_due_at IS NULL OR r.issuance_due_at<>cp.due_at
			    OR NOT JSON_CONTAINS(cp.recipient_candidates_json,JSON_QUOTE(r.issuance_responsible_uid)))`, stream)
		return err
	}
	if _, err := a.db.ExecContext(ctx, `UPDATE finance_notification_checkpoint cp JOIN finance_receipt r ON r.id=cp.source_id
		SET cp.state='closed',cp.close_reason='condition_resolved',cp.closed_at=UTC_TIMESTAMP(),cp.updated_at=UTC_TIMESTAMP()
		WHERE cp.event_stream=? AND cp.source_type='finance_receipt' AND cp.state='open'
		  AND (r.status='reconciled' OR r.received_amount<=COALESCE((SELECT SUM(rec.reconciled_amount) FROM finance_reconciliation rec WHERE rec.receipt_id=r.id AND rec.status='active'),0))`, stream); err != nil {
		return err
	}
	_, err := a.db.ExecContext(ctx, `UPDATE finance_notification_checkpoint cp LEFT JOIN finance_receipt r ON r.id=cp.source_id
		SET cp.state='closed',cp.close_reason='condition_cancelled',cp.closed_at=UTC_TIMESTAMP(),cp.updated_at=UTC_TIMESTAMP()
		WHERE cp.event_stream=? AND cp.source_type='finance_receipt' AND cp.state='open'
		  AND (r.id IS NULL OR r.deleted_at IS NOT NULL OR r.status NOT IN ('confirmed','partially_reconciled')
		    OR r.received_amount<=COALESCE((SELECT SUM(rec.reconciled_amount) FROM finance_reconciliation rec WHERE rec.receipt_id=r.id AND rec.status='active'),0)
		    OR r.reconciliation_responsible_uid IS NULL OR r.reconciliation_due_at IS NULL OR r.reconciliation_due_at<>cp.due_at
		    OR NOT JSON_CONTAINS(cp.recipient_candidates_json,JSON_QUOTE(r.reconciliation_responsible_uid)))`, stream)
	return err
}

func (a *Adapter) openFinanceDueCheckpoint(ctx context.Context, stream string, fact financeDueFact, asOf time.Time) (*financeDueCandidate, bool, error) {
	phase := financeDuePhase(asOf, fact.DueAt)
	if phase == "" {
		return nil, false, nil
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback()
	sourceVersion := financeDueSourceVersion(stream, fact)
	generation := int64(1)
	var latestGeneration int64
	var latestState, latestSourceVersion, latestEventVersion, latestPhase, latestCloseReason string
	var latestRecipient sql.NullString
	latestErr := tx.QueryRowContext(ctx, `SELECT condition_generation,state,source_version,event_version,phase,COALESCE(close_reason,''),notified_recipient_uid
		FROM finance_notification_checkpoint WHERE event_stream=? AND source_type=? AND source_id=?
		ORDER BY condition_generation DESC,id DESC LIMIT 1 FOR UPDATE`, stream, fact.SourceType, fact.ID).Scan(
		&latestGeneration, &latestState, &latestSourceVersion, &latestEventVersion, &latestPhase, &latestCloseReason, &latestRecipient)
	if latestErr != nil && latestErr != sql.ErrNoRows {
		return nil, false, latestErr
	}
	var previousEvent, previousRecipient *string
	if latestErr == nil {
		if latestSourceVersion == sourceVersion && (latestState == "open" || latestCloseReason == "superseded") {
			if financeDuePhaseRank(latestPhase) > financeDuePhaseRank(phase) {
				return nil, false, nil
			}
			generation = latestGeneration
			previousEvent, previousRecipient = financeTextPointer(latestEventVersion), financeNullTextPointer(latestRecipient)
		} else {
			generation = latestGeneration + 1
			if latestState == "open" {
				if _, err := tx.ExecContext(ctx, `UPDATE finance_notification_checkpoint SET state='closed',close_reason='condition_cancelled',closed_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE event_stream=? AND source_type=? AND source_id=? AND state='open'`, stream, fact.SourceType, fact.ID); err != nil {
					return nil, false, err
				}
			}
		}
	}
	candidate := buildFinanceDueCandidate(stream, phase, fact, generation)
	if previousEvent != nil && *previousEvent == candidate.EventVersion {
		previousEvent, previousRecipient = nil, nil
	}
	candidate.PreviousEventVersion, candidate.PreviousRecipientUID = previousEvent, previousRecipient
	if latestErr == nil && generation == latestGeneration && latestState == "open" && latestEventVersion != candidate.EventVersion {
		if _, err := tx.ExecContext(ctx, `UPDATE finance_notification_checkpoint SET state='closed',close_reason='superseded',closed_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE event_version=? AND state='open'`, latestEventVersion); err != nil {
			return nil, false, err
		}
	}
	recipientsJSON, _ := json.Marshal([]string{fact.ResponsibleUID})
	_, err = tx.ExecContext(ctx, `INSERT IGNORE INTO finance_notification_checkpoint
		(event_stream,source_type,source_id,condition_generation,phase,source_version,event_version,previous_event_version,
		 previous_recipient_uid,idempotency_key,actionable_key,due_at,source_code,source_name,recipient_candidates_json,state)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open')`, stream, fact.SourceType, fact.ID, generation, phase, sourceVersion,
		candidate.EventVersion, financeNullableText(previousEvent), financeNullableText(previousRecipient), candidate.IdempotencyKey,
		candidate.ActionableKey, fact.DueAt, fact.Code, fact.Name, string(recipientsJSON))
	if err != nil {
		return nil, false, err
	}
	var state string
	var notificationID, storedPreviousEvent, storedPreviousRecipient sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT state,notification_id,previous_event_version,previous_recipient_uid FROM finance_notification_checkpoint WHERE event_version=? LIMIT 1 FOR UPDATE`, candidate.EventVersion).Scan(&state, &notificationID, &storedPreviousEvent, &storedPreviousRecipient); err != nil {
		return nil, false, err
	}
	candidate.PreviousEventVersion, candidate.PreviousRecipientUID = financeNullTextPointer(storedPreviousEvent), financeNullTextPointer(storedPreviousRecipient)
	if err := tx.Commit(); err != nil {
		return nil, false, err
	}
	return &candidate, state == "open" && !notificationID.Valid, nil
}

func (a *Adapter) pendingFinanceDueClosures(ctx context.Context, stream string, limit int) ([]financeDueClosure, error) {
	rows, err := a.db.QueryContext(ctx, `SELECT cp.event_version,delivered.event_version,cp.actionable_key,cp.source_type,cp.source_id,
		cp.source_code,delivered.notified_recipient_uid,cp.close_reason
		FROM finance_notification_checkpoint cp JOIN finance_notification_checkpoint delivered ON delivered.id=(
		 SELECT prior.id FROM finance_notification_checkpoint prior WHERE prior.event_stream=cp.event_stream
		 AND prior.source_type=cp.source_type AND prior.source_id=cp.source_id AND prior.condition_generation=cp.condition_generation
		 AND prior.id<=cp.id AND prior.notification_id IS NOT NULL AND prior.notified_recipient_uid IS NOT NULL ORDER BY prior.id DESC LIMIT 1)
		WHERE cp.event_stream=? AND cp.state='closed' AND cp.close_reason IN ('condition_resolved','condition_cancelled')
		AND cp.lifecycle_closed_at IS NULL ORDER BY cp.closed_at ASC,cp.id ASC LIMIT ?`, stream, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]financeDueClosure, 0)
	for rows.Next() {
		var item financeDueClosure
		var reason string
		if err := rows.Scan(&item.CheckpointEventVersion, &item.ExpectedVersion, &item.ActionableKey, &item.SourceType, &item.SourceID, &item.SourceCode, &item.RecipientUID, &reason); err != nil {
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

func (a *Adapter) acknowledgeFinanceDueNotification(ctx context.Context, body map[string]any) (map[string]any, error) {
	eventVersion := cleanStringValue(body["eventVersion"])
	notificationID := cleanStringValue(body["notificationId"])
	recipientUID := cleanStringValue(body["recipientUid"])
	if eventVersion == "" || notificationID == "" || !validFinanceResponsibleUID(recipientUID) {
		return nil, httperror.New(http.StatusBadRequest, "finance_due_ack_invalid", "eventVersion, notificationId and an explicit recipientUid are required")
	}
	result, err := a.db.ExecContext(ctx, `UPDATE finance_notification_checkpoint SET notification_id=?,notified_recipient_uid=?,acknowledged_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
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
		err := a.db.QueryRowContext(ctx, `SELECT state,notification_id,notified_recipient_uid FROM finance_notification_checkpoint WHERE event_version=? LIMIT 1`, eventVersion).Scan(&state, &storedNotification, &storedRecipient)
		if err == nil && (state == "open" || state == "closed") && storedNotification.String == notificationID && storedRecipient.String == recipientUID {
			return map[string]any{"eventVersion": eventVersion, "notificationId": notificationID, "recipientUid": recipientUID, "acknowledged": true, "idempotent": true}, nil
		}
		return nil, httperror.New(http.StatusConflict, "finance_due_ack_conflict", "notification checkpoint is stale or recipient evidence conflicts")
	}
	return map[string]any{"eventVersion": eventVersion, "notificationId": notificationID, "recipientUid": recipientUID, "acknowledged": true}, nil
}

func (a *Adapter) acknowledgeFinanceDueClosure(ctx context.Context, body map[string]any) (map[string]any, error) {
	eventVersion := cleanStringValue(body["eventVersion"])
	nextVersion := cleanStringValue(body["nextVersion"])
	if eventVersion == "" || nextVersion == "" {
		return nil, httperror.New(http.StatusBadRequest, "finance_due_closure_ack_invalid", "eventVersion and nextVersion are required")
	}
	result, err := a.db.ExecContext(ctx, `UPDATE finance_notification_checkpoint SET lifecycle_closed_at=UTC_TIMESTAMP(),lifecycle_next_version=?,updated_at=UTC_TIMESTAMP()
		WHERE event_version=? AND state='closed' AND close_reason IN ('condition_resolved','condition_cancelled')
		AND (lifecycle_next_version IS NULL OR lifecycle_next_version=?)`, nextVersion, eventVersion, nextVersion)
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
		err := a.db.QueryRowContext(ctx, `SELECT lifecycle_next_version,lifecycle_closed_at FROM finance_notification_checkpoint WHERE event_version=? LIMIT 1`, eventVersion).Scan(&stored, &closed)
		if err == nil && closed.Valid && stored.String == nextVersion {
			return map[string]any{"eventVersion": eventVersion, "nextVersion": nextVersion, "acknowledged": true, "idempotent": true}, nil
		}
		return nil, httperror.New(http.StatusConflict, "finance_due_closure_ack_conflict", "closure checkpoint is stale or conflicts with existing evidence")
	}
	return map[string]any{"eventVersion": eventVersion, "nextVersion": nextVersion, "acknowledged": true}, nil
}

func buildFinanceDueCandidate(stream, phase string, fact financeDueFact, generation int64) financeDueCandidate {
	hash := financeDueHash(strings.Join([]string{"v1", stream, fact.SourceType, strconv.FormatInt(fact.ID, 10), strconv.FormatInt(generation, 10), fact.Code, fact.Name, fact.ResponsibleUID, fact.DueAt.Format(time.RFC3339), phase}, "|"))[:24]
	return financeDueCandidate{Stream: stream, Phase: phase, SourceType: fact.SourceType, SourceID: fact.ID, SourceCode: fact.Code,
		SourceName: fact.Name, DueAt: fact.DueAt.Format(time.RFC3339), RecipientCandidates: []string{fact.ResponsibleUID}, EventVersion: "v1:" + hash,
		IdempotencyKey: fmt.Sprintf("finance-due:%s:%s:%d:g%d:%s:%s", stream, fact.SourceType, fact.ID, generation, phase, hash),
		ActionableKey:  fmt.Sprintf("finance:%s:%d:%s:g%d", fact.SourceType, fact.ID, stream, generation)}
}

func financeDueSourceVersion(stream string, fact financeDueFact) string {
	return financeDueHash(strings.Join([]string{stream, fact.SourceType, strconv.FormatInt(fact.ID, 10), fact.Code, fact.Name, fact.ResponsibleUID, fact.DueAt.Format(time.RFC3339)}, "|"))
}

func financeDueHash(value string) string {
	hash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(hash[:])
}

func financeDuePhase(asOf, dueAt time.Time) string {
	asOf, dueAt = asOf.UTC(), dueAt.UTC()
	if !dueAt.After(asOf) {
		return "expired"
	}
	switch duration := dueAt.Sub(asOf); {
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

func financeDuePhaseRank(phase string) int {
	return map[string]int{"D30": 1, "D7": 2, "D1": 3, "expired": 4}[phase]
}
func validFinanceDueStream(stream string) bool {
	return stream == financeInvoiceIssuanceDueStream || stream == financeReceiptReconciliationDueStream
}

func validFinanceResponsibleUID(uid string) bool {
	return uid != "" && uid == strings.TrimSpace(uid) && len(uid) <= 50 && !strings.EqualFold(uid, "@all") && !hasFinanceControlCharacter(uid)
}

func encodeFinanceDueCursor(dueAt time.Time, id int64) (string, error) {
	payload, err := json.Marshal(financeDueCursor{DueAt: dueAt.UTC().Format(time.RFC3339), ID: id})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeFinanceDueCursor(raw string) (*financeDueCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, err
	}
	var cursor financeDueCursor
	if err := json.Unmarshal(payload, &cursor); err != nil || cursor.ID <= 0 {
		return nil, fmt.Errorf("invalid cursor")
	}
	if _, err := time.Parse(time.RFC3339, cursor.DueAt); err != nil {
		return nil, err
	}
	return &cursor, nil
}

func financeTextPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}
func financeNullTextPointer(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return financeTextPointer(value.String)
}
func financeNullableText(value *string) any {
	if value == nil {
		return nil
	}
	return strings.TrimSpace(*value)
}
