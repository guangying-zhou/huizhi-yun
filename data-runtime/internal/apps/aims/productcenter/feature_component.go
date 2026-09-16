package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"strings"
	"unicode/utf8"
)

type FeatureComponentAssignment struct {
	BizID                   string `json:"biz_id"`
	ComponentID             *int64 `json:"component_id"`
	ExpectedRevision        uint64 `json:"expected_revision"`
	ExpectedFeatureRevision uint64 `json:"expected_feature_revision"`
	Reason                  string `json:"reason"`
}

// Classification changes neither feature identity nor frozen planning/version scope.
func AssignProductFeatureComponent(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input FeatureComponentAssignment) (CommandResult, error) {
	if identity.Action != "product_features:component-assign" {
		return CommandResult{}, invalid("product_command_identity_invalid", "功能归类命令不匹配")
	}
	id, err := uuid.Parse(input.BizID)
	if err != nil || id.String() != input.BizID || input.ExpectedRevision < 1 || input.ExpectedFeatureRevision < 1 || (input.ComponentID != nil && *input.ComponentID < 1) || !utf8.ValidString(input.Reason) || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 || strings.ContainsRune(input.Reason, '\x00') {
		return CommandResult{}, invalid("product_feature_component_invalid", "功能归类参数或原因无效")
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_features", "edit", permit)
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
		var featureID int64
		var previous *int64
		var revision uint64
		if err = tx.QueryRowContext(ctx, `SELECT id,component_id,revision FROM product_features WHERE BINARY product_code=BINARY ? AND biz_id=? FOR UPDATE`, identity.ProductCode, input.BizID).Scan(&featureID, &previous, &revision); err != nil {
			return nil, err
		}
		if revision != input.ExpectedFeatureRevision {
			return nil, invalid("product_feature_revision_conflict", "功能已变化")
		}
		if input.ComponentID != nil {
			var found int64
			if err = tx.QueryRowContext(ctx, `SELECT id FROM product_components WHERE id=? AND BINARY product_code=BINARY ?`, *input.ComponentID, identity.ProductCode).Scan(&found); err != nil {
				return nil, err
			}
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_features SET component_id=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, input.ComponentID, identity.ActorUID, featureID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"id": featureID, "biz_id": input.BizID, "product_code": identity.ProductCode, "component_id": input.ComponentID, "revision": revision + 1, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"before": map[string]any{"component_id": previous, "revision": revision}, "after": out, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'feature',?,'component-assign',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.BizID, identity.ActorUID, revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
