package console

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"regexp"
)

func (g gitLabOperationRuntime) feedbackMediaGate(ctx context.Context) error {
	if !feedbackMediaEnabled() {
		return feedbackError(503, "media_disabled")
	}
	var project struct {
		Path       string `json:"path_with_namespace"`
		Visibility string `json:"visibility"`
		Media      bool   `json:"enforce_auth_checks_on_uploads"`
	}
	if e := g.requestJSON(ctx, "GET", "/api/v4/projects/"+url.PathEscape(FeedbackProject), nil, &project); e != nil {
		return feedbackError(503, "media_verification_failed")
	}
	if project.Path != FeedbackProject || project.Visibility != "private" || !project.Media {
		return feedbackError(503, "media_not_private")
	}
	return nil
}
func (g gitLabOperationRuntime) uploadFeedbackImage(ctx context.Context, id string, raw []byte) (int64, string, string) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, e := writer.CreateFormFile("file", "feedback-"+id+".png")
	if e != nil {
		return 0, "", "failed"
	}
	if _, e = part.Write(raw); e != nil {
		return 0, "", "failed"
	}
	if e = writer.Close(); e != nil {
		return 0, "", "failed"
	}
	req, e := http.NewRequestWithContext(ctx, "POST", g.BaseURL+"/api/v4/projects/"+url.PathEscape(FeedbackProject)+"/uploads", &body)
	if e != nil {
		return 0, "", "failed"
	}
	req.Header.Set("PRIVATE-TOKEN", g.Token)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	res, e := gitLabOperationClient.Do(req)
	if e != nil {
		return 0, "", "unknown"
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 && res.StatusCode < 500 && res.StatusCode != 408 {
		return 0, "", "failed"
	}
	if res.StatusCode != 201 {
		return 0, "", "unknown"
	}
	var result struct {
		ID  int64  `json:"id"`
		URL string `json:"url"`
	}
	rawResult, e := io.ReadAll(io.LimitReader(res.Body, 65537))
	if e != nil || len(rawResult) > 65536 || json.Unmarshal(rawResult, &result) != nil || result.ID <= 0 || !regexp.MustCompile(`^/uploads/[a-f0-9]{32}/feedback-`+regexp.QuoteMeta(id)+`\.png$`).MatchString(result.URL) {
		return 0, "", "unknown"
	}
	return result.ID, result.URL, "uploaded"
}

// Parent dispatch lease fences each step. A lost HTTP/DB receipt is deliberately
// unknown, never retried as a fresh upload. Uploaded steps survive Issue failure.
func (a *Adapter) deliverFeedbackImages(ctx context.Context, g gitLabOperationRuntime, r *FeedbackRecord, attempt int64) (string, error) {
	if len(r.Text.AttachmentIDs) == 0 {
		return "ready", nil
	}
	if e := g.feedbackMediaGate(ctx); e != nil {
		return "failed", nil
	}
	for _, id := range r.Text.AttachmentIDs {
		tx, e := a.db.BeginTx(ctx, nil)
		if e != nil {
			return "", e
		}
		var current int64
		var parent string
		e = tx.QueryRowContext(ctx, `SELECT attempt,status FROM console_feedback WHERE tenant_code=? AND feedback_id=? FOR UPDATE`, a.tenant, r.ID).Scan(&current, &parent)
		if e != nil || current != attempt || parent != "dispatching" {
			tx.Rollback()
			return "", feedbackError(409, "lease_changed")
		}
		var state, path string
		var raw []byte
		e = tx.QueryRowContext(ctx, `SELECT status,upload_path,image_bytes FROM console_feedback_attachments WHERE tenant_code=? AND feedback_id=? AND attachment_id=? FOR UPDATE`, a.tenant, r.ID, id).Scan(&state, &path, &raw)
		if e != nil {
			tx.Rollback()
			return "failed", nil
		}
		if state == "uploaded" {
			tx.Rollback()
			r.AttachmentMarkdown += "\n![反馈图片](" + path + ")\n"
			continue
		}
		if state == "unknown" || state == "uploading" {
			tx.Rollback()
			return "unknown", nil
		}
		if len(raw) == 0 || state == "expired" {
			tx.Rollback()
			return "failed", nil
		}
		_, e = tx.ExecContext(ctx, `UPDATE console_feedback_attachments SET status='uploading',updated_at=UTC_TIMESTAMP(3) WHERE tenant_code=? AND feedback_id=? AND attachment_id=?`, a.tenant, r.ID, id)
		if e != nil {
			tx.Rollback()
			return "", e
		}
		if e = tx.Commit(); e != nil {
			return "", e
		}
		uploadID, uploadPath, next := g.uploadFeedbackImage(ctx, feedbackMediaKey(a.tenant, r.ID, id), raw)
		// Receipt failures leave uploading, which is treated as unknown next time.
		tx, e = a.db.BeginTx(context.WithoutCancel(ctx), nil)
		if e != nil {
			return "", e
		}
		e = tx.QueryRowContext(ctx, `SELECT attempt,status FROM console_feedback WHERE tenant_code=? AND feedback_id=? FOR UPDATE`, a.tenant, r.ID).Scan(&current, &parent)
		if e != nil || current != attempt || parent != "dispatching" {
			tx.Rollback()
			return "", feedbackError(409, "lease_changed")
		}
		_, e = tx.ExecContext(ctx, `UPDATE console_feedback_attachments SET status=?,upload_id=?,upload_path=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_code=? AND feedback_id=? AND attachment_id=?`, next, uploadID, uploadPath, a.tenant, r.ID, id)
		if e != nil {
			tx.Rollback()
			return "", e
		}
		if e = tx.Commit(); e != nil {
			return "", e
		}
		if next != "uploaded" {
			return next, nil
		}
		r.AttachmentMarkdown += fmt.Sprintf("\n![反馈图片](%s)\n", uploadPath)
	}
	// Setting can be revoked between steps; do not create an Issue after revocation.
	if e := g.feedbackMediaGate(ctx); e != nil {
		return "failed", nil
	}
	return "ready", nil
}

