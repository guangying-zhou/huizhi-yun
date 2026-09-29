package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"
)

type ProductComponentDelete struct {
	ComponentID               int64  `json:"component_id"`
	ExpectedRevision          uint64 `json:"expected_revision"`
	ExpectedComponentRevision uint64 `json:"expected_component_revision"`
	Reason                    string `json:"reason"`
}

func DeleteProductComponent(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductComponentDelete) (CommandResult, error) {
	return deleteProductComponent(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}
func DeleteProductComponentInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input ProductComponentDelete) (CommandResult, error) {
	result, err := deleteProductComponent(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}
func deleteProductComponent(ctx context.Context, identity CommandIdentity, permit AuthorizationPermit, input ProductComponentDelete, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {

	if identity.Action != "product_components:delete" {
		return CommandResult{}, invalid("product_command_identity_invalid", "模块删除命令不匹配")
	}
	if input.ComponentID < 1 || input.ExpectedRevision < 1 || input.ExpectedComponentRevision < 1 || strings.TrimSpace(input.Reason) == "" || !utf8.ValidString(input.Reason) || utf8.RuneCountInString(input.Reason) > 2000 || strings.ContainsRune(input.Reason, '\x00') {
		return CommandResult{}, invalid("product_component_delete_invalid", "模块删除参数或原因无效")
	}
	return execute(func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_components", "delete", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "产品已归档")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化")
		}
		var before ProductComponentRecord
		if err = tx.QueryRowContext(ctx, `SELECT id,biz_id,product_code,parent_id,name,COALESCE(description,''),sort_order,revision FROM product_components WHERE id=? AND BINARY product_code=BINARY ? FOR UPDATE`, input.ComponentID, identity.ProductCode).Scan(&before.ID, &before.BizID, &before.ProductCode, &before.ParentID, &before.Name, &before.Description, &before.SortOrder, &before.Revision); err != nil {
			return nil, err
		}
		if before.Revision != input.ExpectedComponentRevision {
			return nil, invalid("product_component_revision_conflict", "模块已变化")
		}
		var sourceCount int
		if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_component_sources WHERE component_id=?`, input.ComponentID).Scan(&sourceCount); err != nil {
			return nil, err
		}
		if sourceCount > 0 {
			return nil, invalid("product_component_source_bound", "此模块关联产品线下的来源产品，不能直接删除")
		}
		var references int
		if err = tx.QueryRowContext(ctx, `SELECT (SELECT COUNT(*) FROM product_components WHERE parent_id=?)+(SELECT COUNT(*) FROM product_features WHERE component_id=?)+(SELECT COUNT(*) FROM product_requests WHERE component_id=?)`, input.ComponentID, input.ComponentID, input.ComponentID).Scan(&references); err != nil {
			return nil, err
		}
		if references > 0 {
			return nil, invalid("product_component_referenced", "模块仍有子模块、功能或需求引用，请先调整归属")
		}
		if _, err = tx.ExecContext(ctx, `DELETE FROM product_components WHERE id=?`, input.ComponentID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"before": before, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'component',?,'delete',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(before.ID, 10), identity.ActorUID, before.Revision+1, changes, identity.IdempotencyKey)
		return map[string]any{"id": before.ID, "biz_id": before.BizID, "product_code": before.ProductCode, "deleted": true, "workspace_revision": root.Revision + 1}, err
	})
}
