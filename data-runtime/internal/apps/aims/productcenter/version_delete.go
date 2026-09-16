package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"
)

type ProductVersionDeleteInput struct {
	VersionID               int64  `json:"version_id"`
	ExpectedRevision        uint64 `json:"expected_revision"`
	ExpectedVersionRevision uint64 `json:"expected_version_revision"`
	ExpectedScopeRevision   uint64 `json:"expected_scope_revision"`
	Reason                  string `json:"reason"`
}

func DeleteProductCenterVersion(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionDeleteInput) (CommandResult, error) {
	if identity.Action != "product_versions:delete" {
		return CommandResult{}, invalid("product_command_identity_invalid", "版本删除命令不匹配")
	}
	if input.VersionID <= 0 || input.ExpectedRevision == 0 || input.ExpectedVersionRevision == 0 || input.ExpectedScopeRevision == 0 || !utf8.ValidString(input.Reason) || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 || strings.ContainsRune(input.Reason, '\x00') {
		return CommandResult{}, invalid("product_version_delete_invalid", "删除须提供完整修订及原因")
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_versions", "delete", permit)
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
			return nil, invalid("product_version_revision_conflict", "版本已变化")
		}
		if version.Status != "planning" || version.CurrentReleaseRecordID != nil {
			return nil, invalid("product_version_locked", "仅未发布的规划版本可以删除")
		}
		for _, table := range []string{"work_items", "product_version_features", "aims_project_products", "product_version_acceptances", "product_release_records"} {
			var count int
			if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE version_id=?", version.ID).Scan(&count); err != nil {
				return nil, err
			}
			if count > 0 {
				return nil, invalid("product_version_referenced", "版本存在执行、范围、项目绑定或发布验收记录，不能删除")
			}
		}
		if _, err = tx.ExecContext(ctx, `DELETE FROM product_versions WHERE id=?`, version.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"version_id": version.ID, "product_code": identity.ProductCode, "deleted": true, "revision": version.Revision + 1, "workspace_revision": root.Revision + 1, "scope_revision": version.ScopeRevision, "release_record_id": version.CurrentReleaseRecordID}
		changes, err := json.Marshal(map[string]any{"result": out, "reason": input.Reason, "before": version})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'version',?,'delete',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(version.ID, 10), identity.ActorUID, version.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
