package console

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"strings"
	"time"
)

func feedbackDefaultSettings() FeedbackSettings {
	return FeedbackSettings{IntegrationCode: "gitlab.default", Project: FeedbackProject, WecomIntegrationCode: "wecom.default", RecipientRoles: []string{"system_admin"}, RecipientUIDs: []string{}, Labels: map[string][]string{}}
}
func (a *Adapter) feedbackSettings(ctx context.Context) (FeedbackSettings, error) {
	s := feedbackDefaultSettings()
	var raw []byte
	e := a.db.QueryRowContext(ctx, `SELECT settings_json FROM console_feedback_settings WHERE tenant_code=?`, a.tenant).Scan(&raw)
	if errors.Is(e, sql.ErrNoRows) {
		return s, nil
	}
	if e != nil {
		return s, e
	}
	e = json.Unmarshal(raw, &s)
	return s, e
}

const feedbackSelect = `SELECT feedback_id,reporter_uid,reporter_name,text_json,settings_json,status,issue_iid,issue_url,created_at, ((SELECT COUNT(*) FROM console_feedback_events e WHERE e.tenant_code=f.tenant_code AND e.feedback_id=f.feedback_id AND e.recipient_uids_json IS NULL)+(SELECT COUNT(*) FROM console_feedback_delivery d JOIN console_feedback_events e ON e.tenant_code=d.tenant_code AND e.event_id=d.event_id WHERE e.tenant_code=f.tenant_code AND e.feedback_id=f.feedback_id AND d.status IN ('pending','sending'))) FROM console_feedback f`

func scanFeedback(row interface{ Scan(...any) error }) (FeedbackRecord, error) {
	var r FeedbackRecord
	var t, s []byte
	var at time.Time
	e := row.Scan(&r.ID, &r.ReporterUID, &r.ReporterName, &t, &s, &r.Status, &r.IssueIID, &r.IssueURL, &at, &r.NotificationPending)
	if e != nil {
		return r, e
	}
	if e = json.Unmarshal(t, &r.Text); e != nil {
		return r, e
	}
	e = json.Unmarshal(s, &r.Settings)
	r.CreatedAt = at.UTC().Format(time.RFC3339Nano)
	return r, e
}
func (a *Adapter) feedbackRecord(ctx context.Context, id string) (FeedbackRecord, error) {
	r, e := scanFeedback(a.db.QueryRowContext(ctx, feedbackSelect+` WHERE tenant_code=? AND feedback_id=?`, a.tenant, id))
	if errors.Is(e, sql.ErrNoRows) {
		return r, feedbackError(404, "not_found")
	}
	return r, e
}
func (a *Adapter) feedbackActor(ctx context.Context, uid string) (string, error) {
	if uid == "" || strings.Contains(uid, ":") {
		return "", feedbackError(403, "subject_invalid")
	}
	var name string
	e := a.db.QueryRowContext(ctx, `SELECT display_name FROM directory_users WHERE uid=? AND status='active'`, uid).Scan(&name)
	if errors.Is(e, sql.ErrNoRows) {
		return "", feedbackError(403, "subject_inactive")
	}
	return name, e
}

