package altoc

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const altocReceivableDueStream = "receivable_plan_due"

type altocReceivableDueCursor struct {
	DueAt string `json:"dueAt"`
	ID    int64  `json:"id"`
}
type altocReceivableDueFact struct {
	ID                         int64
	Code, Name, ResponsibleUID string
	DueAt                      time.Time
}
type altocReceivableDueCandidate struct {
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
type altocReceivableDueClosure struct {
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

func (a *Adapter) handleReceivableNotificationRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	if method != http.MethodPost {
		return nil, "", false, nil
	}
	switch path {
	case "/v1/altoc/service/notifications:scan-due":
		v, err := a.scanReceivableDueNotifications(ctx, body)
		return runtimeOK(v), "altoc.notifications.receivable_due.scan", true, err
	case "/v1/altoc/service/notifications:acknowledge":
		v, err := a.acknowledgeReceivableDueNotification(ctx, body)
		return runtimeOK(v), "altoc.notifications.receivable_due.acknowledge", true, err
	case "/v1/altoc/service/notifications:acknowledge-closure":
		v, err := a.acknowledgeReceivableDueClosure(ctx, body)
		return runtimeOK(v), "altoc.notifications.receivable_due.closure_acknowledge", true, err
	case "/v1/altoc/notification-details/authorize":
		v, err := a.authorizeReceivableNotificationDetail(ctx, query, body)
		return runtimeOK(v), "altoc.notification_details.authorize", true, err
	default:
		return nil, "", false, nil
	}
}

func (a *Adapter) scanReceivableDueNotifications(ctx context.Context, body map[string]any) (map[string]any, error) {
	stream := strings.TrimSpace(fmt.Sprint(body["stream"]))
	if stream != altocReceivableDueStream {
		return nil, httperror.New(http.StatusBadRequest, "altoc_receivable_due_stream_invalid", "stream is not supported")
	}
	asOf, err := time.Parse(time.RFC3339, strings.TrimSpace(fmt.Sprint(body["asOf"])))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "altoc_receivable_due_as_of_invalid", "asOf must be an explicit RFC3339 timestamp")
	}
	asOfDate := utcDate(asOf)
	cursor, err := decodeAltocReceivableDueCursor(strings.TrimSpace(fmt.Sprint(body["cursor"])))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "altoc_receivable_due_cursor_invalid", "cursor is invalid")
	}
	limit := int(numberValue(body["limit"], 100))
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	if err := a.reconcileReceivableDueCheckpoints(ctx); err != nil {
		return nil, err
	}
	facts, err := a.queryReceivableDueFacts(ctx, asOfDate, cursor, limit+1)
	if err != nil {
		return nil, err
	}
	hasMore := len(facts) > limit
	if hasMore {
		facts = facts[:limit]
	}
	items := make([]altocReceivableDueCandidate, 0, len(facts))
	for _, fact := range facts {
		candidate, pending, openErr := a.openReceivableDueCheckpoint(ctx, fact, asOfDate)
		if openErr != nil {
			return nil, openErr
		}
		if pending {
			items = append(items, *candidate)
		}
	}
	closures, err := a.pendingReceivableDueClosures(ctx, limit)
	if err != nil {
		return nil, err
	}
	var nextCursor any
	if hasMore && len(facts) > 0 {
		nextCursor, err = encodeAltocReceivableDueCursor(facts[len(facts)-1].DueAt, facts[len(facts)-1].ID)
		if err != nil {
			return nil, err
		}
	}
	return map[string]any{"stream": stream, "asOf": asOf.UTC().Format(time.RFC3339), "items": items, "closures": closures, "nextCursor": nextCursor}, nil
}

