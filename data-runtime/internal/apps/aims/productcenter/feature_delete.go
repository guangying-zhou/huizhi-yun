package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

type FeatureDelete struct {
	ExpectedRevision        uint64 `json:"expected_revision"`
	BizID                   string `json:"biz_id"`
	ExpectedFeatureRevision uint64 `json:"expected_feature_revision"`
	Reason                  string `json:"reason"`
}

func ValidateFeatureDelete(input FeatureDelete) error {
	if input.ExpectedRevision == 0 {
		return invalid("product_revision_required", "必须提供产品空间版本号")
	}
	id, err := uuid.Parse(input.BizID)
	if err != nil || id.String() != input.BizID || input.ExpectedFeatureRevision == 0 {
		return invalid("product_feature_revision_required", "必须提供功能标识与功能版本号")
	}
	if !utf8.ValidString(input.Reason) || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 || strings.ContainsRune(input.Reason, '\x00') {
		return invalid("product_feature_reason_invalid", "请填写有效的删除原因")
	}
	return nil
}

func DeleteProductFeature(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input FeatureDelete) (CommandResult, error) {
	return deleteProductFeature(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}
func DeleteProductFeatureInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input FeatureDelete) (CommandResult, error) {
	result, err := deleteProductFeature(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}
func deleteProductFeature(ctx context.Context, identity CommandIdentity, permit AuthorizationPermit, input FeatureDelete, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {
	if identity.Action != "product_features:delete" {
		return CommandResult{}, invalid("product_command_identity_invalid", "功能删除命令不匹配")
	}
	if err := ValidateFeatureDelete(input); err != nil {
		return CommandResult{}, err
	}
	return execute(func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_features", "delete", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "产品空间已归档，请先恢复")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品空间已变化，请刷新后重试")
		}
		before, err := scanFeature(tx.QueryRowContext(ctx, `SELECT `+featureColumns+` FROM product_features WHERE product_code=? AND biz_id=?`, identity.ProductCode, input.BizID))
		if err != nil {
			return nil, err
		}
		if before.Revision != input.ExpectedFeatureRevision {
			return nil, invalid("product_feature_revision_conflict", "功能已变化，请刷新后重试")
		}

		if before.Lifecycle != "candidate" || len(before.LifecycleEvidence) != 0 {
			return nil, invalid("product_feature_delete_state_invalid", "只有未生效的候选功能可以删除")
		}
		var references int
		err = tx.QueryRowContext(ctx, `SELECT
 (SELECT COUNT(*) FROM product_request_features WHERE product_feature_id=?) +
 (SELECT COUNT(*) FROM product_planning_items WHERE feature_id=?) +
 (SELECT COUNT(*) FROM product_version_features WHERE product_feature_id=?)`, before.ID, before.ID, before.ID).Scan(&references)
		if err != nil {
			return nil, err
		}
		if references != 0 {
			return nil, invalid("product_feature_referenced", "功能已被需求、规划或版本引用，不能删除")
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM product_features WHERE product_code=? AND id=?`, identity.ProductCode, before.ID)
		if err != nil {
			return nil, err
		}

		_, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"before": before, "deleted": true, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'feature',?,'delete',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.BizID, identity.ActorUID, before.Revision+1, changes, identity.IdempotencyKey)
		return map[string]any{"biz_id": before.BizID, "deleted": true, "workspace_revision": root.Revision + 1}, err
	})
}
