package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLPlanningBudgetAtomicity(t *testing.T) {
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
	expanded := Hundredths(1200)
	input := PlanningBudgetChange{PlanningCycleTransition: PlanningCycleTransition{BizID: first, ExpectedRevision: 3, ExpectedCycleRevision: 2, Reason: "新增可用投入"}, ExpectedQueueRevision: 2, Budget: &PlanningCycleBudget{Total: &expanded, Reserve: &zero, Reliability: &zero, Usability: &expanded, Growth: &zero}, ImpactNote: "保留本期已发生的八人日投入", Exceptions: []DecisionException{}}
	identity := CommandIdentity{ProductCode: "P-OPEN", ActorUID: "pm", Action: "product_priorities:budget-change", IdempotencyKey: "budget"}
	_, err := ChangePlanningBudget(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	preview, err := PreviewPlanningBudget(ctx, db, "P-OPEN", "pm", permit("view"), input)
	if err != nil || !preview.CanConfirm || preview.Before.Confirmed.SelectedEffort != 800 || preview.After.Confirmed.SelectedEffort != 800 {
		t.Fatalf("preview %+v %v", preview, err)
	}
	if _, err = db.Exec(`CREATE TRIGGER pc_fail_budget BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = ChangePlanningBudget(ctx, db, identity, permit("prioritize"), input); err == nil {
		t.Fatal("audit failure committed")
	}
	before, err := ReadPlanningCycle(ctx, db, "P-OPEN", "pm", first, permit("view"))
	if err != nil || before.Revision != 2 || before.WorkspaceRevision != 3 || *before.Budget.Total != 1000 {
		t.Fatalf("rollback %+v %v", before, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_fail_budget`); err != nil {
		t.Fatal(err)
	}
	result, err := ChangePlanningBudget(ctx, db, identity, permit("prioritize"), input)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := ChangePlanningBudget(ctx, db, identity, permit("prioritize"), input)
	if err != nil || !replay.Replayed || result.ReceiptID != replay.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	after, err := ReadPlanningCycle(ctx, db, "P-OPEN", "pm", first, permit("view"))
	if err != nil || after.Revision != 3 || after.QueueRevision != 3 || after.WorkspaceRevision != 4 || *after.Budget.Total != 1200 {
		t.Fatalf("budget %+v %v", after, err)
	}
	var stored []byte
	if err = db.QueryRow(`SELECT decision_snapshot FROM product_planning_cycle_items WHERE planning_item_id=?`, itemID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	baseline, err := decodePlanningCapacityBaseline(stored, itemBiz)
	if err != nil || baseline.Effort == nil || *baseline.Effort != 800 {
		t.Fatalf("baseline changed %+v %v", baseline, err)
	}
	identity.IdempotencyKey = "stale-budget"
	_, err = ChangePlanningBudget(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "product_revision_conflict")
	input.ExpectedRevision = 4
	input.ExpectedCycleRevision = 3
	_, err = ChangePlanningBudget(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "priority_queue_conflict")
	input.ExpectedQueueRevision = 3
	reduced := Hundredths(600)
	input.Budget = &PlanningCycleBudget{Total: &reduced, Reserve: &zero, Reliability: &zero, Usability: &reduced, Growth: &zero}
	identity.IdempotencyKey = "reduce"
	// A read preview must work even if every cycle UPDATE is rejected by MySQL.
	if _, err = db.Exec(`CREATE TRIGGER pc_no_preview_update BEFORE UPDATE ON product_planning_cycles FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='preview wrote'`); err != nil {
		t.Fatal(err)
	}
	reduction, err := PreviewPlanningBudget(ctx, db, "P-OPEN", "pm", permit("view"), input)
	if err != nil || reduction.CanConfirm || reduction.Blocker == nil || reduction.After.Confirmed.SelectedEffort != 800 || reduction.After.Confirmed.Remaining != -200 || len(reduction.After.Latest.Issues) != 2 {
		t.Fatalf("reduction %+v %v", reduction, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_no_preview_update`); err != nil {
		t.Fatal(err)
	}
	_, err = ChangePlanningBudget(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "decision_issues_unresolved")
	input.Exceptions = []DecisionException{
		{Code: "capacity_exceeded", Reason: "容量计划下调", ResponsibleUID: "pm", Impact: "保留已发生投入，负余额需要后续处理"},
		{Code: "category_capacity_exceeded", Category: Usability, Reason: "体验投入预算下调", ResponsibleUID: "pm", Impact: "本期八人日不释放"},
	}
	if _, err = ChangePlanningBudget(ctx, db, identity, permit("prioritize"), input); err != nil {
		t.Fatal(err)
	}
	capacity, err := ReadPlanningCapacity(ctx, db, "P-OPEN", "pm", first, permit("view"))
	if err != nil || capacity.Confirmed.SelectedEffort != 800 || capacity.Confirmed.Remaining != -200 || len(capacity.Latest.Issues) != 2 {
		t.Fatalf("waiver hid issues %+v %v", capacity, err)
	}
	closeInput := PlanningCycleTransition{BizID: first, ExpectedRevision: 5, ExpectedCycleRevision: 4, Reason: "本期结束"}
	if _, err = ClosePlanningCycle(ctx, db, CommandIdentity{ProductCode: "P-OPEN", ActorUID: "pm", Action: "product_priorities:cycle-close", IdempotencyKey: "close-after-budget"}, permit("prioritize"), closeInput); err != nil {
		t.Fatal(err)
	}
	input.ExpectedRevision = 6
	input.ExpectedCycleRevision = 5
	input.ExpectedQueueRevision = 4
	identity.IdempotencyKey = "closed-budget"
	_, err = ChangePlanningBudget(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "planning_cycle_readonly")

}
