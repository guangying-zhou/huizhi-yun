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
	"regexp"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

var enterpriseDepartmentCopySourceUUID = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// A department document may be created by a current member or manager. The
// The server-held Directory lease is checked before receipt access, including
// replay; folder scope is checked in this Codocs transaction. The browser
// cannot choose owner, UUID, or object key.
func (a *Adapter) CreateEnterpriseDepartmentDocument(ctx context.Context, identity EnterpriseDepartmentFolderIdentity, payload map[string]any, check EnterpriseDepartmentManagerCheck) (map[string]any, error) {
	if identity.Tenant == "" || identity.SourceDeployment == "" || identity.TargetDeployment == "" || identity.Actor == "" || identity.Client != "enterprise.runtime" || identity.Department == "" || identity.Key == "" || len(identity.Key) > 190 || check == nil {
		return nil, httperror.New(403, "department_document_identity_invalid", "Bound department document identity required")
	}
	for field := range payload {
		switch field {
		case "title", "folder_id", "content_sha256", "content_size", "doc_type", "dept_code", "source_uuid":
		default:
			return nil, httperror.New(400, "department_document_input_invalid", "Invalid department document input")
		}
	}
	title, ok := payload["title"].(string)
	title = strings.TrimSpace(title)
	if !ok || title == "" || len([]rune(title)) > 255 || payload["doc_type"] != "department" || payload["dept_code"] != identity.Department {
		return nil, httperror.New(400, "department_document_input_invalid", "Invalid department document input")
	}
	var sourceUUID string
	if raw, present := payload["source_uuid"]; present {
		sourceUUID, ok = raw.(string)
		if !ok || !enterpriseDepartmentCopySourceUUID.MatchString(sourceUUID) {
			return nil, httperror.New(400, "department_document_input_invalid", "Invalid source document")
		}
	}
	hash, ok := payload["content_sha256"].(string)
	if !ok || !personalDocumentContentHash.MatchString(hash) {
		return nil, httperror.New(400, "department_document_input_invalid", "Invalid content hash")
	}
	size, ok := payload["content_size"].(float64)
	if !ok || size < 0 || size > 10*1024*1024 || size != float64(int64(size)) {
		return nil, httperror.New(400, "department_document_input_invalid", "Invalid content size")
	}
	var folderID int64
	if value := payload["folder_id"]; value != nil {
		n, valid := value.(float64)
		if !valid || n < 1 || n > 9007199254740991 || n != float64(int64(n)) {
			return nil, httperror.New(400, "department_document_input_invalid", "Invalid folder identifier")
		}
		folderID = int64(n)
	}
	command := map[string]any{"actor": identity.Actor, "department": identity.Department, "title": title, "folder_id": folderID, "content_sha256": hash, "content_size": int64(size)}
	if sourceUUID != "" {
		command["source_uuid"] = sourceUUID
	}
	raw, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	namespace := sha256.Sum256([]byte(strings.Join([]string{"codocs.department-documents.create.v1", identity.Tenant, identity.SourceDeployment, identity.TargetDeployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(namespace[:])
	namespace[6] = (namespace[6] & 0x0f) | 0x40
	namespace[8] = (namespace[8] & 0x3f) | 0x80
	uuid := fmt.Sprintf("%x-%x-%x-%x-%x", namespace[:4], namespace[4:6], namespace[6:8], namespace[8:10], namespace[10:16])
	path := "codocs/document-creations/" + uuid + "/" + digest + ".md"
	input := io.ReceiptCommandInput{
		TrustedContext:       io.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.SourceDeployment, SourceApp: "enterprise", ServiceClientID: identity.Client, RequestID: identity.RequestID},
		SourceDeploymentCode: identity.SourceDeployment, TargetDeploymentCode: identity.TargetDeployment, TargetApp: "codocs", OperationID: uuid,
		OperationCode: "codocs.department-documents.create.v1", RequiredCapability: "codocs:enterprise-host:execute", IdempotencyKey: key,
		CommandSchemaVersion: "codocs-dept-document-create.v1", CommandSHA256: digest, Command: raw, OriginalActorUID: identity.Actor,
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
	if err = check(ctx, tx, identity.Actor, identity.Department); err != nil {
		return nil, err
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
		if err := ensureDocumentTitleAvailableFrom(ctx, tx, uuid, map[string]any{"owner_uid": identity.Actor, "doc_type": "department"}, title, nullableInt64(folderID)); err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		inserted, err := tx.ExecContext(ctx, `INSERT INTO documents
			(uuid,title,doc_type,oss_path,owner_uid,dept_code,project_code,folder_id,content_size,status)
			VALUES (?,?,'department',?,?,?,NULL,?,?,1)`, uuid, title, path, identity.Actor, identity.Department, nullableInt64(folderID), int64(size))
		if err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		id, err := inserted.LastInsertId()
		if err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		if err = upsertDocumentRelationTx(ctx, tx, documentRelationInput{
			DocumentID: id, DocumentUUID: uuid, RelatedUID: identity.Actor, RelationType: "created_by_me", SourceType: "document", SourceID: strconv.FormatInt(id, 10), CanRead: true, CanEdit: true,
			Metadata: map[string]any{"docType": "department", "deptCode": identity.Department, "folderId": nullableInt64(folderID)},
		}); err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		return io.ReceiptBusinessResult{TargetBizType: "document", TargetBizCode: uuid, HTTPStatus: http.StatusOK}, nil
	})
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "department_document_key_conflict", "Idempotency key was used for different document content")
	}
	if err != nil {
		return nil, err
	}
	if receipt.TargetBizCode != uuid {
		return nil, httperror.New(503, "department_document_receipt_invalid", "Document receipt is invalid")
	}
	var id int64
	err = tx.QueryRowContext(ctx, `SELECT id FROM documents WHERE uuid=? AND doc_type='department' AND BINARY owner_uid=BINARY ? AND dept_code=? AND oss_path=? AND status<>0 FOR UPDATE`, uuid, identity.Actor, identity.Department, path).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(409, "department_document_replay_scope_denied", "Document no longer matches receipt scope")
	}
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "uuid": uuid, "title": title, "doc_type": "department", "dept_code": identity.Department, "oss_path": path}, nil
}
