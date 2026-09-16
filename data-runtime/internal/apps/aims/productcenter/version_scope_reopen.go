package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"strconv"
	"strings"
	"unicode/utf8"
)

type ProductVersionScopeReopen struct {
	VersionID               int64  `json:"version_id"`
	ScopeID                 int64  `json:"scope_id"`
	ExpectedRevision        uint64 `json:"expected_revision"`
	ExpectedVersionRevision uint64 `json:"expected_version_revision"`
	ExpectedScopeRevision   uint64 `json:"expected_scope_revision"`
	Reason                  string `json:"reason"`
}

func ValidateProductVersionScopeReopen(input ProductVersionScopeReopen) error {
	if input.VersionID <= 0 || input.ScopeID <= 0 || input.ExpectedRevision == 0 || input.ExpectedVersionRevision == 0 || input.ExpectedScopeRevision == 0 {
		return invalid("product_version_scope_reopen_invalid", "撤回交付确认需要范围标识及完整版本信息")
	}
	if strings.TrimSpace(input.Reason) == "" || !utf8.ValidString(input.Reason) || utf8.RuneCountInString(input.Reason) > 2000 || strings.ContainsRune(input.Reason, '\x00') {
		return invalid("product_version_scope_reopen_invalid", "必须记录有效的交付确认撤回原因")
	}
	return nil
}

// Reopening preserves previous delivery evidence and invalidates acceptance by advancing scope revision.
func ReopenProductVersionScope(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionScopeReopen, sourceContext ...integrationoperation.TrustedContext) (CommandResult, error) {
	if identity.Action != "product_versions:scope-reopen" {
		return CommandResult{}, invalid("product_command_identity_invalid", "范围交付撤回命令不匹配")
	}
	if err := ValidateProductVersionScopeReopen(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_versions", "accept", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "产品已归档")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化，请刷新")
		}
		version, err := loadProductVersion(ctx, tx, identity.ProductCode, input.VersionID)
		if err != nil {
			return nil, err
		}
		if version.Revision != input.ExpectedVersionRevision || version.ScopeRevision != input.ExpectedScopeRevision {
			return nil, invalid("product_version_revision_conflict", "版本或范围已变化，请重新核验")
		}
		if (version.Status != "planning" && version.Status != "developing") || version.CurrentReleaseRecordID != nil {
			return nil, invalid("product_version_locked", "已发布或归档版本须先撤回发布才能调整范围")
		}
		var snapshot struct {
			ID                 int64   `json:"id"`
			Title              string  `json:"title"`
			Description        *string `json:"description"`
			AcceptanceCriteria *string `json:"acceptance_criteria"`
			Status             string  `json:"status"`
		}
		err = tx.QueryRowContext(ctx, `SELECT id,title,description,acceptance_criteria,status FROM product_version_features WHERE id=? AND version_id=? FOR UPDATE`, input.ScopeID, version.ID).Scan(&snapshot.ID, &snapshot.Title, &snapshot.Description, &snapshot.AcceptanceCriteria, &snapshot.Status)
		if err != nil {
			return nil, err
		}
		if snapshot.Status != "delivered" {
			return nil, invalid("product_version_scope_locked", "仅已交付范围可撤回交付确认")
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_version_features SET status='planned',updated_at=UTC_TIMESTAMP(3) WHERE id=?`, input.ScopeID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_versions SET revision=revision+1,scope_revision=scope_revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, version.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"id": input.ScopeID, "version_id": version.ID, "product_code": identity.ProductCode, "status": "planned", "revision": version.Revision + 1, "scope_revision": version.ScopeRevision + 1, "workspace_revision": root.Revision + 1}
		var trusted integrationoperation.TrustedContext
		if len(sourceContext) == 1 {
			trusted = sourceContext[0]
		}
		if err := enqueueProductFeedbackProgressTx(ctx, tx, trusted, identity.ActorUID, identity.ProductCode, root.Revision+1); err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"before": snapshot, "after": out, "reason": input.Reason, "withdrawn_scope_revision": input.ExpectedScopeRevision})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'version',?,'scope-reopen',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(version.ID, 10), identity.ActorUID, version.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
