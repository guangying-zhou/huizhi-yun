package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
)

// Current describes whether the pending confirmation can be consumed against
// this snapshot, not whether capacity/dependency exceptions permit withdrawal.
type PlanningConsumptionView struct {
	CycleBizID        string                           `json:"cycle_biz_id"`
	ItemBizID         string                           `json:"item_biz_id"`
	WorkspaceRevision uint64                           `json:"workspace_revision"`
	CycleRevision     uint64                           `json:"cycle_revision"`
	QueueRevision     uint64                           `json:"queue_revision"`
	ItemRevision      uint64                           `json:"item_revision"`
	ScopeRevision     uint64                           `json:"scope_revision"`
	ProductStatus     string                           `json:"product_status"`
	CycleStatus       string                           `json:"cycle_status"`
	Lifecycle         string                           `json:"lifecycle"`
	SelectionStatus   string                           `json:"selection_status"`
	Pending           *PlanningConsumptionConfirmation `json:"pending"`
	Retained          *PlanningRetainedConsumption     `json:"retained"`
	Current           bool                             `json:"current"`
	Blocker           *RuleError                       `json:"blocker"`
}

func ReadPlanningConsumption(ctx context.Context, db *sql.DB, code, uid, cycleID, itemID string, permit AuthorizationPermit) (PlanningConsumptionView, error) {
	var out PlanningConsumptionView
	for _, value := range []string{cycleID, itemID} {
		id, err := uuid.Parse(value)
		if err != nil || id.String() != value {
			return out, invalid("planning_consumption_input_invalid", "周期和事项标识无效")
		}
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", permit); err != nil {
		return out, err
	}
	root, err := loadWorkspace(ctx, tx, code)
	if err != nil {
		return out, err
	}
	cycle, err := loadPlanningCycle(ctx, tx, code, cycleID)
	if err != nil {
		return out, err
	}
	out = PlanningConsumptionView{CycleBizID: cycleID, ItemBizID: itemID, WorkspaceRevision: root.Revision, CycleRevision: cycle.Revision, QueueRevision: cycle.QueueRevision, ProductStatus: root.Status, CycleStatus: cycle.Status}
	var snapshot json.RawMessage
	err = tx.QueryRowContext(ctx, `SELECT i.revision,i.scope_revision,i.lifecycle,ci.selection_status,ci.decision_snapshot FROM product_planning_items i JOIN product_planning_cycle_items ci ON ci.planning_item_id=i.id AND ci.product_code=i.product_code WHERE i.product_code=? AND i.biz_id=? AND ci.cycle_id=?`, code, itemID, cycle.ID).Scan(&out.ItemRevision, &out.ScopeRevision, &out.Lifecycle, &out.SelectionStatus, &snapshot)
	if err != nil {
		return PlanningConsumptionView{}, err
	}
	var envelope map[string]json.RawMessage
	if len(snapshot) > 0 && json.Unmarshal(snapshot, &envelope) != nil {
		return PlanningConsumptionView{}, invalid("planning_consumption_snapshot_invalid", "周期决定快照无效")
	}
	if encoded, exists := envelope["pending_consumption"]; exists {
		var confirmation PlanningConsumptionConfirmation
		if json.Unmarshal(encoded, &confirmation) != nil || confirmation.ConfirmationID == "" {
			return PlanningConsumptionView{}, invalid("planning_consumption_snapshot_invalid", "投入确认记录无效")
		}
		// Validate historical identity even if the current scope has moved on.
		retained, marshalErr := json.Marshal(map[string]any{"retained_consumption": confirmation.PlanningRetainedConsumption})
		if marshalErr != nil {
			return PlanningConsumptionView{}, marshalErr
		}
		if _, err = decodePlanningRetainedConsumption(retained, cycleID, itemID, "deferred"); err != nil {
			return PlanningConsumptionView{}, err
		}
		out.Pending = &confirmation
		if _, err = consumePlanningConfirmation(snapshot, cycleID, itemID, out.ItemRevision, out.ScopeRevision, confirmation.ConfirmationID); err != nil {
			if !errors.As(err, &out.Blocker) {
				return PlanningConsumptionView{}, err
			}
		} else {
			out.Current = true
		}
	}
	out.Retained, err = decodePlanningRetainedConsumption(snapshot, cycleID, itemID, out.SelectionStatus)
	if err != nil {
		return PlanningConsumptionView{}, err
	}
	if root.Status != "active" || cycle.Status != "open" || out.Lifecycle != "in_delivery" || out.SelectionStatus != "selected" {
		out.Current = false
		out.Blocker = &RuleError{Code: "planning_consumption_state_invalid", Message: "当前产品、周期或事项状态不允许使用投入确认撤回"}
	}
	return out, tx.Commit()
}
