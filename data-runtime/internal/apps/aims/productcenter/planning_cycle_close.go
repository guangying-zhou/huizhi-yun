package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
)

func ClosePlanningCycle(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input PlanningCycleTransition) (CommandResult, error) {
	if identity.Action != "product_priorities:cycle-close" {
		return CommandResult{}, invalid("product_command_identity_invalid", "周期关闭命令不匹配")
	}
	if err := ValidatePlanningCycleTransition(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "prioritize", permit)
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
		before, err := loadPlanningCycle(ctx, tx, identity.ProductCode, input.BizID)
		if err != nil {
			return nil, err
		}
		if before.Revision != input.ExpectedCycleRevision {
			return nil, invalid("planning_cycle_revision_conflict", "周期已变化，请刷新后重试")
		}
		if before.Status != "open" {
			return nil, invalid("planning_cycle_state_conflict", "仅开放周期可以关闭")
		}
		// Closing freezes cycle decisions, not the lifecycle of shared planning
		// items. Keep assessments, ranks and capacity snapshots for review.
		_, err = tx.ExecContext(ctx, `UPDATE product_planning_cycles SET status='closed',revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND id=?`, identity.ActorUID, identity.ProductCode, before.ID)
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		after, err := loadPlanningCycle(ctx, tx, identity.ProductCode, input.BizID)
		if err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"before": before, "after": after, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'planning_cycle',?,'close',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.BizID, identity.ActorUID, after.Revision, changes, identity.IdempotencyKey)
		return PlanningCycleDetail{PlanningCycleRecord: after, WorkspaceRevision: root.Revision + 1}, err
	})
}
