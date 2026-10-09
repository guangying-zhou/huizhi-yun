package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

type PlanningCycleTransition struct {
	BizID                 string `json:"biz_id"`
	ExpectedRevision      uint64 `json:"expected_revision"`
	ExpectedCycleRevision uint64 `json:"expected_cycle_revision"`
	Reason                string `json:"reason"`
}

func ValidatePlanningCycleTransition(input PlanningCycleTransition) error {
	id, err := uuid.Parse(input.BizID)
	if err != nil || id.String() != input.BizID || input.ExpectedRevision == 0 || input.ExpectedCycleRevision == 0 {
		return invalid("planning_cycle_revision_required", "必须提供周期标识、产品与周期版本")
	}
	if strings.TrimSpace(input.Reason) == "" || !utf8.ValidString(input.Reason) || strings.ContainsRune(input.Reason, '\x00') || utf8.RuneCountInString(input.Reason) > 2000 {
		return invalid("planning_cycle_reason_invalid", "周期流转必须说明原因，最多 2000 字")
	}
	return nil
}

func OpenPlanningCycle(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input PlanningCycleTransition) (CommandResult, error) {
	if identity.Action != "product_priorities:cycle-open" {
		return CommandResult{}, invalid("product_command_identity_invalid", "周期开放命令不匹配")
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
		if before.Status != "draft" {
			return nil, invalid("planning_cycle_state_conflict", "仅草案周期可以开放")
		}
		if before.Budget == nil {
			return nil, invalid("planning_capacity_missing", "开放前须明确完整容量预算")
		}
		if err = before.Budget.Validate(); err != nil {
			return nil, err
		}
		var metric PlanningCycleMetric
		if len(before.MetricDefinition) == 0 {
			return nil, invalid("planning_cycle_metric_required", "开放前须定义成功指标与目标值")
		}
		if err = json.Unmarshal(before.MetricDefinition, &metric); err != nil {
			return nil, err
		}
		metric.BaselineValue = before.BaselineValue
		metric.TargetValue = before.TargetValue
		if err = ValidatePlanningCycleMetric(metric); err != nil {
			return nil, err
		}
		if metric.TargetValue == nil {
			return nil, invalid("planning_cycle_metric_required", "开放前须明确目标值，基线未知可保留为空")
		}
		if err = validatePlanningCycleModelReady(ctx, tx, identity.ProductCode, before.ModelVersion, before.ModelSnapshot); err != nil {
			return nil, err
		}

		now := time.Now().UTC()
		start, err := time.Parse("2006-01-02", before.StartsOn)
		if err != nil {
			return nil, err
		}
		end, err := time.Parse("2006-01-02", before.EndsOn)
		if err != nil {
			return nil, err
		}
		end = end.Add(24*time.Hour - time.Second)
		if now.After(end) {
			return nil, invalid("planning_cycle_period_expired", "周期期间已结束，请调整草案日期")
		}
		if start.After(now) {
			now = start
		}
		nextReview := now.AddDate(0, 0, before.ReviewIntervalDays)
		if nextReview.After(end) {
			nextReview = end
		}
		var existing bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM product_planning_cycles WHERE product_code=? AND status='open')`, identity.ProductCode).Scan(&existing); err != nil {
			return nil, err
		}
		if existing {
			return nil, invalid("planning_cycle_already_open", "本产品已有开放周期，请先关闭当前周期")
		}
		_, err = tx.ExecContext(ctx, `UPDATE product_planning_cycles SET status='open',next_review_at=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND id=?`, nextReview, identity.ActorUID, identity.ProductCode, before.ID)
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
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'planning_cycle',?,'open',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.BizID, identity.ActorUID, after.Revision, changes, identity.IdempotencyKey)
		return PlanningCycleDetail{PlanningCycleRecord: after, WorkspaceRevision: root.Revision + 1}, err
	})
}
