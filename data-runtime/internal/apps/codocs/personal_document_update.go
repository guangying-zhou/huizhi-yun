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

const personalDocumentUpdateOperation = "codocs.personal-documents.update.v1"
const personalDocumentUpdateCapability = "codocs:personal-documents:edit"
const personalDocumentUpdateSchema = "codocs-document-update.v1"

type personalDocumentUpdateFacts struct {
	Command     map[string]any
	Digest      string
	OperationID string
	ReceiptKey  string
	Title       string
	HasContent  bool
}

func personalDocumentUpdateFactsFor(identity PersonalFolderCreationIdentity, uuid string, payload map[string]any, allowStorageVersion bool) (personalDocumentUpdateFacts, error) {
	for key := range payload {
		if key != "title" && key != "content_size" && key != "content_sha256" && key != "oss_version_id" && key != "save_mode" {
			return personalDocumentUpdateFacts{}, httperror.New(400, "invalid_document_update", "Invalid document update")
		}
		if !allowStorageVersion && key == "oss_version_id" {
			return personalDocumentUpdateFacts{}, httperror.New(400, "invalid_document_update_plan", "Storage version is not accepted by update plan")
		}
	}
	title, titleOK := payload["title"].(string)
	title = strings.TrimSpace(title)
	if !titleOK || title == "" || len([]rune(title)) > 255 {
		return personalDocumentUpdateFacts{}, httperror.New(400, "invalid_document_title", "Invalid document title")
	}
	_, hasContent := payload["content_sha256"]
	var contentHash, saveMode string
	var contentSize int64
	if hasContent {
		if allowStorageVersion {
			version, ok := payload["oss_version_id"].(string)
			if !ok || strings.TrimSpace(version) == "" || len(version) > 255 {
				return personalDocumentUpdateFacts{}, httperror.New(400, "invalid_document_content_update", "Invalid document content update")
			}
		}
		contentHash, _ = payload["content_sha256"].(string)
		size, ok := payload["content_size"].(float64)
		saveMode, _ = payload["save_mode"].(string)
		if !personalDocumentContentHash.MatchString(contentHash) || !ok || size < 0 || size > 10*1024*1024 || size != float64(int64(size)) || (saveMode != "overwrite" && saveMode != "recovery" && saveMode != "import") {
			return personalDocumentUpdateFacts{}, httperror.New(400, "invalid_document_content_update", "Invalid document content update")
		}
		contentSize = int64(size)
	} else if len(payload) != 1 {
		return personalDocumentUpdateFacts{}, httperror.New(400, "invalid_document_update", "Metadata update only accepts title")
	}
	command := map[string]any{"uuid": uuid, "actor": identity.Actor, "title": title, "content_size": contentSize, "content_sha256": contentHash, "save_mode": saveMode}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return personalDocumentUpdateFacts{}, err
	}
	ns := sha256.Sum256([]byte(strings.Join([]string{personalDocumentUpdateOperation, identity.Tenant, identity.Deployment, identity.Actor, identity.Key}, "\x00")))
	receiptKey := hex.EncodeToString(ns[:])
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	operationID := fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16])
	return personalDocumentUpdateFacts{Command: command, Digest: digest, OperationID: operationID, ReceiptKey: receiptKey, Title: title, HasContent: hasContent}, nil
}

type personalDocumentUpdateReceipt struct {
	OperationID, Capability, Schema, Digest, Status, TargetType, TargetCode, ResponseSummary string
	HTTPStatus                                                                               int
}

func readPersonalDocumentUpdateReceipt(ctx context.Context, db *sql.DB, identity PersonalFolderCreationIdentity, facts personalDocumentUpdateFacts) (*personalDocumentUpdateReceipt, error) {
	row := db.QueryRowContext(ctx, `SELECT operation_id, required_capability, command_schema_version, command_sha256, status, target_biz_type, target_biz_code, response_http_status, response_summary_sha256 FROM service_command_receipt WHERE tenant_code = ? AND source_deployment_code = ? AND deployment_code = ? AND source_app = 'codocs' AND target_app = 'codocs' AND operation_code = ? AND idempotency_key = ? LIMIT 1`, identity.Tenant, identity.Deployment, identity.Deployment, personalDocumentUpdateOperation, facts.ReceiptKey)
	var result personalDocumentUpdateReceipt
	var operationID, capability, schema, digest, status, targetType, targetCode, responseSummary sql.NullString
	var httpStatus sql.NullInt64
	if err := row.Scan(&operationID, &capability, &schema, &digest, &status, &targetType, &targetCode, &httpStatus, &responseSummary); errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	result.OperationID, result.Capability, result.Schema, result.Digest, result.Status = operationID.String, capability.String, schema.String, digest.String, status.String
	result.TargetType, result.TargetCode, result.ResponseSummary = targetType.String, targetCode.String, responseSummary.String
	result.HTTPStatus = int(httpStatus.Int64)
	return &result, nil
}

