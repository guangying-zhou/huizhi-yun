package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"strings"
	"unicode/utf8"
)

type PlanningWithdrawal struct {
	ConsumptionConfirmationID string `json:"consumption_confirmation_id,omitempty"`
	PlanningCycleCandidateAdd
	ExpectedQueueRevision uint64              `json:"expected_queue_revision"`
	Reason                string              `json:"reason"`
	ImpactNote            string              `json:"impact_note"`
	Exceptions            []DecisionException `json:"exceptions"`
}

func ValidatePlanningWithdrawal(input PlanningWithdrawal) error {
	if err := ValidatePlanningCycleCandidateAdd(input.PlanningCycleCandidateAdd); err != nil {
		return err
	}
	if input.ExpectedQueueRevision == 0 {
		return invalid("priority_queue_conflict", "必须提供队列版本")
	}
	if input.ConsumptionConfirmationID != "" {
		id, err := uuid.Parse(input.ConsumptionConfirmationID)
		if err != nil || id.String() != input.ConsumptionConfirmationID {
			return invalid("planning_consumption_input_invalid", "投入确认标识无效")
		}
	}
	for _, value := range []string{input.Reason, input.ImpactNote} {
		if strings.TrimSpace(value) == "" || !utf8.ValidString(value) || strings.ContainsRune(value, '\x00') || utf8.RuneCountInString(value) > 2000 {
			return invalid("planning_withdrawal_reason_required", "移出事项须说明原因和影响，最多 2000 字")
		}
	}
	return ValidateDecisionExceptions(input.Exceptions)
}

type PlanningWithdrawalImpact struct {
	Consumption       *PlanningConsumptionConfirmation `json:"consumption,omitempty"`
	CanConfirm        bool                             `json:"can_confirm"`
	Blocker           *RuleError                       `json:"blocker"`
	CycleBizID        string                           `json:"cycle_biz_id"`
	ItemBizID         string                           `json:"item_biz_id"`
	WorkspaceRevision uint64                           `json:"workspace_revision"`
	CycleRevision     uint64                           `json:"cycle_revision"`
	QueueRevision     uint64                           `json:"queue_revision"`
	Before            CapacityComparison               `json:"before"`
	After             CapacityComparison               `json:"after"`
	PreviousDecision  json.RawMessage                  `json:"previous_decision"`
}

