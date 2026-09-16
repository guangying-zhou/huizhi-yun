package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"
)

type LegacyProductVersionScopeCriteria struct {
	VersionID               int64  `json:"version_id"`
	ScopeID                 int64  `json:"scope_id"`
	ExpectedRevision        uint64 `json:"expected_revision"`
	ExpectedVersionRevision uint64 `json:"expected_version_revision"`
	ExpectedScopeRevision   uint64 `json:"expected_scope_revision"`
	Reason                  string `json:"reason"`
	AcceptanceCriteria      string `json:"acceptance_criteria"`
}

func ValidateLegacyProductVersionScopeCriteria(input LegacyProductVersionScopeCriteria) error {
	if input.VersionID <= 0 || input.ScopeID <= 0 || input.ExpectedRevision == 0 || input.ExpectedVersionRevision == 0 || input.ExpectedScopeRevision == 0 {
		return invalid("product_version_legacy_criteria_invalid", "历史范围标准补录需要范围标识及完整版本信息")
	}
	if strings.TrimSpace(input.Reason) == "" || !utf8.ValidString(input.Reason) || utf8.RuneCountInString(input.Reason) > 2000 || strings.ContainsRune(input.Reason, '\x00') {
		return invalid("product_version_legacy_criteria_invalid", "必须记录有效的历史范围标准补录原因")
	}
	if strings.TrimSpace(input.AcceptanceCriteria) == "" || !utf8.ValidString(input.AcceptanceCriteria) || utf8.RuneCountInString(input.AcceptanceCriteria) > 10000 || strings.ContainsRune(input.AcceptanceCriteria, '\x00') {
		return invalid("product_version_legacy_criteria_invalid", "必须提供有效验收标准")
	}
	return nil
}

// Historical scope criteria can be completed without fabricating planning decisions.
func UpdateLegacyProductVersionScopeCriteria(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input LegacyProductVersionScopeCriteria) (CommandResult, error) {
	if identity.Action != "product_versions:scope-legacy-criteria" {
		return CommandResult{}, invalid("product_command_identity_invalid", "历史范围标准命令不匹配")
	}
	if err := ValidateLegacyProductVersionScopeCriteria(input); err != nil {
		return CommandResult{}, err
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
			PlanningItemID     *int64  `json:"planning_item_id"`
		}
		err = tx.QueryRowContext(ctx, `SELECT id,title,description,acceptance_criteria,status,planning_item_id FROM product_version_features WHERE id=? AND version_id=? FOR UPDATE`, input.ScopeID, version.ID).Scan(&snapshot.ID, &snapshot.Title, &snapshot.Description, &snapshot.AcceptanceCriteria, &snapshot.Status, &snapshot.PlanningItemID)
		if err != nil {
			return nil, err
		}
		if snapshot.Status != "planned" || snapshot.PlanningItemID != nil {
			return nil, invalid("product_version_scope_locked", "仅计划中的历史未评估范围可补录标准")
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_version_features SET acceptance_criteria=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, input.AcceptanceCriteria, input.ScopeID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_versions SET revision=revision+1,scope_revision=scope_revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, version.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"id": input.ScopeID, "version_id": version.ID, "product_code": identity.ProductCode, "status": "planned", "acceptance_criteria": input.AcceptanceCriteria, "revision": version.Revision + 1, "scope_revision": version.ScopeRevision + 1, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"before": snapshot, "after": out, "reason": input.Reason, "previous_scope_revision": input.ExpectedScopeRevision})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'version',?,'scope-legacy-criteria',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(version.ID, 10), identity.ActorUID, version.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
