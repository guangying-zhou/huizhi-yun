package workflow

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

// WorkflowNotificationEffect is a durable "new pending to-do" notification.
// Instance start, node advance, delegation and resubmission create Console
// projections only through these notifications; without an outbox a single
// failed synchronous publish would leave the to-do missing forever and every
// later lifecycle CAS would 404.
type WorkflowNotificationEffect struct {
	EffectID     int64                `json:"effectId"`
	Notification WorkflowNotification `json:"notification"`
}

// persistWorkflowNotificationEffects writes one row per projection-creating
// notification in the same transaction as the Workflow fact. The idempotency
// key is the notification's own publish key, so a replayed write is a no-op.
func persistWorkflowNotificationEffects(ctx context.Context, tx *sql.Tx, instanceID any, actionID int64, effects *WorkflowEffects) error {
	for _, notification := range actionablePrerequisiteNotifications(effects.Notifications) {
		actionableKey := cleanAnyString(notification.Metadata["actionableKey"])
		if actionableKey == "" || notification.IdempotencyKey == "" || len(notification.IdempotencyKey) > 191 || len(actionableKey) > 191 {
			return fmt.Errorf("invalid workflow notification effect for instance %v", instanceID)
		}
		payload, err := json.Marshal(notification)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO flow_notification_outbox (
				instance_id, action_id, actionable_key, idempotency_key, notification,
				delivery_status, attempt_count, created_at, updated_at
			) VALUES (?, NULLIF(?, 0), ?, ?, ?, 'pending', 0, NOW(), NOW())
			ON DUPLICATE KEY UPDATE id = id
		`, instanceID, actionID, actionableKey, notification.IdempotencyKey, string(payload)); err != nil {
			return err
		}
	}
	return nil
}

func (a *Adapter) pendingWorkflowNotificationOutbox(ctx context.Context, limit int) (InstanceAPIResponse, string, error) {
	if limit < 1 || limit > 200 {
		limit = 100
	}
	rows, err := queryMaps(ctx, a.db, `
		SELECT id, notification
		FROM flow_notification_outbox
		WHERE delivery_status = 'pending'
		  AND (attempt_count = 0 OR last_attempt_at IS NULL OR
		       TIMESTAMPDIFF(SECOND, last_attempt_at, NOW()) >= CASE
		         WHEN attempt_count = 1 THEN 60
		         WHEN attempt_count = 2 THEN 300
		         WHEN attempt_count = 3 THEN 900
		         ELSE 3600
		       END)
		ORDER BY id
		LIMIT ?
	`, limit)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	effects := make([]WorkflowNotificationEffect, 0, len(rows))
	for _, row := range rows {
		var notification WorkflowNotification
		if err := json.Unmarshal([]byte(cleanAnyString(row["notification"])), &notification); err != nil {
			return InstanceAPIResponse{}, "", err
		}
		effects = append(effects, WorkflowNotificationEffect{EffectID: anyInt64(row["id"]), Notification: notification})
	}
	return InstanceAPIResponse{Code: 0, Data: effects}, "workflow.notification_effect.pending", nil
}

func (a *Adapter) acknowledgeWorkflowNotificationOutbox(ctx context.Context, effectID string) (InstanceAPIResponse, string, error) {
	result, err := a.db.ExecContext(ctx, `
		UPDATE flow_notification_outbox
		SET delivery_status = 'delivered', delivered_at = COALESCE(delivered_at, NOW()), updated_at = NOW()
		WHERE id = ? AND delivery_status = 'pending'
	`, effectID)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if affected == 0 {
		exists, err := existsByQuery(ctx, a.db, "SELECT id FROM flow_notification_outbox WHERE id = ? AND delivery_status = 'delivered'", effectID)
		if err != nil {
			return InstanceAPIResponse{}, "", err
		}
		if !exists {
			return InstanceAPIResponse{}, "", fmt.Errorf("workflow notification outbox effect %s not found", effectID)
		}
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"effect_id": parseInt64Fallback(effectID), "status": "delivered"}}, "workflow.notification_effect.ack", nil
}

func (a *Adapter) failWorkflowNotificationOutbox(ctx context.Context, effectID string) (InstanceAPIResponse, string, error) {
	result, err := a.db.ExecContext(ctx, `
		UPDATE flow_notification_outbox
		SET attempt_count = attempt_count + 1, last_attempt_at = NOW(), updated_at = NOW()
		WHERE id = ? AND delivery_status = 'pending'
	`, effectID)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"effect_id": parseInt64Fallback(effectID), "pending": affected > 0}}, "workflow.notification_effect.fail", nil
}
