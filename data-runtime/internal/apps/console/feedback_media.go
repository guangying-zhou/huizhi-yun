package console

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"github.com/go-sql-driver/mysql"
	"image"
	_ "image/jpeg"
	"image/png"
	"os"
	"regexp"
	"time"
)

const feedbackImageLimit = 5 << 20

var feedbackAttachmentID = regexp.MustCompile(`^[a-f0-9-]{36}$`)

// An operator records a successful anonymous-media check. It expires; project
// visibility and media authorization are additionally rechecked before each send.
func feedbackMediaEnabled() bool {
	at, e := time.Parse(time.RFC3339, os.Getenv("HZY_CONSOLE_FEEDBACK_MEDIA_VERIFIED_AT"))
	return os.Getenv("HZY_CONSOLE_FEEDBACK_MEDIA_ENABLED") == "true" && e == nil && !at.After(time.Now()) && time.Since(at) < 7*24*time.Hour
}
func normalizeFeedbackImage(raw []byte, mime string) ([]byte, error) {
	if len(raw) == 0 || len(raw) > feedbackImageLimit {
		return nil, feedbackError(413, "image_size")
	}
	c, format, e := image.DecodeConfig(bytes.NewReader(raw))
	if e != nil || !((format == "png" && mime == "image/png") || (format == "jpeg" && mime == "image/jpeg")) || c.Width < 1 || c.Height < 1 || c.Width > 8192 || c.Height > 8192 || int64(c.Width)*int64(c.Height) > 16000000 {
		return nil, feedbackError(400, "image_invalid")
	}
	// APNG animation is not silently flattened. PNG/JPEG decoders discard all
	// metadata when re-encoding. Browser converts supported static WebP to PNG.
	if format == "png" && bytes.Contains(raw, []byte("acTL")) {
		return nil, feedbackError(400, "image_animation")
	}
	im, _, e := image.Decode(bytes.NewReader(raw))
	if e != nil {
		return nil, feedbackError(400, "image_invalid")
	}
	var b bytes.Buffer
	if e = png.Encode(&b, im); e != nil {
		return nil, feedbackError(400, "image_invalid")
	}
	if b.Len() > feedbackImageLimit {
		return nil, feedbackError(413, "image_size")
	}
	return b.Bytes(), nil
}
func feedbackDigest(raw []byte) string { h := sha256.Sum256(raw); return hex.EncodeToString(h[:]) }
func (a *Adapter) feedbackAttachment(ctx context.Context, op string, c FeedbackCommand, m MutationMeta, global bool) (map[string]any, error) {
	if !feedbackAttachmentID.MatchString(c.AttachmentID) {
		return nil, feedbackError(400, "attachment_invalid")
	}
	r, e := a.feedbackRecord(ctx, c.ID)
	if e != nil {
		return nil, e
	}
	// Submit permission never permits attaching to another person's draft.
	if r.ReporterUID != m.ActorID && (op == "attachment-put" || !global) {
		return nil, feedbackError(404, "not_found")
	}
	if op == "attachment-read" {
		var raw []byte
		e = a.db.QueryRowContext(ctx, `SELECT image_bytes FROM console_feedback_attachments WHERE tenant_code=? AND feedback_id=? AND attachment_id=?`, a.tenant, c.ID, c.AttachmentID).Scan(&raw)
		if e == sql.ErrNoRows {
			return nil, feedbackError(404, "not_found")
		}
		if e != nil {
			return nil, e
		}
		if len(raw) == 0 {
			return nil, feedbackError(410, "image_expired")
		}
		return map[string]any{"data": map[string]any{"image": base64.StdEncoding.EncodeToString(raw), "contentType": "image/png"}}, nil
	}
	settings, settingsErr := a.feedbackSettings(ctx)
	if settingsErr != nil {
		return nil, settingsErr
	}
	if !settings.Enabled {
		return nil, feedbackError(503, "disabled")
	}
	if !feedbackMediaEnabled() {
		return nil, feedbackError(503, "media_disabled")
	}
	if !feedbackCode.MatchString(m.IdempotencyKey) {
		return nil, feedbackError(400, "idempotency_required")
	}
	expected := false
	for _, id := range r.Text.AttachmentIDs {
		if id == c.AttachmentID {
			expected = true
		}
	}
	if !expected {
		return nil, feedbackError(409, "attachment_not_in_draft")
	}
	raw, e := base64.StdEncoding.Strict().DecodeString(c.Image)
	if e != nil || feedbackDigest(raw) != c.SHA256 {
		return nil, feedbackError(400, "image_digest")
	}
	clean, e := normalizeFeedbackImage(raw, c.ContentType)
	if e != nil {
		return nil, e
	}
	tx, e := a.db.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	var status string
	if e = tx.QueryRowContext(ctx, `SELECT status FROM console_feedback WHERE tenant_code=? AND feedback_id=? FOR UPDATE`, a.tenant, c.ID).Scan(&status); e != nil {
		return nil, e
	}
	requestKey := feedbackDigest([]byte(m.ActorID + "\x00" + m.IdempotencyKey))
	var boundFeedback, boundAttachment string
	e = tx.QueryRowContext(ctx, `SELECT feedback_id,attachment_id FROM console_feedback_attachments WHERE tenant_code=? AND request_key=?`, a.tenant, requestKey).Scan(&boundFeedback, &boundAttachment)
	if e == nil && (boundFeedback != c.ID || boundAttachment != c.AttachmentID) {
		return nil, feedbackError(409, "image_intent_changed")
	}
	if e != nil && e != sql.ErrNoRows {
		return nil, e
	}
	var old string
	e = tx.QueryRowContext(ctx, `SELECT input_sha256 FROM console_feedback_attachments WHERE tenant_code=? AND feedback_id=? AND attachment_id=?`, a.tenant, c.ID, c.AttachmentID).Scan(&old)
	if e == nil {
		if old != c.SHA256 {
			return nil, feedbackError(409, "image_changed")
		}
		return map[string]any{"data": map[string]any{"id": c.AttachmentID, "replayed": true}}, nil
	}
	if e != sql.ErrNoRows {
		return nil, e
	}
	if status != "draft" {
		return nil, feedbackError(409, "state_changed")
	}
	var count, total int
	if e = tx.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(byte_size),0) FROM console_feedback_attachments WHERE tenant_code=? AND feedback_id=?`, a.tenant, c.ID).Scan(&count, &total); e != nil {
		return nil, e
	}
	if count >= 5 || total+len(clean) > 15<<20 {
		return nil, feedbackError(413, "attachments_limit")
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO console_feedback_attachments(tenant_code,feedback_id,attachment_id,request_key,input_sha256,sha256,byte_size,image_bytes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, a.tenant, c.ID, c.AttachmentID, requestKey, c.SHA256, feedbackDigest(clean), len(clean), clean)
	if e != nil {
		var duplicate *mysql.MySQLError
		if errors.As(e, &duplicate) && duplicate.Number == 1062 {
			return nil, feedbackError(409, "image_intent_changed")
		}
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"data": map[string]any{"id": c.AttachmentID}}, nil
}
func (a *Adapter) purgeFeedbackMedia(ctx context.Context) error {
	// Only local blobs are removed automatically. External orphan receipts survive
	// for administrator disposition; ordinary workers have no GitLab delete route.
	_, e := a.db.ExecContext(ctx, `UPDATE console_feedback_attachments a SET a.image_bytes=NULL,a.status=IF(a.status IN ('uploaded','uploading','unknown'),a.status,'expired'),a.updated_at=UTC_TIMESTAMP(3) WHERE a.tenant_code=? AND a.image_bytes IS NOT NULL AND EXISTS (SELECT 1 FROM console_feedback f WHERE f.tenant_code=a.tenant_code AND f.feedback_id=a.feedback_id AND ((f.status IN ('draft','cancelled') AND a.created_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 24 HOUR)) OR (f.status='submitted' AND f.updated_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 7 DAY)) OR (f.status IN ('failed','unknown') AND a.created_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 DAY)))) LIMIT 50`, a.tenant)
	return e
}

// Keep summaries small; never return private upload URLs or binary in lists.
func (a *Adapter) feedbackMediaSummary(ctx context.Context, id string) ([]map[string]any, error) {
	rows, e := a.db.QueryContext(ctx, `SELECT attachment_id,status,byte_size,image_bytes IS NOT NULL FROM console_feedback_attachments WHERE tenant_code=? AND feedback_id=? ORDER BY attachment_id`, a.tenant, id)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, status string
		var size int
		var available bool
		if e = rows.Scan(&id, &status, &size, &available); e != nil {
			return nil, e
		}
		out = append(out, map[string]any{"id": id, "status": status, "size": size, "available": available})
	}
	return out, rows.Err()
}
