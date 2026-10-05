package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"reflect"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

type PlanningCycleEdit struct {
	PlanningCycleDraft
	BizID                 string `json:"biz_id"`
	ExpectedCycleRevision uint64 `json:"expected_cycle_revision"`
	Reason                string `json:"reason"`
	// Explicit intent prevents an omitted budget from erasing known capacity.
	BudgetMode string `json:"budget_mode"`
}

func ValidatePlanningCycleEdit(input PlanningCycleEdit) error {
	if err := ValidatePlanningCycleDraft(input.PlanningCycleDraft); err != nil {
		return err
	}
	id, err := uuid.Parse(input.BizID)
	if err != nil || id.String() != input.BizID || input.ExpectedCycleRevision == 0 {
		return invalid("planning_cycle_revision_required", "必须提供周期标识和当前版本")
	}
	if strings.TrimSpace(input.Reason) == "" || !utf8.ValidString(input.Reason) || strings.ContainsRune(input.Reason, '\x00') || utf8.RuneCountInString(input.Reason) > 2000 {
		return invalid("planning_cycle_reason_invalid", "修改周期须填写有效原因，最多 2000 字")
	}
	switch input.BudgetMode {
	case "set":
		if input.Budget == nil {
			return invalid("planning_capacity_missing", "设置预算必须提供完整数值")
		}
	case "keep", "clear":
		if input.Budget != nil {
			return invalid("planning_cycle_budget_mode_invalid", "保留或清除预算时不能同时设置数值")
		}
	default:
		return invalid("planning_cycle_budget_mode_invalid", "必须明确保留、设置或清除预算")
	}
	return nil
}

func EditPlanningCycle(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input PlanningCycleEdit) (CommandResult, error) {
	if identity.Action != "product_priorities:cycle-edit" {
		return CommandResult{}, invalid("product_command_identity_invalid", "周期编辑命令不匹配")
	}
	if err := ValidatePlanningCycleEdit(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "edit", permit)
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
			return nil, invalid("planning_cycle_readonly", "仅草案周期可直接修改，开放期调整须通过决策流程")
		}
		budget := input.Budget
		if input.BudgetMode == "keep" {
			budget = before.Budget
		}

		var metricDefinition any = []byte(before.MetricDefinition)
		if before.MetricDefinition == nil {
			metricDefinition = nil
		}
		var baselineValue, targetValue any
		if before.BaselineValue != nil {
			baselineValue = *before.BaselineValue
		}
		if before.TargetValue != nil {
			targetValue = *before.TargetValue
		}
		metricChanged := false
		if input.Metric != nil {
			metricDefinition, baselineValue, targetValue, err = planningCycleMetricColumns(input.Metric)
			if err != nil {
				return nil, err
			}
			var previous, next map[string]string
			if before.MetricDefinition != nil {
				if err = json.Unmarshal(before.MetricDefinition, &previous); err != nil {
					return nil, err
				}
			}
			if err = json.Unmarshal(metricDefinition.([]byte), &next); err != nil {
				return nil, err
			}
			var oldBaseline, oldTarget any
			if before.BaselineValue != nil {
				oldBaseline = *before.BaselineValue
			}
			if before.TargetValue != nil {
				oldTarget = *before.TargetValue
			}
			metricChanged = !reflect.DeepEqual(previous, next) || oldBaseline != baselineValue || oldTarget != targetValue
		}
		if !metricChanged && before.Title == input.Title && before.StartsOn == input.StartsOn && before.EndsOn == input.EndsOn && before.GoalSummary == input.GoalSummary && before.ReviewIntervalDays == input.ReviewIntervalDays && reflect.DeepEqual(before.Budget, budget) {
			return PlanningCycleDetail{PlanningCycleRecord: before, WorkspaceRevision: root.Revision}, nil
		}
		var amounts [5]any
		if budget != nil {
			for i, value := range []*Hundredths{budget.Total, budget.Reserve, budget.Reliability, budget.Usability, budget.Growth} {
				if value != nil {
					amounts[i] = value.String()
				}
			}
		}
		_, err = tx.ExecContext(ctx, `UPDATE product_planning_cycles SET title=?,starts_on=?,ends_on=?,goal_summary=?,review_interval_days=?,total_person_days=?,reserve_person_days=?,reliability_person_days=?,usability_person_days=?,growth_person_days=?,metric_definition=?,baseline_value=?,target_value=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND id=?`, input.Title, input.StartsOn, input.EndsOn, input.GoalSummary, input.ReviewIntervalDays, amounts[0], amounts[1], amounts[2], amounts[3], amounts[4], metricDefinition, baselineValue, targetValue, identity.ActorUID, identity.ProductCode, before.ID)
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
		value := PlanningCycleDetail{PlanningCycleRecord: after, WorkspaceRevision: root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"before": before, "after": after, "reason": input.Reason, "budget_mode": input.BudgetMode})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'planning_cycle',?,'edit',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.BizID, identity.ActorUID, after.Revision, changes, identity.IdempotencyKey)
		return value, err
	})
}
