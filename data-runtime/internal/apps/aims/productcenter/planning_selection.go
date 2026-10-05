package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"strings"
	"unicode/utf8"
)

// PlanningSelection selects one existing candidate without replacing a page of
// the queue. Reassessment of already committed scope is a separate change flow.
type PlanningSelection struct {
	PlanningCycleCandidateAdd
	ExpectedQueueRevision uint64              `json:"expected_queue_revision"`
	ExpectedAssessmentID  int64               `json:"expected_assessment_id"`
	Reason                string              `json:"reason"`
	Exceptions            []DecisionException `json:"exceptions"`
}

func ValidatePlanningSelection(input PlanningSelection) error {
	if err := ValidatePlanningCycleCandidateAdd(input.PlanningCycleCandidateAdd); err != nil {
		return err
	}
	if input.ExpectedQueueRevision == 0 || input.ExpectedAssessmentID < 1 {
		return invalid("planning_selection_input_invalid", "必须提供队列版本和本次确认的评估标识")
	}
	if strings.TrimSpace(input.Reason) == "" || !utf8.ValidString(input.Reason) || strings.ContainsRune(input.Reason, '\x00') || utf8.RuneCountInString(input.Reason) > 2000 {
		return invalid("priority_reason_required", "选入周期须填写理由，最多 2000 字")
	}
	return ValidateDecisionExceptions(input.Exceptions)
}

func ValidateDecisionExceptions(exceptions []DecisionException) error {
	if exceptions == nil || len(exceptions) > 100 {
		return invalid("decision_exception_invalid", "必须明确例外清单，最多 100 项")
	}
	seen := map[DecisionIssue]bool{}
	canonicalID := func(value string) bool { id, err := uuid.Parse(value); return err == nil && id.String() == value }
	for _, exception := range exceptions {
		issue := DecisionIssue{Code: exception.Code, ItemID: exception.ItemID, PredecessorID: exception.PredecessorID, Category: exception.Category}
		valid := false
		switch exception.Code {
		case "capacity_exceeded":
			valid = exception.ItemID == "" && exception.PredecessorID == "" && exception.Category == ""
		case "category_capacity_exceeded":
			valid = ValidInvestmentCategory(exception.Category) && exception.ItemID == "" && exception.PredecessorID == ""
		case "effort_required":
			valid = canonicalID(exception.ItemID) && exception.PredecessorID == "" && exception.Category == ""
		case "dependency_unresolved":
			valid = canonicalID(exception.ItemID) && canonicalID(exception.PredecessorID) && exception.ItemID != exception.PredecessorID && exception.Category == ""
		}
		if !valid || seen[issue] {
			return invalid("decision_exception_invalid", "例外必须对应唯一且有效的问题类型与对象")
		}
		seen[issue] = true
		if exception.ResponsibleUID != strings.TrimSpace(exception.ResponsibleUID) || utf8.RuneCountInString(exception.ResponsibleUID) > 64 {
			return invalid("decision_exception_invalid", "例外责任人标识无效")
		}

		for _, value := range []string{exception.Reason, exception.Impact, exception.ResponsibleUID} {
			if strings.TrimSpace(value) == "" || !utf8.ValidString(value) || strings.ContainsRune(value, '\x00') || utf8.RuneCountInString(value) > 2000 {
				return invalid("decision_exception_invalid", "例外原因、责任人与影响须有效且不超过 2000 字")
			}
		}
	}
	return nil
}

