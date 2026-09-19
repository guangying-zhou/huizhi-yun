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

// The browser can choose a new title, never an owner, folder or object key.
func ValidatePersonalDocumentRestore(payload map[string]any, commit bool) error {
	for key, value := range payload {
		switch key {
		case "new_title":
			title, ok := value.(string)
			if !ok || strings.TrimSpace(title) == "" || len([]rune(title)) > 255 {
				return httperror.New(400, "invalid_document_restore", "Invalid restore title")
			}
		case "state_sha256":
			hash, ok := value.(string)
			if !commit || !ok || !personalDocumentContentHash.MatchString(hash) {
				return httperror.New(400, "invalid_document_restore", "Invalid restore state")
			}
		default:
			return httperror.New(400, "invalid_document_restore", "Invalid restore field")
		}
	}
	if commit && payload["state_sha256"] == nil {
		return httperror.New(400, "invalid_document_restore", "Restore state required")
	}
	return nil
}

func personalRestorePlan(doc map[string]any, newTitle string) (map[string]any, error) {
	switch stringValue(doc["doc_type"]) {
	case "private", "slide", "worklog", "weekly-report":
	default:
		return nil, httperror.New(403, "document_restore_scope_denied", "Document is outside the personal restore scope")
	}
	path := stringValue(doc["oss_path"])
	if (!strings.HasPrefix(path, "codocs/") && !strings.HasPrefix(path, "recycle.bin/")) || strings.Contains(path, "\\") || strings.ContainsAny(path, "\x00\r\n") {
		return nil, httperror.New(409, "document_restore_path_invalid", "Document storage path cannot be restored")
	}
	for _, segment := range strings.Split(path, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return nil, httperror.New(409, "document_restore_path_invalid", "Document storage path cannot be restored")
		}
	}
	title := firstNonEmpty(strings.TrimSpace(newTitle), stringValue(doc["title"]))
	// Only the digest leaves this snapshot; titles may legitimately contain
	// URLs, and must not be persisted as integration-command content.
	stateBytes, err := json.Marshal(map[string]any{
		"uuid": doc["uuid"], "owner": doc["owner_uid"], "kind": doc["doc_type"], "folder": doc["folder_id"],
		"title": doc["title"], "path": path, "status": doc["status"], "deleted_at": stringValue(doc["deleted_at"]), "updated_at": stringValue(doc["updated_at"]),
	})
	if err != nil {
		return nil, err
	}
	stateHash := sha256.Sum256(stateBytes)
	state := hex.EncodeToString(stateHash[:])
	target := path
	if strings.HasPrefix(path, "recycle.bin/") {
		// Never overwrite the old title-based key: another document may now own it.
		target = "codocs/document-restores/" + stringValue(doc["uuid"]) + "/" + state + ".md"
	}
	return map[string]any{"uuid": doc["uuid"], "title": title, "doc_type": doc["doc_type"], "source_path": path, "target_path": target, "state_sha256": state, "deleted": int64Value(doc["status"]) == 0}, nil
}

// Read-only preflight. ACL and all mutable facts are checked again on commit.
func (a *Adapter) PlanPersonalDocumentRestore(ctx context.Context, uuid, actor string, payload map[string]any) (map[string]any, error) {
	if err := ValidatePersonalDocumentRestore(payload, false); err != nil {
		return nil, err
	}
	doc, err := a.requireDocumentWrite(ctx, uuid, map[string]any{"actorUid": actor}, true)
	if err != nil {
		return nil, err
	}
	return personalRestorePlan(doc, stringValue(payload["new_title"]))
}

