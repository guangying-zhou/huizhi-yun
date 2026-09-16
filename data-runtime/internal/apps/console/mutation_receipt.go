package console

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type mutationSession struct {
	tx        *sql.Tx
	receiptID string
	requestID string
	actorType string
	actorID   string
	operation string
}

func (a *Adapter) beginMutation(
	ctx context.Context,
	operation string,
	idempotencyKey string,
	requestID string,
	actorID string,
	payload any,
) (*mutationSession, map[string]any, error) {
	return a.beginMutationAs(ctx, operation, idempotencyKey, requestID, "human", actorID, payload)
}

func (a *Adapter) beginMutationAs(
	ctx context.Context,
	operation string,
	idempotencyKey string,
	requestID string,
	actorType string,
	actorID string,
	payload any,
) (*mutationSession, map[string]any, error) {
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if !mutationIdempotencyKeyPattern.MatchString(idempotencyKey) {
		return nil, nil, httperror.New(http.StatusBadRequest, "invalid_idempotency_key", "Idempotency-Key must be 1-191 safe ASCII characters")
	}
	actorID = strings.TrimSpace(actorID)
	if actorID == "" || len(actorID) > 128 {
		return nil, nil, httperror.New(http.StatusForbidden, "trusted_console_actor_required", "A trusted Console actor is required")
	}
	actorType = strings.TrimSpace(actorType)
	if actorType != "human" && actorType != "service" && actorType != "system" {
		return nil, nil, httperror.New(http.StatusForbidden, "trusted_console_actor_type_invalid", "Trusted Console actor type is invalid")
	}
	requestID = strings.TrimSpace(requestID)
	if len(requestID) > 64 {
		requestID = requestID[:64]
	}
	canonical, err := json.Marshal(payload)
	if err != nil {
		return nil, nil, err
	}
	digest := sha256.Sum256(canonical)
	requestHash := hex.EncodeToString(digest[:])
	receiptID, err := newMutationReceiptID()
	if err != nil {
		return nil, nil, err
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, nil, err
	}
	session := &mutationSession{
		tx:        tx,
		receiptID: receiptID,
		requestID: requestID,
		actorType: actorType,
		actorID:   actorID,
		operation: operation,
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO console_mutation_receipts (
			receipt_id,tenant_code,operation_code,idempotency_key,request_sha256,
			status,actor_type,actor_id,request_id,created_at,updated_at
		) VALUES (?, ?, ?, ?, ?, 'processing', ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
		ON DUPLICATE KEY UPDATE receipt_id=console_mutation_receipts.receipt_id
	`, receiptID, a.tenant, operation, idempotencyKey, requestHash, actorType, actorID, nullableText(requestID)); err != nil {
		_ = tx.Rollback()
		return nil, nil, err
	}
	var receipt mutationReceipt
	if err := tx.QueryRowContext(ctx, `
		SELECT receipt_id,request_sha256,status,result_json
		FROM console_mutation_receipts
		WHERE tenant_code=? AND operation_code=? AND idempotency_key=?
		FOR UPDATE
	`, a.tenant, operation, idempotencyKey).Scan(
		&receipt.ReceiptID,
		&receipt.RequestHash,
		&receipt.Status,
		&receipt.ResultJSON,
	); err != nil {
		_ = tx.Rollback()
		return nil, nil, err
	}
	if receipt.RequestHash != requestHash {
		_ = tx.Rollback()
		return nil, nil, httperror.New(http.StatusConflict, "idempotency_payload_mismatch", "Idempotency-Key was already used with a different mutation")
	}
	if receipt.Status == "succeeded" {
		var replay map[string]any
		if !receipt.ResultJSON.Valid || json.Unmarshal([]byte(receipt.ResultJSON.String), &replay) != nil {
			_ = tx.Rollback()
			return nil, nil, httperror.New(http.StatusConflict, "idempotency_receipt_invalid", "Stored mutation receipt cannot be replayed")
		}
		if err := tx.Commit(); err != nil {
			return nil, nil, err
		}
		replay["replayed"] = true
		return nil, replay, nil
	}
	if receipt.ReceiptID != receiptID {
		_ = tx.Rollback()
		return nil, nil, httperror.New(http.StatusConflict, "mutation_in_progress", "A mutation with this Idempotency-Key is still processing")
	}
	return session, nil, nil
}

func (a *Adapter) finishMutation(
	ctx context.Context,
	session *mutationSession,
	domainCode string,
	action string,
	targetType string,
	targetKey string,
	detail map[string]any,
	response map[string]any,
) error {
	detail["receiptId"] = session.receiptID
	detailJSON, err := json.Marshal(detail)
	if err != nil {
		return err
	}
	if _, err := session.tx.ExecContext(ctx, `
		INSERT INTO operation_logs (
			domain_code,action,target_type,target_key,actor_type,actor_id,request_id,detail_json,created_at
		) VALUES (?,?,?,?, ?,?,?,?,UTC_TIMESTAMP())
	`, domainCode, action, targetType, nullableText(targetKey), session.actorType, session.actorID, nullableText(session.requestID), detailJSON); err != nil {
		return err
	}
	response["replayed"] = false
	responseJSON, err := json.Marshal(response)
	if err != nil {
		return err
	}
	if _, err := session.tx.ExecContext(ctx, `
		UPDATE console_mutation_receipts
		SET status='succeeded',result_json=?,response_http_status=200,
			completed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)
		WHERE receipt_id=? AND status='processing'
	`, responseJSON, session.receiptID); err != nil {
		return err
	}
	return session.tx.Commit()
}

func finishMutationReceipt(ctx context.Context, session *mutationSession, response map[string]any) error {
	response["replayed"] = false
	responseJSON, err := json.Marshal(response)
	if err != nil {
		return err
	}
	if _, err := session.tx.ExecContext(ctx, `
		UPDATE console_mutation_receipts
		SET status='succeeded',result_json=?,response_http_status=200,
			completed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)
		WHERE receipt_id=? AND status='processing'
	`, responseJSON, session.receiptID); err != nil {
		return err
	}
	return session.tx.Commit()
}
