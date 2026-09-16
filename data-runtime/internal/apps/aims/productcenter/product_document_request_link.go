package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
)

type ProductDocumentRequestLink struct {
	ExpectedRevision uint64 `json:"expected_revision"`
	RequestBizID     string `json:"request_biz_id"`
}

// The caller must first verify current Codocs access to the server-resolved
// request document. This transaction owns only the Aims relationship.
func LinkCreatedProductDocument(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductDocumentRequestLink) (CommandResult, error) {
	parsed, err := uuid.Parse(input.RequestBizID)
	if identity.Action != "product_documents:link-created" || input.ExpectedRevision == 0 || err != nil || parsed == uuid.Nil || parsed.String() != input.RequestBizID {
		return CommandResult{}, invalid("product_document_request_invalid", "文档创建请求或修订无效")
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
		var documentID, purpose, operationID, creator string
		var linked sql.NullString
		err = tx.QueryRowContext(ctx, `SELECT document_uuid,purpose,operation_id,relation_biz_id,created_by FROM product_document_creation_requests WHERE biz_id=? AND product_code=? FOR UPDATE`, input.RequestBizID, identity.ProductCode).Scan(&documentID, &purpose, &operationID, &linked, &creator)
		if err != nil {
			return nil, err
		}
		var valid int
		err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM integration_operation WHERE operation_id=? AND source_app='aims' AND target_app='codocs' AND operation_code='aims.codocs.product-document.create.v1' AND source_biz_type='product_document_request' AND source_biz_code=? AND status='succeeded' AND target_receipt_id IS NOT NULL AND target_receipt_id<>'' AND required_capability='codocs:product-document:create' AND command_schema_version='product-document-create.v1' AND original_actor_uid=? AND JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.actorUid'))=? AND target_biz_type='product_document' AND target_biz_code=? AND JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.productCode'))=? AND JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.documentUuid'))=?`, operationID, input.RequestBizID, creator, creator, documentID, identity.ProductCode, documentID).Scan(&valid)
		if err != nil {
			return nil, err
		}
		if valid != 1 {
			return nil, invalid("product_document_creation_pending", "文档尚未成功创建或回执关联不一致")
		}
		var relationID string
		var removed sql.NullTime
		err = tx.QueryRowContext(ctx, `SELECT biz_id,removed_at FROM product_documents WHERE product_code=? AND document_uuid=? FOR UPDATE`, identity.ProductCode, documentID).Scan(&relationID, &removed)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if removed.Valid {
			return nil, invalid("product_document_removed", "文档关系已解除，请显式恢复原记录")
		}
		if linked.Valid {
			if relationID != linked.String {
				return nil, invalid("product_document_binding_conflict", "文档关系不一致")
			}
			return map[string]any{"biz_id": relationID, "workspace_revision": root.Revision}, nil
		}
		if relationID == "" {
			relationID = uuid.NewString()
			if _, err = tx.ExecContext(ctx, `INSERT INTO product_documents(biz_id,product_code,document_uuid,purpose,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, relationID, identity.ProductCode, documentID, purpose, identity.ActorUID, identity.ActorUID); err != nil {
				return nil, err
			}
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_document_creation_requests SET relation_biz_id=?,linked_at=UTC_TIMESTAMP(3) WHERE biz_id=? AND product_code=? AND relation_biz_id IS NULL`, relationID, input.RequestBizID, identity.ProductCode); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		changes, _ := json.Marshal(map[string]any{"after": map[string]any{"biz_id": relationID}})
		if _, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'product_document_request',?,'link',?,1,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.RequestBizID, identity.ActorUID, changes, identity.IdempotencyKey); err != nil {
			return nil, err
		}
		return map[string]any{"biz_id": relationID, "workspace_revision": root.Revision + 1}, nil
	})
}