func (a *Adapter) RestorePersonalDocument(ctx context.Context, identity PersonalFolderCreationIdentity, uuid string, payload map[string]any) (map[string]any, error) {
	if identity.Tenant == "" || identity.Deployment == "" || identity.Actor == "" || identity.Client != "enterprise.runtime" || identity.Key == "" || len(identity.Key) > 200 {
		return nil, httperror.New(403, "document_restore_identity_invalid", "Bound document restore identity required")
	}
	if err := ValidatePersonalDocumentRestore(payload, true); err != nil {
		return nil, err
	}
	// Bind retry identity to user intent, not a transient preflight state. A
	// successful old request must not restore a document deleted again later.
	titleHash := sha256.Sum256([]byte(strings.TrimSpace(stringValue(payload["new_title"]))))
	command := map[string]any{"uuid": uuid, "actor": identity.Actor, "new_title_sha256": hex.EncodeToString(titleHash[:])}
	raw, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	namespace := sha256.Sum256([]byte(strings.Join([]string{"codocs.personal-documents.restore.v1", identity.Tenant, identity.Deployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(namespace[:])
	namespace[6] = (namespace[6] & 0x0f) | 0x40
	namespace[8] = (namespace[8] & 0x3f) | 0x80
	operationID := fmt.Sprintf("%x-%x-%x-%x-%x", namespace[:4], namespace[4:6], namespace[6:8], namespace[8:10], namespace[10:16])
	input := io.OwnedReceiptCommandInput{
		TrustedContext:       io.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.Deployment, SourceApp: "codocs", ServiceClientID: identity.Client, RequestID: identity.RequestID},
		SourceDeploymentCode: identity.Deployment, TargetDeploymentCode: identity.Deployment, TargetApp: "codocs", OperationID: operationID,
		OperationCode: "codocs.personal-documents.restore.v1", RequiredCapability: "codocs:personal-documents:edit", IdempotencyKey: key,
		CommandSchemaVersion: "codocs-personal-restore.v1", CommandSHA256: digest, Command: raw, OriginalActorUID: identity.Actor,
	}
	repo, err := io.NewReceiptRepository(a.db)
	if err != nil {
		return nil, err
	}
	// Serializable also protects the title-availability predicate from a
	// concurrent creation or restore in the same personal folder namespace.
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	doc, err := requireDocumentWriteFrom(ctx, tx, uuid, map[string]any{"actorUid": identity.Actor}, true, false, true)
	if err != nil {
		return nil, err
	}
	plan, err := personalRestorePlan(doc, stringValue(payload["new_title"]))
	if err != nil {
		return nil, err
	}
	receipt, err := repo.ExecuteOwnedInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		if int64Value(doc["status"]) != 0 {
			return io.ReceiptBusinessResult{}, httperror.New(409, "document_not_deleted", "Document is not deleted")
		}
		if plan["state_sha256"] != payload["state_sha256"] {
			return io.ReceiptBusinessResult{}, httperror.New(409, "document_restore_state_changed", "Document changed since restore preflight")
		}
		if folder := int64Value(doc["folder_id"]); folder > 0 {
			row, err := readFolderScope(ctx, tx, folder, true)
			if err != nil {
				return io.ReceiptBusinessResult{}, err
			}
			if row.Kind != stringValue(doc["doc_type"]) || row.Owner.String != stringValue(doc["owner_uid"]) || row.Department.String != "" || row.Project.String != "" {
				return io.ReceiptBusinessResult{}, httperror.New(403, "document_restore_folder_denied", "Original folder scope changed")
			}
		}
		if err := ensureDocumentTitleAvailableFrom(ctx, tx, uuid, doc, stringValue(plan["title"]), doc["folder_id"]); err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE documents SET status = 1, deleted_at = NULL, title = ?, oss_path = ?, updated_at = NOW() WHERE uuid = ?", plan["title"], plan["target_path"], uuid); err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		return io.ReceiptBusinessResult{TargetBizType: "document", TargetBizCode: uuid, HTTPStatus: 200}, nil
	})
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "document_restore_key_conflict", "Idempotency key was used for another restore")
	}
	if err != nil {
		return nil, err
	}
	if receipt.TargetBizCode != uuid {
		return nil, httperror.New(503, "document_restore_receipt_invalid", "Invalid restore receipt")
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"uuid": uuid, "restored": true, "replayed": receipt.Existing}, nil
}
