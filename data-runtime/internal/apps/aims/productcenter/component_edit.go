package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"
)

type ProductComponentEdit struct {
	ComponentID               int64  `json:"component_id"`
	Name                      string `json:"name"`
	Description               string `json:"description"`
	SortOrder                 int32  `json:"sort_order"`
	ExpectedRevision          uint64 `json:"expected_revision"`
	ExpectedComponentRevision uint64 `json:"expected_component_revision"`
	Reason                    string `json:"reason"`
}

func EditProductComponent(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductComponentEdit) (CommandResult, error) {
	if identity.Action != "product_components:edit" {
		return CommandResult{}, invalid("product_command_identity_invalid", "模块编辑命令不匹配")
	}
	if input.ComponentID < 1 || input.ExpectedRevision < 1 || input.ExpectedComponentRevision < 1 || strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.Reason) == "" {
		return CommandResult{}, invalid("product_component_edit_invalid", "模块名称、修订或原因无效")
	}
	for _, field := range []struct {
		value string
		limit int
	}{{input.Name, 255}, {input.Description, 10000}, {input.Reason, 2000}} {
		if !utf8.ValidString(field.value) || utf8.RuneCountInString(field.value) > field.limit || strings.ContainsRune(field.value, '\x00') {
			return CommandResult{}, invalid("product_component_edit_invalid", "模块字段无效")
		}
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
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
		var before ProductComponentRecord
		if err = tx.QueryRowContext(ctx, `SELECT id,biz_id,product_code,parent_id,name,COALESCE(description,''),sort_order,revision FROM product_components WHERE id=? AND BINARY product_code=BINARY ? FOR UPDATE`, input.ComponentID, identity.ProductCode).Scan(&before.ID, &before.BizID, &before.ProductCode, &before.ParentID, &before.Name, &before.Description, &before.SortOrder, &before.Revision); err != nil {
			return nil, err
		}
		if before.Revision != input.ExpectedComponentRevision {
			return nil, invalid("product_component_revision_conflict", "模块已变化")
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_components SET name=?,description=?,sort_order=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, input.Name, input.Description, input.SortOrder, identity.ActorUID, input.ComponentID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		// Explicit snapshots omit child_count, which is not loaded by this edit.
		snapshot := func(name, description string, sort int32, revision uint64) map[string]any {
			return map[string]any{"id": before.ID, "biz_id": before.BizID, "product_code": before.ProductCode, "parent_id": before.ParentID, "name": name, "description": description, "sort_order": sort, "revision": revision}
		}
		after := snapshot(input.Name, input.Description, input.SortOrder, before.Revision+1)
		changes, err := json.Marshal(map[string]any{"before": snapshot(before.Name, before.Description, before.SortOrder, before.Revision), "after": after, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'component',?,'edit',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(before.ID, 10), identity.ActorUID, before.Revision+1, changes, identity.IdempotencyKey)
		return map[string]any{"component": after, "workspace_revision": root.Revision + 1}, err
	})
}
