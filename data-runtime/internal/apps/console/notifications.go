package console

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type notificationRow struct {
	RowID          uint64
	NotificationID string
	SourceAppCode  string
	Category       string
	Severity       string
	CreatedAt      time.Time
	ExpiresAt      sql.NullTime
	ReadAt         sql.NullTime
	ArchivedAt     sql.NullTime
	PinnedAt       sql.NullTime
}

func (a *Adapter) UserNotifications(ctx context.Context, uid string, query url.Values) (map[string]any, error) {
	uid, err := validNotificationUID(uid)
	if err != nil {
		return nil, err
	}
	status := strings.TrimSpace(query.Get("status"))
	if status == "" {
		status = "all"
	}
	if status != "all" && status != "unread" && status != "read" && status != "archived" {
		return nil, httperror.New(http.StatusBadRequest, "notification_status_invalid", "status is invalid")
	}
	filters := []string{
		"r.uid=?",
		"(n.expires_at IS NULL OR n.expires_at>UTC_TIMESTAMP())",
		notificationStatusSQL(status),
	}
	args := []any{uid}
	if category := limitedNotificationFilter(query.Get("category")); category != "" {
		filters = append(filters, "n.category=?")
		args = append(args, category)
	}
	sourceApp := firstValue(query.Get("sourceAppCode"), query.Get("source_app_code"))
	if sourceApp = limitedNotificationFilter(sourceApp); sourceApp != "" {
		filters = append(filters, "n.source_app_code=?")
		args = append(args, sourceApp)
	}
	cursor := strings.TrimSpace(query.Get("cursor"))
	if cursor != "" {
		cursorID, err := strconv.ParseUint(cursor, 10, 64)
		if err != nil || cursorID == 0 {
			return nil, httperror.New(http.StatusBadRequest, "notification_cursor_invalid", "cursor is invalid")
		}
		filters = append(filters, "r.id<?")
		args = append(args, cursorID)
	}
	limit := positiveIntQuery(query.Get("limit"), 20)
	if limit > 100 {
		limit = 100
	}
	args = append(args, limit+1)
	rows, err := a.db.QueryContext(ctx, notificationSelectSQL()+`
		WHERE `+strings.Join(filters, " AND ")+`
		ORDER BY COALESCE(r.pinned_at,n.created_at) DESC,r.id DESC
		LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0, limit)
	var lastID uint64
	hasMore := false
	for rows.Next() {
		row, err := scanNotificationRow(rows)
		if err != nil {
			return nil, err
		}
		if len(items) == limit {
			hasMore = true
			continue
		}
		lastID = row.RowID
		items = append(items, mapNotification(row))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var nextCursor any
	if hasMore && lastID > 0 {
		nextCursor = strconv.FormatUint(lastID, 10)
	}
	return map[string]any{"code": 0, "message": "success", "data": map[string]any{
		"items": items, "nextCursor": nextCursor,
	}}, nil
}

func (a *Adapter) UserNotificationSummary(ctx context.Context, uid string) (map[string]any, error) {
	uid, err := validNotificationUID(uid)
	if err != nil {
		return nil, err
	}
	var totalCount, unreadCount uint64
	if err := a.db.QueryRowContext(ctx, `
		SELECT COUNT(*),COALESCE(SUM(CASE WHEN r.read_at IS NULL THEN 1 ELSE 0 END),0)
		FROM portal_notification_recipients r
		INNER JOIN portal_notifications n ON n.notification_id=r.notification_id
		WHERE r.uid=? AND r.archived_at IS NULL
			AND (n.expires_at IS NULL OR n.expires_at>UTC_TIMESTAMP())
	`, uid).Scan(&totalCount, &unreadCount); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT n.category,COUNT(*)
		FROM portal_notification_recipients r
		INNER JOIN portal_notifications n ON n.notification_id=r.notification_id
		WHERE r.uid=? AND r.archived_at IS NULL AND r.read_at IS NULL
			AND (n.expires_at IS NULL OR n.expires_at>UTC_TIMESTAMP())
		GROUP BY n.category ORDER BY COUNT(*) DESC,n.category`, uid)
	if err != nil {
		return nil, err
	}
	unreadByCategory := map[string]uint64{}
	for rows.Next() {
		var category string
		var count uint64
		if err := rows.Scan(&category, &count); err != nil {
			rows.Close()
			return nil, err
		}
		unreadByCategory[category] = count
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	latestResult, err := a.UserNotifications(ctx, uid, url.Values{"status": []string{"all"}, "limit": []string{"5"}})
	if err != nil {
		return nil, err
	}
	latestData, _ := latestResult["data"].(map[string]any)
	return map[string]any{"code": 0, "message": "success", "data": map[string]any{
		"totalCount": totalCount, "unreadCount": unreadCount,
		"unreadByCategory": unreadByCategory, "latest": latestData["items"],
	}}, nil
}

func (a *Adapter) UserNotificationDetailFact(
	ctx context.Context,
	uid string,
	notificationID string,
) (map[string]any, error) {
	uid, err := validNotificationUID(uid)
	if err != nil {
		return nil, err
	}
	notificationID = strings.TrimSpace(notificationID)
	if notificationID == "" || len(notificationID) > 128 || strings.ContainsAny(notificationID, "\r\n\t") {
		return nil, httperror.New(http.StatusBadRequest, "notification_id_invalid", "notificationId is invalid")
	}
	var sourceAppCode, title string
	var summary, body, actionURL, bizType, bizID, metadataJSON sql.NullString
	var createdAt time.Time
	var expiresAt sql.NullTime
	err = a.db.QueryRowContext(ctx, `
		SELECT n.source_app_code,n.title,n.summary,n.body,n.action_url,n.biz_type,n.biz_id,
			CAST(n.metadata_json AS CHAR),n.created_at,n.expires_at
		FROM portal_notification_recipients r
		INNER JOIN portal_notifications n ON n.notification_id=r.notification_id
		WHERE r.uid=? AND r.notification_id=?
			AND (n.expires_at IS NULL OR n.expires_at>UTC_TIMESTAMP())
		LIMIT 1`, uid, notificationID).Scan(
		&sourceAppCode, &title, &summary, &body, &actionURL, &bizType, &bizID,
		&metadataJSON, &createdAt, &expiresAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "notification_not_found", "Notification not found")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"notificationId": notificationID,
		"sourceAppCode":  sourceAppCode,
		"title":          title,
		"summary":        nullableTextFromSQL(summary),
		"body":           nullableTextFromSQL(body),
		"actionUrl":      nullableTextFromSQL(actionURL),
		"bizType":        nullableTextFromSQL(bizType),
		"bizId":          nullableTextFromSQL(bizID),
		"metadataJson":   nullableTextFromSQL(metadataJSON),
		"createdAt":      createdAt.UTC().Format(time.RFC3339Nano),
		"expiresAt":      nullableAuditTime(expiresAt),
	}, nil
}

