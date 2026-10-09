package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type EnterpriseDepartmentDocumentRelationCheck func(context.Context, *sql.Tx, string, string) (canWrite, canManage bool, err error)

// EditEnterpriseDepartmentDocumentMetadata lets a current department writer
// edit only a document they own or can write through an explicit share, while
// a current manager may manage any document in the same department.
func (a *Adapter) EditEnterpriseDepartmentDocumentMetadata(ctx context.Context, identity EnterpriseDepartmentFolderIdentity, uuid string, payload map[string]any, relation EnterpriseDepartmentDocumentRelationCheck) (map[string]any, error) {
	if identity.Tenant == "" || identity.SourceDeployment == "" || identity.TargetDeployment == "" || identity.Actor == "" || identity.Client != "enterprise.runtime" || identity.Department == "" || identity.Key == "" || len(identity.Key) > 190 || relation == nil {
		return nil, httperror.New(403, "department_document_identity_invalid", "Bound department document identity required")
	}
	if !uuidPattern.MatchString(uuid) || len(payload) == 0 || len(payload) > 2 {
		return nil, httperror.New(400, "department_document_input_invalid", "Invalid metadata request")
	}
	command := map[string]any{"actor": identity.Actor, "department": identity.Department, "uuid": uuid}
	for field, value := range payload {
		switch field {
		case "title":
			title, ok := value.(string)
			title = strings.TrimSpace(title)
			if !ok || title == "" || len([]rune(title)) > 255 {
				return nil, httperror.New(400, "department_document_input_invalid", "Invalid document title")
			}
			command["title"] = title
		case "folder_id":
			if value == nil {
				command["folder_id"] = int64(0)
				break
			}
			n, ok := value.(float64)
			if !ok || n < 1 || n > 9007199254740991 || n != float64(int64(n)) {
				return nil, httperror.New(400, "department_document_input_invalid", "Invalid document folder")
			}
			command["folder_id"] = int64(n)
		default:
			return nil, httperror.New(400, "department_document_input_invalid", "Invalid metadata field")
		}
	}
	raw, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	namespace := sha256.Sum256([]byte(strings.Join([]string{"codocs.department-documents.edit-metadata.v1", identity.Tenant, identity.SourceDeployment, identity.TargetDeployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(namespace[:])
	namespace[6] = (namespace[6] & 0x0f) | 0x40
	namespace[8] = (namespace[8] & 0x3f) | 0x80
	opID := fmt.Sprintf("%x-%x-%x-%x-%x", namespace[:4], namespace[4:6], namespace[6:8], namespace[8:10], namespace[10:16])
	input := io.ReceiptCommandInput{
		TrustedContext:       io.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.SourceDeployment, SourceApp: "enterprise", ServiceClientID: identity.Client, RequestID: identity.RequestID},
		SourceDeploymentCode: identity.SourceDeployment, TargetDeploymentCode: identity.TargetDeployment, TargetApp: "codocs", OperationID: opID,
		OperationCode: "codocs.department-documents.edit-metadata.v1", RequiredCapability: "codocs:enterprise-host:execute", IdempotencyKey: key,
		CommandSchemaVersion: "codocs-dept-doc-meta.v1", CommandSHA256: digest, Command: raw, OriginalActorUID: identity.Actor,
	}
	repo, err := io.NewReceiptRepository(a.db)
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	canWrite, canManage, err := relation(ctx, tx, identity.Actor, identity.Department)
	if err != nil {
		return nil, err
	}
	if !canWrite && !canManage {
		return nil, httperror.New(403, "department_writer_required", "Department writer required")
	}
	doc, err := readDocumentByUUID(ctx, tx, uuid, false, true)
	if err != nil {
		return nil, err
	}
	if stringValue(doc["doc_type"]) != "department" || stringValue(doc["dept_code"]) != identity.Department || stringValue(doc["project_code"]) != "" {
		return nil, httperror.New(403, "department_document_scope_denied", "Document is outside department scope")
	}
	if int64Value(doc["status"]) == 2 || int64Value(doc["readonly_flag"]) == 1 {
		return nil, httperror.New(403, "document_readonly", "Document is read-only")
	}
	if !canManage && stringValue(doc["owner_uid"]) != identity.Actor {
		permission, readErr := readDocumentSharePermission(ctx, tx, int64Value(doc["id"]), identity.Actor, true)
		if readErr != nil {
			return nil, readErr
		}
		if permission != "write" {
			return nil, httperror.New(403, "department_document_write_denied", "Document write access required")
		}
	}
	title := stringValue(doc["title"])
	if value, ok := command["title"]; ok {
		title = value.(string)
	}
	folderID := int64Value(doc["folder_id"])
	if value, ok := command["folder_id"]; ok {
		folderID = value.(int64)
	}
	if folderID != int64Value(doc["folder_id"]) && !canManage && stringValue(doc["owner_uid"]) != identity.Actor {
		return nil, httperror.New(403, "department_document_move_denied", "Only the owner or department manager can move this document")
	}
	if folderID > 0 {
		folder, readErr := readFolderScope(ctx, tx, folderID, true)
		if readErr != nil {
			return nil, readErr
		}
		if folder.Kind != "department" || folder.Department.String != identity.Department || folder.Project.String != "" {
			return nil, httperror.New(403, "department_document_folder_scope_denied", "Folder is outside department scope")
		}
	}
	receipt, err := repo.ExecuteInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		if err := ensureDocumentTitleAvailableFrom(ctx, tx, uuid, doc, title, nullableInt64(folderID)); err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		_, err := tx.ExecContext(ctx, `UPDATE documents SET title=?,folder_id=?,updated_at=NOW() WHERE uuid=? AND doc_type='department' AND dept_code=? AND status<>0`, title, nullableInt64(folderID), uuid, identity.Department)
		return io.ReceiptBusinessResult{TargetBizType: "document", TargetBizCode: uuid, HTTPStatus: http.StatusOK}, err
	})
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "department_document_key_conflict", "Idempotency key was used for different document metadata")
	}
	if err != nil {
		return nil, err
	}
	if receipt.TargetBizCode != uuid {
		return nil, httperror.New(503, "department_document_receipt_invalid", "Document receipt is invalid")
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"uuid": uuid, "title": title, "folder_id": nullableInt64(folderID), "dept_code": identity.Department}, nil
}