// Feedback is the owning typed entry. Global scope is granted only by a fresh,
// signed Console permit; all other reads are constrained to reporter_uid.
func (a *Adapter) Feedback(ctx context.Context, op string, c FeedbackCommand, meta MutationMeta, global bool) (map[string]any, error) {
	name, e := a.feedbackActor(ctx, meta.ActorID)
	if e != nil {
		return nil, e
	}
	if (op == "settings-get" || op == "settings-save" || op == "retry" || op == "cancel" || op == "admin-list" || op == "cleanup-media") && !global {
		return nil, feedbackError(403, "scope_denied")
	}
	if op == "cleanup-media" {
		if !feedbackCode.MatchString(meta.IdempotencyKey) {
			return nil, feedbackError(400, "idempotency_required")
		}
		return a.cleanupFeedbackImages(ctx, c.ID, meta)
	}
	if op == "attachment-put" || op == "attachment-read" {
		return a.feedbackAttachment(ctx, op, c, meta, global)
	}
	if op == "options" || op == "settings-get" {
		s, e := a.feedbackSettings(ctx)
		if e != nil {
			return nil, e
		}
		if op == "options" {
			return map[string]any{"data": map[string]any{"enabled": s.Enabled, "project": s.Project, "mediaEnabled": feedbackMediaEnabled()}}, nil
		}
		return map[string]any{"data": s}, nil
	}
	if op == "list" || op == "admin-list" {
		if c.Page < 1 || c.Page > 100000 {
			return nil, feedbackError(400, "page_invalid")
		}
		if c.PageSize == 0 {
			c.PageSize = 20
		}
		if c.PageSize < 1 || c.PageSize > 100 {
			return nil, feedbackError(400, "page_size_invalid")
		}
		if c.Status != "" && !map[string]bool{"draft": true, "pending": true, "dispatching": true, "submitted": true, "failed": true, "unknown": true, "cancelled": true}[c.Status] {
			return nil, feedbackError(400, "status_invalid")
		}
		if c.Kind != "" && c.Kind != "bug" && c.Kind != "feature" && c.Kind != "suggestion" {
			return nil, feedbackError(400, "kind_invalid")
		}
		where := " WHERE tenant_code=?"
		args := []any{a.tenant}
		if op == "list" {
			where += " AND reporter_uid=?"
			args = append(args, meta.ActorID)
		}
		if c.Status != "" {
			where += " AND status=?"
			args = append(args, c.Status)
		}
		if c.Kind != "" {
			where += " AND JSON_UNQUOTE(JSON_EXTRACT(text_json,'$.kind'))=?"
			args = append(args, c.Kind)
		}
		var count int
		if e = a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM console_feedback"+where, args...).Scan(&count); e != nil {
			return nil, e
		}
		args = append(args, c.PageSize, (c.Page-1)*c.PageSize)
		rows, e := a.db.QueryContext(ctx, feedbackSelect+where+" ORDER BY created_at DESC,feedback_id DESC LIMIT ? OFFSET ?", args...)
		if e != nil {
			return nil, e
		}
		defer rows.Close()
		items := []FeedbackRecord{}
		for rows.Next() {
			r, e := scanFeedback(rows)
			if e != nil {
				return nil, e
			}
			items = append(items, r)
		}
		return map[string]any{"data": map[string]any{"items": items, "total": count, "page": c.Page, "pageSize": c.PageSize}}, rows.Err()
	}
	if op == "detail" {
		r, e := a.feedbackRecord(ctx, c.ID)
		if e != nil {
			return nil, e
		}
		if !global && r.ReporterUID != meta.ActorID {
			return nil, feedbackError(404, "not_found")
		}
		r.Attachments, e = a.feedbackMediaSummary(ctx, c.ID)
		if e != nil {
			return nil, e
		}
		return map[string]any{"data": r}, nil
	}
	if op != "draft" && op != "submit" && op != "retry" && op != "cancel" && op != "settings-save" {
		return nil, feedbackError(404, "operation_invalid")
	}
	if !feedbackCode.MatchString(meta.IdempotencyKey) {
		return nil, feedbackError(400, "idempotency_required")
	}
	var settings FeedbackSettings
	if op == "draft" || op == "submit" {
		settings, e = a.feedbackSettings(ctx)
		if e != nil {
			return nil, e
		}
		if !settings.Enabled {
			return nil, feedbackError(503, "disabled")
		}
		if op == "draft" && c.Text == nil {
			return nil, feedbackError(400, "text_required")
		}
		if op == "draft" {
			t, err := normalizeFeedbackText(*c.Text, settings)
			if err != nil {
				return nil, err
			}
			if len(t.AttachmentIDs) > 0 && !feedbackMediaEnabled() {
				return nil, feedbackError(503, "media_disabled")
			}
			c.Text = &t
		}
	}
	if op == "settings-save" {
		if c.Settings == nil {
			return nil, feedbackError(400, "settings_required")
		}
		if e = validateFeedbackSettings(*c.Settings); e != nil {
			return nil, e
		}
	}
	// Authorize object before any replay; the receipt never bypasses ownership.
	if op == "submit" || op == "retry" || op == "cancel" {
		r, e := a.feedbackRecord(ctx, c.ID)
		if e != nil {
			return nil, e
		}
		if !global && r.ReporterUID != meta.ActorID {
			return nil, feedbackError(404, "not_found")
		}
	}
	h := sha256.Sum256([]byte(meta.ActorID + "\x00" + meta.IdempotencyKey))
	key := hex.EncodeToString(h[:])
	session, replay, e := a.beginMutation(ctx, "console.feedback."+op, key, meta.RequestID, meta.ActorID, c)
	if e != nil || replay != nil {
		return replay, e
	}
	defer session.tx.Rollback()
	var result any
	switch op {
	case "settings-save":
		s := *c.Settings
		if s.RecipientUIDs == nil {
			s.RecipientUIDs = []string{}
		}
		if s.RecipientRoles == nil {
			s.RecipientRoles = []string{}
		}
		if s.Labels == nil {
			s.Labels = map[string][]string{}
		}
		s.Revision++
		raw, _ := json.Marshal(s)
		if c.Settings.Revision == 0 {
			_, e = session.tx.ExecContext(ctx, `INSERT INTO console_feedback_settings(tenant_code,revision,settings_json,updated_at) VALUES(?,?,?,UTC_TIMESTAMP(3))`, a.tenant, s.Revision, raw)
		} else {
			var res sql.Result
			res, e = session.tx.ExecContext(ctx, `UPDATE console_feedback_settings SET revision=?,settings_json=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_code=? AND revision=?`, s.Revision, raw, a.tenant, c.Settings.Revision)
			if e == nil {
				n, _ := res.RowsAffected()
				if n != 1 {
					e = feedbackError(409, "settings_changed")
				}
			}
		}
		result = s
	case "draft":
		id, err := newMutationReceiptID()
		if err != nil {
			return nil, err
		}
		text, _ := json.Marshal(c.Text)
		s, _ := json.Marshal(settings)
		_, e = session.tx.ExecContext(ctx, `INSERT INTO console_feedback(tenant_code,feedback_id,reporter_uid,reporter_name,text_json,settings_json,status,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,'draft',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, a.tenant, id, meta.ActorID, name, text, s)
		result = map[string]any{"id": id, "status": "draft"}
	default:
		var status string
		e = session.tx.QueryRowContext(ctx, `SELECT status FROM console_feedback WHERE tenant_code=? AND feedback_id=? FOR UPDATE`, a.tenant, c.ID).Scan(&status)
		if e != nil {
			return nil, e
		}
		if op == "submit" {
			var textRaw []byte
			if e = session.tx.QueryRowContext(ctx, `SELECT text_json FROM console_feedback WHERE tenant_code=? AND feedback_id=?`, a.tenant, c.ID).Scan(&textRaw); e != nil {
				return nil, e
			}
			var text FeedbackText
			if e = json.Unmarshal(textRaw, &text); e != nil {
				return nil, e
			}
			if len(text.AttachmentIDs) > 0 {
				if !feedbackMediaEnabled() {
					return nil, feedbackError(503, "media_disabled")
				}
				for _, id := range text.AttachmentIDs {
					var n int
					if e = session.tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM console_feedback_attachments WHERE tenant_code=? AND feedback_id=? AND attachment_id=? AND image_bytes IS NOT NULL AND status='staged'`, a.tenant, c.ID, id).Scan(&n); e != nil {
						return nil, e
					}
					if n != 1 {
						return nil, feedbackError(409, "attachment_missing")
					}
				}
			}
		}
		next := "pending"
		if op == "submit" && status != "draft" {
			return nil, feedbackError(409, "state_changed")
		}
		if op == "retry" && status != "failed" {
			return nil, feedbackError(409, "retry_requires_definite_failure")
		}
		if op == "cancel" {
			unknownUpload := false
			if status == "unknown" {
				var n int
				if e = session.tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM console_feedback_attachments WHERE tenant_code=? AND feedback_id=? AND status IN ('uploading','unknown')`, a.tenant, c.ID).Scan(&n); e != nil {
					return nil, e
				}
				unknownUpload = n > 0
			}
			// An unresolved attachment means the all-images-ready gate was never
			// passed. Unlike an unknown Issue POST, this can be cancelled safely.
			if status != "draft" && status != "pending" && status != "failed" && !unknownUpload {
				return nil, feedbackError(409, "cannot_cancel")
			}
			next = "cancelled"
		}
		_, e = session.tx.ExecContext(ctx, `UPDATE console_feedback SET status=?,next_attempt_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE tenant_code=? AND feedback_id=?`, next, a.tenant, c.ID)
		result = map[string]any{"id": c.ID, "status": next}
	}
	if e != nil {
		var duplicate *mysql.MySQLError
		if errors.As(e, &duplicate) && duplicate.Number == 1062 {
			return nil, feedbackError(409, "settings_changed")
		}
		return nil, e
	}
	response := map[string]any{"data": result}
	e = a.finishMutation(ctx, session, "feedback", op, "feedback", c.ID, map[string]any{"operation": op}, response)
	return response, e
}

func feedbackMarker(tenant, id string) string {
	h := sha256.Sum256([]byte(tenant + "\x00" + id))
	return "<!-- hzy-feedback:v1:" + hex.EncodeToString(h[:]) + " -->"
}
func feedbackEvent(ctx context.Context, tx *sql.Tx, tenant, id, kind string, s FeedbackSettings) error {
	raw, _ := json.Marshal(s)
	// One event per failure cycle and one success event. Manual retries do not spam.
	// DATETIME defaults follow the database session's timezone. Keep the due
	// timestamp in the same UTC clock used by the worker, even on legacy pools.
	_, e := tx.ExecContext(ctx, `INSERT IGNORE INTO console_feedback_events(tenant_code,event_id,feedback_id,event_type,recipient_policy_json,resolve_after,created_at) VALUES(?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, tenant, fmt.Sprintf("%s:%s", id, kind), id, kind, raw)
	return e
}

// Bounded tenant-local retention; unresolved delivery evidence is never purged.
// GitLab retention is independent and no external deletion is performed.
func (a *Adapter) purgeFeedback(ctx context.Context) error {
	if e := a.purgeFeedbackMedia(ctx); e != nil {
		return e
	}
	tx, e := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if e != nil {
		return e
	}
	defer tx.Rollback()
	rows, e := tx.QueryContext(ctx, `SELECT feedback_id FROM console_feedback f WHERE tenant_code=? AND ((status='draft' AND created_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 24 HOUR)) OR (status IN ('submitted','cancelled') AND created_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 180 DAY))) AND NOT EXISTS(SELECT 1 FROM console_feedback_attachments a WHERE a.tenant_code=f.tenant_code AND a.feedback_id=f.feedback_id AND a.status IN ('uploaded','uploading','unknown') AND f.status<>'submitted') AND NOT EXISTS(SELECT 1 FROM console_feedback_events e WHERE e.tenant_code=f.tenant_code AND e.feedback_id=f.feedback_id AND (e.recipient_uids_json IS NULL OR EXISTS(SELECT 1 FROM console_feedback_delivery d WHERE d.tenant_code=e.tenant_code AND d.event_id=e.event_id AND d.status IN ('pending','sending')))) LIMIT 50 FOR UPDATE SKIP LOCKED`, a.tenant)
	if e != nil {
		return e
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return e
		}
		ids = append(ids, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, id := range ids {
		if _, e = tx.ExecContext(ctx, `DELETE FROM console_feedback_attachments WHERE tenant_code=? AND feedback_id=?`, a.tenant, id); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, `DELETE d FROM console_feedback_delivery d JOIN console_feedback_events e ON e.tenant_code=d.tenant_code AND e.event_id=d.event_id WHERE e.tenant_code=? AND e.feedback_id=?`, a.tenant, id); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, `DELETE FROM console_feedback_events WHERE tenant_code=? AND feedback_id=?`, a.tenant, id); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, `DELETE FROM console_feedback WHERE tenant_code=? AND feedback_id=?`, a.tenant, id); e != nil {
			return e
		}
	}
	return tx.Commit()
}
