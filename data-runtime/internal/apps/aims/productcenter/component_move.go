package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"
)

type ProductComponentMove struct {
	ComponentID               int64  `json:"component_id"`
	ParentID                  *int64 `json:"parent_id"`
	ExpectedRevision          uint64 `json:"expected_revision"`
	ExpectedComponentRevision uint64 `json:"expected_component_revision"`
	Reason                    string `json:"reason"`
}

func MoveProductComponent(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductComponentMove) (CommandResult, error) {
	return moveProductComponent(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}
func MoveProductComponentInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input ProductComponentMove) (CommandResult, error) {
	result, err := moveProductComponent(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}
func moveProductComponent(ctx context.Context, identity CommandIdentity, permit AuthorizationPermit, input ProductComponentMove, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {

	if identity.Action != "product_components:move" {
		return CommandResult{}, invalid("product_command_identity_invalid", "模块移动命令不匹配")
	}
	if input.ComponentID < 1 || (input.ParentID != nil && *input.ParentID < 1) || input.ExpectedRevision < 1 || input.ExpectedComponentRevision < 1 || strings.TrimSpace(input.Reason) == "" || !utf8.ValidString(input.Reason) || utf8.RuneCountInString(input.Reason) > 2000 || strings.ContainsRune(input.Reason, '\x00') {
		return CommandResult{}, invalid("product_component_move_invalid", "模块移动参数或原因无效")
	}
	return execute(func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_components", "edit", permit)
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
		var previousParent *int64
		var revision uint64
		var bizID string
		if err = tx.QueryRowContext(ctx, `SELECT biz_id,parent_id,revision FROM product_components WHERE id=? AND BINARY product_code=BINARY ? FOR UPDATE`, input.ComponentID, identity.ProductCode).Scan(&bizID, &previousParent, &revision); err != nil {
			return nil, err
		}
		if revision != input.ExpectedComponentRevision {
			return nil, invalid("product_component_revision_conflict", "模块已变化")
		}
		nodes, err := loadProductComponentTree(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if err = ValidateProductComponentMove(nodes, input.ComponentID, input.ParentID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_components SET parent_id=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, input.ParentID, identity.ActorUID, input.ComponentID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"id": input.ComponentID, "biz_id": bizID, "product_code": identity.ProductCode, "parent_id": input.ParentID, "revision": revision + 1, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"before": map[string]any{"parent_id": previousParent, "revision": revision}, "after": out, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'component',?,'move',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(input.ComponentID, 10), identity.ActorUID, revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
