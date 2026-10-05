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

// Recycle retains the existing object key. The original editor and ACL still
// use documents.status, and no cross-system move can strand the initial body.
// A receipt makes an old DELETE retry harmless even after a later restore.
func (a *Adapter) RecyclePersonalDocument(ctx context.Context, identity PersonalFolderCreationIdentity, documentUUID string) (map[string]any, error) {
	if identity.Tenant == "" || identity.Deployment == "" || identity.Actor == "" || identity.Client != "enterprise.runtime" || identity.Key == "" || len(identity.Key) > 200 {
		return nil, httperror.New(403, "document_recycle_identity_invalid", "Bound document recycle identity required")
	}
	command := map[string]any{"uuid": documentUUID, "actor": identity.Actor}
	raw, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	namespace := sha256.Sum256([]byte(strings.Join([]string{"codocs.personal-documents.recycle.v1", identity.Tenant, identity.Deployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(namespace[:])
	namespace[6] = (namespace[6] & 0x0f) | 0x40
	namespace[8] = (namespace[8] & 0x3f) | 0x80
	operationID := fmt.Sprintf("%x-%x-%x-%x-%x", namespace[:4], namespace[4:6], namespace[6:8], namespace[8:10], namespace[10:16])
	input := io.OwnedReceiptCommandInput{
		TrustedContext:       io.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.Deployment, SourceApp: "codocs", ServiceClientID: identity.Client, RequestID: identity.RequestID},
		SourceDeploymentCode: identity.Deployment, TargetDeploymentCode: identity.Deployment, TargetApp: "codocs", OperationID: operationID,
		OperationCode: "codocs.personal-documents.recycle.v1", RequiredCapability: "codocs:personal-documents:delete", IdempotencyKey: key,
		CommandSchemaVersion: "codocs-personal-recycle.v1", CommandSHA256: digest, Command: raw, OriginalActorUID: identity.Actor,
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
	doc, err := requireDocumentWriteFrom(ctx, tx, documentUUID, map[string]any{"actorUid": identity.Actor}, true, false, true)
	if err != nil {
		return nil, err
	}
	switch stringValue(doc["doc_type"]) {
	case "private", "slide", "worklog", "weekly-report":
	default:
		return nil, httperror.New(403, "document_recycle_scope_denied", "Document is outside the personal recycle scope")
	}
	receipt, err := repo.ExecuteOwnedInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		if int64Value(doc["status"]) != 0 {
			if _, err := tx.ExecContext(ctx, "UPDATE documents SET status = 0, deleted_at = NOW(), updated_at = NOW() WHERE uuid = ?", documentUUID); err != nil {
				return io.ReceiptBusinessResult{}, err
			}
		}
		return io.ReceiptBusinessResult{TargetBizType: "document", TargetBizCode: documentUUID, HTTPStatus: 200}, nil
	})
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "document_recycle_key_conflict", "Idempotency key was used for another document")
	}
	if err != nil {
		return nil, err
	}
	if receipt.TargetBizCode != documentUUID {
		return nil, httperror.New(503, "document_recycle_receipt_invalid", "Invalid recycle receipt")
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"uuid": documentUUID, "deleted": true}, nil
}
