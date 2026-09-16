package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
)

// PlanningCapacityBaseline is the capacity part of a persisted decision snapshot.
// It is written by the decision command, never accepted as a browser estimate.
type PlanningCapacityBaseline struct {
	Version   int                `json:"version"`
	ItemBizID string             `json:"item_biz_id"`
	Category  InvestmentCategory `json:"investment_category"`
	Effort    *Hundredths        `json:"effort_person_days"`
}

type PlanningCapacityView struct {
	Budget            PlanningCycleBudget `json:"budget"`
	CycleBizID        string              `json:"cycle_biz_id"`
	WorkspaceRevision uint64              `json:"workspace_revision"`
	CycleRevision     uint64              `json:"cycle_revision"`
	QueueRevision     uint64              `json:"queue_revision"`
	CapacityComparison
}

func ReadPlanningCapacity(ctx context.Context, db *sql.DB, code, uid, cycleID string, permit AuthorizationPermit) (PlanningCapacityView, error) {
	var out PlanningCapacityView
	id, err := uuid.Parse(cycleID)
	if err != nil || id.String() != cycleID {
		return out, invalid("planning_cycle_id_invalid", "周期标识无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", permit); err != nil {
		return out, err
	}
	cycle, err := loadPlanningCycle(ctx, tx, code, cycleID)
	if err != nil {
		return out, err
	}
	if cycle.Budget == nil {
		return out, invalid("planning_capacity_missing", "周期预算尚未填写")
	}
	if err = cycle.Budget.Validate(); err != nil {
		return out, err
	}
	items, latest, err := loadPlanningCapacityItems(ctx, tx, code, cycle)
	if err != nil {
		return out, err
	}
	b := cycle.Budget
	comparison, err := CompareDecisionCapacity(Capacity{Total: *b.Total, Reserve: *b.Reserve, Categories: map[InvestmentCategory]Hundredths{Reliability: *b.Reliability, Usability: *b.Usability, Growth: *b.Growth}}, items, latest)
	if err != nil {
		return out, err
	}
	out = PlanningCapacityView{Budget: *cycle.Budget, CycleBizID: cycleID, WorkspaceRevision: permit.Facts.Revision, CycleRevision: cycle.Revision, QueueRevision: cycle.QueueRevision, CapacityComparison: comparison}
	return out, tx.Commit()
}

// Load the complete product graph so predecessors outside the cycle are checked
// without treating them as selected. Refuse oversized data rather than summarize
// a truncated page. The caller holds the authorized product root lock.
func loadPlanningCapacityItems(ctx context.Context, tx *sql.Tx, code string, cycle PlanningCycleRecord) ([]DecisionItem, map[string]LatestCapacityEstimate, error) {
	rows, err := tx.QueryContext(ctx, `SELECT i.biz_id,i.investment_category,i.lifecycle,COALESCE(ci.selection_status,'candidate'),ci.decision_snapshot,a.effort_person_days,
 COALESCE(a.priority_score IS NOT NULL AND a.scope_revision=i.scope_revision AND a.evidence_revision=i.evidence_revision AND a.model_version=?,0),
 EXISTS(SELECT 1 FROM product_cross_dependencies d JOIN product_planning_items p ON p.id=d.predecessor_id AND p.product_code=d.predecessor_product_code WHERE d.planning_item_id=i.id AND d.product_code=i.product_code AND p.lifecycle<>'delivered')
 FROM product_planning_items i
 LEFT JOIN product_planning_cycle_items ci ON ci.planning_item_id=i.id AND ci.product_code=i.product_code AND ci.cycle_id=?
 LEFT JOIN product_priority_assessments a ON a.id=ci.current_assessment_id AND a.planning_item_id=i.id AND a.cycle_id=ci.cycle_id
 WHERE i.product_code=? ORDER BY ci.decision_rank IS NULL,ci.decision_rank,i.id LIMIT 10001`, cycle.ModelVersion, cycle.ID, code)
	if err != nil {
		return nil, nil, err
	}
	items := []DecisionItem{}
	latest := map[string]LatestCapacityEstimate{}
	positions := map[string]int{}
	for rows.Next() {
		var item DecisionItem
		var lifecycle, selection string
		var snapshot []byte
		var effort sql.NullString
		if err = rows.Scan(&item.ID, &item.Category, &lifecycle, &selection, &snapshot, &effort, &item.AssessmentCurrent, &item.CrossDependencyUnresolved); err != nil {
			rows.Close()
			return nil, nil, err
		}
		item.Selected, item.Delivered = selection == "selected", lifecycle == "delivered"
		if item.Selected {
			baseline, decodeErr := decodePlanningCapacityBaseline(snapshot, item.ID)
			if decodeErr != nil {
				rows.Close()
				return nil, nil, decodeErr
			}
			currentCategory := item.Category
			item.AssessmentCurrent = item.AssessmentCurrent && item.Category == baseline.Category
			item.Category, item.Effort = baseline.Category, baseline.Effort
			if !item.Delivered {
				latest[item.ID] = LatestCapacityEstimate{Category: currentCategory}
				if effort.Valid {
					value, parseErr := ParseHundredths(effort.String)
					if parseErr != nil {
						rows.Close()
						return nil, nil, parseErr
					}
					latest[item.ID] = LatestCapacityEstimate{Category: currentCategory, Effort: &value}
				}
			}
		}
		retained, decodeErr := decodePlanningRetainedConsumption(snapshot, cycle.BizID, item.ID, selection)
		if decodeErr != nil {
			rows.Close()
			return nil, nil, decodeErr
		}
		if retained != nil {
			item.Category, item.RetainedEffort = retained.Category, retained.Spent
		}
		positions[item.ID] = len(items)
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, nil, err
	}
	if len(items) > 10000 {
		return nil, nil, invalid("planning_capacity_limit", "产品事项超过容量核算上限，未返回部分汇总")
	}
	deps, err := tx.QueryContext(ctx, `SELECT i.biz_id,p.biz_id FROM product_planning_dependencies d JOIN product_planning_items i ON i.id=d.planning_item_id AND i.product_code=d.product_code JOIN product_planning_items p ON p.id=d.predecessor_id AND p.product_code=d.product_code WHERE d.product_code=? ORDER BY i.id,p.id LIMIT 100001`, code)
	if err != nil {
		return nil, nil, err
	}
	defer deps.Close()
	count := 0
	for deps.Next() {
		var itemID, predecessorID string
		if err = deps.Scan(&itemID, &predecessorID); err != nil {
			return nil, nil, err
		}
		count++
		if count > 100000 {
			return nil, nil, invalid("planning_capacity_limit", "产品依赖超过容量核算上限，未返回部分汇总")
		}
		position, ok := positions[itemID]
		if !ok {
			return nil, nil, invalid("planning_dependency_not_found", "前置关系不在当前产品集合中")
		}
		items[position].Dependencies = append(items[position].Dependencies, predecessorID)
	}
	return items, latest, deps.Err()
}

func decodePlanningCapacityBaseline(raw []byte, itemID string) (PlanningCapacityBaseline, error) {
	var envelope struct {
		Capacity json.RawMessage `json:"capacity"`
	}
	if json.Unmarshal(raw, &envelope) != nil || len(envelope.Capacity) == 0 {
		return PlanningCapacityBaseline{}, invalid("planning_decision_snapshot_invalid", "已选事项缺少有效的容量决定快照")
	}
	// Unknown effort must be explicit null. A missing field is an incomplete
	// persisted decision, not an estimate that may be waived as an exception.
	var fields map[string]json.RawMessage
	var b PlanningCapacityBaseline
	if json.Unmarshal(envelope.Capacity, &fields) != nil || len(fields["effort_person_days"]) == 0 || json.Unmarshal(envelope.Capacity, &b) != nil {
		return PlanningCapacityBaseline{}, invalid("planning_decision_snapshot_invalid", "容量决定快照缺少明确的投入基线")
	}
	if b.Version != 1 || b.ItemBizID != itemID || !ValidInvestmentCategory(b.Category) || (b.Effort != nil && (*b.Effort < 50 || *b.Effort > 100_000_000)) {
		return PlanningCapacityBaseline{}, invalid("planning_decision_snapshot_invalid", "容量决定快照与事项不匹配或格式无效")
	}
	return b, nil
}
