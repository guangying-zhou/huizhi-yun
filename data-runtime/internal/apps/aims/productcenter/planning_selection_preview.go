package productcenter

import (
	"context"
	"database/sql"
	"errors"
)

type PlanningSelectionPreview struct {
	CycleBizID        string             `json:"cycle_biz_id"`
	ItemBizID         string             `json:"item_biz_id"`
	WorkspaceRevision uint64             `json:"workspace_revision"`
	CycleRevision     uint64             `json:"cycle_revision"`
	QueueRevision     uint64             `json:"queue_revision"`
	Before            CapacityComparison `json:"before"`
	After             CapacityComparison `json:"after"`
	CanConfirm        bool               `json:"can_confirm"`
	Blocker           *RuleError         `json:"blocker"`
}

// PreviewPlanningSelection is read-only, with no provisional SQL update,
// receipt, audit entry or version increment. A later commit revalidates all facts.
func PreviewPlanningSelection(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, input PlanningSelection) (PlanningSelectionPreview, error) {
	var out PlanningSelectionPreview
	if err := ValidatePlanningSelection(input); err != nil {
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
	prepared, err := preparePlanningSelection(ctx, tx, code, input)
	if err != nil {
		return out, err
	}
	out = PlanningSelectionPreview{CycleBizID: input.CycleBizID, ItemBizID: input.ItemBizID, WorkspaceRevision: prepared.RootRevision, CycleRevision: prepared.Cycle.Revision, QueueRevision: prepared.Cycle.QueueRevision, Before: prepared.Before, After: prepared.After}
	if len(prepared.Before.Changes) > 0 {
		out.Blocker = &RuleError{Code: "planning_decision_changed", Message: "已有决定的投入或类别已变化，请先确认变更"}
	} else if err = ConfirmDecision(prepared.After.Latest, input.Exceptions); err != nil {
		if !errors.As(err, &out.Blocker) {
			return PlanningSelectionPreview{}, err
		}
	} else {
		out.CanConfirm = true
	}
	return out, tx.Commit()
}
