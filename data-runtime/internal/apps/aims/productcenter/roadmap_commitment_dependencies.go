package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
)

type RoadmapCommitmentDependency struct {
	BizID           string  `json:"biz_id"`
	Revision        uint64  `json:"revision"`
	Lifecycle       string  `json:"lifecycle"`
	SelectionStatus string  `json:"selection_status"`
	DecisionRank    *uint64 `json:"decision_rank"`
}

func roadmapCommitmentDependencies(ctx context.Context, tx *sql.Tx, code string, cycleID, itemID int64, itemBizID string, decision json.RawMessage) ([]RoadmapCommitmentDependency, error) {
	var rank uint64
	if err := tx.QueryRowContext(ctx, `SELECT decision_rank FROM product_planning_cycle_items WHERE cycle_id=? AND planning_item_id=? AND BINARY product_code=BINARY ?`, cycleID, itemID, code).Scan(&rank); err != nil {
		return nil, err
	}
	out, err := loadRoadmapCommitmentDependencies(ctx, tx, code, cycleID, itemID)
	if err != nil {
		return nil, err
	}
	report := CapacityReport{}
	var unresolved bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM product_cross_dependencies d JOIN product_planning_items p ON p.id=d.predecessor_id AND p.product_code=d.predecessor_product_code WHERE d.planning_item_id=? AND BINARY d.product_code=BINARY ? AND p.lifecycle<>'delivered')`, itemID, code).Scan(&unresolved); err != nil {
		return nil, err
	}
	if unresolved {
		report.Issues = append(report.Issues, DecisionIssue{Code: "cross_dependency_unresolved", ItemID: itemBizID})
	}
	for _, p := range out {
		if p.Lifecycle != "delivered" && (p.Lifecycle == "cancelled" || p.Lifecycle == "merged" || p.SelectionStatus != "selected" || p.DecisionRank == nil || *p.DecisionRank >= rank) {
			report.Issues = append(report.Issues, DecisionIssue{Code: "dependency_unresolved", ItemID: itemBizID, PredecessorID: p.BizID})
		}
	}
	var frozen struct {
		Exceptions []DecisionException `json:"exceptions"`
	}
	if err = json.Unmarshal(decision, &frozen); err != nil {
		return nil, err
	}
	applicable := []DecisionException{}
	for _, exception := range frozen.Exceptions {
		for _, issue := range report.Issues {
			if exception.Code == issue.Code && exception.ItemID == issue.ItemID && exception.PredecessorID == issue.PredecessorID && exception.Category == issue.Category {
				applicable = append(applicable, exception)
			}
		}
	}
	if err = ConfirmDecision(report, applicable); err != nil {
		return nil, err
	}
	return out, nil
}

func loadRoadmapCommitmentDependencies(ctx context.Context, tx *sql.Tx, code string, cycleID, itemID int64) ([]RoadmapCommitmentDependency, error) {
	rows, err := tx.QueryContext(ctx, `SELECT p.biz_id,p.revision,p.lifecycle,COALESCE(ci.selection_status,'candidate'),ci.decision_rank FROM product_planning_dependencies d JOIN product_planning_items p ON p.id=d.predecessor_id AND p.product_code=d.product_code LEFT JOIN product_planning_cycle_items ci ON ci.planning_item_id=p.id AND ci.product_code=p.product_code AND ci.cycle_id=? WHERE d.planning_item_id=? AND BINARY d.product_code=BINARY ? ORDER BY p.id`, cycleID, itemID, code)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RoadmapCommitmentDependency{}
	for rows.Next() {
		var p RoadmapCommitmentDependency
		if err = rows.Scan(&p.BizID, &p.Revision, &p.Lifecycle, &p.SelectionStatus, &p.DecisionRank); err != nil {
			return nil, err
		}
		out = append(out, p)

	}
	if err = rows.Err(); err != nil {
		return nil, err
	}

	return out, nil
}
