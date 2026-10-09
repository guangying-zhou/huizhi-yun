package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

type PlanningCycleModelSelect struct {
	BizID                 string `json:"biz_id"`
	ModelVersion          string `json:"model_version"`
	ExpectedRevision      uint64 `json:"expected_revision"`
	ExpectedCycleRevision uint64 `json:"expected_cycle_revision"`
	Reason                string `json:"reason"`
}

func SelectPlanningCycleModel(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input PlanningCycleModelSelect) (CommandResult, error) {
	if identity.Action != "product_priorities:cycle-model-select" {
		return CommandResult{}, invalid("product_command_identity_invalid", "周期模型命令不匹配")
	}
	id, err := uuid.Parse(input.BizID)
	if err != nil || id.String() != input.BizID || input.ExpectedRevision == 0 || input.ExpectedCycleRevision == 0 || !utf8.ValidString(input.Reason) || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 || strings.ContainsRune(input.Reason, 0) {
		return CommandResult{}, invalid("assessment_model_invalid", "周期模型选择参数无效")
	}
	syntax := DefaultWeightedAssessmentModel()
	syntax.Version = input.ModelVersion
	if err = syntax.Validate(); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "admin", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "归档产品不能选择模型")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化，请刷新")
		}
		cycle, err := loadPlanningCycle(ctx, tx, identity.ProductCode, input.BizID)
		if err != nil {
			return nil, err
		}
		if cycle.Revision != input.ExpectedCycleRevision {
			return nil, invalid("planning_cycle_revision_conflict", "周期已变化，请刷新")
		}
		if cycle.Status != "draft" {
			return nil, invalid("planning_cycle_readonly", "仅草稿周期可以选择模型")
		}
		var hasAssessment bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM product_priority_assessments WHERE cycle_id=?)`, cycle.ID).Scan(&hasAssessment); err != nil {
			return nil, err
		}
		if hasAssessment {
			return nil, invalid("planning_cycle_readonly", "已有评估历史的周期不能切换模型")
		}
		var snapshot json.RawMessage
		if input.ModelVersion == AssessmentModel {
			snapshot, err = json.Marshal(planningCycleModelSnapshot())
		} else {
			err = tx.QueryRowContext(ctx, `SELECT configuration FROM product_priority_model_versions WHERE BINARY product_code=BINARY ? AND BINARY version=BINARY ?`, identity.ProductCode, input.ModelVersion).Scan(&snapshot)
		}
		if err != nil {
			return nil, err
		}
		if err = validatePlanningCycleModelReady(ctx, tx, identity.ProductCode, input.ModelVersion, snapshot); err != nil {
			return nil, err
		}
		if cycle.ModelVersion == input.ModelVersion {
			return nil, invalid("assessment_model_unchanged", "周期已使用该模型")
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_cycles SET model_version=?,model_snapshot=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, input.ModelVersion, []byte(snapshot), identity.ActorUID, cycle.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"biz_id": cycle.BizID, "product_code": identity.ProductCode, "model_version": input.ModelVersion, "model_snapshot": snapshot, "revision": cycle.Revision + 1, "workspace_revision": root.Revision + 1, "queue_revision": cycle.QueueRevision}
		changes, err := json.Marshal(map[string]any{"before": map[string]any{"model_version": cycle.ModelVersion, "model_snapshot": cycle.ModelSnapshot}, "after": out, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'planning_cycle',?,'model-select',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, cycle.BizID, identity.ActorUID, cycle.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