// Explicit feedback:admin disposition. No arbitrary project, URL or upload ID
// from the browser. Only cancelled feedback with a definite upload receipt is
// eligible; unknown creates are never cancelled/deleted by this operation.
func (a *Adapter) cleanupFeedbackImages(ctx context.Context, id string, meta MutationMeta) (map[string]any, error) {
	r, e := a.feedbackRecord(ctx, id)
	if e != nil {
		return nil, e
	}
	if r.Status != "cancelled" || r.IssueIID != 0 {
		return nil, feedbackError(409, "cleanup_requires_cancelled")
	}
	_, e = a.db.ExecContext(ctx, `INSERT INTO operation_logs(domain_code,action,target_type,target_key,actor_type,actor_id,request_id,detail_json,created_at) VALUES('feedback','cleanup-media','feedback',?,'user',?,?,JSON_OBJECT('operation','cleanup-media'),UTC_TIMESTAMP(3))`, id, meta.ActorID, meta.RequestID)
	if e != nil {
		return nil, e
	}
	g, e := a.resolveOwnedGitLabRuntime(ctx, r.Settings.IntegrationCode, "console.feedback-admin", "console", "", "")
	if e != nil {
		return nil, e
	}
	if e = a.reconcileFeedbackImages(ctx, g, id); e != nil {
		return nil, e
	}
	rows, e := a.db.QueryContext(ctx, `SELECT attachment_id,upload_id FROM console_feedback_attachments WHERE tenant_code=? AND feedback_id=? AND upload_id>0 AND status IN ('uploaded','unknown')`, a.tenant, id)
	if e != nil {
		return nil, e
	}
	type candidate struct {
		id     string
		upload int64
	}
	list := []candidate{}
	for rows.Next() {
		var c candidate
		if e = rows.Scan(&c.id, &c.upload); e != nil {
			rows.Close()
			return nil, e
		}
		list = append(list, c)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	for _, c := range list {
		req, e := http.NewRequestWithContext(ctx, "DELETE", g.BaseURL+"/api/v4/projects/"+url.PathEscape(FeedbackProject)+"/uploads/"+fmt.Sprint(c.upload), nil)
		if e != nil {
			return nil, e
		}
		req.Header.Set("PRIVATE-TOKEN", g.Token)
		res, e := gitLabOperationClient.Do(req)
		if e != nil {
			return nil, feedbackError(503, "cleanup_unconfirmed")
		}
		res.Body.Close()
		if res.StatusCode != 204 && res.StatusCode != 404 {
			return nil, feedbackError(503, "cleanup_unconfirmed")
		}
		_, e = a.db.ExecContext(ctx, `UPDATE console_feedback_attachments SET status='expired',upload_path='',image_bytes=NULL,updated_at=UTC_TIMESTAMP(3) WHERE tenant_code=? AND feedback_id=? AND attachment_id=? AND upload_id=?`, a.tenant, id, c.id, c.upload)
		if e != nil {
			return nil, e
		}
	}
	var unresolved int
	if e = a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM console_feedback_attachments WHERE tenant_code=? AND feedback_id=? AND status IN ('uploading','unknown')`, a.tenant, id).Scan(&unresolved); e != nil {
		return nil, e
	}
	if unresolved > 0 {
		return nil, feedbackError(409, "cleanup_unconfirmed")
	}
	return map[string]any{"data": map[string]any{"cleaned": len(list)}}, nil
}

// Upload POST has no GitLab idempotency contract. Reconcile by our generated
// filename AND canonical image digest, never by filename alone. GitLab's listing
// does not expose the Markdown secret/path, so a recovered ID is disposition
// evidence only: never invent a link or upload the same image again.
func (g gitLabOperationRuntime) findFeedbackUpload(ctx context.Context, id, digest string) (int64, error) {
	var found int64
	for page := 1; page <= 100; page++ {
		var list []struct {
			ID       int64  `json:"id"`
			Filename string `json:"filename"`
			Size     int    `json:"size"`
		}
		e := g.requestJSON(ctx, "GET", "/api/v4/projects/"+url.PathEscape(FeedbackProject)+"/uploads?per_page=100&page="+fmt.Sprint(page), nil, &list)
		if e != nil {
			return 0, e
		}
		for _, row := range list {
			if row.Filename != "feedback-"+id+".png" || row.ID <= 0 || row.Size > feedbackImageLimit {
				continue
			}
			req, e := http.NewRequestWithContext(ctx, "GET", g.BaseURL+"/api/v4/projects/"+url.PathEscape(FeedbackProject)+"/uploads/"+fmt.Sprint(row.ID), nil)
			if e != nil {
				return 0, e
			}
			req.Header.Set("PRIVATE-TOKEN", g.Token)
			res, e := gitLabOperationClient.Do(req)
			if e != nil {
				return 0, e
			}
			raw, e := io.ReadAll(io.LimitReader(res.Body, feedbackImageLimit+1))
			res.Body.Close()
			if e != nil || res.StatusCode != 200 {
				return 0, feedbackError(503, "upload_reconcile_unavailable")
			}
			if feedbackDigest(raw) != digest {
				continue
			}
			if found != 0 && found != row.ID {
				return 0, feedbackError(409, "multiple_uploads")
			}
			found = row.ID
		}
		if len(list) < 100 {
			return found, nil
		}
	}
	return 0, feedbackError(503, "upload_reconcile_bound")
}
func (a *Adapter) reconcileFeedbackImages(ctx context.Context, g gitLabOperationRuntime, id string) error {
	rows, e := a.db.QueryContext(ctx, `SELECT attachment_id,sha256 FROM console_feedback_attachments WHERE tenant_code=? AND feedback_id=? AND status IN ('uploading','unknown') AND upload_id=0`, a.tenant, id)
	if e != nil {
		return e
	}
	type candidate struct{ id, digest string }
	list := []candidate{}
	for rows.Next() {
		var c candidate
		if e = rows.Scan(&c.id, &c.digest); e != nil {
			rows.Close()
			return e
		}
		list = append(list, c)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, c := range list {
		upload, e := g.findFeedbackUpload(ctx, feedbackMediaKey(a.tenant, id, c.id), c.digest)
		if e != nil {
			return e
		}
		if upload == 0 {
			continue
		}
		_, e = a.db.ExecContext(ctx, `UPDATE console_feedback_attachments SET upload_id=?,status='unknown',updated_at=UTC_TIMESTAMP(3) WHERE tenant_code=? AND feedback_id=? AND attachment_id=? AND upload_id=0 AND status IN ('uploading','unknown')`, upload, a.tenant, id, c.id)
		if e != nil {
			return e
		}
	}
	return nil
}

func feedbackMediaKey(tenant, feedback, attachment string) string {
	return feedbackDigest([]byte(tenant + "\x00" + feedback + "\x00" + attachment))
}
