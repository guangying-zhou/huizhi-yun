package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"
)

type PlanningBudgetChange struct {
	PlanningCycleTransition
	ExpectedQueueRevision uint64               `json:"expected_queue_revision"`
	Budget                *PlanningCycleBudget `json:"budget"`
	ImpactNote            string               `json:"impact_note"`
	Exceptions            []DecisionException  `json:"exceptions"`
}
type PlanningBudgetImpact struct {
	CanConfirm        bool                `json:"can_confirm"`
	Blocker           *RuleError          `json:"blocker"`
	CycleBizID        string              `json:"cycle_biz_id"`
	WorkspaceRevision uint64              `json:"workspace_revision"`
	CycleRevision     uint64              `json:"cycle_revision"`
	QueueRevision     uint64              `json:"queue_revision"`
	BeforeBudget      PlanningCycleBudget `json:"before_budget"`
	AfterBudget       PlanningCycleBudget `json:"after_budget"`
	Before            CapacityComparison  `json:"before"`
	After             CapacityComparison  `json:"after"`
}

func ValidatePlanningBudgetChange(input PlanningBudgetChange) error {
	if err := ValidatePlanningCycleTransition(input.PlanningCycleTransition); err != nil {
		return err
	}
	if input.ExpectedQueueRevision == 0 {
		return invalid("priority_queue_conflict", "必须提供队列版本")
	}
	if input.Budget == nil {
		return invalid("planning_capacity_missing", "必须明确完整新预算")
	}
	if err := input.Budget.Validate(); err != nil {
		return err
	}
	if strings.TrimSpace(input.ImpactNote) == "" || !utf8.ValidString(input.ImpactNote) || strings.ContainsRune(input.ImpactNote, '\x00') || utf8.RuneCountInString(input.ImpactNote) > 2000 {
		return invalid("planning_budget_impact_required", "预算调整必须说明影响，最多 2000 字")
	}
	return ValidateDecisionExceptions(input.Exceptions)
}
func preparePlanningBudget(ctx context.Context, tx *sql.Tx, code string, input PlanningBudgetChange) (PlanningBudgetImpact, error) {
	var out PlanningBudgetImpact
	root, err := loadWorkspace(ctx, tx, code)
	if err != nil {
		return out, err
	}
	if root.Status != "active" {
		return out, invalid("product_archived", "产品空间已归档")
	}
	if root.Revision != input.ExpectedRevision {
		return out, invalid("product_revision_conflict", "产品已变化，请重新读取")
	}
	cycle, err := loadPlanningCycle(ctx, tx, code, input.BizID)
	if err != nil {
		return out, err
	}
	if cycle.Status != "open" {
		return out, invalid("planning_cycle_readonly", "仅开放周期允许预算决定")
	}
	if cycle.Revision != input.ExpectedCycleRevision {
		return out, invalid("planning_cycle_revision_conflict", "周期已变化，请重新读取")
	}
	if cycle.QueueRevision != input.ExpectedQueueRevision {
		return out, invalid("priority_queue_conflict", "队列已变化，请重新读取")
	}
	if cycle.Budget == nil {
		return out, invalid("planning_capacity_missing", "原预算不完整")
	}
	if err = cycle.Budget.Validate(); err != nil {
		return out, err
	}
	items, latest, err := loadPlanningCapacityItems(ctx, tx, code, cycle)
	if err != nil {
		return out, err
	}
	compare := func(b *PlanningCycleBudget) (CapacityComparison, error) {
		return CompareDecisionCapacity(Capacity{Total: *b.Total, Reserve: *b.Reserve, Categories: map[InvestmentCategory]Hundredths{Reliability: *b.Reliability, Usability: *b.Usability, Growth: *b.Growth}}, items, latest)
	}
	before, err := compare(cycle.Budget)
	if err != nil {
		return out, err
	}
	after, err := compare(input.Budget)
	if err != nil {
		return out, err
	}
	out = PlanningBudgetImpact{CycleBizID: cycle.BizID, WorkspaceRevision: root.Revision, CycleRevision: cycle.Revision, QueueRevision: cycle.QueueRevision, BeforeBudget: *cycle.Budget, AfterBudget: *input.Budget, Before: before, After: after}
	return out, nil
}
func ChangePlanningBudget(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input PlanningBudgetChange) (CommandResult, error) {
	if identity.Action != "product_priorities:budget-change" {
		return CommandResult{}, invalid("product_command_identity_invalid", "预算命令不匹配")
	}
	if err := ValidatePlanningBudgetChange(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "prioritize", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		impact, err := preparePlanningBudget(ctx, tx, identity.ProductCode, input)
		if err != nil {
			return nil, err
		}
		// Changing capacity never silently reconfirms changed estimates or scope.
		if len(impact.Before.Changes) > 0 {
			return nil, invalid("planning_decision_changed", "已有投入或类别变化，请先重新确认事项决定")
		}
		if err = ConfirmDecision(impact.After.Latest, input.Exceptions); err != nil {
			return nil, err
		}
		b := input.Budget
		_, err = tx.ExecContext(ctx, `UPDATE product_planning_cycles SET total_person_days=?,reserve_person_days=?,reliability_person_days=?,usability_person_days=?,growth_person_days=?,revision=revision+1,queue_revision=queue_revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND biz_id=?`, b.Total.String(), b.Reserve.String(), b.Reliability.String(), b.Usability.String(), b.Growth.String(), identity.ActorUID, identity.ProductCode, input.BizID)
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"impact": impact, "reason": input.Reason, "impact_note": input.ImpactNote, "exceptions": input.Exceptions})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'planning_cycle',?,'budget-change',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.BizID, identity.ActorUID, impact.CycleRevision+1, changes, identity.IdempotencyKey)
		if err != nil {
			return nil, err
		}
		return map[string]any{"cycle_biz_id": input.BizID, "workspace_revision": impact.WorkspaceRevision + 1, "cycle_revision": impact.CycleRevision + 1, "queue_revision": impact.QueueRevision + 1, "impact": impact}, nil
	})
}

// Preview performs no provisional write; commit recomputes under the same lock.
func PreviewPlanningBudget(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, input PlanningBudgetChange) (PlanningBudgetImpact, error) {
	var out PlanningBudgetImpact
	if err := ValidatePlanningBudgetChange(input); err != nil {
		return out, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", permit); err != nil {
		return out, err
	}
	out, err = preparePlanningBudget(ctx, tx, code, input)
	if err != nil {
		return out, err
	}
	if len(out.Before.Changes) > 0 {
		out.Blocker = &RuleError{Code: "planning_decision_changed", Message: "已有决定的投入或类别已变化，请先确认变更"}
	} else if err = ConfirmDecision(out.After.Latest, input.Exceptions); err != nil {
		if !errors.As(err, &out.Blocker) {
			return PlanningBudgetImpact{}, err
		}
	} else {
		out.CanConfirm = true
	}

	return out, tx.Commit()
}
