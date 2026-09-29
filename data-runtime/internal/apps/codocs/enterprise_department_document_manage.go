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

// ManageEnterpriseDepartmentDocument handles manager-only flags and recycle.
// The server holds the current Directory manager lock while this serializable
// Codocs transaction checks document scope, mutation and receipt. Replays
// acquire a fresh Directory lock before entering this method.
func (a *Adapter) ManageEnterpriseDepartmentDocument(ctx context.Context, identity EnterpriseDepartmentFolderIdentity, action, uuid string, payload map[string]any, check EnterpriseDepartmentManagerCheck) (map[string]any, error) {
	if identity.Tenant == "" || identity.SourceDeployment == "" || identity.TargetDeployment == "" || identity.Actor == "" || identity.Client != "enterprise.runtime" || identity.Department == "" || identity.Key == "" || len(identity.Key) > 190 || check == nil {
		return nil, httperror.New(403, "department_document_identity_invalid", "Bound department document identity required")
	}
	if !uuidPattern.MatchString(uuid) {
		return nil, httperror.New(400, "department_document_uuid_invalid", "Invalid document identifier")
	}
	command := map[string]any{"actor": identity.Actor, "department": identity.Department, "uuid": uuid, "action": action}
	switch action {
	case "readonly":
		value, ok := payload["readonly_flag"].(bool)
		if !ok || len(payload) != 1 {
			return nil, httperror.New(400, "department_document_input_invalid", "Invalid read-only flag")
		}
		command["readonly_flag"] = value
	case "recycle":
		if len(payload) != 0 {
			return nil, httperror.New(400, "department_document_input_invalid", "Recycle body must be empty")
		}
	default:
		return nil, httperror.New(404, "department_document_action_unknown", "Unknown document action")
	}
	raw, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	namespace := sha256.Sum256([]byte(strings.Join([]string{"codocs.department-documents." + action + ".v1", identity.Tenant, identity.SourceDeployment, identity.TargetDeployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(namespace[:])
	namespace[6] = (namespace[6] & 0x0f) | 0x40
	namespace[8] = (namespace[8] & 0x3f) | 0x80
	opID := fmt.Sprintf("%x-%x-%x-%x-%x", namespace[:4], namespace[4:6], namespace[6:8], namespace[8:10], namespace[10:16])
	schemaVersion := map[string]string{"readonly": "codocs-dept-doc-readonly.v1", "recycle": "codocs-dept-doc-recycle.v1"}[action]
	input := io.ReceiptCommandInput{
		TrustedContext:       io.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.SourceDeployment, SourceApp: "enterprise", ServiceClientID: identity.Client, RequestID: identity.RequestID},
		SourceDeploymentCode: identity.SourceDeployment, TargetDeploymentCode: identity.TargetDeployment, TargetApp: "codocs", OperationID: opID,
		OperationCode: "codocs.department-documents." + action + ".v1", RequiredCapability: "codocs:enterprise-host:execute", IdempotencyKey: key,
		CommandSchemaVersion: schemaVersion, CommandSHA256: digest, Command: raw, OriginalActorUID: identity.Actor,
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
	doc, err := readDocumentByUUID(ctx, tx, uuid, true, true)
	if err != nil {
		return nil, err
	}
	if stringValue(doc["doc_type"]) != "department" || stringValue(doc["dept_code"]) != identity.Department || stringValue(doc["project_code"]) != "" {
		return nil, httperror.New(http.StatusForbidden, "department_document_scope_denied", "Document is outside department scope")
	}
	receipt, err := repo.ExecuteInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		if int64Value(doc["status"]) == 0 {
			return io.ReceiptBusinessResult{}, httperror.New(409, "department_document_deleted", "Document is already recycled")
		}
		if action == "readonly" {
			flag := 0
			if command["readonly_flag"].(bool) {
				flag = 1
			}
			_, err = tx.ExecContext(ctx, `UPDATE documents SET readonly_flag=?,updated_at=NOW() WHERE uuid=? AND doc_type='department' AND dept_code=? AND status<>0`, flag, uuid, identity.Department)
		} else {
			_, err = tx.ExecContext(ctx, `UPDATE documents SET status=0,deleted_at=NOW(),updated_at=NOW() WHERE uuid=? AND doc_type='department' AND dept_code=? AND status<>0`, uuid, identity.Department)
		}
		if err == nil && (action == "recycle" || command["readonly_flag"] == true) {
			// Freezing a document ends its collaboration: advance the epoch and
			// revoke active sessions in this same transaction (under the
			// document row lock taken above), so a late Collab renew or
			// publish is refused. Un-freezing needs no session change.
			err = invalidateCollaboration(ctx, tx, uuid)
		}
		return io.ReceiptBusinessResult{TargetBizType: "document", TargetBizCode: uuid, HTTPStatus: http.StatusOK}, err
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
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	if action == "recycle" {
		return map[string]any{"uuid": uuid, "deleted": true}, nil
	}
	return map[string]any{"uuid": uuid, "readonly_flag": command["readonly_flag"]}, nil
}
