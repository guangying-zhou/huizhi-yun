package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
)

type ProductDocumentTransition struct {
	BizID                    string `json:"biz_id"`
	ExpectedRevision         uint64 `json:"expected_revision"`
	ExpectedDocumentRevision uint64 `json:"expected_document_revision"`
}

// Changes only the relation. Restoring it must never restore a Codocs ACL.
func TransitionProductDocument(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductDocumentTransition) (CommandResult, error) {
	remove := identity.Action == "product_documents:remove"
	if !remove && identity.Action != "product_documents:restore" {
		return CommandResult{}, invalid("product_command_identity_invalid", "文档关系操作无效")
	}
	parsed, err := uuid.Parse(input.BizID)
	if err != nil || parsed == uuid.Nil || parsed.String() != input.BizID || input.ExpectedRevision == 0 || input.ExpectedDocumentRevision == 0 {
		return CommandResult{}, invalid("product_document_input_invalid", "关系身份或修订无效")
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_documents", "edit", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "归档产品不能修改文档关系")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化，请重新读取")
		}
		var revision uint64
		var removed bool
		if err = tx.QueryRowContext(ctx, `SELECT revision,removed_at IS NOT NULL FROM product_documents WHERE product_code=? AND biz_id=? FOR UPDATE`, identity.ProductCode, input.BizID).Scan(&revision, &removed); err == sql.ErrNoRows {
			return nil, invalid("product_document_not_found", "文档关系不存在")
		} else if err != nil {
			return nil, err
		}
		if revision != input.ExpectedDocumentRevision {
			return nil, invalid("product_document_revision_conflict", "文档关系已变化，请重新读取")
		}
		if removed == remove {
			return nil, invalid("product_document_transition_invalid", "文档关系已处于目标状态")
		}
		action := "restore"
		if remove {
			action = "remove"
			_, err = tx.ExecContext(ctx, `UPDATE product_documents SET removed_at=UTC_TIMESTAMP(3),removed_by=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND biz_id=?`, identity.ActorUID, identity.ActorUID, identity.ProductCode, input.BizID)
		} else {
			_, err = tx.ExecContext(ctx, `UPDATE product_documents SET removed_at=NULL,removed_by=NULL,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND biz_id=?`, identity.ActorUID, identity.ProductCode, input.BizID)
		}
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"biz_id": input.BizID, "product_code": identity.ProductCode, "removed": remove, "revision": revision + 1, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"before": map[string]any{"removed": removed, "revision": revision}, "after": map[string]any{"removed": remove, "revision": revision + 1}})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'product_document',?,?,?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.BizID, action, identity.ActorUID, revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
