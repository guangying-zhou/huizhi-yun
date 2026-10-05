package workflow

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func persistWorkflowCallbacks(ctx context.Context, tx *sql.Tx, instanceID any, effects *WorkflowEffects) error {
	if effects == nil {
		return nil
	}
	external := make([]WorkflowCallback, 0, len(effects.Callbacks))
	for index := range effects.Callbacks {
		callback := &effects.Callbacks[index]
		if callback.URL == "" || callback.Payload == nil {
			return httperror.New(http.StatusInternalServerError, "invalid_callback_effect", "workflow callback effect is invalid")
		}
		event := cleanAnyString(callback.Payload["event"])
		status := cleanAnyString(callback.Payload["status"])
		idempotencyKey := "workflow:callback:" + cleanAnyString(instanceID) + ":" + event + ":" + status
		if callback.URL == aimsCompletionWorkflowCallback {
			callback.Payload["idempotencyKey"] = idempotencyKey
		}
		handled, err := applyCompletionLaneCallback(ctx, tx, *callback)
		if err != nil {
			return err
		}
		if handled {
			continue
		}
		payload, err := json.Marshal(callback.Payload)
		if err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `
			INSERT INTO flow_callback_logs (
			  instance_id, callback_url, event, status, attempts, last_error,
			  payload, idempotency_key, next_attempt_at, created_at, updated_at
			) VALUES (?, ?, ?, 'pending', 0, NULL, ?, ?, NULL, NOW(), NOW())
			ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
		`, instanceID, callback.URL, event, string(payload), idempotencyKey)
		if err != nil {
			return err
		}
		callback.EffectID, err = result.LastInsertId()
		if err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, "SELECT version_no FROM flow_callback_logs WHERE id=? FOR UPDATE", callback.EffectID).Scan(&callback.VersionNo); err != nil {
			return err
		}
		external = append(external, *callback)
	}
	effects.Callbacks = external
	return nil
}

func (a *Adapter) pendingWorkflowCallbacks(ctx context.Context, limit int) (InstanceAPIResponse, string, error) {
	if limit < 1 || limit > 200 {
		limit = 100
	}
	rows, err := queryMaps(ctx, a.db, `
		SELECT id, version_no, callback_url, payload
		FROM flow_callback_logs
		WHERE status IN ('pending', 'failed')
		  AND attempts < 20
		  AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
		ORDER BY id
		LIMIT ?
	`, limit)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	callbacks := make([]WorkflowCallback, 0, len(rows))
	for _, row := range rows {
		payload, err := parseJSONObject(cleanAnyString(row["payload"]))
		if err != nil {
			return InstanceAPIResponse{}, "", err
		}
		callbacks = append(callbacks, WorkflowCallback{
			EffectID:  anyInt64(row["id"]),
			VersionNo: anyInt64(row["version_no"]),
			URL:       cleanAnyString(row["callback_url"]),
			Payload:   payload,
		})
	}
	return InstanceAPIResponse{Code: 0, Data: callbacks}, "workflow.callback_effects.pending", nil
}

func (a *Adapter) acknowledgeWorkflowCallback(ctx context.Context, rawID string, body map[string]any) (InstanceAPIResponse, string, error) {
	return a.acknowledgeWorkflowDelivery(ctx, workflowCallbackDelivery, rawID, body)
}

func (a *Adapter) failWorkflowCallback(ctx context.Context, rawID string, body map[string]any) (InstanceAPIResponse, string, error) {
	return a.failWorkflowDelivery(ctx, workflowCallbackDelivery, rawID, body)
}