func (a *Adapter) queryReceivableDueFacts(ctx context.Context, asOfDate time.Time, cursor *altocReceivableDueCursor, limit int) ([]altocReceivableDueFact, error) {
	args := []any{asOfDate.AddDate(0, 0, 30).Format("2006-01-02")}
	query := `SELECT id,code,COALESCE(plan_name,code),collection_responsible_uid,planned_payment_date FROM receivable_plan
		WHERE deleted_at IS NULL AND status IN ('to_receive','partially_received','overdue')
		AND GREATEST(COALESCE(amount,0)-COALESCE(received_amount,0),0)>0
		AND collection_responsible_uid IS NOT NULL AND planned_payment_date IS NOT NULL AND planned_payment_date<=?`
	if cursor != nil {
		query += ` AND (planned_payment_date>? OR (planned_payment_date=? AND id>?))`
		args = append(args, cursor.DueAt, cursor.DueAt, cursor.ID)
	}
	args = append(args, limit)
	rows, err := a.DB().QueryContext(ctx, query+` ORDER BY planned_payment_date ASC,id ASC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	facts := make([]altocReceivableDueFact, 0, limit)
	for rows.Next() {
		var f altocReceivableDueFact
		if err := rows.Scan(&f.ID, &f.Code, &f.Name, &f.ResponsibleUID, &f.DueAt); err != nil {
			return nil, err
		}
		f.DueAt = utcDate(f.DueAt)
		if validCollectionResponsibleUID(f.ResponsibleUID) {
			facts = append(facts, f)
		}
	}
	return facts, rows.Err()
}

func (a *Adapter) reconcileReceivableDueCheckpoints(ctx context.Context) error {
	if _, err := a.DB().ExecContext(ctx, `UPDATE altoc_receivable_notification_checkpoint cp JOIN receivable_plan rp ON rp.id=cp.source_id
		SET cp.state='closed',cp.close_reason='condition_resolved',cp.closed_at=UTC_TIMESTAMP(),cp.updated_at=UTC_TIMESTAMP()
		WHERE cp.event_stream=? AND cp.state='open' AND (rp.status='received' OR GREATEST(COALESCE(rp.amount,0)-COALESCE(rp.received_amount,0),0)=0)`, altocReceivableDueStream); err != nil {
		return err
	}
	_, err := a.DB().ExecContext(ctx, `UPDATE altoc_receivable_notification_checkpoint cp LEFT JOIN receivable_plan rp ON rp.id=cp.source_id
		SET cp.state='closed',cp.close_reason='condition_cancelled',cp.closed_at=UTC_TIMESTAMP(),cp.updated_at=UTC_TIMESTAMP()
		WHERE cp.event_stream=? AND cp.state='open' AND (rp.id IS NULL OR rp.deleted_at IS NOT NULL
		OR rp.status NOT IN ('to_receive','partially_received','overdue') OR GREATEST(COALESCE(rp.amount,0)-COALESCE(rp.received_amount,0),0)=0
		OR rp.collection_responsible_uid IS NULL OR rp.planned_payment_date IS NULL OR rp.planned_payment_date<>cp.due_at
		OR NOT JSON_CONTAINS(cp.recipient_candidates_json,JSON_QUOTE(rp.collection_responsible_uid)))`, altocReceivableDueStream)
	return err
}

func (a *Adapter) openReceivableDueCheckpoint(ctx context.Context, fact altocReceivableDueFact, asOf time.Time) (*altocReceivableDueCandidate, bool, error) {
	phase := altocReceivableDuePhase(asOf, fact.DueAt)
	if phase == "" {
		return nil, false, nil
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback()
	sourceVersion := altocReceivableSourceVersion(fact)
	generation := int64(1)
	var g int64
	var state, storedSource, storedEvent, storedPhase, closeReason string
	var recipient sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT condition_generation,state,source_version,event_version,phase,COALESCE(close_reason,''),notified_recipient_uid
		FROM altoc_receivable_notification_checkpoint WHERE event_stream=? AND source_id=? ORDER BY condition_generation DESC,id DESC LIMIT 1 FOR UPDATE`, altocReceivableDueStream, fact.ID).Scan(&g, &state, &storedSource, &storedEvent, &storedPhase, &closeReason, &recipient)
	if err != nil && err != sql.ErrNoRows {
		return nil, false, err
	}
	var previousEvent, previousRecipient *string
	if err == nil {
		if storedSource == sourceVersion && (state == "open" || closeReason == "superseded") {
			if altocReceivablePhaseRank(storedPhase) > altocReceivablePhaseRank(phase) {
				return nil, false, nil
			}
			generation = g
			previousEvent = textPtr(storedEvent)
			previousRecipient = nullTextPtr(recipient)
		} else {
			generation = g + 1
			if state == "open" {
				if _, e := tx.ExecContext(ctx, `UPDATE altoc_receivable_notification_checkpoint SET state='closed',close_reason='condition_cancelled',closed_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE event_stream=? AND source_id=? AND state='open'`, altocReceivableDueStream, fact.ID); e != nil {
					return nil, false, e
				}
			}
		}
	}
	c := buildAltocReceivableCandidate(phase, fact, generation)
	if previousEvent != nil && *previousEvent == c.EventVersion {
		previousEvent = nil
		previousRecipient = nil
	}
	c.PreviousEventVersion = previousEvent
	c.PreviousRecipientUID = previousRecipient
	if err == nil && generation == g && state == "open" && storedEvent != c.EventVersion {
		if _, e := tx.ExecContext(ctx, `UPDATE altoc_receivable_notification_checkpoint SET state='closed',close_reason='superseded',closed_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE event_version=? AND state='open'`, storedEvent); e != nil {
			return nil, false, e
		}
	}
	recipients, _ := json.Marshal([]string{fact.ResponsibleUID})
	_, err = tx.ExecContext(ctx, `INSERT IGNORE INTO altoc_receivable_notification_checkpoint(event_stream,source_type,source_id,condition_generation,phase,source_version,event_version,previous_event_version,previous_recipient_uid,idempotency_key,actionable_key,due_at,source_code,source_name,recipient_candidates_json,state) VALUES (?,'receivable_plan',?,?,?,?,?,?,?,?,?,?,?,?,?,'open')`, altocReceivableDueStream, fact.ID, generation, phase, sourceVersion, c.EventVersion, ptrValue(previousEvent), ptrValue(previousRecipient), c.IdempotencyKey, c.ActionableKey, fact.DueAt.Format("2006-01-02"), fact.Code, fact.Name, string(recipients))
	if err != nil {
		return nil, false, err
	}
	var storedState string
	var notification, prevEvent, prevRecipient sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT state,notification_id,previous_event_version,previous_recipient_uid FROM altoc_receivable_notification_checkpoint WHERE event_version=? LIMIT 1 FOR UPDATE`, c.EventVersion).Scan(&storedState, &notification, &prevEvent, &prevRecipient); err != nil {
		return nil, false, err
	}
	c.PreviousEventVersion = nullTextPtr(prevEvent)
	c.PreviousRecipientUID = nullTextPtr(prevRecipient)
	if err := tx.Commit(); err != nil {
		return nil, false, err
	}
	return &c, storedState == "open" && !notification.Valid, nil
}

func (a *Adapter) pendingReceivableDueClosures(ctx context.Context, limit int) ([]altocReceivableDueClosure, error) {
	rows, err := a.DB().QueryContext(ctx, `SELECT cp.event_version,delivered.event_version,cp.actionable_key,cp.source_type,cp.source_id,cp.source_code,delivered.notified_recipient_uid,cp.close_reason
		FROM altoc_receivable_notification_checkpoint cp JOIN altoc_receivable_notification_checkpoint delivered ON delivered.id=(SELECT prior.id FROM altoc_receivable_notification_checkpoint prior WHERE prior.event_stream=cp.event_stream AND prior.source_id=cp.source_id AND prior.condition_generation=cp.condition_generation AND prior.id<=cp.id AND prior.notification_id IS NOT NULL AND prior.notified_recipient_uid IS NOT NULL ORDER BY prior.id DESC LIMIT 1)
		WHERE cp.event_stream=? AND cp.state='closed' AND cp.close_reason IN ('condition_resolved','condition_cancelled') AND cp.lifecycle_closed_at IS NULL ORDER BY cp.closed_at,cp.id LIMIT ?`, altocReceivableDueStream, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []altocReceivableDueClosure{}
	for rows.Next() {
		var i altocReceivableDueClosure
		var reason string
		if err := rows.Scan(&i.CheckpointEventVersion, &i.ExpectedVersion, &i.ActionableKey, &i.SourceType, &i.SourceID, &i.SourceCode, &i.RecipientUID, &reason); err != nil {
			return nil, err
		}
		i.State = "cancelled"
		if reason == "condition_resolved" {
			i.State = "resolved"
		}
		i.NextVersion = i.State + ":" + i.CheckpointEventVersion
		items = append(items, i)
	}
	return items, rows.Err()
}

func (a *Adapter) acknowledgeReceivableDueNotification(ctx context.Context, body map[string]any) (map[string]any, error) {
	event, notification, recipient := bodyText(body, "eventVersion"), bodyText(body, "notificationId"), bodyText(body, "recipientUid")
	if event == "" || notification == "" || !validCollectionResponsibleUID(recipient) {
		return nil, httperror.New(http.StatusBadRequest, "altoc_receivable_due_ack_invalid", "eventVersion, notificationId and an explicit recipientUid are required")
	}
	result, err := a.DB().ExecContext(ctx, `UPDATE altoc_receivable_notification_checkpoint SET notification_id=?,notified_recipient_uid=?,acknowledged_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE event_version=? AND JSON_CONTAINS(recipient_candidates_json,JSON_QUOTE(?)) AND (notification_id IS NULL OR (notification_id=? AND notified_recipient_uid=?))`, notification, recipient, event, recipient, notification, recipient)
	if err != nil {
		return nil, err
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		var state string
		var n, r sql.NullString
		e := a.DB().QueryRowContext(ctx, `SELECT state,notification_id,notified_recipient_uid FROM altoc_receivable_notification_checkpoint WHERE event_version=?`, event).Scan(&state, &n, &r)
		if e == nil && (state == "open" || state == "closed") && n.String == notification && r.String == recipient {
			return map[string]any{"eventVersion": event, "notificationId": notification, "recipientUid": recipient, "acknowledged": true, "idempotent": true}, nil
		}
		return nil, httperror.New(http.StatusConflict, "altoc_receivable_due_ack_conflict", "notification checkpoint is stale or recipient evidence conflicts")
	}
	return map[string]any{"eventVersion": event, "notificationId": notification, "recipientUid": recipient, "acknowledged": true}, nil
}

func (a *Adapter) acknowledgeReceivableDueClosure(ctx context.Context, body map[string]any) (map[string]any, error) {
	event, next := bodyText(body, "eventVersion"), bodyText(body, "nextVersion")
	if event == "" || next == "" {
		return nil, httperror.New(http.StatusBadRequest, "altoc_receivable_due_closure_ack_invalid", "eventVersion and nextVersion are required")
	}
	result, err := a.DB().ExecContext(ctx, `UPDATE altoc_receivable_notification_checkpoint SET lifecycle_closed_at=UTC_TIMESTAMP(),lifecycle_next_version=?,updated_at=UTC_TIMESTAMP() WHERE event_version=? AND state='closed' AND close_reason IN ('condition_resolved','condition_cancelled') AND (lifecycle_next_version IS NULL OR lifecycle_next_version=?)`, next, event, next)
	if err != nil {
		return nil, err
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		var stored sql.NullString
		var closed sql.NullTime
		e := a.DB().QueryRowContext(ctx, `SELECT lifecycle_next_version,lifecycle_closed_at FROM altoc_receivable_notification_checkpoint WHERE event_version=?`, event).Scan(&stored, &closed)
		if e == nil && closed.Valid && stored.String == next {
			return map[string]any{"eventVersion": event, "nextVersion": next, "acknowledged": true, "idempotent": true}, nil
		}
		return nil, httperror.New(http.StatusConflict, "altoc_receivable_due_closure_ack_conflict", "closure checkpoint is stale or conflicts with existing evidence")
	}
	return map[string]any{"eventVersion": event, "nextVersion": next, "acknowledged": true}, nil
}

func (a *Adapter) authorizeReceivableNotificationDetail(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	if query.Get("hzy_runtime_actor_purpose") != "notification-detail-authorization" {
		return nil, httperror.New(http.StatusForbidden, "trusted_notification_actor_required", "trusted notification detail actor delegation is required")
	}
	if operationID, ok := exactAltocIntegrationOperationDescriptor(body["descriptor"]); ok {
		subject := strings.TrimSpace(query.Get("current_user"))
		if !validCollectionResponsibleUID(subject) {
			return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "trusted notification subject is required")
		}
		notificationID := bodyText(body, "notificationId")
		trusted, trustedErr := integrationoperation.TrustedContextFromMap(altocIntegrationOperationQueryBody(query), "altoc")
		if trustedErr != nil {
			return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted integration operation context is missing or invalid")
		}
		repository, repositoryErr := integrationoperation.NewRepository(a.DB())
		if repositoryErr != nil {
			return nil, repositoryErr
		}
		authorized, reason, authorizeErr := repository.AuthorizeDeadLetterNotification(ctx, integrationoperation.AuthorizeDeadLetterNotificationInput{TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "altoc", OperationID: operationID, NotificationID: notificationID, SubjectUID: subject})
		if authorizeErr != nil {
			return nil, authorizeErr
		}
		return map[string]any{"authorized": authorized, "reasonCode": reason, "resource": "integration_operation", "id": operationID}, nil
	}
	code, err := exactAltocReceivableDescriptor(body["descriptor"])
	if err != nil {
		return nil, err
	}
	subject := query.Get("current_user")
	if !validCollectionResponsibleUID(subject) {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "trusted notification subject is required")
	}
	var id int64
	var related int
	err = a.DB().QueryRowContext(ctx, `SELECT id,CASE WHEN status IN ('to_receive','partially_received','overdue') AND GREATEST(COALESCE(amount,0)-COALESCE(received_amount,0),0)>0 AND collection_responsible_uid=? AND planned_payment_date IS NOT NULL THEN 1 ELSE 0 END FROM receivable_plan WHERE code=? AND deleted_at IS NULL LIMIT 1`, subject, code).Scan(&id, &related)
	authorized, reason := false, "not_authorized"
	if err == sql.ErrNoRows {
		reason = "not_found"
	} else if err != nil {
		return nil, err
	} else if related == 1 {
		authorized = true
		reason = "allowed"
	}
	return map[string]any{"authorized": authorized, "reasonCode": reason, "resource": "receivable_plan", "id": code}, nil
}

func exactAltocIntegrationOperationDescriptor(value any) (string, bool) {
	d, ok := value.(map[string]any)
	if !ok || len(d) != 2 {
		return "", false
	}
	resource, resourceOK := d["resource"].(string)
	id, idOK := d["id"].(string)
	if !resourceOK || !idOK || resource != "integration_operation" {
		return "", false
	}
	id = strings.TrimSpace(id)
	if id != strings.ToLower(id) || integrationoperation.ValidateOperationID(id) != nil {
		return "", false
	}
	return id, true
}

func exactAltocReceivableDescriptor(value any) (string, error) {
	d, ok := value.(map[string]any)
	if !ok || len(d) != 2 {
		return "", invalidAltocReceivableDescriptor()
	}
	for k := range d {
		if k != "resource" && k != "id" {
			return "", invalidAltocReceivableDescriptor()
		}
	}
	resource, rok := d["resource"].(string)
	code, cok := d["id"].(string)
	if !rok || !cok || resource != "receivable_plan" || code == "" || code != strings.TrimSpace(code) || len(code) > 30 || hasControlCharacter(code) {
		return "", invalidAltocReceivableDescriptor()
	}
	return code, nil
}
func invalidAltocReceivableDescriptor() error {
	return httperror.New(http.StatusBadRequest, "invalid_descriptor", "Altoc notification descriptor is invalid")
}

func buildAltocReceivableCandidate(phase string, f altocReceivableDueFact, g int64) altocReceivableDueCandidate {
	h := hashText(strings.Join([]string{"v1", altocReceivableDueStream, "receivable_plan", strconv.FormatInt(f.ID, 10), strconv.FormatInt(g, 10), f.Code, f.Name, f.ResponsibleUID, f.DueAt.Format("2006-01-02"), phase}, "|"))[:24]
	return altocReceivableDueCandidate{Stream: altocReceivableDueStream, Phase: phase, SourceType: "receivable_plan", SourceID: f.ID, SourceCode: f.Code, SourceName: f.Name, DueAt: f.DueAt.Format("2006-01-02"), RecipientCandidates: []string{f.ResponsibleUID}, EventVersion: "v1:" + h, IdempotencyKey: fmt.Sprintf("altoc-receivable-due:%d:g%d:%s:%s", f.ID, g, phase, h), ActionableKey: fmt.Sprintf("altoc:receivable_plan:%d:%s:g%d", f.ID, altocReceivableDueStream, g)}
}
func altocReceivableSourceVersion(f altocReceivableDueFact) string {
	return hashText(strings.Join([]string{f.Code, f.Name, f.ResponsibleUID, f.DueAt.Format("2006-01-02")}, "|"))
}
func hashText(v string) string { h := sha256.Sum256([]byte(v)); return hex.EncodeToString(h[:]) }
func utcDate(v time.Time) time.Time {
	v = v.UTC()
	return time.Date(v.Year(), v.Month(), v.Day(), 0, 0, 0, 0, time.UTC)
}
func altocReceivableDuePhase(asOf, due time.Time) string {
	days := int(utcDate(due).Sub(utcDate(asOf)).Hours() / 24)
	switch {
	case days < 0:
		return "expired"
	case days <= 1:
		return "D1"
	case days <= 7:
		return "D7"
	case days <= 30:
		return "D30"
	default:
		return ""
	}
}
func altocReceivablePhaseRank(v string) int {
	return map[string]int{"D30": 1, "D7": 2, "D1": 3, "expired": 4}[v]
}
func encodeAltocReceivableDueCursor(d time.Time, id int64) (string, error) {
	b, e := json.Marshal(altocReceivableDueCursor{DueAt: utcDate(d).Format("2006-01-02"), ID: id})
	return base64.RawURLEncoding.EncodeToString(b), e
}
func decodeAltocReceivableDueCursor(raw string) (*altocReceivableDueCursor, error) {
	if raw == "" || raw == "<nil>" {
		return nil, nil
	}
	b, e := base64.RawURLEncoding.DecodeString(raw)
	if e != nil {
		return nil, e
	}
	var c altocReceivableDueCursor
	if e = json.Unmarshal(b, &c); e != nil || c.ID <= 0 {
		return nil, fmt.Errorf("invalid cursor")
	}
	if _, e = time.Parse("2006-01-02", c.DueAt); e != nil {
		return nil, e
	}
	return &c, nil
}
func validCollectionResponsibleUID(v string) bool {
	return v != "" && v == strings.TrimSpace(v) && len(v) <= 50 && !strings.EqualFold(v, "@all") && !hasControlCharacter(v)
}
func hasControlCharacter(v string) bool {
	for _, r := range v {
		if r < 32 || r == 127 {
			return true
		}
	}
	return false
}
func bodyText(body map[string]any, key string) string {
	v, ok := body[key].(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(v)
}
func textPtr(v string) *string {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	return &v
}
func nullTextPtr(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	return textPtr(v.String)
}
func ptrValue(v *string) any {
	if v == nil {
		return nil
	}
	return *v
}
