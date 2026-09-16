package workflow

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func persistWorkflowCallbacks(ctx context.Context, tx *sql.Tx, instanceID any, effects *WorkflowEffects) error {
	if effects == nil {
		return nil
	}
	for index := range effects.Callbacks {
		callback := &effects.Callbacks[index]
		if callback.URL == "" || callback.Payload == nil {
			return httperror.New(http.StatusInternalServerError, "invalid_callback_effect", "workflow callback effect is invalid")
		}
		payload, err := json.Marshal(callback.Payload)
		if err != nil {
			return err
		}
		event := cleanAnyString(callback.Payload["event"])
		status := cleanAnyString(callback.Payload["status"])
		idempotencyKey := "workflow:callback:" + cleanAnyString(instanceID) + ":" + event + ":" + status
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
	}
	return nil
}

func (a *Adapter) pendingWorkflowCallbacks(ctx context.Context, limit int) (InstanceAPIResponse, string, error) {
	if limit < 1 || limit > 200 {
		limit = 100
	}
	rows, err := queryMaps(ctx, a.db, `
		SELECT id, callback_url, payload
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
			EffectID: anyInt64(row["id"]),
			URL:      cleanAnyString(row["callback_url"]),
			Payload:  payload,
		})
	}
	return InstanceAPIResponse{Code: 0, Data: callbacks}, "workflow.callback_effects.pending", nil
}

func (a *Adapter) acknowledgeWorkflowCallback(ctx context.Context, rawID string) (InstanceAPIResponse, string, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(rawID), 10, 64)
	if err != nil || id <= 0 {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "invalid_callback_effect_id", "invalid callback effect id")
	}
	result, err := a.db.ExecContext(ctx, `
		UPDATE flow_callback_logs
		SET status = 'success', attempts = attempts + 1, last_error = NULL,
		    next_attempt_at = NULL, updated_at = NOW()
		WHERE id = ? AND status IN ('pending', 'failed')
	`, id)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	affected, _ := result.RowsAffected()
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": id, "acknowledged": affected > 0}}, "workflow.callback_effects.ack", nil
}

func (a *Adapter) failWorkflowCallback(ctx context.Context, rawID string, body map[string]any) (InstanceAPIResponse, string, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(rawID), 10, 64)
	if err != nil || id <= 0 {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "invalid_callback_effect_id", "invalid callback effect id")
	}
	message := cleanAnyString(body["error"])
	if len(message) > 2000 {
		message = message[:2000]
	}
	result, err := a.db.ExecContext(ctx, `
		UPDATE flow_callback_logs
		SET status = 'failed', attempts = attempts + 1, last_error = ?,
		    next_attempt_at = DATE_ADD(NOW(), INTERVAL 60 SECOND), updated_at = NOW()
		WHERE id = ? AND status IN ('pending', 'failed')
	`, nilIfEmpty(message), id)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	affected, _ := result.RowsAffected()
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": id, "failed": affected > 0}}, "workflow.callback_effects.fail", nil
}