func SelectPlanningCandidate(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input PlanningSelection) (CommandResult, error) {
	if identity.Action != "product_priorities:select" {
		return CommandResult{}, invalid("product_command_identity_invalid", "周期选择命令不匹配")
	}
	if err := ValidatePlanningSelection(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "prioritize", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		prepared, err := preparePlanningSelection(ctx, tx, identity.ProductCode, input)
		if err != nil {
			return nil, err
		}
		if len(prepared.Before.Changes) > 0 {
			return nil, invalid("planning_decision_changed", "已有决定的投入或类别已变化，请先确认变更")
		}
		if err = ConfirmDecision(prepared.After.Latest, input.Exceptions); err != nil {
			return nil, err
		}
		cycle := prepared.Cycle
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_cycle_items SET selection_status='selected',roadmap_bucket='now',decision_snapshot=?,decided_by=?,decision_reason=?,decided_at=UTC_TIMESTAMP(3) WHERE cycle_id=? AND planning_item_id=? AND product_code=?`, prepared.Snapshot, identity.ActorUID, input.Reason, cycle.ID, prepared.ItemID, identity.ProductCode); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_cycles SET revision=revision+1,queue_revision=queue_revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, identity.ActorUID, cycle.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"cycle_biz_id": cycle.BizID, "item_biz_id": input.ItemBizID, "workspace_revision": prepared.RootRevision + 1, "cycle_revision": cycle.Revision + 1, "queue_revision": cycle.QueueRevision + 1, "selection_status": "selected", "roadmap_bucket": "now", "capacity": prepared.After}
		changes, err := json.Marshal(map[string]any{"before_selection_status": prepared.PreviousSelection, "after": out, "snapshot": prepared.Snapshot, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'planning_cycle',?,'select',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, cycle.BizID, identity.ActorUID, cycle.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}

type preparedSelection struct {
	RootRevision      uint64
	Cycle             PlanningCycleRecord
	ItemID            int64
	PreviousSelection string
	Snapshot          json.RawMessage
	Before            CapacityComparison
	After             CapacityComparison
}

// preparePlanningSelection only reads within the caller's authorized root lock.
// Both preview and commit project the same single-item change in memory.
func preparePlanningSelection(ctx context.Context, tx *sql.Tx, code string, input PlanningSelection) (preparedSelection, error) {
	root, err := loadWorkspace(ctx, tx, code)
	if err != nil {
		return preparedSelection{}, err
	}
	if root.Status != "active" {
		return preparedSelection{}, invalid("product_archived", "产品已归档")
	}
	if root.Revision != input.ExpectedRevision {
		return preparedSelection{}, invalid("product_revision_conflict", "产品已变化，请刷新")
	}
	cycle, err := loadPlanningCycle(ctx, tx, code, input.CycleBizID)
	if err != nil {
		return preparedSelection{}, err
	}
	if cycle.Status != "open" {
		return preparedSelection{}, invalid("planning_cycle_readonly", "仅开放周期允许选择")
	}
	if cycle.Revision != input.ExpectedCycleRevision {
		return preparedSelection{}, invalid("planning_cycle_revision_conflict", "周期已变化，请刷新")
	}
	if cycle.QueueRevision != input.ExpectedQueueRevision {
		return preparedSelection{}, invalid("priority_queue_conflict", "队列已变化，请刷新")
	}
	if cycle.Budget == nil {
		return preparedSelection{}, invalid("planning_capacity_missing", "请先填写容量")
	}
	if err = cycle.Budget.Validate(); err != nil {
		return preparedSelection{}, err
	}
	var itemID, assessmentID int64
	var itemRevision, scopeRevision, evidenceRevision uint64
	var category InvestmentCategory
	var lifecycle, selection string
	var current bool
	var effort sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT i.id,i.revision,i.scope_revision,i.evidence_revision,i.investment_category,i.lifecycle,ci.selection_status,COALESCE(ci.current_assessment_id,0),a.effort_person_days,
  COALESCE(a.priority_score IS NOT NULL AND a.scope_revision=i.scope_revision AND a.evidence_revision=i.evidence_revision AND a.model_version=?,0)
  FROM product_planning_items i JOIN product_planning_cycle_items ci ON ci.planning_item_id=i.id AND ci.product_code=i.product_code AND ci.cycle_id=?
  LEFT JOIN product_priority_assessments a ON a.id=ci.current_assessment_id AND a.cycle_id=ci.cycle_id AND a.planning_item_id=i.id WHERE i.product_code=? AND i.biz_id=?`, cycle.ModelVersion, cycle.ID, code, input.ItemBizID).Scan(&itemID, &itemRevision, &scopeRevision, &evidenceRevision, &category, &lifecycle, &selection, &assessmentID, &effort, &current)
	if err != nil {
		return preparedSelection{}, err
	}
	if itemRevision != input.ExpectedItemRevision {
		return preparedSelection{}, invalid("product_planning_revision_conflict", "事项已变化，请刷新")
	}
	if selection == "selected" {
		return preparedSelection{}, invalid("planning_selection_already_selected", "事项已选入，重新确认须走范围变更流程")
	}
	if lifecycle != "proposed" {
		return preparedSelection{}, invalid("product_planning_readonly", "已开始或结束的事项须通过继续或变更决定处理")
	}
	if assessmentID != input.ExpectedAssessmentID || !current {
		return preparedSelection{}, invalid("assessment_required", "评估已变化或不完整，请重新确认")
	}
	baseline := PlanningCapacityBaseline{Version: 1, ItemBizID: input.ItemBizID, Category: category}
	if effort.Valid {
		value, e := ParseHundredths(effort.String)
		if e != nil {
			return preparedSelection{}, e
		}
		baseline.Effort = &value
	}
	snapshot, err := json.Marshal(map[string]any{"capacity": baseline, "assessment_id": assessmentID, "scope_revision": scopeRevision, "evidence_revision": evidenceRevision, "model_version": cycle.ModelVersion, "exceptions": input.Exceptions})
	if err != nil {
		return preparedSelection{}, err
	}
	items, latest, err := loadPlanningCapacityItems(ctx, tx, code, cycle)
	if err != nil {
		return preparedSelection{}, err
	}
	b := cycle.Budget
	capacity := Capacity{Total: *b.Total, Reserve: *b.Reserve, Categories: map[InvestmentCategory]Hundredths{Reliability: *b.Reliability, Usability: *b.Usability, Growth: *b.Growth}}
	before, err := CompareDecisionCapacity(capacity, items, latest)
	if err != nil {
		return preparedSelection{}, err
	}
	for i := range items {
		if items[i].ID == input.ItemBizID {
			items[i].Selected = true
			items[i].Category = category
			items[i].Effort = baseline.Effort
			items[i].AssessmentCurrent = true
			latest[input.ItemBizID] = LatestCapacityEstimate{Category: category, Effort: baseline.Effort}
		}
	}
	after, err := CompareDecisionCapacity(capacity, items, latest)
	if err != nil {
		return preparedSelection{}, err
	}
	return preparedSelection{RootRevision: root.Revision, Cycle: cycle, ItemID: itemID, PreviousSelection: selection, Snapshot: snapshot, Before: before, After: after}, nil
}
