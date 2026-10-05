package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"strings"
	"unicode/utf8"
)

// FeatureDraft creates a candidate only. Activation requires separate lifecycle evidence.
type FeatureDraft struct {
	ExpectedRevision uint64 `json:"expected_revision"`
	Title            string `json:"title"`
	Description      string `json:"description"`
}

func ValidateFeatureDraft(input FeatureDraft) error {
	if input.ExpectedRevision == 0 {
		return invalid("product_revision_required", "必须提供产品空间版本号")
	}
	if strings.TrimSpace(input.Title) == "" {
		return invalid("product_feature_fields_invalid", "功能标题必填")
	}
	for _, f := range []struct {
		value string
		max   int
	}{{input.Title, 500}, {input.Description, 10000}} {
		if !utf8.ValidString(f.value) || utf8.RuneCountInString(f.value) > f.max || strings.ContainsRune(f.value, '\x00') {
			return invalid("product_feature_fields_invalid", "功能字段无效或超出长度限制")
		}
	}
	return nil
}
func CreateProductFeature(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input FeatureDraft) (CommandResult, error) {
	return createProductFeature(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}
func CreateProductFeatureInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input FeatureDraft) (CommandResult, error) {
	result, err := createProductFeature(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}
func createProductFeature(ctx context.Context, identity CommandIdentity, permit AuthorizationPermit, input FeatureDraft, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {
	if identity.Action != "product_features:create" {
		return CommandResult{}, invalid("product_command_identity_invalid", "功能创建命令不匹配")
	}
	if err := ValidateFeatureDraft(input); err != nil {
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
		bizID := uuid.NewString()
		result, err := tx.ExecContext(ctx, `INSERT INTO product_features(biz_id,product_code,title,description,lifecycle,revision,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,'candidate',1,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, bizID, identity.ProductCode, input.Title, input.Description, identity.ActorUID, identity.ActorUID)
		if err != nil {
			return nil, err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		value := map[string]any{"id": id, "biz_id": bizID, "product_code": identity.ProductCode, "title": input.Title, "description": input.Description, "lifecycle": "candidate", "revision": 1, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"after": value})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'feature',?,'create',?,1,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, bizID, identity.ActorUID, changes, identity.IdempotencyKey)
		return value, err
	})
}
