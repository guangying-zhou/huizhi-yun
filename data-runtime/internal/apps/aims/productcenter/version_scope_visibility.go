package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type ProductVersionScopeVisibility struct {
	VersionID               int64  `json:"version_id"`
	ScopeID                 int64  `json:"scope_id"`
	ExpectedRevision        uint64 `json:"expected_revision"`
	ExpectedVersionRevision uint64 `json:"expected_version_revision"`
	ExpectedScopeRevision   uint64 `json:"expected_scope_revision"`
	IsPublic                *bool  `json:"is_public"`
	Reason                  string `json:"reason"`
}

// Visibility changes are product decisions, not unversioned project metadata.
func ChangeProductVersionScopeVisibility(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionScopeVisibility, trusted integrationoperation.TrustedContext) (CommandResult, error) {
	if identity.Action != "product_versions:scope-visibility" {
		return CommandResult{}, invalid("product_command_identity_invalid", "公开范围命令不匹配")
	}
	if input.VersionID <= 0 || input.ScopeID <= 0 || input.ExpectedRevision == 0 || input.ExpectedVersionRevision == 0 || input.ExpectedScopeRevision == 0 || input.IsPublic == nil || strings.TrimSpace(input.Reason) == "" || !utf8.ValidString(input.Reason) || utf8.RuneCountInString(input.Reason) > 2000 || strings.ContainsFunc(input.Reason, unicode.IsControl) {
		return CommandResult{}, invalid("product_version_visibility_invalid", "请提供公开设置、完整修订及变更原因")
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_versions", "edit", permit)
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
		version, err := loadProductVersion(ctx, tx, identity.ProductCode, input.VersionID)
		if err != nil {
			return nil, err
		}
		if version.Revision != input.ExpectedVersionRevision || version.ScopeRevision != input.ExpectedScopeRevision {
			return nil, invalid("product_version_revision_conflict", "版本或范围已变化")
		}
		if version.Status != "planning" && version.Status != "developing" {
			return nil, invalid("product_version_locked", "已发布范围须通过重新打开及更正流程调整")
		}
		var before bool
		if err := tx.QueryRowContext(ctx, `SELECT is_public FROM product_version_features WHERE version_id=? AND id=? FOR UPDATE`, version.ID, input.ScopeID).Scan(&before); err != nil {
			return nil, err
		}
		if before == *input.IsPublic {
			return nil, invalid("product_version_visibility_unchanged", "公开设置未变化")
		}
		if _, err := tx.ExecContext(ctx, `UPDATE product_version_features SET is_public=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, *input.IsPublic, input.ScopeID); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE product_versions SET revision=revision+1,scope_revision=scope_revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, version.ID); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		if err := enqueueProductFeedbackProgressTx(ctx, tx, trusted, identity.ActorUID, identity.ProductCode, root.Revision+1); err != nil {
			return nil, err
		}
		out := map[string]any{"id": input.ScopeID, "version_id": version.ID, "is_public": *input.IsPublic, "workspace_revision": root.Revision + 1, "revision": version.Revision + 1, "scope_revision": version.ScopeRevision + 1}
		changes, err := json.Marshal(map[string]any{"before_public": before, "result": out, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'version',?,'scope-visibility',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(version.ID, 10), identity.ActorUID, version.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
