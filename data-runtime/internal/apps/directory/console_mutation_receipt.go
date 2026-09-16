package directory

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var consoleMutationKeyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,190}$`)

type ConsoleMutationMeta struct {
	IdempotencyKey string
	RequestID      string
	ActorID        string
	ActorType      string
}

type consoleMutationSession struct {
	tx        *sql.Tx
	receiptID string
	requestID string
	actorType string
	actorID   string
	operation string
}

func (a *Adapter) beginConsoleMutation(
	ctx context.Context,
	operation string,
	meta ConsoleMutationMeta,
	payload any,
) (*consoleMutationSession, map[string]any, error) {
	key := strings.TrimSpace(meta.IdempotencyKey)
	if !consoleMutationKeyPattern.MatchString(key) {
		return nil, nil, httperror.New(http.StatusBadRequest, "invalid_idempotency_key", "Idempotency-Key must be 1-191 safe ASCII characters")
	}
	actorID := strings.TrimSpace(meta.ActorID)
	if actorID == "" || len(actorID) > 128 {
		return nil, nil, httperror.New(http.StatusForbidden, "trusted_console_actor_required", "A trusted Console actor is required")
	}
	actorType := strings.TrimSpace(meta.ActorType)
	if actorType == "" {
		actorType = "human"
	}
	if actorType != "human" && actorType != "service" && actorType != "system" {
		return nil, nil, httperror.New(http.StatusForbidden, "trusted_console_actor_type_invalid", "Trusted Console actor type is invalid")
	}
	requestID := strings.TrimSpace(meta.RequestID)
	if len(requestID) > 64 {
		requestID = requestID[:64]
	}
	canonical, err := json.Marshal(payload)
	if err != nil {
		return nil, nil, err
	}
	digest := sha256.Sum256(canonical)
	requestHash := hex.EncodeToString(digest[:])
	receiptID, err := randomConsoleMutationUUID()
	if err != nil {
		return nil, nil, err
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, nil, err
	}
	session := &consoleMutationSession{
		tx: tx, receiptID: receiptID, requestID: requestID,
		actorType: actorType, actorID: actorID, operation: operation,
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO console_mutation_receipts
		(receipt_id,tenant_code,operation_code,idempotency_key,request_sha256,status,
		 actor_type,actor_id,request_id,created_at,updated_at)
		VALUES (?,?,?,?,?,'processing',?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
		ON DUPLICATE KEY UPDATE receipt_id=console_mutation_receipts.receipt_id`,
		receiptID, a.tenant, operation, key, requestHash, actorType, actorID, nullableConsoleText(requestID)); err != nil {
		_ = tx.Rollback()
		return nil, nil, err
	}
	var storedID, storedHash, status string
	var resultJSON sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT receipt_id,request_sha256,status,result_json
		FROM console_mutation_receipts
		WHERE tenant_code=? AND operation_code=? AND idempotency_key=? FOR UPDATE`,
		a.tenant, operation, key).Scan(&storedID, &storedHash, &status, &resultJSON); err != nil {
		_ = tx.Rollback()
		return nil, nil, err
	}
	if storedHash != requestHash {
		_ = tx.Rollback()
		return nil, nil, httperror.New(http.StatusConflict, "idempotency_payload_mismatch", "Idempotency-Key was already used with a different mutation")
	}
	if status == "succeeded" {
		var replay map[string]any
		if !resultJSON.Valid || json.Unmarshal([]byte(resultJSON.String), &replay) != nil {
			_ = tx.Rollback()
			return nil, nil, httperror.New(http.StatusConflict, "idempotency_receipt_invalid", "Stored mutation receipt cannot be replayed")
		}
		if err := tx.Commit(); err != nil {
			return nil, nil, err
		}
		replay["replayed"] = true
		return nil, replay, nil
	}
	if storedID != receiptID {
		_ = tx.Rollback()
		return nil, nil, httperror.New(http.StatusConflict, "mutation_in_progress", "A mutation with this Idempotency-Key is still processing")
	}
	return session, nil, nil
}

func finishConsoleMutation(
	ctx context.Context,
	session *consoleMutationSession,
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
	if _, err := session.tx.ExecContext(ctx, `INSERT INTO operation_logs
		(domain_code,action,target_type,target_key,actor_type,actor_id,request_id,detail_json,created_at)
		VALUES ('directory',?,?,?,?,?,?,?,UTC_TIMESTAMP())`,
		action, targetType, nullableConsoleText(targetKey), session.actorType, session.actorID,
		nullableConsoleText(session.requestID), detailJSON); err != nil {
		return err
	}
	response["receiptId"] = session.receiptID
	response["replayed"] = false
	responseJSON, err := json.Marshal(response)
	if err != nil {
		return err
	}
	if _, err := session.tx.ExecContext(ctx, `UPDATE console_mutation_receipts
		SET status='succeeded',result_json=?,response_http_status=200,
			completed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)
		WHERE receipt_id=? AND status='processing'`, responseJSON, session.receiptID); err != nil {
		return err
	}
	return session.tx.Commit()
}

func rollbackConsoleMutation(session *consoleMutationSession) {
	if session != nil {
		_ = session.tx.Rollback()
	}
}

func nullableConsoleText(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func randomConsoleMutationUUID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		value[0:4], value[4:6], value[6:8], value[8:10], value[10:16]), nil
}
