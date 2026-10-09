package console

import (
	"context"
	"database/sql"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"strings"
)

// This publication-bound projection never accepts provider subjects from callers.
// The opt-in transport field does not change the canonical notification hash.
func resolveNotificationExternalIdentities(ctx context.Context, tx *sql.Tx, request canonicalNotification, id, channel string, out map[string]any) error {
	if channel == "" {
		return nil
	}
	targets := []map[string]string{}
	skipped := []map[string]string{}
	for _, uid := range request.Recipients {
		var userStatus string
		var identityStatus, subject sql.NullString
		err := tx.QueryRowContext(ctx, `SELECT u.status,i.status,i.provider_subject FROM directory_users u LEFT JOIN directory_identities i ON BINARY i.uid=BINARY u.uid AND i.provider_code=? WHERE BINARY u.uid=BINARY ? LIMIT 1`, channel, uid).Scan(&userStatus, &identityStatus, &subject)
		if errors.Is(err, sql.ErrNoRows) {
			return httperror.New(400, "notification_recipient_not_found", "Notification recipient is not registered")
		}
		if err != nil {
			return err
		}
		reason := ""
		if userStatus != "active" {
			reason = "recipient_inactive"
		} else if identityStatus.String != "active" || strings.TrimSpace(subject.String) == "" {
			reason = "external_identity_missing"
		}
		if reason == "" {
			targets = append(targets, map[string]string{"uid": uid, "subject": subject.String})
			continue
		}
		skipped = append(skipped, map[string]string{"uid": uid, "reason": reason})
		// The notification row remains locked, so retries cannot duplicate this fact.
		_, err = tx.ExecContext(ctx, `INSERT INTO portal_notification_deliveries(notification_id,uid,channel,provider,status,attempt_count,last_error,sent_at,created_at,updated_at) SELECT ?,?,?,?,'skipped',0,?,NULL,UTC_TIMESTAMP(),UTC_TIMESTAMP() WHERE NOT EXISTS (SELECT 1 FROM portal_notification_deliveries WHERE notification_id=? AND BINARY uid=BINARY ? AND channel=? AND status='skipped' AND last_error=?)`, id, uid, channel, channel, reason, id, uid, channel, reason)
		if err != nil {
			return err
		}
	}
	out["data"].(map[string]any)["externalIdentityResolution"] = map[string]any{"channel": channel, "recipients": targets, "skipped": skipped}
	return nil
}