func validatePersonalDocumentUpdateReceipt(receipt *personalDocumentUpdateReceipt, facts personalDocumentUpdateFacts, uuid string) error {
	if receipt.OperationID != facts.OperationID || receipt.Capability != personalDocumentUpdateCapability || receipt.Schema != personalDocumentUpdateSchema || receipt.Digest != facts.Digest {
		return httperror.New(409, "document_update_key_conflict", "Idempotency key was used for another update")
	}
	if receipt.Status != "succeeded" {
		return httperror.New(503, "document_update_receipt_unavailable", "Document update receipt is not complete")
	}
	expectedSummary, err := io.ValidateAndDigestCommand(map[string]any{"targetBizType": "document", "targetBizCode": uuid})
	if err != nil || receipt.TargetType != "document" || receipt.TargetCode != uuid || receipt.HTTPStatus != 200 || receipt.ResponseSummary != expectedSummary {
		return httperror.New(503, "document_update_receipt_invalid", "Invalid document update receipt")
	}
	return nil
}

// CommitPersonalDocumentUpdate records the already-written immutable OSS
// version and document metadata in one receipt-backed transaction. The OSS
// version id is deliberately excluded from the command digest: if storage
// succeeded but the DB transaction failed, a retry may produce a newer OSS
// version for the same title/content hash without changing the user command.
func (a *Adapter) CommitPersonalDocumentUpdate(ctx context.Context, identity PersonalFolderCreationIdentity, uuid string, payload map[string]any) (map[string]any, error) {
	if identity.Tenant == "" || identity.Deployment == "" || identity.Actor == "" || identity.Client != "enterprise.runtime" || identity.Key == "" || len(identity.Key) > 200 {
		return nil, httperror.New(403, "document_update_identity_invalid", "Bound document update identity required")
	}
	facts, err := personalDocumentUpdateFactsFor(identity, uuid, payload, true)
	if err != nil {
		return nil, err
	}
	title, hasContent := facts.Title, facts.HasContent
	contentHash, _ := payload["content_sha256"].(string)
	ossVersion, _ := payload["oss_version_id"].(string)
	sizeFloat, _ := payload["content_size"].(float64)
	contentSize := int64(sizeFloat)
	raw, err := json.Marshal(facts.Command)
	if err != nil {
		return nil, err
	}
	receiptInput := io.OwnedReceiptCommandInput{
		TrustedContext:       io.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.Deployment, SourceApp: "codocs", ServiceClientID: identity.Client, RequestID: identity.RequestID},
		SourceDeploymentCode: identity.Deployment, TargetDeploymentCode: identity.Deployment, TargetApp: "codocs",
		OperationID: facts.OperationID, OperationCode: personalDocumentUpdateOperation,
		RequiredCapability: personalDocumentUpdateCapability, IdempotencyKey: facts.ReceiptKey, CommandSchemaVersion: personalDocumentUpdateSchema, CommandSHA256: facts.Digest, Command: raw, OriginalActorUID: identity.Actor,
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
	var docID int64
	var owner, oldTitle string
	var readonly, status int
	if err = tx.QueryRowContext(ctx, `SELECT id, owner_uid, title, readonly_flag, status FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1 FOR UPDATE`, uuid).Scan(&docID, &owner, &oldTitle, &readonly, &status); errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(404, "document_not_found", "Document not found")
	} else if err != nil {
		return nil, err
	}
	if status == 2 || readonly == 1 {
		return nil, httperror.New(403, "document_readonly", "Document is readonly")
	}
	if identity.Actor != owner {
		var permission string
		if err = tx.QueryRowContext(ctx, `SELECT permission FROM document_shares WHERE document_id = ? AND shared_to_uid = ? LIMIT 1`, docID, identity.Actor).Scan(&permission); err != nil || permission != "write" {
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return nil, err
			}
			return nil, httperror.New(403, "permission_denied", "Permission denied")
		}
	}
	if title != oldTitle {
		var duplicate int
		if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM documents WHERE uuid <> ? AND owner_uid = ? AND doc_type = (SELECT doc_type FROM documents WHERE id = ?) AND COALESCE(folder_id,0) = COALESCE((SELECT folder_id FROM documents WHERE id = ?),0) AND title = ? AND status <> 0`, uuid, owner, docID, docID, title).Scan(&duplicate); err != nil {
			return nil, err
		}
		if duplicate > 0 {
			return nil, httperror.New(409, "document_title_conflict", "Document title already exists")
		}
	}
	receipt, err := repo.ExecuteOwnedInTransaction(ctx, tx, receiptInput, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		if hasContent {
			// New commands only (replays return their stored receipt), under the
			// document row lock that v2 publish also takes.
			if err := refuseSnapshotV2Document(ctx, tx, uuid); err != nil {
				return io.ReceiptBusinessResult{}, err
			}
			var max sql.NullInt64
			if err := tx.QueryRowContext(ctx, `SELECT MAX(version_num) FROM document_versions WHERE document_id = ?`, docID).Scan(&max); err != nil {
				return io.ReceiptBusinessResult{}, err
			}
			next := int64(1)
			if max.Valid {
				next = max.Int64 + 1
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO document_versions (document_id, version_num, oss_version_id, editor_uid, content_size, content_sha256) VALUES (?, ?, ?, ?, ?, ?)`, docID, next, ossVersion, identity.Actor, contentSize, contentHash); err != nil {
				return io.ReceiptBusinessResult{}, err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE documents SET title = ?, content_size = ?, last_editor_uid = ?, updated_at = NOW() WHERE id = ?`, title, contentSize, identity.Actor, docID); err != nil {
				return io.ReceiptBusinessResult{}, err
			}
		} else if _, err := tx.ExecContext(ctx, `UPDATE documents SET title = ?, last_editor_uid = ?, updated_at = NOW() WHERE id = ?`, title, identity.Actor, docID); err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		return io.ReceiptBusinessResult{TargetBizType: "document", TargetBizCode: uuid, HTTPStatus: 200}, nil
	})
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "document_update_key_conflict", "Idempotency key was used for another update")
	}
	if err != nil {
		return nil, err
	}
	if receipt.TargetBizCode != uuid {
		return nil, httperror.New(503, "document_update_receipt_invalid", "Invalid document update receipt")
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"uuid": uuid, "updated": true, "contentUpdated": hasContent}, nil
}

// PlanPersonalDocumentUpdate is deliberately read-only. It lets the Host
// avoid another OSS write when a completed request is retried after losing its
// response. It is not a reservation and cannot close the storage/DB race.
func (a *Adapter) PlanPersonalDocumentUpdate(ctx context.Context, identity PersonalFolderCreationIdentity, uuid string, payload map[string]any) (map[string]any, error) {
	if identity.Tenant == "" || identity.Deployment == "" || identity.Actor == "" || identity.Client != "enterprise.runtime" || identity.Key == "" || len(identity.Key) > 200 {
		return nil, httperror.New(403, "document_update_identity_invalid", "Bound document update identity required")
	}
	facts, err := personalDocumentUpdateFactsFor(identity, uuid, payload, false)
	if err != nil {
		return nil, err
	}
	var docID int64
	var owner, oldTitle, docType, ossPath string
	var readonly, status int
	if err = a.db.QueryRowContext(ctx, `SELECT id, owner_uid, title, doc_type, oss_path, readonly_flag, status FROM documents WHERE uuid = ? LIMIT 1`, uuid).Scan(&docID, &owner, &oldTitle, &docType, &ossPath, &readonly, &status); errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(404, "document_not_found", "Document not found")
	} else if err != nil {
		return nil, err
	}
	if status == 0 {
		return nil, httperror.New(404, "document_not_found", "Document not found")
	}
	if status == 2 || readonly == 1 {
		return nil, httperror.New(403, "document_readonly", "Document is readonly")
	}
	if identity.Actor != owner {
		var permission string
		if err = a.db.QueryRowContext(ctx, `SELECT permission FROM document_shares WHERE document_id = ? AND shared_to_uid = ? LIMIT 1`, docID, identity.Actor).Scan(&permission); err != nil || permission != "write" {
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return nil, err
			}
			return nil, httperror.New(403, "permission_denied", "Permission denied")
		}
	}
	receipt, err := readPersonalDocumentUpdateReceipt(ctx, a.db, identity, facts)
	if err != nil {
		return nil, err
	}
	if receipt != nil {
		if err := validatePersonalDocumentUpdateReceipt(receipt, facts, uuid); err != nil {
			return nil, err
		}
		return map[string]any{"uuid": uuid, "replayed": true, "oss_path": ossPath, "doc_type": docType}, nil
	}
	if facts.HasContent {
		if err = refuseSnapshotV2Document(ctx, a.db, uuid); err != nil {
			return nil, err
		}
	}
	if facts.Title != oldTitle {
		var duplicate int
		if err = a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM documents WHERE uuid <> ? AND owner_uid = ? AND doc_type = ? AND COALESCE(folder_id,0) = (SELECT COALESCE(folder_id,0) FROM documents WHERE id = ?) AND title = ? AND status <> 0`, uuid, owner, docType, docID, facts.Title).Scan(&duplicate); err != nil {
			return nil, err
		}
		if duplicate > 0 {
			return nil, httperror.New(409, "document_title_conflict", "Document title already exists")
		}
	}
	return map[string]any{"uuid": uuid, "replayed": false, "oss_path": ossPath, "doc_type": docType}, nil
}
