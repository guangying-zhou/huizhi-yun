package console

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Preserve definite rejection vs uncertain completion; never return raw errors.
func (g gitLabOperationRuntime) createFeedbackIssue(ctx context.Context, r FeedbackRecord, marker string) (int64, string, string) {
	payload, _ := json.Marshal(map[string]any{"title": r.Text.Title, "description": feedbackIssueBody(r, marker), "labels": strings.Join(r.Settings.Labels[r.Text.Kind], ",")})
	req, e := http.NewRequestWithContext(ctx, "POST", g.BaseURL+"/api/v4/projects/"+url.PathEscape(FeedbackProject)+"/issues", bytes.NewReader(payload))
	if e != nil {
		return 0, "", "failed"
	}
	req.Header.Set("PRIVATE-TOKEN", g.Token)
	req.Header.Set("Content-Type", "application/json")
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
	raw, e := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var issue gitLabIssueProjection
	if e != nil || json.Unmarshal(raw, &issue) != nil || issue.IID <= 0 || !strings.Contains(issue.Description, marker) {
		return 0, "", "unknown"
	}
	return issue.IID, g.BaseURL + "/" + FeedbackProject + "/-/issues/" + fmt.Sprint(issue.IID), "submitted"
}
func (g gitLabOperationRuntime) reconcileFeedbackIssue(ctx context.Context, marker string) (int64, string, error) {
	var found int64
	for page := 1; page <= 100; page++ {
		var issues []gitLabIssueProjection
		query := url.Values{"scope": {"all"}, "state": {"all"}, "per_page": {"100"}, "page": {fmt.Sprint(page)}, "search": {marker}, "in": {"description"}}
		e := g.requestJSON(ctx, "GET", "/api/v4/projects/"+url.PathEscape(FeedbackProject)+"/issues?"+query.Encode(), nil, &issues)
		if e != nil {
			return 0, "", e
		}
		for _, i := range issues {
			if i.IID > 0 && strings.Contains(i.Description, marker) {
				if found != 0 && found != i.IID {
					return 0, "", feedbackError(409, "multiple_issues")
				}
				found = i.IID
			}
		}
		if len(issues) < 100 {
			if found > 0 {
				return found, g.BaseURL + "/" + FeedbackProject + "/-/issues/" + fmt.Sprint(found), nil
			}
			return 0, "", nil
		}
	}
	return 0, "", feedbackError(503, "reconciliation_bound")
}

// Commit dispatch intent before HTTP. Expired dispatches only reconcile; the
// attempt fence rejects stale workers. No exactly-once external guarantee.
func (a *Adapter) DrainFeedback(ctx context.Context) (map[string]any, error) {
	if e := a.purgeFeedback(ctx); e != nil {
		return nil, e
	}
	return a.drainFeedback(ctx, func(ctx context.Context, code string) (gitLabOperationRuntime, error) {
		return a.resolveOwnedGitLabRuntime(ctx, code, "console.feedback-worker", "console", "", "")
	})
}
func (a *Adapter) drainFeedback(ctx context.Context, resolve func(context.Context, string) (gitLabOperationRuntime, error)) (map[string]any, error) {

	tx, e := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r, e := scanFeedback(tx.QueryRowContext(ctx, feedbackSelect+` WHERE tenant_code=? AND ((status IN ('pending','unknown') AND next_attempt_at<=UTC_TIMESTAMP(3)) OR (status='dispatching' AND lease_until<UTC_TIMESTAMP(3))) ORDER BY next_attempt_at,feedback_id LIMIT 1 FOR UPDATE SKIP LOCKED`, a.tenant))
	if errors.Is(e, sql.ErrNoRows) {
		return map[string]any{"data": map[string]any{"claimed": false}}, nil
	}
	if e != nil {
		return nil, e
	}
	reconcile := r.Status != "pending"
	if reconcile {
		if e = feedbackEvent(ctx, tx, a.tenant, r.ID, "unknown", r.Settings); e != nil {
			return nil, e
		}
	}
	var attempt int64
	if e = tx.QueryRowContext(ctx, `SELECT attempt FROM console_feedback WHERE tenant_code=? AND feedback_id=?`, a.tenant, r.ID).Scan(&attempt); e != nil {
		return nil, e
	}
	attempt++
	_, e = tx.ExecContext(ctx, `UPDATE console_feedback SET status='dispatching',attempt=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 120 SECOND),updated_at=UTC_TIMESTAMP(3) WHERE tenant_code=? AND feedback_id=?`, attempt, a.tenant, r.ID)
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	callCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	g, resolveErr := resolve(callCtx, r.Settings.IntegrationCode)
	status := "failed"
	var iid int64
	var issueURL string
	if reconcile {
		status = "unknown"
		if resolveErr == nil {
			if len(r.Text.AttachmentIDs) > 0 {
				_ = a.reconcileFeedbackImages(callCtx, g, r.ID)
			}
			iid, issueURL, e = g.reconcileFeedbackIssue(callCtx, feedbackMarker(a.tenant, r.ID))
			if e == nil && iid > 0 {
				status = "submitted"
			}
		}
	} else if resolveErr == nil {
		mediaStatus, mediaErr := a.deliverFeedbackImages(callCtx, g, &r, attempt)
		if mediaErr != nil {
			return nil, mediaErr
		}
		status = mediaStatus
		if mediaStatus == "ready" {
			iid, issueURL, status = g.createFeedbackIssue(callCtx, r, feedbackMarker(a.tenant, r.ID))
		}
	}
	saveCtx, done := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer done()
	tx, e = a.db.BeginTx(saveCtx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	res, e := tx.ExecContext(saveCtx, `UPDATE console_feedback SET status=?,issue_iid=?,issue_url=?,lease_until=NULL,next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE),updated_at=UTC_TIMESTAMP(3) WHERE tenant_code=? AND feedback_id=? AND status='dispatching' AND attempt=?`, status, iid, issueURL, a.tenant, r.ID, attempt)
	if e != nil {
		return nil, e
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return nil, feedbackError(409, "lease_changed")
	}
	if e = feedbackEvent(saveCtx, tx, a.tenant, r.ID, status, r.Settings); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"data": map[string]any{"claimed": true, "id": r.ID, "status": status}}, nil
}
