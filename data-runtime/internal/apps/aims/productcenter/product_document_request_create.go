package productcenter

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type ProductDocumentRequestCreate struct {
	ExpectedRevision uint64 `json:"expected_revision"`
	TemplateUUID     string `json:"template_uuid"`
	Title            string `json:"title"`
	Purpose          string `json:"purpose"`
}

func ValidateProductDocumentRequestCreate(input ProductDocumentRequestCreate) error {
	parsed, err := uuid.Parse(input.TemplateUUID)
	if err != nil || parsed == uuid.Nil || parsed.String() != input.TemplateUUID || input.ExpectedRevision == 0 || !utf8.ValidString(input.Title) || input.Title == "" || strings.TrimSpace(input.Title) != input.Title || utf8.RuneCountInString(input.Title) > 200 || strings.ContainsFunc(input.Title, unicode.IsControl) {
		return invalid("product_document_request_invalid", "模板、标题或产品修订无效")
	}
	return validateProductDocumentPurpose(input.Purpose)
}

// trusted is built by the runtime adapter from authenticated gateway context.
// This only registers work: it does not grant Codocs ACL or issue a service call.
func CreateProductDocumentRequest(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductDocumentRequestCreate, trusted integrationoperation.TrustedContext) (CommandResult, error) {
	if identity.Action != "product_documents:template-create" {
		return CommandResult{}, invalid("product_command_identity_invalid", "模板创建请求命令无效")
	}
	if err := ValidateProductDocumentRequestCreate(input); err != nil {
		return CommandResult{}, err
	}
	if trusted.SourceApp != "aims" {
		return CommandResult{}, invalid("product_command_identity_invalid", "模板创建来源无效")
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_documents", "edit", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" || root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品状态或修订已变化")
		}
		requestID, operationID, documentID := uuid.NewString(), uuid.NewString(), uuid.NewString()
		key := "aims:product-document:create:" + requestID
		command := map[string]any{"actorUid": identity.ActorUID, "productCode": identity.ProductCode, "documentUuid": documentID, "templateUuid": input.TemplateUUID, "title": input.Title, "action": "create"}
		payload, err := json.Marshal(command)
		if err != nil {
			return nil, err
		}
		digest := sha256.Sum256(payload)
		hash := hex.EncodeToString(digest[:])
		operationIdentity := integrationoperation.Identity{TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "aims", TargetApp: "codocs", OperationCode: "aims.codocs.product-document.create.v1", SourceBizType: "product_document_request", SourceBizCode: requestID, IdempotencyKey: key, CommandSHA256: hash}
		if err = operationIdentity.Validate(); err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO integration_operation(operation_id,operation_key,correlation_key,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,command_json,command_sha256,status,next_attempt_at,original_actor_uid) VALUES(?,?,?,?,?,'aims','codocs','aims.codocs.product-document.create.v1','codocs:product-document:create','product_document_request',?,?,'product-document-create.v1',?,?,'pending',UTC_TIMESTAMP(3),?)`, operationID, key, key, trusted.TenantCode, trusted.DeploymentCode, requestID, key, string(payload), hash, identity.ActorUID)
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_document_creation_requests(biz_id,product_code,operation_id,document_uuid,purpose,created_by,created_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3))`, requestID, identity.ProductCode, operationID, documentID, input.Purpose, identity.ActorUID)
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		changes, _ := json.Marshal(map[string]any{"after": map[string]any{"biz_id": requestID}})
		if _, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'product_document_request',?,'create',?,1,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, requestID, identity.ActorUID, changes, identity.IdempotencyKey); err != nil {
			return nil, err
		}
		return map[string]any{"biz_id": requestID, "product_code": identity.ProductCode, "operation_id": operationID, "document_uuid": documentID, "workspace_revision": root.Revision + 1}, nil
	})
}
