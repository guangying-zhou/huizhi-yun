package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLPlanningSelectionAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-SELECT")
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-SELECT", "pm", action)
		p.Resource = "product_priorities"
		return p
	}
	itemID := planningFixture(t, db, "P-SELECT")
	draft := assessmentDraft()
	if err := db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, itemID).Scan(&draft.ItemBizID); err != nil {
		t.Fatal(err)
	}
	result, err := CreatePlanningCycle(ctx, db, CommandIdentity{ProductCode: "P-SELECT", ActorUID: "pm", Action: "product_priorities:cycle-create", IdempotencyKey: "cycle"}, permit("edit"), PlanningCycleDraft{ExpectedRevision: 1, Title: "选入测试", StartsOn: "2099-01-01", EndsOn: "2099-01-31", GoalSummary: "目标", ReviewIntervalDays: 14})
	if err != nil {
		t.Fatal(err)
	}
	var cycle struct {
		BizID string `json:"biz_id"`
	}
	if err = json.Unmarshal(result.Value, &cycle); err != nil {
		t.Fatal(err)
	}
	draft.CycleBizID = cycle.BizID
	draft.ExpectedRevision = 2
	draft.ExpectedCycleRevision = 1
	draft.ExpectedItemRevision = 1
	if _, err = AddPlanningCycleCandidate(ctx, db, CommandIdentity{ProductCode: "P-SELECT", ActorUID: "pm", Action: "product_priorities:candidate-add", IdempotencyKey: "candidate"}, permit("edit"), draft.PlanningCycleCandidateAdd); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE product_planning_cycles SET status='open',total_person_days=10,reserve_person_days=1,reliability_person_days=3,usability_person_days=3,growth_person_days=3 WHERE biz_id=?`, cycle.BizID); err != nil {
		t.Fatal(err)
	}
	draft.ExpectedRevision = 3
	draft.ExpectedCycleRevision = 2
	if _, err = CreatePlanningAssessment(ctx, db, CommandIdentity{ProductCode: "P-SELECT", ActorUID: "pm", Action: "product_priorities:assess", IdempotencyKey: "assess"}, permit("assess"), draft); err != nil {
		t.Fatal(err)
	}
	detail, err := ReadPlanningCycle(ctx, db, "P-SELECT", "pm", cycle.BizID, permit("view"))
	if err != nil {
		t.Fatal(err)
	}
	input := PlanningSelection{PlanningCycleCandidateAdd: PlanningCycleCandidateAdd{CycleBizID: cycle.BizID, ItemBizID: draft.ItemBizID, ExpectedRevision: detail.WorkspaceRevision, ExpectedCycleRevision: detail.Revision, ExpectedItemRevision: 1}, ExpectedQueueRevision: detail.QueueRevision, Reason: "确认本期建设", Exceptions: []DecisionException{}}
	if err = db.QueryRow(`SELECT current_assessment_id FROM product_planning_cycle_items WHERE planning_item_id=?`, itemID).Scan(&input.ExpectedAssessmentID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`CREATE TRIGGER pc_no_preview_write BEFORE UPDATE ON product_planning_cycle_items FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='preview must not write'`); err != nil {
		t.Fatal(err)
	}
	preview, err := PreviewPlanningSelection(ctx, db, "P-SELECT", "pm", permit("view"), input)
	if err != nil || preview.CanConfirm || preview.Blocker == nil || preview.Before.Confirmed.SelectedEffort != 0 || preview.After.Latest.SelectedEffort != 800 || preview.QueueRevision != input.ExpectedQueueRevision {
		t.Fatalf("selection preview %+v %v", preview, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_no_preview_write`); err != nil {
		t.Fatal(err)
	}
	wrongPreview := permit("view")
	wrongPreview.Resource = "product_requests"
	if _, err = PreviewPlanningSelection(ctx, db, "P-SELECT", "pm", wrongPreview, input); err == nil {
		t.Fatal("wrong resource preview authorized")
	}

	identity := CommandIdentity{ProductCode: "P-SELECT", ActorUID: "pm", Action: "product_priorities:select", IdempotencyKey: "select"}
	_, err = SelectPlanningCandidate(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	stale := input
	stale.ExpectedQueueRevision++
	_, err = SelectPlanningCandidate(ctx, db, identity, permit("prioritize"), stale)
	requireProductRule(t, err, "priority_queue_conflict")
	_, err = SelectPlanningCandidate(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "decision_issues_unresolved")
	assertUnselected := func() {
		t.Helper()
		var status string
		var snapshot []byte
		if e := db.QueryRow(`SELECT selection_status,decision_snapshot FROM product_planning_cycle_items WHERE planning_item_id=?`, itemID).Scan(&status, &snapshot); e != nil || status != "candidate" || snapshot != nil {
			t.Fatalf("selection leaked %s %s %v", status, snapshot, e)
		}
	}
	assertUnselected()
	input.Exceptions = []DecisionException{{Code: "category_capacity_exceeded", Category: Growth, Reason: "本期明确调整投入取舍", ResponsibleUID: "pm", Impact: "增长类别超过原预算 5 人日，保留风险"}}
	approvedPreview, err := PreviewPlanningSelection(ctx, db, "P-SELECT", "pm", permit("view"), input)
	if err != nil || !approvedPreview.CanConfirm || approvedPreview.Blocker != nil || approvedPreview.After.Latest.SelectedEffort != 800 {
		t.Fatalf("exception preview %+v %v", approvedPreview, err)
	}
	assertUnselected()

	predecessorID := planningFixture(t, db, "P-SELECT")
	if _, err = db.Exec(`INSERT INTO product_planning_dependencies(product_code,planning_item_id,predecessor_id,created_by,created_at) VALUES ('P-SELECT',?,?,'pm',UTC_TIMESTAMP(3))`, itemID, predecessorID); err != nil {
		t.Fatal(err)
	}
	_, err = SelectPlanningCandidate(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "decision_issues_unresolved")
	assertUnselected()
	if _, err = db.Exec(`DELETE FROM product_planning_dependencies WHERE planning_item_id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE product_planning_items SET evidence_revision=evidence_revision+1 WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	_, err = SelectPlanningCandidate(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "assessment_required")
	assertUnselected()
	if _, err = db.Exec(`UPDATE product_planning_items SET evidence_revision=evidence_revision-1 WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}

	if _, err = db.Exec(`CREATE TRIGGER pc_fail_select BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = SelectPlanningCandidate(ctx, db, identity, permit("prioritize"), input); err == nil {
		t.Fatal("audit failure committed selection")
	}
	assertUnselected()
	if _, err = db.Exec(`DROP TRIGGER pc_fail_select`); err != nil {
		t.Fatal(err)
	}
	selected, err := SelectPlanningCandidate(ctx, db, identity, permit("prioritize"), input)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := SelectPlanningCandidate(ctx, db, identity, permit("prioritize"), input)
	if err != nil || !replay.Replayed || replay.ReceiptID != selected.ReceiptID {
		t.Fatalf("selection replay %+v %v", replay, err)
	}
	capacity, err := ReadPlanningCapacity(ctx, db, "P-SELECT", "pm", cycle.BizID, permit("view"))
	if err != nil || capacity.Confirmed.SelectedEffort != 800 || capacity.Latest.SelectedEffort != 800 || capacity.WorkspaceRevision != input.ExpectedRevision+1 || capacity.QueueRevision != input.ExpectedQueueRevision+1 {
		t.Fatalf("selected capacity %+v %v", capacity, err)
	}
	workspaceFixture(t, db, "P-CROSS-PREDECESSOR")
	crossID := planningFixture(t, db, "P-CROSS-PREDECESSOR")
	if _, err = db.Exec(`INSERT INTO product_cross_dependencies(biz_id,product_code,planning_item_id,predecessor_product_code,predecessor_id,reason,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-SELECT',?,'P-CROSS-PREDECESSOR',?,'共享能力','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, itemID, crossID); err != nil {
		t.Fatal(err)
	}
	crossCapacity, err := ReadPlanningCapacity(ctx, db, "P-SELECT", "pm", cycle.BizID, permit("view"))
	if err != nil {
		t.Fatal(err)
	}
	foundCross := false
	for _, issue := range crossCapacity.Latest.Issues {
		if issue.Code == "cross_dependency_unresolved" {
			foundCross = true
			if issue.ItemID != draft.ItemBizID || issue.PredecessorID != "" {
				t.Fatalf("cross issue leaked endpoint %+v", issue)
			}
		}
	}
	if !foundCross {
		t.Fatal("cross dependency missing from capacity")
	}
	if _, err = db.Exec(`UPDATE product_planning_items SET lifecycle='delivered' WHERE id=?`, crossID); err != nil {
		t.Fatal(err)
	}
	crossCapacity, err = ReadPlanningCapacity(ctx, db, "P-SELECT", "pm", cycle.BizID, permit("view"))
	if err != nil {
		t.Fatal(err)
	}
	for _, issue := range crossCapacity.Latest.Issues {
		if issue.Code == "cross_dependency_unresolved" {
			t.Fatal("delivered cross dependency unresolved")
		}
	}
	if _, err = db.Exec(`DELETE FROM product_cross_dependencies WHERE planning_item_id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	var snapshot []byte
	if err = db.QueryRow(`SELECT decision_snapshot FROM product_planning_cycle_items WHERE planning_item_id=?`, itemID).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	baseline, err := decodePlanningCapacityBaseline(snapshot, draft.ItemBizID)
	if err != nil || baseline.Effort == nil || *baseline.Effort != 800 {
		t.Fatalf("frozen decision %+v %v", baseline, err)
	}
	gateInput := PlanningDeliveryCheck{ItemBizID: draft.ItemBizID, CycleBizID: cycle.BizID, ExpectedRevision: capacity.WorkspaceRevision, ExpectedItemRevision: 1, ExpectedCycleRevision: capacity.CycleRevision, ExpectedQueueRevision: capacity.QueueRevision}
	checkGate := func() (PlanningDeliveryBasis, error) {
		t.Helper()
		p := permit("handoff")
		tx, e := db.BeginTx(ctx, nil)
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback()
		if e = AuthorizeWorkspaceTransaction(ctx, tx, "P-SELECT", "pm", "product_priorities", "handoff", p); e != nil {
			t.Fatal(e)
		}
		return ValidatePlanningDeliveryTx(ctx, tx, "P-SELECT", gateInput)
	}
	basis, err := checkGate()
	if err != nil || basis.ItemID != itemID || basis.ScopeRevision != 1 || len(basis.Decision) == 0 {
		t.Fatalf("delivery basis: %+v %v", basis, err)
	}
	if _, err = db.Exec(`UPDATE product_planning_items SET lifecycle='proposed' WHERE id=?`, crossID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_cross_dependencies(biz_id,product_code,planning_item_id,predecessor_product_code,predecessor_id,reason,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-SELECT',?,'P-CROSS-PREDECESSOR',?,'共享能力','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, itemID, crossID); err != nil {
		t.Fatal(err)
	}
	_, err = checkGate()
	requireProductRule(t, err, "decision_issues_unresolved")
	if _, err = db.Exec(`UPDATE product_planning_items SET lifecycle='delivered' WHERE id=?`, crossID); err != nil {
		t.Fatal(err)
	}
	if _, err = checkGate(); err != nil {
		t.Fatalf("delivered cross predecessor rejected: %v", err)
	}
	if _, err = db.Exec(`DELETE FROM product_cross_dependencies WHERE planning_item_id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	// A predecessor may change after selection without changing the selected
	// item's assessment. Every new delivery arrangement must recheck it.
	if _, err = db.Exec(`INSERT INTO product_planning_dependencies(product_code,planning_item_id,predecessor_id,created_by,created_at) VALUES ('P-SELECT',?,?,'pm',UTC_TIMESTAMP(3))`, itemID, predecessorID); err != nil {
		t.Fatal(err)
	}
	_, err = checkGate()
	requireProductRule(t, err, "decision_issues_unresolved")
	if _, err = db.Exec(`UPDATE product_planning_items SET lifecycle='delivered' WHERE id=?`, predecessorID); err != nil {
		t.Fatal(err)
	}
	if _, err = checkGate(); err != nil {
		t.Fatalf("delivered predecessor rejected: %v", err)
	}
	if _, err = db.Exec(`UPDATE product_planning_items SET lifecycle='cancelled' WHERE id=?`, predecessorID); err != nil {
		t.Fatal(err)
	}
	_, err = checkGate()
	requireProductRule(t, err, "decision_issues_unresolved")
	if _, err = db.Exec(`DELETE FROM product_planning_dependencies WHERE planning_item_id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ name, change, restore, rule string }{
		{"unselected", "UPDATE product_planning_cycle_items SET selection_status='candidate'", "UPDATE product_planning_cycle_items SET selection_status='selected'", "planning_delivery_selection_required"},
		{"closed", "UPDATE product_planning_cycles SET status='closed'", "UPDATE product_planning_cycles SET status='open'", "planning_cycle_readonly"},
		{"scope", "UPDATE product_planning_items SET scope_revision=2", "UPDATE product_planning_items SET scope_revision=1", "planning_decision_changed"},
		{"evidence", "UPDATE product_planning_items SET evidence_revision=2", "UPDATE product_planning_items SET evidence_revision=1", "planning_decision_changed"},
		{"finished", "UPDATE product_planning_items SET lifecycle='delivered'", "UPDATE product_planning_items SET lifecycle='proposed'", "product_planning_readonly"},
	} {
		t.Run("delivery_"+tc.name, func(t *testing.T) {
			if _, e := db.Exec(tc.change); e != nil {
				t.Fatal(e)
			}
			_, e := checkGate()
			requireProductRule(t, e, tc.rule)
			if _, e := db.Exec(tc.restore); e != nil {
				t.Fatal(e)
			}
		})
	}
	gateInput.ExpectedQueueRevision++
	_, err = checkGate()
	requireProductRule(t, err, "priority_queue_conflict")
	gateInput.ExpectedQueueRevision--
	gateInput = exerciseHandoffTransaction(t, db, gateInput)
	gateInput = exerciseVersionScopeTransaction(t, db, gateInput)
	draft.ExpectedItemRevision = gateInput.ExpectedItemRevision
	// New estimates are appended through the real command; immutable evidence
	// must never be overwritten to simulate a change.
	draft.ExpectedRevision = gateInput.ExpectedRevision
	draft.ExpectedCycleRevision = gateInput.ExpectedCycleRevision
	newEffort := Hundredths(900)
	draft.Assessment.Effort = &newEffort
	if _, err = CreatePlanningAssessment(ctx, db, CommandIdentity{ProductCode: "P-SELECT", ActorUID: "pm", Action: "product_priorities:assess", IdempotencyKey: "reestimate"}, permit("assess"), draft); err != nil {
		t.Fatal(err)
	}
	gateInput.ExpectedRevision++
	gateInput.ExpectedCycleRevision++
	_, err = checkGate()
	requireProductRule(t, err, "planning_decision_changed")
	_, err = SelectPlanningCandidate(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_authorization_invalid")
}
