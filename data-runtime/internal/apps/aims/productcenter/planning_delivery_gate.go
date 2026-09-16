package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/google/uuid"
)

// PlanningDeliveryCheck binds a new delivery arrangement to the revisions the
// user reviewed. It is shared by project handoff and version-scope commands.
type PlanningDeliveryCheck struct {
	ItemBizID             string `json:"item_biz_id"`
	CycleBizID            string `json:"cycle_biz_id"`
	ExpectedRevision      uint64 `json:"expected_revision"`
	ExpectedItemRevision  uint64 `json:"expected_item_revision"`
	ExpectedCycleRevision uint64 `json:"expected_cycle_revision"`
	ExpectedQueueRevision uint64 `json:"expected_queue_revision"`
}

type PlanningDeliveryBasis struct {
	ItemID           int64           `json:"item_id"`
	ItemBizID        string          `json:"item_biz_id"`
	CycleBizID       string          `json:"cycle_biz_id"`
	ScopeRevision    uint64          `json:"scope_revision"`
	EvidenceRevision uint64          `json:"evidence_revision"`
	Decision         json.RawMessage `json:"decision"`
}

// ValidatePlanningDeliveryTx must run after the caller obtains fresh action
// authorization and the product root lock, in the same transaction as writes.
// It validates a selected decision; it grants no product or project permission.
func ValidatePlanningDeliveryTx(ctx context.Context, tx *sql.Tx, code string, input PlanningDeliveryCheck) (PlanningDeliveryBasis, error) {
	var out PlanningDeliveryBasis
	if err := ValidatePlanningDeliveryCheck(input); err != nil {
		return out, err
	}
	root, err := loadWorkspace(ctx, tx, code)
	if err != nil {
		return out, err
	}
	if root.Status != "active" {
		return out, invalid("product_archived", "产品已归档")
	}
	if root.Revision != input.ExpectedRevision {
		return out, invalid("product_revision_conflict", "产品已变化，请刷新")
	}
	cycle, err := loadPlanningCycle(ctx, tx, code, input.CycleBizID)
	if err != nil {
		return out, err
	}
	if cycle.Status != "open" {
		return out, invalid("planning_cycle_readonly", "新交付安排需要开放周期的有效决定")
	}
	if cycle.Revision != input.ExpectedCycleRevision {
		return out, invalid("planning_cycle_revision_conflict", "周期已变化，请刷新")
	}
	if cycle.QueueRevision != input.ExpectedQueueRevision {
		return out, invalid("priority_queue_conflict", "队列已变化，请刷新")
	}
	var revision uint64
	var lifecycle, selection string
	var category InvestmentCategory
	var decision []byte
	var current bool
	var effort sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT i.id,i.revision,i.scope_revision,i.evidence_revision,i.lifecycle,i.investment_category,ci.selection_status,ci.decision_snapshot,a.effort_person_days,
 COALESCE(a.priority_score IS NOT NULL AND a.scope_revision=i.scope_revision AND a.evidence_revision=i.evidence_revision AND a.model_version=?,0)
 FROM product_planning_items i JOIN product_planning_cycle_items ci ON ci.product_code=i.product_code AND ci.planning_item_id=i.id AND ci.cycle_id=?
 LEFT JOIN product_priority_assessments a ON a.id=ci.current_assessment_id AND a.planning_item_id=i.id AND a.cycle_id=ci.cycle_id
 WHERE i.product_code=? AND i.biz_id=?`, cycle.ModelVersion, cycle.ID, code, input.ItemBizID).Scan(&out.ItemID, &revision, &out.ScopeRevision, &out.EvidenceRevision, &lifecycle, &category, &selection, &decision, &effort, &current)
	if err != nil {
		return out, err
	}
	if revision != input.ExpectedItemRevision {
		return out, invalid("product_planning_revision_conflict", "事项已变化，请刷新")
	}
	if lifecycle != "proposed" && lifecycle != "in_delivery" {
		return out, invalid("product_planning_readonly", "已结束事项不能新增交付安排")
	}
	if selection != "selected" {
		return out, invalid("planning_delivery_selection_required", "请先正式选入当前周期")
	}
	baseline, err := decodePlanningCapacityBaseline(decision, input.ItemBizID)
	if err != nil {
		return out, err
	}
	var frozen struct {
		ScopeRevision    uint64 `json:"scope_revision"`
		EvidenceRevision uint64 `json:"evidence_revision"`
		ModelVersion     string `json:"model_version"`
		AssessmentID     int64  `json:"assessment_id"`
	}
	if json.Unmarshal(decision, &frozen) != nil || frozen.ScopeRevision == 0 || frozen.EvidenceRevision == 0 || frozen.AssessmentID <= 0 || frozen.ModelVersion == "" {
		return out, invalid("planning_decision_snapshot_invalid", "交付安排缺少完整决定依据")
	}
	if !current || frozen.ScopeRevision != out.ScopeRevision || frozen.EvidenceRevision != out.EvidenceRevision || frozen.ModelVersion != cycle.ModelVersion || baseline.Category != category {
		return out, invalid("planning_decision_changed", "范围、证据或评估已变化，请先重新确认决定")
	}
	var latest *Hundredths
	if effort.Valid {
		value, e := ParseHundredths(effort.String)
		if e != nil {
			return out, e
		}
		latest = &value
	}
	if (latest == nil) != (baseline.Effort == nil) || (latest != nil && *latest != *baseline.Effort) {
		return out, invalid("planning_decision_changed", "投入已变化，请先重新确认决定")
	}
	// Recheck current dependencies: a valid assessment alone does not preserve
	// the predecessor state or ordering reviewed at selection time.
	if _, err = roadmapCommitmentDependencies(ctx, tx, code, cycle.ID, out.ItemID, input.ItemBizID, decision); err != nil {
		return out, err
	}
	out.ItemBizID, out.CycleBizID, out.Decision = input.ItemBizID, input.CycleBizID, json.RawMessage(decision)
	return out, nil
}

func ValidatePlanningDeliveryCheck(input PlanningDeliveryCheck) error {
	for _, value := range []string{input.ItemBizID, input.CycleBizID} {
		id, err := uuid.Parse(value)
		if err != nil || id.String() != value {
			return invalid("planning_delivery_input_invalid", "规划事项或周期标识无效")
		}
	}
	if input.ExpectedRevision == 0 || input.ExpectedItemRevision == 0 || input.ExpectedCycleRevision == 0 || input.ExpectedQueueRevision == 0 {
		return invalid("planning_delivery_input_invalid", "交付安排需要完整版本信息")
	}
	return nil
}
