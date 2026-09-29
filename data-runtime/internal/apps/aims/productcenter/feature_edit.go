package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

type FeatureEdit struct {
	FeatureDraft
	BizID                   string `json:"biz_id"`
	ExpectedFeatureRevision uint64 `json:"expected_feature_revision"`
	Reason                  string `json:"reason"`
}

func ValidateFeatureEdit(input FeatureEdit) error {
	if err := ValidateFeatureDraft(input.FeatureDraft); err != nil {
		return err
	}
	id, err := uuid.Parse(input.BizID)
	if err != nil || id.String() != input.BizID || input.ExpectedFeatureRevision == 0 {
		return invalid("product_feature_revision_required", "必须提供功能标识与功能版本号")
	}
	if !utf8.ValidString(input.Reason) || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 || strings.ContainsRune(input.Reason, '\x00') {
		return invalid("product_feature_reason_invalid", "请填写有效的修改原因")
	}
	return nil
}

func EditProductFeature(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input FeatureEdit) (CommandResult, error) {
	return editProductFeature(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}
func EditProductFeatureInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input FeatureEdit) (CommandResult, error) {
	result, err := editProductFeature(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}
func editProductFeature(ctx context.Context, identity CommandIdentity, permit AuthorizationPermit, input FeatureEdit, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {
	if identity.Action != "product_features:edit" {
		return CommandResult{}, invalid("product_command_identity_invalid", "功能修改命令不匹配")
	}
	if err := ValidateFeatureEdit(input); err != nil {
		return CommandResult{}, err
	}
	return execute(func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_features", "edit", permit)
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

		_, err = tx.ExecContext(ctx, `UPDATE product_features SET title=?,description=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND id=?`, input.Title, input.Description, identity.ActorUID, identity.ProductCode, before.ID)
		if err != nil {
			return nil, err
		}
		// Descriptive edits do not change lifecycle evidence, planning scope, or frozen decisions.
		_, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		after, err := scanFeature(tx.QueryRowContext(ctx, `SELECT `+featureColumns+` FROM product_features WHERE product_code=? AND id=?`, identity.ProductCode, before.ID))
		if err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"before": before, "after": after, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'feature',?,'edit',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.BizID, identity.ActorUID, after.Revision, changes, identity.IdempotencyKey)
		return map[string]any{"feature": after, "workspace_revision": root.Revision + 1}, err
	})
}
