package console

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) SetRuntimeClipboard(ctx context.Context, uid string, body map[string]any) (map[string]any, error) {
	uid, err := validRuntimeCompatValue(uid, 64, "uid")
	if err != nil {
		return nil, err
	}
	content := stringField(body["content"])
	if content == "" {
		return nil, httperror.New(http.StatusBadRequest, "clipboard_content_required", "clipboard content is required")
	}
	if len([]byte(content)) > 512*1024 {
		return nil, httperror.New(http.StatusRequestEntityTooLarge, "clipboard_content_too_large", "clipboard content is too large")
	}
	contentType := strings.TrimSpace(stringField(body["contentType"]))
	if contentType == "" {
		contentType = "markdown"
	}
	if !utf8.ValidString(contentType) || len(contentType) > 32 {
		return nil, httperror.New(http.StatusBadRequest, "clipboard_content_type_invalid", "clipboard content type is invalid")
	}
	sourceApp := limitedRuntimeCompatText(body["sourceApp"], 64)
	_, err = a.db.ExecContext(ctx, `
		INSERT INTO runtime_clipboards (uid,content,content_type,source_app,created_at,expires_at)
		VALUES (?,?,?,?,UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 MINUTE))
		ON DUPLICATE KEY UPDATE
			content=VALUES(content),content_type=VALUES(content_type),source_app=VALUES(source_app),
			created_at=UTC_TIMESTAMP(),expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 MINUTE)`,
		uid, content, contentType, nullableText(sourceApp))
	if err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "message": "ok", "data": nil}, nil
}

func (a *Adapter) RuntimeClipboard(ctx context.Context, uid string) (map[string]any, error) {
	uid, err := validRuntimeCompatValue(uid, 64, "uid")
	if err != nil {
		return nil, err
	}
	var content, contentType string
	var sourceApp sql.NullString
	var createdAt time.Time
	err = a.db.QueryRowContext(ctx, `
		SELECT content,content_type,source_app,created_at
		FROM runtime_clipboards
		WHERE uid=? AND expires_at>UTC_TIMESTAMP()
		LIMIT 1`, uid).Scan(&content, &contentType, &sourceApp, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return map[string]any{"code": 0, "message": "ok", "data": nil}, nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "message": "ok", "data": map[string]any{
		"content": content, "contentType": contentType, "sourceApp": nullableTextFromSQL(sourceApp),
		"createdAt": createdAt.UTC().Format(time.RFC3339Nano),
	}}, nil
}

func (a *Adapter) WriteRuntimeHeartbeat(ctx context.Context, uid string, body map[string]any) (map[string]any, error) {
	uid, err := validRuntimeCompatValue(uid, 64, "uid")
	if err != nil {
		return nil, err
	}
	sourceApp, err := validRuntimeCompatValue(stringField(body["sourceApp"]), 64, "sourceApp")
	if err != nil {
		return nil, err
	}
	status := strings.TrimSpace(stringField(body["status"]))
	if status != "idle" && status != "offline" {
		status = "active"
	}
	page := limitedRuntimeCompatText(body["page"], 512)
	_, err = a.db.ExecContext(ctx, `
		INSERT INTO local_presence_heartbeats (uid,source_app,page_path,status,last_seen_at)
		VALUES (?,?,?,?,UTC_TIMESTAMP())
		ON DUPLICATE KEY UPDATE
			page_path=VALUES(page_path),status=VALUES(status),last_seen_at=UTC_TIMESTAMP()`,
		uid, sourceApp, nullableText(page), status)
	if err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "message": "ok", "data": nil}, nil
}

func (a *Adapter) RuntimeOnlineHeartbeats(ctx context.Context, query url.Values) (map[string]any, error) {
	sourceApp := limitedRuntimeCompatText(query.Get("sourceApp"), 64)
	statement := `
		SELECT uid,source_app,page_path,status,last_seen_at
		FROM local_presence_heartbeats
		WHERE last_seen_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 5 MINUTE)`
	args := []any{}
	if sourceApp != "" {
		statement += " AND source_app=?"
		args = append(args, sourceApp)
	}
	statement += " ORDER BY last_seen_at DESC LIMIT 1000"
	rows, err := a.db.QueryContext(ctx, statement, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var uid, appCode, status string
		var page sql.NullString
		var lastSeen time.Time
		if err := rows.Scan(&uid, &appCode, &page, &status, &lastSeen); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"uid": uid, "sourceApp": appCode, "page": nullableTextFromSQL(page),
			"status": status, "lastSeen": lastSeen.UTC().Format(time.RFC3339Nano),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "message": "ok", "data": map[string]any{
		"total": len(items), "items": items,
	}}, nil
}

func validRuntimeCompatValue(value string, maxLength int, field string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > maxLength || !utf8.ValidString(value) || strings.ContainsAny(value, "\r\n\t") {
		return "", httperror.New(http.StatusBadRequest, "runtime_compat_"+field+"_invalid", field+" is invalid")
	}
	return value, nil
}

func limitedRuntimeCompatText(value any, maxLength int) string {
	text := strings.TrimSpace(stringField(value))
	if !utf8.ValidString(text) {
		return ""
	}
	if len(text) > maxLength {
		return text[:maxLength]
	}
	return text
}
