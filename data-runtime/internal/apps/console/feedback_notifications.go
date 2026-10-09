package console

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

type FeedbackNotificationCommand struct {
	EventID    string   `json:"eventId"`
	Recipients []string `json:"recipients"`
	UID        string   `json:"uid"`
	Attempt    int64    `json:"attempt"`
	InApp      bool     `json:"inApp"`
	Wecom      bool     `json:"wecom"`
	Skip       bool     `json:"skip"`
}

func (a *Adapter) FeedbackNotification(ctx context.Context, op string, c FeedbackNotificationCommand) (map[string]any, error) {
	if op == "events" {
		tx, e := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
		if e != nil {
			return nil, e
		}
		defer tx.Rollback()
		rows, e := tx.QueryContext(ctx, `SELECT event_id,feedback_id,event_type,recipient_policy_json FROM console_feedback_events WHERE tenant_code=? AND recipient_uids_json IS NULL AND resolve_after<=UTC_TIMESTAMP(3) ORDER BY resolve_after,created_at LIMIT 3 FOR UPDATE SKIP LOCKED`, a.tenant)
		if e != nil {
			return nil, e
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var id, fid, kind string
			var raw []byte
			var s FeedbackSettings
			if e = rows.Scan(&id, &fid, &kind, &raw); e != nil {
				return nil, e
			}
			if e = json.Unmarshal(raw, &s); e != nil {
				return nil, e
			}
			items = append(items, map[string]any{"eventId": id, "feedbackId": fid, "eventType": kind, "recipientUids": s.RecipientUIDs, "recipientRoleCodes": s.RecipientRoles})
		}
		if e = rows.Err(); e != nil {
			return nil, e
		}
		rows.Close()
		for _, item := range items {
			if _, e = tx.ExecContext(ctx, `UPDATE console_feedback_events SET resolve_after=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE) WHERE tenant_code=? AND event_id=?`, a.tenant, item["eventId"]); e != nil {
				return nil, e
			}
		}
		return map[string]any{"data": items}, tx.Commit()
	}
	tx, e := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	if op == "freeze" {
		if len(c.Recipients) == 0 || len(c.Recipients) > 100 {
			return nil, feedbackError(400, "recipients_invalid")
		}
		var frozen []byte
		if e = tx.QueryRowContext(ctx, `SELECT recipient_uids_json FROM console_feedback_events WHERE tenant_code=? AND event_id=? FOR UPDATE`, a.tenant, c.EventID).Scan(&frozen); e != nil {
			return nil, e
		}
		if len(frozen) > 0 {
			return map[string]any{"data": map[string]any{"frozen": true}}, nil
		}
		seen := map[string]bool{}
		for _, uid := range c.Recipients {
			if !feedbackCode.MatchString(uid) || seen[uid] {
				return nil, feedbackError(400, "recipients_invalid")
			}
			seen[uid] = true
			if _, e = a.feedbackActor(ctx, uid); e != nil {
				return nil, e
			}
			for _, channel := range []string{"in_app", "wecom"} {
				if _, e = tx.ExecContext(ctx, `INSERT INTO console_feedback_delivery(tenant_code,event_id,recipient_uid,channel,updated_at) VALUES(?,?,?,?,UTC_TIMESTAMP(3))`, a.tenant, c.EventID, uid, channel); e != nil {
					return nil, e
				}
			}
		}
		raw, _ := json.Marshal(c.Recipients)
		_, e = tx.ExecContext(ctx, `UPDATE console_feedback_events SET recipient_uids_json=? WHERE tenant_code=? AND event_id=?`, raw, a.tenant, c.EventID)
		if e != nil {
			return nil, e
		}
		e = tx.Commit()
		return map[string]any{"data": map[string]any{"frozen": true}}, e
	}
	if op == "claim" {
		var eventID, uid string
		var attempt int64
		e = tx.QueryRowContext(ctx, `SELECT event_id,recipient_uid,attempt FROM console_feedback_delivery WHERE tenant_code=? AND channel='wecom' AND status IN ('pending','sending') AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP(3)) ORDER BY updated_at,event_id LIMIT 1 FOR UPDATE SKIP LOCKED`, a.tenant).Scan(&eventID, &uid, &attempt)
		if errors.Is(e, sql.ErrNoRows) {
			return map[string]any{"data": nil}, nil
		}
		if e != nil {
			return nil, e
		}
		attempt++
		var fid, kind string
		if e = tx.QueryRowContext(ctx, `SELECT feedback_id,event_type FROM console_feedback_events WHERE tenant_code=? AND event_id=?`, a.tenant, eventID).Scan(&fid, &kind); e != nil {
			return nil, e
		}
		r, e := scanFeedback(tx.QueryRowContext(ctx, feedbackSelect+` WHERE tenant_code=? AND feedback_id=?`, a.tenant, fid))
		if e != nil {
			return nil, e
		}
		if _, e = tx.ExecContext(ctx, `UPDATE console_feedback_delivery SET attempt=?,status='sending',lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 120 SECOND),updated_at=UTC_TIMESTAMP(3) WHERE tenant_code=? AND event_id=? AND recipient_uid=? AND channel='wecom'`, attempt, a.tenant, eventID, uid); e != nil {
			return nil, e
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		// No description/diagnostics are projected to notification producers.
		issueURL := r.IssueURL
		if kind != "submitted" {
			issueURL = ""
		}
		return map[string]any{"data": map[string]any{"eventId": eventID, "uid": uid, "attempt": attempt, "feedbackId": fid, "eventType": kind, "kind": r.Text.Kind, "title": r.Text.Title, "reporterName": r.ReporterName, "pageUrl": r.Text.PageURL, "issueUrl": issueURL, "integrationCode": r.Settings.WecomIntegrationCode, "publicUrl": r.Settings.PublicURL}}, nil
	}
	if op == "ack" {
		var attempt int64
		var status string
		e = tx.QueryRowContext(ctx, `SELECT attempt,status FROM console_feedback_delivery WHERE tenant_code=? AND event_id=? AND recipient_uid=? AND channel='wecom' FOR UPDATE`, a.tenant, c.EventID, c.UID).Scan(&attempt, &status)
		if e != nil {
			return nil, e
		}
		if attempt != c.Attempt || status != "sending" {
			return nil, feedbackError(409, "lease_changed")
		}
		if c.Skip {
			status = "skipped"
		} else if c.Wecom {
			if !c.InApp {
				return nil, feedbackError(400, "delivery_order_invalid")
			}
			status = "sent"
		} else {
			status = "pending"
		}
		if _, e = tx.ExecContext(ctx, `UPDATE console_feedback_delivery SET status=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE),updated_at=UTC_TIMESTAMP(3) WHERE tenant_code=? AND event_id=? AND recipient_uid=? AND channel='wecom'`, status, a.tenant, c.EventID, c.UID); e != nil {
			return nil, e
		}
		if c.InApp || c.Skip {
			bell := "sent"
			if c.Skip {
				bell = "skipped"
			}
			if _, e = tx.ExecContext(ctx, `UPDATE console_feedback_delivery SET status=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_code=? AND event_id=? AND recipient_uid=? AND channel='in_app' AND status<>'sent'`, bell, a.tenant, c.EventID, c.UID); e != nil {
				return nil, e
			}
		}
		e = tx.Commit()
		return map[string]any{"data": map[string]any{"acknowledged": true}}, e
	}
	return nil, feedbackError(404, fmt.Sprint("notification_operation_invalid"))
}
