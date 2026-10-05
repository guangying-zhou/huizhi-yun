package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLPlanningCycleCloseAtomicity(t *testing.T) {
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

	input := PlanningCycleTransition{BizID: first, ExpectedRevision: 2, ExpectedCycleRevision: 1, Reason: "结束本期规划，保留决定供回看"}
	identity := CommandIdentity{ProductCode: "P-OPEN", ActorUID: "pm", Action: "product_priorities:cycle-close", IdempotencyKey: "close"}
	_, err := ClosePlanningCycle(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	_, err = ClosePlanningCycle(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "planning_cycle_state_conflict")
	openIdentity := identity
	openIdentity.Action = "product_priorities:cycle-open"
	openIdentity.IdempotencyKey = "open"
	if _, err = OpenPlanningCycle(ctx, db, openIdentity, permit("prioritize"), input); err != nil {
		t.Fatal(err)
	}
	_, err = ClosePlanningCycle(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "product_revision_conflict")
	input.ExpectedRevision = 3
	input.ExpectedCycleRevision = 2
	if _, err = db.Exec(`CREATE TRIGGER pc_fail_close BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = ClosePlanningCycle(ctx, db, identity, permit("prioritize"), input); err == nil {
		t.Fatal("audit failure committed")
	}
	before, err := ReadPlanningCycle(ctx, db, "P-OPEN", "pm", first, permit("view"))
	if err != nil || before.Status != "open" || before.Revision != 2 || before.WorkspaceRevision != 3 {
		t.Fatalf("rollback %+v %v", before, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_fail_close`); err != nil {
		t.Fatal(err)
	}
	result, err := ClosePlanningCycle(ctx, db, identity, permit("prioritize"), input)
	if err != nil {
		t.Fatal(err)
	}
	after, err := ReadPlanningCycle(ctx, db, "P-OPEN", "pm", first, permit("view"))
	if err != nil || after.Status != "closed" || after.Revision != 3 || after.WorkspaceRevision != 4 || after.QueueRevision != before.QueueRevision || string(after.ModelSnapshot) != string(before.ModelSnapshot) {
		t.Fatalf("closed %+v %v", after, err)
	}
	replay, err := ClosePlanningCycle(ctx, db, identity, permit("prioritize"), input)
	if err != nil || !replay.Replayed || replay.ReceiptID != result.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	_, err = ClosePlanningCycle(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	identity.IdempotencyKey = "close-again"
	input.ExpectedRevision = 4
	input.ExpectedCycleRevision = 3
	_, err = ClosePlanningCycle(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "planning_cycle_state_conflict")
	openIdentity.IdempotencyKey = "reopen"
	_, err = OpenPlanningCycle(ctx, db, openIdentity, permit("prioritize"), input)
	requireProductRule(t, err, "planning_cycle_state_conflict")
	// The real close command must free the one-open-cycle constraint without
	// allowing writes into the old cycle or silently carrying candidates forward.
	itemID := planningFixture(t, db, "P-OPEN")
	var itemBiz string
	if err = db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, itemID).Scan(&itemBiz); err != nil {
		t.Fatal(err)
	}
	addIdentity := CommandIdentity{ProductCode: "P-OPEN", ActorUID: "pm", Action: "product_priorities:candidate-add", IdempotencyKey: "closed-add"}
	add := PlanningCycleCandidateAdd{CycleBizID: first, ItemBizID: itemBiz, ExpectedRevision: 4, ExpectedCycleRevision: 3, ExpectedItemRevision: 1}
	_, err = AddPlanningCycleCandidate(ctx, db, addIdentity, permit("edit"), add)
	requireProductRule(t, err, "planning_cycle_readonly")
	draft.ExpectedRevision = 4
	draft.Title = "下一规划周期"
	second := create("next-cycle")
	next := PlanningCycleTransition{BizID: second, ExpectedRevision: 5, ExpectedCycleRevision: 1, Reason: "重新确认下一周期目标和容量"}
	openIdentity.IdempotencyKey = "next-open"
	if _, err = OpenPlanningCycle(ctx, db, openIdentity, permit("prioritize"), next); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_planning_cycle_items ci JOIN product_planning_cycles c ON c.id=ci.cycle_id WHERE c.biz_id=?`, second).Scan(&count); err != nil || count != 0 {
		t.Fatalf("implicit carryover %d %v", count, err)
	}
	add.CycleBizID = second
	add.ExpectedRevision = 6
	add.ExpectedCycleRevision = 2
	addIdentity.IdempotencyKey = "explicit-next-candidate"
	if _, err = AddPlanningCycleCandidate(ctx, db, addIdentity, permit("edit"), add); err != nil {
		t.Fatal(err)
	}
	var selected string
	var assessmentID *int64
	var snapshot []byte
	if err = db.QueryRow(`SELECT ci.selection_status,ci.current_assessment_id,ci.decision_snapshot FROM product_planning_cycle_items ci JOIN product_planning_cycles c ON c.id=ci.cycle_id WHERE c.biz_id=? AND ci.planning_item_id=?`, second, itemID).Scan(&selected, &assessmentID, &snapshot); err != nil || selected != "candidate" || assessmentID != nil || len(snapshot) != 0 {
		t.Fatalf("fresh candidate %s %v %s %v", selected, assessmentID, snapshot, err)
	}
	old, err := ReadPlanningCycle(ctx, db, "P-OPEN", "pm", first, permit("view"))
	if err != nil || old.Status != "closed" || old.Revision != 3 || old.QueueRevision != before.QueueRevision {
		t.Fatalf("old cycle mutated %+v %v", old, err)
	}

}
