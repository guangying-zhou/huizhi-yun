package productcenter

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

// CommandIdentity must be constructed by the Aims adapter from the verified
// actor and actual parent product, never copied from browser authorization data.
type CommandIdentity struct {
	ProductCode    string
	Action         string
	ActorUID       string
	IdempotencyKey string
}

type CommandResult struct {
	ReceiptID int64           `json:"receipt_id"`
	Replayed  bool            `json:"replayed"`
	Value     json.RawMessage `json:"value"`
}

type AuthorizeCommand func(context.Context, *sql.Tx) error
type ApplyCommand func(context.Context, *sql.Tx) (any, error)

// ExecuteCommand uses a local Aims receipt, not a fabricated cross-app service
// identity. Authorization runs in the transaction before reading any receipt,
// including a replay. The caller's authorization callback also locks the actual
// product root, so membership, queue and domain mutations share lock ordering.
func ExecuteCommand(ctx context.Context, db *sql.DB, identity CommandIdentity, payload any, authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
	return executeCommandWithIsolation(ctx, db, identity, payload, authorize, apply, sql.LevelReadCommitted)
}

// A commitment validates and fingerprints predecessor facts in several reads.
// Keep those reads on one committed snapshot; the source root remains locked.
func executeSnapshotCommand(ctx context.Context, db *sql.DB, identity CommandIdentity, payload any, authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
	return executeCommandWithIsolation(ctx, db, identity, payload, authorize, apply, sql.LevelRepeatableRead)
}

func executeCommandWithIsolation(ctx context.Context, db *sql.DB, identity CommandIdentity, payload any, authorize AuthorizeCommand, apply ApplyCommand, isolation sql.IsolationLevel) (CommandResult, error) {
	var result CommandResult
	if db == nil || authorize == nil || apply == nil {
		return result, invalid("product_command_configuration", "产品命令缺少事务或授权处理器")
	}
	for _, field := range []struct {
		value string
		max   int
	}{
		{identity.ProductCode, 64}, {identity.Action, 64}, {identity.ActorUID, 64}, {identity.IdempotencyKey, 191},
	} {
		if field.value == "" || strings.TrimSpace(field.value) != field.value || !utf8.ValidString(field.value) || utf8.RuneCountInString(field.value) > field.max {
			return result, invalid("product_command_identity_invalid", "产品命令标识不完整或格式无效")
		}
		for _, r := range field.value {
			if r < 32 || r == 127 {
				return result, invalid("product_command_identity_invalid", "命令标识不能包含控制字符")
			}
		}
	}
	canonical, err := json.Marshal(payload)
	if err != nil {
		return result, invalid("product_command_payload_invalid", "产品命令内容无效")
	}
	if len(canonical) > 256*1024 {
		return result, invalid("product_command_payload_too_large", "单次产品命令内容过大")
	}
	digest := sha256.Sum256(canonical)
	hash := hex.EncodeToString(digest[:])
	executionID := uuid.NewString()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: isolation})
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	if err := authorize(ctx, tx); err != nil {
		return result, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO product_command_receipts
		(product_code,action,actor_uid,idempotency_key,execution_id,request_hash,status,created_at)
		VALUES (?,?,?,?,?,?,'processing',UTC_TIMESTAMP(3))
		ON DUPLICATE KEY UPDATE id=product_command_receipts.id`, identity.ProductCode, identity.Action, identity.ActorUID, identity.IdempotencyKey, executionID, hash)
	if err != nil {
		return result, err
	}
	var storedHash, status, storedExecutionID string
	var storedResult []byte
	err = tx.QueryRowContext(ctx, `SELECT id,request_hash,status,result_json,execution_id FROM product_command_receipts
		WHERE product_code=? AND action=? AND actor_uid=? AND idempotency_key=? FOR UPDATE`,
		identity.ProductCode, identity.Action, identity.ActorUID, identity.IdempotencyKey).Scan(&result.ReceiptID, &storedHash, &status, &storedResult, &storedExecutionID)
	if err != nil {
		return result, err
	}
	if storedHash != hash {
		return CommandResult{}, invalid("idempotency_payload_mismatch", "同一幂等键已用于不同的请求内容")
	}
	if status == "succeeded" {
		if !json.Valid(storedResult) {
			return CommandResult{}, fmt.Errorf("product receipt %d has invalid result", result.ReceiptID)
		}
		result.Replayed, result.Value = true, json.RawMessage(storedResult)
		return result, tx.Commit()
	}
	if status != "processing" {
		return CommandResult{}, fmt.Errorf("product receipt %d has unexpected status", result.ReceiptID)
	}
	if storedExecutionID != executionID {
		return CommandResult{}, invalid("product_command_incomplete_receipt", "存在未完成的历史回执，请先核验该命令")
	}
	value, err := apply(ctx, tx)
	if err != nil {
		return CommandResult{}, err
	}
	result.Value, err = json.Marshal(value)
	if err != nil || len(result.Value) > 256*1024 {
		return CommandResult{}, invalid("product_command_result_invalid", "产品命令结果无法保存")
	}
	_, err = tx.ExecContext(ctx, `UPDATE product_command_receipts SET status='succeeded',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=? AND status='processing'`, []byte(result.Value), result.ReceiptID)
	if err != nil {
		return CommandResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CommandResult{}, err
	}
	return result, nil
}
