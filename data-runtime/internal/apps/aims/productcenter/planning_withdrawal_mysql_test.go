package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLPlanningWithdrawalAtomicity(t *testing.T) {
	testPlanningWithdrawal(t, false)
}

func TestMySQLPlanningWithdrawalDownstreamDependency(t *testing.T) {
	testPlanningWithdrawal(t, true)
}

func testPlanningWithdrawal(t *testing.T, downstream bool) {
	t.Helper()
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-OPEN")
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-OPEN", "pm", action)
		p.Resource = "product_priorities"
		return p
	}
	zero, total, target := Hundredths(0), Hundredths(1000), "75"
	draft := PlanningCycleDraft{ExpectedRevision: 1, Title: "规划周期", StartsOn: "2099-01-01", EndsOn: "2099-01-31", GoalSummary: "提升成功率", ReviewIntervalDays: 14, Budget: &PlanningCycleBudget{Total: &total, Reserve: &zero, Reliability: &zero, Usability: &total, Growth: &zero}, Metric: &PlanningCycleMetric{Name: "成功率", Unit: "百分比", Direction: "increase", MeasurementMethod: "按用户去重", TargetValue: &target}}
	create := func(key string) string {
		result, err := CreatePlanningCycle(ctx, db, CommandIdentity{ProductCode: "P-OPEN", ActorUID: "pm", Action: "product_priorities:cycle-create", IdempotencyKey: key}, permit("edit"), draft)
		if err != nil {
			t.Fatal(err)
		}
		var value struct {
			BizID string `json:"biz_id"`
		}
		if err = json.Unmarshal(result.Value, &value); err != nil {
			t.Fatal(err)
		}
		return value.BizID
	}
	first := create("first")

	itemID := planningFixture(t, db, "P-OPEN")
	var itemBiz string
	if err := db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, itemID).Scan(&itemBiz); err != nil {
		t.Fatal(err)
	}
	add := PlanningCycleCandidateAdd{CycleBizID: first, ItemBizID: itemBiz, ExpectedRevision: 2, ExpectedCycleRevision: 1, ExpectedItemRevision: 1}
	if _, err := AddPlanningCycleCandidate(ctx, db, CommandIdentity{ProductCode: "P-OPEN", ActorUID: "pm", Action: "product_priorities:candidate-add", IdempotencyKey: "candidate"}, permit("edit"), add); err != nil {
		t.Fatal(err)
	}
	effort := Hundredths(800)
	snapshot, _ := json.Marshal(map[string]any{"capacity": PlanningCapacityBaseline{Version: 1, ItemBizID: itemBiz, Category: Usability, Effort: &effort}})
	if _, err := db.Exec(`UPDATE product_planning_cycles SET status='open' WHERE biz_id=?`, first); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE product_planning_items SET lifecycle='delivered' WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE product_planning_cycle_items SET selection_status='selected',decision_snapshot=? WHERE planning_item_id=?`, snapshot, itemID); err != nil {
		t.Fatal(err)
	}

	input := PlanningWithdrawal{PlanningCycleCandidateAdd: PlanningCycleCandidateAdd{CycleBizID: first, ItemBizID: itemBiz, ExpectedRevision: 3, ExpectedCycleRevision: 2, ExpectedItemRevision: 1}, ExpectedQueueRevision: 2, Reason: "延后未开工范围", ImpactNote: "释放未发生投入，保留历史决定", Exceptions: []DecisionException{}}
	identity := CommandIdentity{ProductCode: "P-OPEN", ActorUID: "pm", Action: "product_priorities:withdraw", IdempotencyKey: "withdraw"}
	_, err := WithdrawPlanningCandidate(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	_, err = WithdrawPlanningCandidate(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "planning_withdrawal_consumption_required")
	if _, err = db.Exec(`UPDATE product_planning_items SET lifecycle='proposed' WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}

	expectedBefore, expectedAfter := Hundredths(800), Hundredths(0)
	if downstream {
		dependentID := planningFixture(t, db, "P-OPEN")
		var dependentBiz string
		if err = db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, dependentID).Scan(&dependentBiz); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(`UPDATE product_planning_items SET investment_category='usability' WHERE id=?`, dependentID); err != nil {
			t.Fatal(err)
		}
		dependentEffort := Hundredths(100)
		dependentSnapshot, _ := json.Marshal(map[string]any{"capacity": PlanningCapacityBaseline{Version: 1, ItemBizID: dependentBiz, Category: Usability, Effort: &dependentEffort}})
		if _, err = db.Exec(`INSERT INTO product_planning_cycle_items(cycle_id,planning_item_id,product_code,selection_status,decision_rank,decision_snapshot)
   SELECT id,?,'P-OPEN','selected',1000000,? FROM product_planning_cycles WHERE biz_id=?`, dependentID, dependentSnapshot, first); err != nil {
			t.Fatal(err)
		}
		assessment, e := db.Exec(`INSERT INTO product_priority_assessments(cycle_id,planning_item_id,scope_revision,evidence_revision,model_version,model_snapshot,strategic,user_value,business,risk,confidence,effort_person_days,value_score,priority_score,evidence_snapshot,rationale,assessed_by,assessed_at)
   SELECT id,?,1,1,model_version,JSON_OBJECT(),1,1,1,1,1.00,1.00,20,20,JSON_OBJECT(),JSON_OBJECT(),'pm',UTC_TIMESTAMP(3) FROM product_planning_cycles WHERE biz_id=?`, dependentID, first)
		if e != nil {
			t.Fatal(e)
		}
		assessmentID, e := assessment.LastInsertId()
		if e != nil {
			t.Fatal(e)
		}
		if _, err = db.Exec(`UPDATE product_planning_cycle_items SET current_assessment_id=? WHERE planning_item_id=?`, assessmentID, dependentID); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(`INSERT INTO product_planning_dependencies(product_code,planning_item_id,predecessor_id,created_by,created_at) VALUES ('P-OPEN',?,?,'pm',UTC_TIMESTAMP(3))`, dependentID, itemID); err != nil {
			t.Fatal(err)
		}
		blocked, e := PreviewPlanningWithdrawal(ctx, db, "P-OPEN", "pm", permit("view"), input)
		if e != nil || blocked.CanConfirm || blocked.Blocker == nil || blocked.Blocker.Code != "decision_issues_unresolved" {
			t.Fatalf("downstream preview %+v %v", blocked, e)
		}
		_, e = WithdrawPlanningCandidate(ctx, db, identity, permit("prioritize"), input)
		requireProductRule(t, e, "decision_issues_unresolved")
		var status string
		if e = db.QueryRow(`SELECT selection_status FROM product_planning_cycle_items WHERE planning_item_id=?`, itemID).Scan(&status); e != nil || status != "selected" {
			t.Fatalf("blocked withdrawal mutated %s %v", status, e)
		}
		input.Exceptions = []DecisionException{{Code: "dependency_unresolved", ItemID: dependentBiz, PredecessorID: itemBiz, Reason: "明确保留下游阻塞", ResponsibleUID: "pm", Impact: "下游交付需另行解除前置条件"}}
		expectedBefore, expectedAfter = 900, 100
	}

	if _, err = db.Exec(`CREATE TRIGGER pc_no_preview_withdraw BEFORE UPDATE ON product_planning_cycle_items FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='preview wrote'`); err != nil {
		t.Fatal(err)
	}
	preview, err := PreviewPlanningWithdrawal(ctx, db, "P-OPEN", "pm", permit("view"), input)
	if err != nil || !preview.CanConfirm || preview.Before.Confirmed.SelectedEffort != expectedBefore || preview.After.Confirmed.SelectedEffort != expectedAfter {
		t.Fatalf("preview %+v %v", preview, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_no_preview_withdraw`); err != nil {
		t.Fatal(err)
	}
	wrongPreview := permit("view")
	wrongPreview.Resource = "product_requests"
	_, err = PreviewPlanningWithdrawal(ctx, db, "P-OPEN", "pm", wrongPreview, input)
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`CREATE TRIGGER pc_fail_withdraw BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = WithdrawPlanningCandidate(ctx, db, identity, permit("prioritize"), input); err == nil {
		t.Fatal("audit failure committed")
	}
	var selection string
	if err = db.QueryRow(`SELECT selection_status FROM product_planning_cycle_items WHERE planning_item_id=?`, itemID).Scan(&selection); err != nil || selection != "selected" {
		t.Fatalf("rollback %s %v", selection, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_fail_withdraw`); err != nil {
		t.Fatal(err)
	}
	result, err := WithdrawPlanningCandidate(ctx, db, identity, permit("prioritize"), input)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := WithdrawPlanningCandidate(ctx, db, identity, permit("prioritize"), input)
	if err != nil || !replay.Replayed || result.ReceiptID != replay.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	capacity, err := ReadPlanningCapacity(ctx, db, "P-OPEN", "pm", first, permit("view"))
	if err != nil || capacity.Confirmed.SelectedEffort != expectedAfter || capacity.CycleRevision != 3 || capacity.QueueRevision != 3 || capacity.WorkspaceRevision != 4 {
		t.Fatalf("capacity %+v %v", capacity, err)
	}
	if downstream {
		found := false
		for _, issue := range capacity.Latest.Issues {
			if issue.Code == "dependency_unresolved" && issue.PredecessorID == itemBiz {
				found = true
			}
		}
		if !found {
			t.Fatal("explicit exception erased downstream dependency warning")
		}
		var edges int
		if err = db.QueryRow(`SELECT COUNT(*) FROM product_planning_dependencies WHERE predecessor_id=?`, itemID).Scan(&edges); err != nil || edges != 1 {
			t.Fatalf("dependency lost %d %v", edges, err)
		}
	}
	var previous []byte
	if err = db.QueryRow(`SELECT selection_status,JSON_EXTRACT(decision_snapshot,'$.previous_decision') FROM product_planning_cycle_items WHERE planning_item_id=?`, itemID).Scan(&selection, &previous); err != nil || selection != "deferred" {
		t.Fatalf("withdrawn %s %v", selection, err)
	}
	baseline, err := decodePlanningCapacityBaseline(previous, itemBiz)
	if err != nil || baseline.Effort == nil || *baseline.Effort != 800 {
		t.Fatalf("lost decision %+v %v", baseline, err)
	}
	// Simulate a persisted, separately confirmed consumption record. The write
	// command producing this snapshot is tested separately when introduced.
	spent := Hundredths(325)
	retained := PlanningRetainedConsumption{Version: 1, CycleBizID: first, ItemBizID: itemBiz, ScopeRevision: 1, Category: Usability, Spent: &spent, ConfirmedBy: "engineer", ConfirmedAt: "2026-09-08T12:00:00Z", Reason: "确认已发生投入"}
	retainedJSON, err := json.Marshal(retained)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE product_planning_cycle_items SET decision_snapshot=JSON_SET(decision_snapshot,'$.retained_consumption',CAST(? AS JSON)) WHERE planning_item_id=?`, retainedJSON, itemID); err != nil {
		t.Fatal(err)
	}
	retainedView, err := ReadPlanningCapacity(ctx, db, "P-OPEN", "pm", first, permit("view"))
	if err != nil || retainedView.Confirmed.RetainedEffort != 325 || retainedView.Confirmed.OccupiedEffort != expectedAfter+325 || retainedView.Latest.RetainedEffort != 325 || retainedView.Latest.OccupiedEffort != expectedAfter+325 {
		t.Fatalf("persisted consumption %+v %v", retainedView, err)
	}
	if _, err = db.Exec(`UPDATE product_planning_cycle_items SET decision_snapshot=JSON_SET(decision_snapshot,'$.retained_consumption.item_biz_id',?) WHERE planning_item_id=?`, first, itemID); err != nil {
		t.Fatal(err)
	}
	_, err = ReadPlanningCapacity(ctx, db, "P-OPEN", "pm", first, permit("view"))
	requireProductRule(t, err, "planning_consumption_snapshot_invalid")

}