func preparePlanningWithdrawal(ctx context.Context, tx *sql.Tx, code string, input PlanningWithdrawal) (PlanningWithdrawalImpact, error) {
	var out PlanningWithdrawalImpact
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
	cycle, err := loadPlanningCycle(ctx, tx, code, input.CycleBizID)
	if err != nil {
		return out, err
	}
	if cycle.Status != "open" {
		return out, invalid("planning_cycle_readonly", "仅开放周期允许移出事项")
	}
	if cycle.Revision != input.ExpectedCycleRevision {
		return out, invalid("planning_cycle_revision_conflict", "周期已变化，请重新读取")
	}
	if cycle.QueueRevision != input.ExpectedQueueRevision {
		return out, invalid("priority_queue_conflict", "队列已变化，请重新读取")
	}
	var revision, scopeRevision uint64
	var lifecycle, selection string
	var previous json.RawMessage
	err = tx.QueryRowContext(ctx, `SELECT i.revision,i.scope_revision,i.lifecycle,ci.selection_status,ci.decision_snapshot FROM product_planning_items i JOIN product_planning_cycle_items ci ON ci.planning_item_id=i.id AND ci.product_code=i.product_code WHERE i.product_code=? AND i.biz_id=? AND ci.cycle_id=?`, code, input.ItemBizID, cycle.ID).Scan(&revision, &scopeRevision, &lifecycle, &selection, &previous)
	if err != nil {
		return out, err
	}
	if revision != input.ExpectedItemRevision {
		return out, invalid("product_planning_revision_conflict", "事项已变化，请重新读取")
	}
	if selection != "selected" {
		return out, invalid("planning_withdrawal_not_selected", "只能移出已选事项")
	}
	var consumption *PlanningConsumptionConfirmation
	if lifecycle == "in_delivery" {
		consumption, err = consumePlanningConfirmation(previous, input.CycleBizID, input.ItemBizID, revision, scopeRevision, input.ConsumptionConfirmationID)
		if err != nil {
			return out, err
		}
	} else if lifecycle != "proposed" {
		return out, invalid("planning_withdrawal_consumption_required", "已结束事项不能通过撤回释放本周期消耗")
	} else if input.ConsumptionConfirmationID != "" {
		return out, invalid("planning_consumption_state_invalid", "未开工事项不能使用已开工投入确认")
	}
	if cycle.Budget == nil {
		return out, invalid("planning_capacity_missing", "周期预算不完整")
	}
	if err = cycle.Budget.Validate(); err != nil {
		return out, err
	}
	items, latest, err := loadPlanningCapacityItems(ctx, tx, code, cycle)
	if err != nil {
		return out, err
	}
	b := cycle.Budget
	capacity := Capacity{Total: *b.Total, Reserve: *b.Reserve, Categories: map[InvestmentCategory]Hundredths{Reliability: *b.Reliability, Usability: *b.Usability, Growth: *b.Growth}}
	before, err := CompareDecisionCapacity(capacity, items, latest)
	if err != nil {
		return out, err
	}
	for i := range items {
		if items[i].ID == input.ItemBizID {
			items[i].Selected = false
			if consumption != nil {
				items[i].RetainedEffort = cloneEffort(consumption.Spent)
				items[i].Category = consumption.Category
			}
		}
	}
	delete(latest, input.ItemBizID)
	after, err := CompareDecisionCapacity(capacity, items, latest)
	if err != nil {
		return out, err
	}
	return PlanningWithdrawalImpact{Consumption: consumption, CycleBizID: cycle.BizID, ItemBizID: input.ItemBizID, WorkspaceRevision: root.Revision, CycleRevision: cycle.Revision, QueueRevision: cycle.QueueRevision, Before: before, After: after, PreviousDecision: previous}, nil
}
func WithdrawPlanningCandidate(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input PlanningWithdrawal) (CommandResult, error) {
	if identity.Action != "product_priorities:withdraw" {
		return CommandResult{}, invalid("product_command_identity_invalid", "移出命令不匹配")
	}
	if err := ValidatePlanningWithdrawal(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "prioritize", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		impact, err := preparePlanningWithdrawal(ctx, tx, identity.ProductCode, input)
		if err != nil {
			return nil, err
		}
		// Removing stale scope is allowed, but cannot reconfirm other changed scope.
		if len(impact.After.Changes) > 0 {
			return nil, invalid("planning_decision_changed", "其他已选事项的投入或类别已变化，请先确认变更")
		}
		if err = ConfirmDecision(impact.After.Latest, input.Exceptions); err != nil {
			return nil, err
		}
		decision := map[string]any{"action": "withdraw", "previous_decision": impact.PreviousDecision, "exceptions": input.Exceptions}
		if impact.Consumption != nil {
			decision["retained_consumption"] = impact.Consumption.PlanningRetainedConsumption
			decision["consumption_confirmation_id"] = impact.Consumption.ConfirmationID
		}
		snapshot, err := json.Marshal(decision)
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE product_planning_cycle_items ci JOIN product_planning_items i ON i.id=ci.planning_item_id AND i.product_code=ci.product_code JOIN product_planning_cycles c ON c.id=ci.cycle_id SET ci.selection_status='deferred',ci.roadmap_bucket='later',ci.decision_snapshot=?,ci.decided_by=?,ci.decision_reason=?,ci.decided_at=UTC_TIMESTAMP(3) WHERE ci.product_code=? AND c.biz_id=? AND i.biz_id=?`, snapshot, identity.ActorUID, input.Reason, identity.ProductCode, input.CycleBizID, input.ItemBizID)
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_cycles SET revision=revision+1,queue_revision=queue_revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND biz_id=?`, identity.ActorUID, identity.ProductCode, input.CycleBizID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"impact": impact, "reason": input.Reason, "impact_note": input.ImpactNote, "exceptions": input.Exceptions})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'planning_cycle',?,'withdraw',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.CycleBizID, identity.ActorUID, impact.CycleRevision+1, changes, identity.IdempotencyKey)
		if err != nil {
			return nil, err
		}
		return map[string]any{"cycle_biz_id": input.CycleBizID, "item_biz_id": input.ItemBizID, "workspace_revision": impact.WorkspaceRevision + 1, "cycle_revision": impact.CycleRevision + 1, "queue_revision": impact.QueueRevision + 1, "selection_status": "deferred", "roadmap_bucket": "later", "impact": impact}, nil
	})
}

func PreviewPlanningWithdrawal(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, input PlanningWithdrawal) (PlanningWithdrawalImpact, error) {
	var out PlanningWithdrawalImpact
	if err := ValidatePlanningWithdrawal(input); err != nil {
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
	out, err = preparePlanningWithdrawal(ctx, tx, code, input)
	if err != nil {
		return out, err
	}
	if len(out.After.Changes) > 0 {
		out.Blocker = &RuleError{Code: "planning_decision_changed", Message: "其他已选事项的投入或类别已变化，请先确认变更"}
	} else if err = ConfirmDecision(out.After.Latest, input.Exceptions); err != nil {
		if !errors.As(err, &out.Blocker) {
			return PlanningWithdrawalImpact{}, err
		}
	} else {
		out.CanConfirm = true
	}
	return out, tx.Commit()
}
