package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"reflect"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Confirming consumption does not withdraw the item or release its budget.
// A later prioritize command must explicitly consume this versioned record.
type PlanningConsumptionConfirm struct {
	PlanningCycleCandidateAdd
	ExpectedQueueRevision uint64      `json:"expected_queue_revision"`
	ExpectedScopeRevision uint64      `json:"expected_scope_revision"`
	Spent                 *Hundredths `json:"spent_person_days"`
	Reason                string      `json:"reason"`
}

type PlanningConsumptionConfirmation struct {
	PlanningRetainedConsumption
	ConfirmationID   string          `json:"confirmation_id"`
	ItemRevision     uint64          `json:"item_revision"`
	DecisionSnapshot json.RawMessage `json:"decision_snapshot"`
}

func ValidatePlanningConsumptionConfirm(input PlanningConsumptionConfirm) error {
	if err := ValidatePlanningCycleCandidateAdd(input.PlanningCycleCandidateAdd); err != nil {
		return err
	}
	if input.ExpectedQueueRevision == 0 || input.ExpectedScopeRevision == 0 || input.Spent == nil || *input.Spent < 0 || *input.Spent > 100_000_000 {
		return invalid("planning_consumption_input_invalid", "请提供队列及范围版本和明确的已发生投入，未知不能填写为零")
	}
	if strings.TrimSpace(input.Reason) == "" || !utf8.ValidString(input.Reason) || strings.ContainsRune(input.Reason, '\x00') || utf8.RuneCountInString(input.Reason) > 2000 {
		return invalid("planning_consumption_input_invalid", "确认已发生投入须说明核验依据，最多 2000 字")
	}
	return nil
}

func ConfirmPlanningConsumption(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input PlanningConsumptionConfirm) (CommandResult, error) {
	if identity.Action != "product_priorities:consumption-confirm" {
		return CommandResult{}, invalid("product_command_identity_invalid", "投入确认命令不匹配")
	}
	if err := ValidatePlanningConsumptionConfirm(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "assess", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "产品空间已归档")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化，请重新读取")
		}
		cycle, err := loadPlanningCycle(ctx, tx, identity.ProductCode, input.CycleBizID)
		if err != nil {
			return nil, err
		}
		if cycle.Status != "open" {
			return nil, invalid("planning_cycle_readonly", "仅开放周期允许确认撤回投入")
		}
		if cycle.Revision != input.ExpectedCycleRevision {
			return nil, invalid("planning_cycle_revision_conflict", "周期已变化，请重新读取")
		}
		if cycle.QueueRevision != input.ExpectedQueueRevision {
			return nil, invalid("priority_queue_conflict", "队列已变化，请重新读取")
		}
		var itemID int64
		var revision, scope uint64
		var lifecycle, selection string
		var snapshot json.RawMessage
		err = tx.QueryRowContext(ctx, `SELECT i.id,i.revision,i.scope_revision,i.lifecycle,ci.selection_status,ci.decision_snapshot FROM product_planning_items i JOIN product_planning_cycle_items ci ON ci.planning_item_id=i.id AND ci.product_code=i.product_code WHERE i.product_code=? AND i.biz_id=? AND ci.cycle_id=?`, identity.ProductCode, input.ItemBizID, cycle.ID).Scan(&itemID, &revision, &scope, &lifecycle, &selection, &snapshot)
		if err != nil {
			return nil, err
		}
		if revision != input.ExpectedItemRevision || scope != input.ExpectedScopeRevision {
			return nil, invalid("product_planning_revision_conflict", "事项或范围已变化，请重新核验投入")
		}
		if lifecycle != "in_delivery" || selection != "selected" {
			return nil, invalid("planning_consumption_state_invalid", "仅已开工的已选事项允许确认撤回投入")
		}
		baseline, err := decodePlanningCapacityBaseline(snapshot, input.ItemBizID)
		if err != nil {
			return nil, err
		}
		// Replace an earlier pending confirmation without recursively nesting it.
		var decision map[string]json.RawMessage
		if err = json.Unmarshal(snapshot, &decision); err != nil {
			return nil, err
		}
		delete(decision, "pending_consumption")
		original, err := json.Marshal(decision)
		if err != nil {
			return nil, err
		}
		confirmation := PlanningConsumptionConfirmation{PlanningRetainedConsumption: PlanningRetainedConsumption{Version: 1, CycleBizID: cycle.BizID, ItemBizID: input.ItemBizID, ScopeRevision: scope, Category: baseline.Category, Spent: cloneEffort(input.Spent), ConfirmedBy: identity.ActorUID, ConfirmedAt: time.Now().UTC().Format(time.RFC3339Nano), Reason: input.Reason}, ConfirmationID: uuid.NewString(), ItemRevision: revision, DecisionSnapshot: original}
		encoded, err := json.Marshal(confirmation)
		if err != nil {
			return nil, err
		}
		decision["pending_consumption"] = encoded
		updated, err := json.Marshal(decision)
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_cycle_items SET decision_snapshot=? WHERE cycle_id=? AND planning_item_id=?`, updated, cycle.ID, itemID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_cycles SET revision=revision+1,queue_revision=queue_revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, identity.ActorUID, cycle.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'planning_cycle',?,'consumption-confirm',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, cycle.BizID, identity.ActorUID, cycle.Revision+1, encoded, identity.IdempotencyKey); err != nil {
			return nil, err
		}
		return map[string]any{"confirmation": confirmation, "workspace_revision": root.Revision + 1, "cycle_revision": cycle.Revision + 1, "queue_revision": cycle.QueueRevision + 1}, nil
	})
}

// Consumption is valid only for the exact scope and underlying decision that
// the assessor inspected. JSON structural equality tolerates MySQL formatting.
func consumePlanningConfirmation(snapshot json.RawMessage, cycleID, itemID string, revision, scope uint64, confirmationID string) (*PlanningConsumptionConfirmation, error) {
	fail := func() (*PlanningConsumptionConfirmation, error) {
		return nil, invalid("planning_withdrawal_consumption_required", "请重新核验已发生投入，并选择与当前范围及决定匹配的确认记录")
	}
	if confirmationID == "" {
		return fail()
	}
	var decision map[string]json.RawMessage
	if json.Unmarshal(snapshot, &decision) != nil {
		return fail()
	}
	var confirmation PlanningConsumptionConfirmation
	if json.Unmarshal(decision["pending_consumption"], &confirmation) != nil || confirmation.ConfirmationID != confirmationID || confirmation.ItemRevision != revision || confirmation.ScopeRevision != scope {
		return fail()
	}
	retained, err := json.Marshal(map[string]any{"retained_consumption": confirmation.PlanningRetainedConsumption})
	if err != nil {
		return nil, err
	}
	if _, err = decodePlanningRetainedConsumption(retained, cycleID, itemID, "deferred"); err != nil {
		return nil, err
	}
	delete(decision, "pending_consumption")
	current, err := json.Marshal(decision)
	if err != nil {
		return nil, err
	}
	var before, after any
	if json.Unmarshal(confirmation.DecisionSnapshot, &before) != nil || json.Unmarshal(current, &after) != nil || !reflect.DeepEqual(before, after) {
		return fail()
	}
	return &confirmation, nil
}
