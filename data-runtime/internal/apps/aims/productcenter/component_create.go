package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"strconv"
	"strings"
	"unicode/utf8"
)

type ProductComponentDraft struct {
	ParentID         *int64 `json:"parent_id"`
	Name             string `json:"name"`
	Description      string `json:"description"`
	SortOrder        int32  `json:"sort_order"`
	ExpectedRevision uint64 `json:"expected_revision"`
}

func CreateProductComponent(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductComponentDraft) (CommandResult, error) {
	return createProductComponent(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}
func CreateProductComponentInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input ProductComponentDraft) (CommandResult, error) {
	result, err := createProductComponent(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}
func createProductComponent(ctx context.Context, identity CommandIdentity, permit AuthorizationPermit, input ProductComponentDraft, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {

	if identity.Action != "product_components:create" {
		return CommandResult{}, invalid("product_command_identity_invalid", "模块创建命令不匹配")
	}
	if input.ExpectedRevision < 1 || (input.ParentID != nil && *input.ParentID < 1) || strings.TrimSpace(input.Name) == "" || !utf8.ValidString(input.Name) || utf8.RuneCountInString(input.Name) > 255 || strings.ContainsRune(input.Name, '\x00') || !utf8.ValidString(input.Description) || utf8.RuneCountInString(input.Description) > 10000 || strings.ContainsRune(input.Description, '\x00') {
		return CommandResult{}, invalid("product_component_draft_invalid", "模块名称、描述或父模块无效")
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
		nodes, err := loadProductComponentTree(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if len(nodes) >= 10000 {
			return nil, invalid("product_component_tree_too_large", "模块树最多支持 10000 个节点")
		}
		// Validate a temporary positive ID before insertion, including parent ownership.
		candidate := int64(1)
		used := map[int64]bool{}
		for _, node := range nodes {
			used[node.ID] = true
		}
		for used[candidate] {
			candidate++
		}
		if input.ParentID != nil && !used[*input.ParentID] {
			return nil, invalid("product_component_parent_invalid", "父模块不属于当前产品")
		}
		nodes = append(nodes, ComponentTreeNode{ID: candidate})
		if err = ValidateProductComponentMove(nodes, candidate, input.ParentID); err != nil {
			return nil, err
		}
		bizID := uuid.NewString()
		inserted, err := tx.ExecContext(ctx, `INSERT INTO product_components(biz_id,product_code,parent_id,name,description,sort_order,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, bizID, identity.ProductCode, input.ParentID, input.Name, input.Description, input.SortOrder, identity.ActorUID, identity.ActorUID)
		if err != nil {
			return nil, err
		}
		id, err := inserted.LastInsertId()
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"id": id, "biz_id": bizID, "product_code": identity.ProductCode, "parent_id": input.ParentID, "name": input.Name, "description": input.Description, "sort_order": input.SortOrder, "revision": 1, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"after": out})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'component',?,'create',?,1,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(id, 10), identity.ActorUID, changes, identity.IdempotencyKey)
		return out, err
	})
}
