package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// Delete only hides the owner's personal file. Keep the original OSS object and
// converted document; neither is owned by this metadata-only transaction.
func (a *Adapter) DeletePersonalCabinetFile(ctx context.Context, identity PersonalFolderCreationIdentity, uuid string) (map[string]any, error) {
	if identity.Tenant == "" || identity.Deployment == "" || identity.Actor == "" || identity.Client != "enterprise.runtime" || identity.Key == "" || len(identity.Key) > 200 {
		return nil, httperror.New(403, "cabinet_delete_identity_invalid", "Bound cabinet delete identity required")
	}
	command := map[string]any{"uuid": uuid, "actor": identity.Actor}
	raw, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	ns := sha256.Sum256([]byte(strings.Join([]string{"codocs.personal-cabinet.delete.v1", identity.Tenant, identity.Deployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(ns[:])
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	input := io.OwnedReceiptCommandInput{
		TrustedContext:       io.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.Deployment, SourceApp: "codocs", ServiceClientID: identity.Client, RequestID: identity.RequestID},
		SourceDeploymentCode: identity.Deployment, TargetDeploymentCode: identity.Deployment, TargetApp: "codocs",
		OperationID:   fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16]),
		OperationCode: "codocs.personal-cabinet.delete.v1", RequiredCapability: "codocs:personal-cabinet:delete", IdempotencyKey: key,
		CommandSchemaVersion: "codocs-cabinet-delete.v1", CommandSHA256: digest, Command: raw, OriginalActorUID: identity.Actor,
	}
	repo, err := io.NewReceiptRepository(a.db)
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var status int
	// Include deleted rows to replay receipts, but recheck current ownership even
	// for a replay. Department/project records can never enter this command.
	err = tx.QueryRowContext(ctx, `SELECT status FROM cabinet_files WHERE uuid = ? AND owner_uid = ? AND dept_code IS NULL AND project_code IS NULL LIMIT 1 FOR UPDATE`, uuid, identity.Actor).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(404, "record_not_found", "Cabinet file not found")
	}
	if err != nil {
		return nil, err
	}
	receipt, err := repo.ExecuteOwnedInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		if status != 0 {
			if _, err := tx.ExecContext(ctx, "UPDATE cabinet_files SET status = 0, deleted_at = NOW() WHERE uuid = ?", uuid); err != nil {
				return io.ReceiptBusinessResult{}, err
			}
		}
		return io.ReceiptBusinessResult{TargetBizType: "cabinet-file", TargetBizCode: uuid, HTTPStatus: 200}, nil
	})
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "cabinet_delete_key_conflict", "Idempotency key was used for another file")
	}
	if err != nil {
		return nil, err
	}
	if receipt.TargetBizCode != uuid {
		return nil, httperror.New(503, "cabinet_delete_receipt_invalid", "Invalid cabinet delete receipt")
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"uuid": uuid, "deleted": true}, nil
}
