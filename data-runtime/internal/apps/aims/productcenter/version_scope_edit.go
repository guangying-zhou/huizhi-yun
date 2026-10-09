package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
)

type ProductVersionScopeEdit struct {
	ProductVersionScopeDraft
	ScopeID int64 `json:"scope_id"`
}

func EditProductVersionScope(ctx context.Context, db *sql.DB, identity CommandIdentity, versionPermit, planningPermit AuthorizationPermit, input ProductVersionScopeEdit) (CommandResult, error) {
	return editProductVersionScope(ctx, identity, versionPermit, planningPermit, input, func(payload any, authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, payload, authorize, apply)
	})
}

func EditProductVersionScopeInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, versionPermit, planningPermit AuthorizationPermit, input ProductVersionScopeEdit) (CommandResult, error) {
	return editProductVersionScope(ctx, identity, versionPermit, planningPermit, input, func(payload any, authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, payload, authorize, apply)
	})
}

func editProductVersionScope(ctx context.Context, identity CommandIdentity, versionPermit, planningPermit AuthorizationPermit, input ProductVersionScopeEdit, execute func(any, AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {
	if identity.Action != "product_versions:scope-edit" {
		return CommandResult{}, invalid("product_command_identity_invalid", "版本范围编辑命令不匹配")
	}
	if input.DeferredFrom != nil {
		return CommandResult{}, invalid("product_version_deferral_invalid", "延期必须创建后续范围，不能改写已有来源")
	}
	if input.ScopeID <= 0 {
		return CommandResult{}, invalid("product_version_scope_id_invalid", "版本范围标识无效")
	}
	if err := ValidateProductVersionScopeDraft(input.ProductVersionScopeDraft); err != nil {
		return CommandResult{}, err
	}
	return execute(input, func(ctx context.Context, tx *sql.Tx) error {
		if err := AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_versions", "edit", versionPermit); err != nil {
			return err
		}
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "prioritize", planningPermit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		basis, err := ValidatePlanningDeliveryTx(ctx, tx, identity.ProductCode, input.PlanningDeliveryCheck)
		if err != nil {
			return nil, err
		}
		version, err := loadProductVersion(ctx, tx, identity.ProductCode, input.VersionID)
		if err != nil {
			return nil, err
		}
		if version.Revision != input.ExpectedVersionRevision {
			return nil, invalid("product_version_revision_conflict", "版本已变化，请刷新")
		}
		if version.Status != "planning" && version.Status != "developing" {
			return nil, invalid("product_version_locked", "已发布或归档版本不能修改范围")
		}
		if version.PlanningMode == "simple" {
			return nil, invalid("product_version_plan_locked", "轻量版本范围须通过计划工作区修改")
		}
		var before struct {
			Title              string  `json:"title"`
			Description        *string `json:"description"`
			AcceptanceCriteria *string `json:"acceptance_criteria"`
			ChangeType         *string `json:"change_type"`
			Status             string  `json:"status"`
		}
		var boundFeature, currentFeature sql.NullInt64
		// Bind all three identities in SQL; the browser cannot move the scope to
		// a different version or substitute an unrelated selected planning item.
		err = tx.QueryRowContext(ctx, `SELECT vf.title,vf.description,vf.acceptance_criteria,vf.change_type,vf.status,vf.product_feature_id,i.feature_id FROM product_version_features vf JOIN product_planning_items i ON i.id=vf.planning_item_id AND i.product_code=? WHERE vf.id=? AND vf.version_id=? AND vf.planning_item_id=? FOR UPDATE`, identity.ProductCode, input.ScopeID, version.ID, basis.ItemID).Scan(&before.Title, &before.Description, &before.AcceptanceCriteria, &before.ChangeType, &before.Status, &boundFeature, &currentFeature)
		if err != nil {
			return nil, err
		}
		if before.Status != "planned" {
			return nil, invalid("product_version_scope_locked", "已交付或顺延范围须通过专用变更流程调整")
		}
		if boundFeature != currentFeature {
			return nil, invalid("product_version_scope_feature_changed", "事项关联功能已变化，请先处理原版本范围关联")
		}
		if boundFeature.Valid {
			var lifecycle string
			if err = tx.QueryRowContext(ctx, `SELECT lifecycle FROM product_features WHERE id=? AND product_code=?`, boundFeature.Int64, identity.ProductCode).Scan(&lifecycle); err != nil {
				return nil, err
			}
			if lifecycle == "deprecated" {
				return nil, invalid("product_version_scope_feature_invalid", "关联功能已弃用")
			}
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_version_features SET title=?,description=?,acceptance_criteria=?,change_type=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, input.Title, input.Description, input.AcceptanceCriteria, input.ChangeType, input.ScopeID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_versions SET revision=revision+1,scope_revision=scope_revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, version.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_items SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, identity.ActorUID, basis.ItemID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"id": input.ScopeID, "version_id": version.ID, "product_code": identity.ProductCode, "revision": version.Revision + 1, "scope_revision": version.ScopeRevision + 1, "workspace_revision": input.ExpectedRevision + 1, "item_revision": input.ExpectedItemRevision + 1}
		changes, err := json.Marshal(map[string]any{"before": before, "after": input, "result": out, "decision_basis": basis})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'version',?,'scope-edit',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(version.ID, 10), identity.ActorUID, version.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
