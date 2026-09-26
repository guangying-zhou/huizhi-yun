package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

var personalDocumentProjectCode = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$`)

func (a *Adapter) TransferPersonalDocumentToProject(ctx context.Context, identity PersonalFolderCreationIdentity, uuid string, payload map[string]any) (map[string]any, error) {
	if identity.Tenant == "" || identity.Deployment == "" || identity.Actor == "" || identity.Client != "enterprise.runtime" || identity.Key == "" || len(identity.Key) > 200 {
		return nil, httperror.New(403, "project_transfer_identity_invalid", "Bound project transfer identity required")
	}
	for key := range payload {
		if key != "project_code" && key != "new_oss_path" && key != "source_oss_path" {
			return nil, httperror.New(400, "invalid_project_transfer", "Invalid project transfer")
		}
	}
	projectCode, _ := payload["project_code"].(string)
	targetPath, _ := payload["new_oss_path"].(string)
	sourcePath, _ := payload["source_oss_path"].(string)
	projectCode = strings.TrimSpace(projectCode)
	targetPath = strings.TrimSpace(targetPath)
	sourcePath = strings.TrimSpace(sourcePath)
	if !personalDocumentProjectCode.MatchString(projectCode) || sourcePath == "" || len(sourcePath) > 500 || targetPath == "" || len(targetPath) > 500 || !strings.HasPrefix(targetPath, "codocs/projects/"+projectCode+"/docs/") || strings.ContainsAny(sourcePath+targetPath, "\x00\r\n") {
		return nil, httperror.New(400, "invalid_project_transfer", "Invalid project transfer")
	}
	command := map[string]any{"uuid": uuid, "actor": identity.Actor, "project_code": projectCode, "new_oss_path": targetPath}
	raw, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	ns := sha256.Sum256([]byte(strings.Join([]string{"codocs.personal-documents.project-transfer.v1", identity.Tenant, identity.Deployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(ns[:])
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	input := io.OwnedReceiptCommandInput{TrustedContext: io.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.Deployment, SourceApp: "codocs", ServiceClientID: identity.Client, RequestID: identity.RequestID}, SourceDeploymentCode: identity.Deployment, TargetDeploymentCode: identity.Deployment, TargetApp: "codocs", OperationID: fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16]), OperationCode: "codocs.personal-documents.project-transfer.v1", RequiredCapability: "codocs:document-transfer:project", IdempotencyKey: key, CommandSchemaVersion: "codocs-project-transfer.v1", CommandSHA256: digest, Command: raw, OriginalActorUID: identity.Actor}
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
	var owner, title, kind, storedPath, storedProject string
	var readonly, status int
	if err = tx.QueryRowContext(ctx, `SELECT id, owner_uid, title, doc_type, COALESCE(oss_path,''), COALESCE(project_code,''), readonly_flag, status FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1 FOR UPDATE`, uuid).Scan(&docID, &owner, &title, &kind, &storedPath, &storedProject, &readonly, &status); errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(404, "document_not_found", "Document not found")
	} else if err != nil {
		return nil, err
	}
	if owner != identity.Actor {
		return nil, httperror.New(403, "project_transfer_owner_required", "Only document owner can transfer")
	}
	if status == 2 || readonly == 1 || (kind != "private" && !(kind == "project" && storedProject == projectCode && storedPath == targetPath)) {
		return nil, httperror.New(409, "project_transfer_document_invalid", "Only editable private documents can be transferred")
	}
	if kind == "private" && storedPath != sourcePath {
		return nil, httperror.New(409, "project_transfer_source_changed", "Document storage path changed")
	}
	var duplicate int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM documents WHERE uuid <> ? AND doc_type = 'project' AND project_code = ? AND title = ? AND status <> 0`, uuid, projectCode, title).Scan(&duplicate); err != nil {
		return nil, err
	}
	if duplicate > 0 {
		return nil, httperror.New(409, "project_document_title_conflict", "Project already has a document with the same title")
	}
	receipt, err := repo.ExecuteOwnedInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		if _, err := tx.ExecContext(ctx, `UPDATE documents SET doc_type='project', project_code=?, dept_code=NULL, folder_id=NULL, home_flag=0, oss_path=?, last_editor_uid=?, updated_at=NOW() WHERE id=?`, projectCode, targetPath, identity.Actor, docID); err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		// A project document is not on v2; its content is the copied target.
		if err := invalidateCollaboration(ctx, tx, uuid); err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		err := retireSnapshotHead(ctx, tx, uuid)
		return io.ReceiptBusinessResult{TargetBizType: "document", TargetBizCode: uuid, HTTPStatus: 200}, err
	})
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "project_transfer_key_conflict", "Idempotency key was used for another transfer")
	}
	if err != nil {
		return nil, err
	}
	if receipt.TargetBizCode != uuid {
		return nil, httperror.New(503, "project_transfer_receipt_invalid", "Invalid project transfer receipt")
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"documentUuid": uuid, "projectCode": projectCode, "sourceOssPath": sourcePath, "ossPath": targetPath}, nil
}
