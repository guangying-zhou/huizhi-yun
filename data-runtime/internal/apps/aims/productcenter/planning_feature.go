package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"unicode/utf8"
)

type PlanningFeatureChange struct {
	ExpectedRevision        uint64 `json:"expected_revision"`
	ItemBizID               string `json:"item_biz_id"`
	FeatureBizID            string `json:"feature_biz_id"`
	ExpectedItemRevision    uint64 `json:"expected_item_revision"`
	ExpectedFeatureRevision uint64 `json:"expected_feature_revision"`
	Operation               string `json:"operation"`
	Reason                  string `json:"reason"`
	ImpactNote              string `json:"impact_note"`
}

func ValidatePlanningFeatureChange(input PlanningFeatureChange) error {
	if err := ValidateFeatureRequestChange(FeatureRequestChange{ExpectedRevision: input.ExpectedRevision, FeatureBizID: input.FeatureBizID, RequestBizID: input.ItemBizID, ExpectedFeatureRevision: input.ExpectedFeatureRevision, ExpectedRequestRevision: input.ExpectedItemRevision, Operation: input.Operation, Reason: input.Reason}); err != nil {
		return err
	}
	if !utf8.ValidString(input.ImpactNote) || utf8.RuneCountInString(input.ImpactNote) > 2000 || strings.ContainsRune(input.ImpactNote, '\x00') {
		return invalid("product_planning_reason_invalid", "影响说明无效")
	}
	return nil
}

func ChangePlanningFeature(ctx context.Context, db *sql.DB, identity CommandIdentity, planningPermit, featurePermit AuthorizationPermit, input PlanningFeatureChange) (CommandResult, error) {
	if identity.Action != "product_priorities:feature-link" {
		return CommandResult{}, invalid("product_command_identity_invalid", "规划功能关联命令不匹配")
	}
	if err := ValidatePlanningFeatureChange(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		if err := AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "edit", planningPermit); err != nil {
			return err
		}
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_features", "view", featurePermit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "产品空间已归档")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品空间已变化")
		}
		item, err := loadPlanningItemDetail(ctx, tx, identity.ProductCode, input.ItemBizID)
		if err != nil {
			return nil, err
		}
		if item.Revision != input.ExpectedItemRevision {
			return nil, invalid("product_planning_revision_conflict", "规划事项已变化")
		}
		if item.Lifecycle == "merged" || item.Lifecycle == "delivered" || item.Lifecycle == "cancelled" {
			return nil, invalid("product_planning_readonly", "已结束或合并事项只读保留")
		}
		if item.RequiresImpactNote && strings.TrimSpace(input.ImpactNote) == "" {
			return nil, invalid("product_planning_impact_required", "已选入或交付中的事项须说明影响")
		}
		feature, err := scanFeature(tx.QueryRowContext(ctx, `SELECT `+featureColumns+` FROM product_features WHERE product_code=? AND biz_id=?`, identity.ProductCode, input.FeatureBizID))
		if err != nil {
			return nil, err
		}
		if feature.Revision != input.ExpectedFeatureRevision {
			return nil, invalid("product_feature_revision_conflict", "功能已变化")
		}
		var previous sql.NullInt64
		if err := tx.QueryRowContext(ctx, `SELECT feature_id FROM product_planning_items WHERE id=?`, item.ID).Scan(&previous); err != nil {
			return nil, err
		}
		var next any
		if input.Operation == "link" {
			if feature.Lifecycle == "deprecated" {
				return nil, invalid("product_feature_request_state_invalid", "不能新关联已弃用功能")
			}
			if previous.Valid {
				return nil, invalid("product_planning_feature_conflict", "事项已有关联功能，请先显式解除原关联")
			}
			next = feature.ID
		} else if !previous.Valid || previous.Int64 != feature.ID {
			return nil, invalid("product_planning_feature_conflict", "当前关联功能已变化")
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_items SET feature_id=?,scope_revision=scope_revision+1,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, next, identity.ActorUID, item.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"feature_biz_id": feature.BizID, "operation": input.Operation, "reason": input.Reason, "impact_note": input.ImpactNote, "before_scope_revision": item.ScopeRevision, "after_scope_revision": item.ScopeRevision + 1})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'planning_item',?,'feature-link',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, item.BizID, identity.ActorUID, item.Revision+1, changes, identity.IdempotencyKey)
		return map[string]any{"item_biz_id": item.BizID, "feature_biz_id": feature.BizID, "linked": input.Operation == "link", "workspace_revision": root.Revision + 1, "item_revision": item.Revision + 1, "scope_revision": item.ScopeRevision + 1}, err
	})
}
