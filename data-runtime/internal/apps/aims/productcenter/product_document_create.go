package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
)

type ProductDocumentCreate struct {
	ExpectedRevision uint64 `json:"expected_revision"`
	DocumentUUID     string `json:"document_uuid"`
	Purpose          string `json:"purpose"`
}

func ValidateProductDocumentCreate(input ProductDocumentCreate) error {
	parsed, err := uuid.Parse(input.DocumentUUID)
	if err != nil || parsed == uuid.Nil || parsed.String() != input.DocumentUUID || input.ExpectedRevision == 0 {
		return invalid("product_document_input_invalid", "文档 UUID 或产品修订无效")
	}
	return validateProductDocumentPurpose(input.Purpose)
}

func validateProductDocumentPurpose(purpose string) error {
	switch purpose {
	case "product-overview", "requirements", "design", "release-notes", "user-guide", "other":
		return nil
	default:
		return invalid("product_document_input_invalid", "文档用途无效")
	}
}

// Stores only the Aims relation. The future service/BFF caller must verify
// Codocs access before invoking this command; no browser route exposes it yet.
func CreateProductDocument(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductDocumentCreate) (CommandResult, error) {
	if db == nil {
		return CommandResult{}, invalid("product_command_configuration", "产品命令缺少数据库")
	}
	if identity.Action != "product_documents:create" {
		return CommandResult{}, invalid("product_command_identity_invalid", "文档关联命令无效")
	}
	if err := ValidateProductDocumentCreate(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_documents", "edit", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		return createProductDocumentTx(ctx, tx, identity, input)
	})
}

func CreateProductDocumentInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input ProductDocumentCreate) (CommandResult, error) {
	if identity.Action != "product_documents:create" {
		return CommandResult{}, invalid("product_command_identity_invalid", "文档关联命令无效")
	}
	if err := ValidateProductDocumentCreate(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommandInTransaction(ctx, tx, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_documents", "edit", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		return createProductDocumentTx(ctx, tx, identity, input)
	})
}

func createProductDocumentTx(ctx context.Context, tx *sql.Tx, identity CommandIdentity, input ProductDocumentCreate) (any, error) {
	root, err := loadWorkspace(ctx, tx, identity.ProductCode)
	if err != nil {
		return nil, err
	}
	if root.Status != "active" {
		return nil, invalid("product_archived", "归档产品不能关联文档")
	}
	if root.Revision != input.ExpectedRevision {
		return nil, invalid("product_revision_conflict", "产品已变化，请重新读取")
	}
	var exists int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_documents WHERE product_code=? AND document_uuid=?`, identity.ProductCode, input.DocumentUUID).Scan(&exists); err != nil {
		return nil, err
	}
	if exists != 0 {
		return nil, invalid("product_document_already_linked", "文档关系已存在；已解除关系应恢复原记录")
	}
	bizID := uuid.NewString()
	if _, err = tx.ExecContext(ctx, `INSERT INTO product_documents(biz_id,product_code,document_uuid,purpose,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, bizID, identity.ProductCode, input.DocumentUUID, input.Purpose, identity.ActorUID, identity.ActorUID); err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
		return nil, err
	}
	out := map[string]any{"biz_id": bizID, "product_code": identity.ProductCode, "document_uuid": input.DocumentUUID, "purpose": input.Purpose, "revision": 1, "workspace_revision": root.Revision + 1}
	// Product activity is not a Codocs permission check: omit UUID and metadata.
	changes, err := json.Marshal(map[string]any{"after": map[string]any{"biz_id": bizID, "revision": 1}})
	if err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'product_document',?,'create',?,1,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, bizID, identity.ActorUID, changes, identity.IdempotencyKey)
	return out, err
}