func (a *Adapter) MarkNotificationRead(ctx context.Context, uid string, notificationID string, meta MutationMeta) (map[string]any, error) {
	return a.mutateNotificationRecipient(ctx, uid, notificationID, "read", meta)
}

func (a *Adapter) ArchiveNotification(ctx context.Context, uid string, notificationID string, meta MutationMeta) (map[string]any, error) {
	return a.mutateNotificationRecipient(ctx, uid, notificationID, "archive", meta)
}

func (a *Adapter) MarkAllNotificationsRead(ctx context.Context, uid string, body map[string]any, meta MutationMeta) (map[string]any, error) {
	uid, err := validNotificationUID(uid)
	if err != nil {
		return nil, err
	}
	category := limitedNotificationFilter(stringField(body["category"]))
	sourceApp := limitedNotificationFilter(firstValue(stringField(body["sourceAppCode"]), stringField(body["source_app_code"])))
	payload := map[string]any{"uid": uid, "category": category, "sourceAppCode": sourceApp}
	session, replay, err := a.beginMutation(ctx, "console.notifications.read-all", meta.IdempotencyKey, meta.RequestID, uid, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()
	filters := []string{
		"r.uid=?", "r.read_at IS NULL", "r.archived_at IS NULL",
		"(n.expires_at IS NULL OR n.expires_at>UTC_TIMESTAMP())",
	}
	args := []any{uid}
	if category != "" {
		filters = append(filters, "n.category=?")
		args = append(args, category)
	}
	if sourceApp != "" {
		filters = append(filters, "n.source_app_code=?")
		args = append(args, sourceApp)
	}
	result, err := session.tx.ExecContext(ctx, `
		UPDATE portal_notification_recipients r
		INNER JOIN portal_notifications n ON n.notification_id=r.notification_id
		SET r.read_at=UTC_TIMESTAMP(),r.delivery_state='read',r.updated_at=UTC_TIMESTAMP()
		WHERE `+strings.Join(filters, " AND "), args...)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	response := map[string]any{"code": 0, "message": "success", "data": map[string]any{"updatedCount": affected}}
	if err := a.finishMutation(ctx, session, "notification", "read_all", "notification_recipient", uid, map[string]any{
		"updatedCount": affected, "category": nullableText(category), "sourceAppCode": nullableText(sourceApp),
	}, response); err != nil {
		return nil, err
	}
	return response, nil
}

func (a *Adapter) mutateNotificationRecipient(ctx context.Context, uid string, notificationID string, operation string, meta MutationMeta) (map[string]any, error) {
	uid, err := validNotificationUID(uid)
	if err != nil {
		return nil, err
	}
	notificationID = strings.TrimSpace(notificationID)
	if notificationID == "" || len(notificationID) > 128 || strings.ContainsAny(notificationID, "\r\n\t") {
		return nil, httperror.New(http.StatusBadRequest, "notification_id_invalid", "notificationId is invalid")
	}
	payload := map[string]any{"uid": uid, "notificationId": notificationID, "operation": operation}
	session, replay, err := a.beginMutation(ctx, "console.notifications."+operation, meta.IdempotencyKey, meta.RequestID, uid, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()
	setSQL := "read_at=COALESCE(read_at,UTC_TIMESTAMP()),delivery_state='read'"
	if operation == "archive" {
		setSQL = "read_at=COALESCE(read_at,UTC_TIMESTAMP()),archived_at=COALESCE(archived_at,UTC_TIMESTAMP()),delivery_state='archived'"
	}
	result, err := session.tx.ExecContext(ctx, `
		UPDATE portal_notification_recipients
		SET `+setSQL+`,updated_at=UTC_TIMESTAMP()
		WHERE uid=? AND notification_id=?`, uid, notificationID)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, httperror.New(http.StatusNotFound, "notification_not_found", "Notification not found")
	}
	data := map[string]any{"notificationId": notificationID}
	if operation == "archive" {
		data["archived"] = true
	} else {
		data["read"] = true
	}
	response := map[string]any{"code": 0, "message": "success", "data": data}
	if err := a.finishMutation(ctx, session, "notification", operation, "notification_recipient", notificationID, nilSafeDetail(map[string]any{
		"uid": uid,
	}), response); err != nil {
		return nil, err
	}
	return response, nil
}

func notificationSelectSQL() string {
	return `SELECT r.id,n.notification_id,n.source_app_code,n.category,n.severity,
		n.created_at,n.expires_at,r.read_at,r.archived_at,r.pinned_at
		FROM portal_notification_recipients r
		INNER JOIN portal_notifications n ON n.notification_id=r.notification_id`
}

func scanNotificationRow(scanner interface{ Scan(...any) error }) (notificationRow, error) {
	var row notificationRow
	err := scanner.Scan(
		&row.RowID, &row.NotificationID, &row.SourceAppCode, &row.Category, &row.Severity,
		&row.CreatedAt, &row.ExpiresAt, &row.ReadAt, &row.ArchivedAt, &row.PinnedAt,
	)
	return row, err
}

func mapNotification(row notificationRow) map[string]any {
	return map[string]any{
		"notificationId": row.NotificationID, "sourceAppCode": row.SourceAppCode,
		"category": row.Category, "severity": row.Severity,
		"displayLabel": notificationDisplayLabel(row.Category),
		"createdAt":    row.CreatedAt.UTC().Format(time.RFC3339),
		"expiresAt":    nullableAuditTime(row.ExpiresAt),
		"recipient": map[string]any{
			"readAt": nullableAuditTime(row.ReadAt), "archivedAt": nullableAuditTime(row.ArchivedAt),
			"pinnedAt": nullableAuditTime(row.PinnedAt), "isRead": row.ReadAt.Valid, "isArchived": row.ArchivedAt.Valid,
		},
	}
}

func validNotificationUID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 64 || strings.ContainsAny(value, "\r\n\t") {
		return "", httperror.New(http.StatusForbidden, "trusted_notification_user_required", "Trusted notification user is required")
	}
	return value, nil
}

func limitedNotificationFilter(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 64 {
		return value[:64]
	}
	return value
}

func notificationStatusSQL(status string) string {
	switch status {
	case "unread":
		return "r.read_at IS NULL AND r.archived_at IS NULL"
	case "read":
		return "r.read_at IS NOT NULL AND r.archived_at IS NULL"
	case "archived":
		return "r.archived_at IS NOT NULL"
	default:
		return "r.archived_at IS NULL"
	}
}

func notificationDisplayLabel(category string) string {
	switch strings.ToLower(strings.TrimSpace(category)) {
	case "approval":
		return "待处理审批通知"
	case "task":
		return "待处理任务通知"
	case "todo":
		return "待处理事项通知"
	case "security":
		return "安全通知"
	case "system":
		return "系统通知"
	default:
		return "业务通知"
	}
}

func nilSafeDetail(detail map[string]any) map[string]any {
	if detail == nil {
		return map[string]any{}
	}
	return detail
}

func nullableTextFromSQL(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}
