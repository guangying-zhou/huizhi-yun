package console

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type canonicalNotification struct {
	SourceAppCode  string
	EventType      string
	Category       string
	Severity       string
	Title          string
	Summary        string
	Body           string
	ActionURL      string
	BizType        string
	BizID          string
	IdempotencyKey string
	Recipients     []string
	Channels       []string
	MetadataJSON   string
	CreatedBy      string
	RequestHash    string
	Actionable     map[string]any
}

func (a *Adapter) PublishCanonicalNotification(ctx context.Context, body map[string]any) (map[string]any, error) {
	request, err := parseCanonicalNotification(body)
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var existingID, existingHash string
	err = tx.QueryRowContext(ctx, `
		SELECT notification_id,request_hash
		FROM portal_notifications
		WHERE source_app_code=? AND idempotency_key=?
		LIMIT 1 FOR UPDATE`, request.SourceAppCode, request.IdempotencyKey).Scan(&existingID, &existingHash)
	if err == nil {
		if existingHash != request.RequestHash {
			return nil, httperror.New(http.StatusConflict, "idempotency_payload_mismatch", "Idempotency key is already bound to a different notification request")
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return notificationPublishEnvelope(request, existingID, true), nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	notificationID := "notif_" + uuid.NewString()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO portal_notifications (
			notification_id,source_app_code,event_type,category,severity,title,summary,body,
			action_url,biz_type,biz_id,idempotency_key,request_hash,metadata_json,created_by,
			expires_at,created_at,updated_at
		) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CAST(? AS JSON),?,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
		notificationID, request.SourceAppCode, nullableText(request.EventType), request.Category,
		request.Severity, request.Title, nullableText(request.Summary), nullableText(request.Body),
		nullableText(request.ActionURL), nullableText(request.BizType), nullableText(request.BizID),
		request.IdempotencyKey, request.RequestHash, request.MetadataJSON, nullableText(request.CreatedBy))
	if err != nil {
		return nil, err
	}
	for _, recipient := range request.Recipients {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO portal_notification_recipients
				(notification_id,uid,delivery_state,created_at,updated_at)
			VALUES (?,?,'unread',UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
			notificationID, recipient); err != nil {
			return nil, err
		}
		if len(request.Actionable) > 0 {
			if err := persistRuntimeActionableProjection(ctx, tx, request, recipient, notificationID); err != nil {
				return nil, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return notificationPublishEnvelope(request, notificationID, false), nil
}

func (a *Adapter) AdvanceNotificationActionableLifecycle(ctx context.Context, body map[string]any) (map[string]any, error) {
	sourceApp := validNotificationField(body["sourceAppCode"], 64)
	actionableKey := validNotificationField(body["actionableKey"], 191)
	expectedVersion := validNotificationField(body["expectedVersion"], 191)
	nextVersion := validNotificationField(body["nextVersion"], 191)
	state := strings.ToLower(strings.TrimSpace(stringField(body["state"])))
	if sourceApp == "" || actionableKey == "" || expectedVersion == "" || nextVersion == "" ||
		expectedVersion == nextVersion || (state != "resolved" && state != "cancelled") {
		return nil, httperror.New(http.StatusBadRequest, "actionable_lifecycle_invalid", "actionable lifecycle request is invalid")
	}
	recipients, err := notificationStringList(body["recipients"], false, 100, 128)
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	statement := `
		SELECT id,uid,state,object_version
		FROM portal_actionable_projections
		WHERE source_app_code=? AND actionable_key=?`
	args := []any{sourceApp, actionableKey}
	if len(recipients) > 0 {
		statement += " AND uid IN (" + strings.TrimSuffix(strings.Repeat("?,", len(recipients)), ",") + ")"
		for _, recipient := range recipients {
			args = append(args, recipient)
		}
	}
	statement += " ORDER BY id FOR UPDATE"
	rows, err := tx.QueryContext(ctx, statement, args...)
	if err != nil {
		return nil, err
	}
	type projection struct {
		id            uint64
		uid           string
		state         string
		objectVersion string
	}
	projections := make([]projection, 0)
	for rows.Next() {
		var row projection
		if err := rows.Scan(&row.id, &row.uid, &row.state, &row.objectVersion); err != nil {
			rows.Close()
			return nil, err
		}
		projections = append(projections, row)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(projections) == 0 || (len(recipients) > 0 && len(projections) != len(recipients)) {
		return nil, httperror.New(http.StatusNotFound, "actionable_not_found", "actionable projection was not found")
	}
	updated, replayed := 0, 0
	for _, row := range projections {
		if row.objectVersion == nextVersion && row.state == state {
			replayed++
			continue
		}
		if row.state != "pending" || row.objectVersion != expectedVersion {
			return nil, httperror.New(http.StatusConflict, "actionable_version_conflict", "actionable projection version conflicts")
		}
		result, err := tx.ExecContext(ctx, `
			UPDATE portal_actionable_projections
			SET state=?,object_version=?,closed_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
			WHERE id=? AND state='pending' AND object_version=?`,
			state, nextVersion, row.id, expectedVersion)
		if err != nil {
			return nil, err
		}
		affected, _ := result.RowsAffected()
		if affected != 1 {
			return nil, httperror.New(http.StatusConflict, "actionable_cas_conflict", "actionable projection checkpoint is stale")
		}
		updated++
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "message": "success", "data": map[string]any{
		"sourceAppCode": sourceApp, "actionableKey": actionableKey, "state": state,
		"objectVersion": nextVersion, "matched": len(projections), "updated": updated, "replayed": replayed,
	}}, nil
}

func (a *Adapter) RecordNotificationDelivery(ctx context.Context, body map[string]any) (map[string]any, error) {
	notificationID := validNotificationField(body["notificationId"], 128)
	uid := validNotificationField(body["uid"], 128)
	channel := validNotificationField(body["channel"], 32)
	if notificationID == "" || uid == "" || channel == "" {
		return nil, httperror.New(http.StatusBadRequest, "notification_delivery_invalid", "notification delivery is invalid")
	}
	status := strings.TrimSpace(stringField(body["status"]))
	if status != "success" && status != "failed" && status != "skipped" {
		status = "pending"
	}
	attemptCount := numberField(body["attemptCount"])
	if attemptCount < 0 {
		attemptCount = 0
	}
	var sentAt any
	if value := strings.TrimSpace(stringField(body["sentAt"])); value != "" {
		parsed, err := time.Parse(time.RFC3339, value)
		if err != nil {
			return nil, httperror.New(http.StatusBadRequest, "notification_delivery_sent_at_invalid", "sentAt is invalid")
		}
		sentAt = parsed
	}
	result, err := a.db.ExecContext(ctx, `
		INSERT INTO portal_notification_deliveries (
			notification_id,uid,channel,provider,status,attempt_count,last_error,sent_at,created_at,updated_at
		) VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
		notificationID, uid, channel, nullableText(limitedNotificationText(body["provider"], 64)),
		status, attemptCount, nullableText(limitedNotificationText(body["lastError"], 1000)), sentAt)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()
	return map[string]any{"code": 0, "message": "success", "data": map[string]any{
		"id": id, "notificationId": notificationID, "uid": uid, "channel": channel, "status": status,
	}}, nil
}

func (a *Adapter) UserNotificationTodoSummary(ctx context.Context, uid string) (map[string]any, error) {
	uid, err := validNotificationUID(uid)
	if err != nil {
		return nil, err
	}
	var total, approval, followUp uint64
	err = a.db.QueryRowContext(ctx, `
		SELECT COUNT(*),
			COALESCE(SUM(CASE WHEN n.category='approval' THEN 1 ELSE 0 END),0),
			COALESCE(SUM(CASE WHEN n.category<>'approval' THEN 1 ELSE 0 END),0)
		FROM portal_actionable_projections p
		INNER JOIN portal_notifications n ON n.notification_id=p.current_notification_id
		WHERE p.uid=? AND p.state='pending'
			AND (n.expires_at IS NULL OR n.expires_at>UTC_TIMESTAMP())`, uid).Scan(&total, &approval, &followUp)
	if err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "message": "success", "data": map[string]any{
		"totalPending": total, "approvalPending": approval, "followUpPending": followUp,
	}}, nil
}

func (a *Adapter) UserNotificationTodos(ctx context.Context, uid string, query url.Values) (map[string]any, error) {
	uid, err := validNotificationUID(uid)
	if err != nil {
		return nil, err
	}
	todoCase := `CASE
		WHEN n.category='approval' THEN 'approval'
		WHEN n.category='project-risk' THEN 'risk'
		WHEN n.category IN ('service-sla','asset-expiry','asset-recovery','offboarding','finance_due','receivable') THEN 'due'
		ELSE 'follow_up' END`
	filters := []string{"p.uid=?", "p.state='pending'", "(n.expires_at IS NULL OR n.expires_at>UTC_TIMESTAMP())"}
	args := []any{uid}
	if kind := strings.TrimSpace(query.Get("todoKind")); kind != "" {
		if kind != "approval" && kind != "due" && kind != "risk" && kind != "follow_up" {
			return nil, httperror.New(http.StatusBadRequest, "notification_todo_kind_invalid", "todoKind is invalid")
		}
		filters = append(filters, "("+todoCase+")=?")
		args = append(args, kind)
	}
	if category := limitedNotificationFilter(query.Get("category")); category != "" {
		filters = append(filters, "n.category=?")
		args = append(args, category)
	}
	if source := limitedNotificationFilter(firstValue(query.Get("sourceAppCode"), query.Get("source_app_code"))); source != "" {
		filters = append(filters, "p.source_app_code=?")
		args = append(args, source)
	}
	if cursor := strings.TrimSpace(query.Get("cursor")); cursor != "" {
		var decoded struct {
			V         int    `json:"v"`
			UpdatedAt string `json:"updatedAt"`
			ID        uint64 `json:"id"`
		}
		raw, decodeErr := base64.RawURLEncoding.DecodeString(cursor)
		parseErr := json.Unmarshal(raw, &decoded)
		updatedAt, timeErr := time.Parse(time.RFC3339Nano, decoded.UpdatedAt)
		if decodeErr != nil || parseErr != nil || timeErr != nil || decoded.V != 1 || decoded.ID == 0 {
			return nil, httperror.New(http.StatusBadRequest, "notification_cursor_invalid", "cursor is invalid")
		}
		filters = append(filters, "(p.updated_at<? OR (p.updated_at=? AND p.id<?))")
		args = append(args, updatedAt, updatedAt, decoded.ID)
	}
	limit := positiveIntQuery(query.Get("limit"), 20)
	if limit > 100 {
		limit = 100
	}
	args = append(args, limit+1)
	rows, err := a.db.QueryContext(ctx, `
		SELECT p.id,p.current_notification_id,p.source_app_code,p.target_app_code,`+todoCase+`,
			n.category,n.severity,p.created_at,p.updated_at
		FROM portal_actionable_projections p
		INNER JOIN portal_notifications n ON n.notification_id=p.current_notification_id
		WHERE `+strings.Join(filters, " AND ")+`
		ORDER BY p.updated_at DESC,p.id DESC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0, limit)
	var lastID uint64
	var lastUpdated time.Time
	hasMore := false
	for rows.Next() {
		var id uint64
		var notificationID, source, target, kind, category, severity string
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &notificationID, &source, &target, &kind, &category, &severity, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		if len(items) == limit {
			hasMore = true
			continue
		}
		lastID, lastUpdated = id, updatedAt
		items = append(items, map[string]any{
			"notificationId": notificationID, "sourceAppCode": source, "targetAppCode": target,
			"todoKind": kind, "category": category, "severity": severity,
			"displayLabel": notificationDisplayLabel(category),
			"createdAt":    createdAt.UTC().Format(time.RFC3339Nano), "updatedAt": updatedAt.UTC().Format(time.RFC3339Nano),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var nextCursor any
	if hasMore && lastID > 0 {
		raw, _ := json.Marshal(map[string]any{"v": 1, "updatedAt": lastUpdated.UTC().Format(time.RFC3339Nano), "id": lastID})
		nextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return map[string]any{"code": 0, "message": "success", "data": map[string]any{
		"items": items, "nextCursor": nextCursor,
	}}, nil
}

func parseCanonicalNotification(body map[string]any) (canonicalNotification, error) {
	request := canonicalNotification{
		SourceAppCode:  validNotificationField(body["sourceAppCode"], 64),
		EventType:      limitedNotificationText(body["eventType"], 128),
		Category:       validNotificationField(body["category"], 64),
		Severity:       strings.TrimSpace(stringField(body["severity"])),
		Title:          validNotificationField(body["title"], 255),
		Summary:        limitedNotificationText(body["summary"], 1000),
		Body:           strings.TrimSpace(stringField(body["body"])),
		ActionURL:      limitedNotificationText(body["actionUrl"], 1000),
		BizType:        limitedNotificationText(body["bizType"], 64),
		BizID:          limitedNotificationText(body["bizId"], 128),
		IdempotencyKey: validNotificationField(body["idempotencyKey"], 191),
		MetadataJSON:   strings.TrimSpace(stringField(body["metadataJson"])),
		CreatedBy:      limitedNotificationText(body["createdBy"], 128),
		RequestHash:    validNotificationField(body["requestHash"], 64),
		Actionable:     objectField(body["actionable"]),
	}
	var err error
	request.Recipients, err = notificationStringList(body["recipients"], true, 1000, 128)
	if err != nil {
		return request, err
	}
	request.Channels, err = notificationStringList(body["channels"], true, 32, 32)
	if err != nil {
		return request, err
	}
	if request.SourceAppCode == "" || request.Category == "" || request.Title == "" ||
		request.IdempotencyKey == "" || request.RequestHash == "" || len(request.Recipients) == 0 {
		return request, httperror.New(http.StatusBadRequest, "canonical_notification_invalid", "canonical notification is invalid")
	}
	if request.Severity != "info" && request.Severity != "success" && request.Severity != "warning" && request.Severity != "error" {
		return request, httperror.New(http.StatusBadRequest, "canonical_notification_severity_invalid", "notification severity is invalid")
	}
	var metadata any
	if request.MetadataJSON == "" || json.Unmarshal([]byte(request.MetadataJSON), &metadata) != nil {
		return request, httperror.New(http.StatusBadRequest, "canonical_notification_metadata_invalid", "notification metadata is invalid")
	}
	return request, nil
}

func persistRuntimeActionableProjection(
	ctx context.Context,
	tx *sql.Tx,
	request canonicalNotification,
	uid string,
	notificationID string,
) error {
	actionable := request.Actionable
	sourceApp := validNotificationField(actionable["sourceAppCode"], 64)
	key := validNotificationField(actionable["actionableKey"], 191)
	targetApp := limitedNotificationText(actionable["targetAppCode"], 64)
	bizType := validNotificationField(actionable["bizType"], 64)
	bizID := validNotificationField(actionable["bizId"], 128)
	businessKey := validNotificationField(actionable["businessKey"], 320)
	state := strings.TrimSpace(stringField(actionable["state"]))
	objectVersion := validNotificationField(actionable["objectVersion"], 191)
	previousVersion := limitedNotificationText(actionable["previousObjectVersion"], 191)
	if sourceApp != request.SourceAppCode || key == "" || bizType == "" || bizID == "" ||
		businessKey == "" || objectVersion == "" || (state != "pending" && state != "resolved" && state != "cancelled") {
		return httperror.New(http.StatusBadRequest, "canonical_actionable_invalid", "canonical actionable descriptor is invalid")
	}
	var id uint64
	var existingState, existingVersion string
	err := tx.QueryRowContext(ctx, `
		SELECT id,state,object_version
		FROM portal_actionable_projections
		WHERE uid=? AND source_app_code=? AND actionable_key=?
		LIMIT 1 FOR UPDATE`, uid, sourceApp, key).Scan(&id, &existingState, &existingVersion)
	if errors.Is(err, sql.ErrNoRows) {
		if previousVersion != "" {
			return httperror.New(http.StatusConflict, "actionable_version_conflict", "actionable predecessor projection was not found")
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO portal_actionable_projections (
				uid,source_app_code,actionable_key,target_app_code,biz_type,biz_id,business_key,
				current_notification_id,state,object_version,closed_at,created_at,updated_at
			) VALUES (?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='pending' THEN NULL ELSE UTC_TIMESTAMP() END,
				UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
			uid, sourceApp, key, nullableText(targetApp), bizType, bizID, businessKey,
			notificationID, state, objectVersion, state)
		return err
	}
	if err != nil {
		return err
	}
	if existingState != "pending" || state != "pending" || previousVersion == "" ||
		previousVersion != existingVersion || objectVersion == existingVersion {
		return httperror.New(http.StatusConflict, "actionable_version_conflict", "actionable projection version conflicts")
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE portal_actionable_projections
		SET target_app_code=?,biz_type=?,biz_id=?,business_key=?,current_notification_id=?,
			state='pending',object_version=?,closed_at=NULL,updated_at=UTC_TIMESTAMP()
		WHERE id=? AND state='pending' AND object_version=?`,
		nullableText(targetApp), bizType, bizID, businessKey, notificationID,
		objectVersion, id, previousVersion)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return httperror.New(http.StatusConflict, "actionable_cas_conflict", "actionable projection checkpoint is stale")
	}
	return nil
}

func notificationPublishEnvelope(request canonicalNotification, notificationID string, replayed bool) map[string]any {
	return map[string]any{"code": 0, "message": "success", "data": map[string]any{
		"notificationId": notificationID, "sourceAppCode": request.SourceAppCode,
		"recipients": request.Recipients, "channels": request.Channels, "replayed": replayed,
	}}
}

func notificationStringList(value any, required bool, maxItems int, maxLength int) ([]string, error) {
	values := make([]string, 0)
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			values = append(values, strings.TrimSpace(stringField(item)))
		}
	case []string:
		values = append(values, typed...)
	case string:
		values = strings.FieldsFunc(typed, func(r rune) bool {
			return r == ',' || r == '|' || r == ' ' || r == '\n' || r == '\t'
		})
	case nil:
	default:
		return nil, httperror.New(http.StatusBadRequest, "notification_list_invalid", "notification list is invalid")
	}
	unique := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, item := range values {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if len(item) > maxLength || strings.EqualFold(item, "@all") {
			return nil, httperror.New(http.StatusBadRequest, "notification_list_invalid", "notification list is invalid")
		}
		if !unique[item] {
			unique[item] = true
			result = append(result, item)
		}
	}
	sort.Strings(result)
	if len(result) > maxItems || (required && len(result) == 0) {
		return nil, httperror.New(http.StatusBadRequest, "notification_list_invalid", "notification list is invalid")
	}
	return result, nil
}

func validNotificationField(value any, max int) string {
	text := strings.TrimSpace(stringField(value))
	if text == "" || len(text) > max || strings.ContainsAny(text, "\r\n\t") {
		return ""
	}
	return text
}

func limitedNotificationText(value any, max int) string {
	text := strings.TrimSpace(stringField(value))
	if len(text) > max {
		return text[:max]
	}
	return text
}
