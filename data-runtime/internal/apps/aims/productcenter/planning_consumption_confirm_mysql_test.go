package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
)

func TestMySQLPlanningConsumptionConfirmation(t *testing.T) {
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
	if _, err := db.Exec(`UPDATE product_planning_items SET lifecycle='in_delivery' WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE product_planning_cycle_items SET selection_status='selected',decision_snapshot=? WHERE planning_item_id=?`, snapshot, itemID); err != nil {
		t.Fatal(err)
	}

	input := PlanningConsumptionConfirm{PlanningCycleCandidateAdd: PlanningCycleCandidateAdd{CycleBizID: first, ItemBizID: itemBiz, ExpectedRevision: 3, ExpectedCycleRevision: 2, ExpectedItemRevision: 1}, ExpectedQueueRevision: 2, ExpectedScopeRevision: 1, Spent: &zero, Reason: "核验尚未发生实际投入"}
	identity := CommandIdentity{ProductCode: "P-OPEN", ActorUID: "pm", Action: "product_priorities:consumption-confirm", IdempotencyKey: "confirm"}
	_, err := ConfirmPlanningConsumption(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	stale := input
	stale.ExpectedScopeRevision = 2
	_, err = ConfirmPlanningConsumption(ctx, db, identity, permit("assess"), stale)
	requireProductRule(t, err, "product_planning_revision_conflict")
	if _, err = db.Exec(`CREATE TRIGGER pc_fail_consumption BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err = ConfirmPlanningConsumption(ctx, db, identity, permit("assess"), input); err == nil {
		t.Fatal("audit failure committed")
	}
	var pending sql.NullString
	if err = db.QueryRow(`SELECT JSON_EXTRACT(decision_snapshot,'$.pending_consumption') FROM product_planning_cycle_items WHERE planning_item_id=?`, itemID).Scan(&pending); err != nil || pending.Valid {
		t.Fatalf("leaked confirmation %+v %v", pending, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_fail_consumption`); err != nil {
		t.Fatal(err)
	}
	result, err := ConfirmPlanningConsumption(ctx, db, identity, permit("assess"), input)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := ConfirmPlanningConsumption(ctx, db, identity, permit("assess"), input)
	if err != nil || !replay.Replayed || replay.ReceiptID != result.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	capacity, err := ReadPlanningCapacity(ctx, db, "P-OPEN", "pm", first, permit("view"))
	if err != nil || capacity.Confirmed.SelectedEffort != 800 || capacity.Confirmed.RetainedEffort != 0 || capacity.WorkspaceRevision != 4 || capacity.CycleRevision != 3 || capacity.QueueRevision != 3 {
		t.Fatalf("confirmation released capacity %+v %v", capacity, err)
	}
	if err = db.QueryRow(`SELECT JSON_EXTRACT(decision_snapshot,'$.pending_consumption') FROM product_planning_cycle_items WHERE planning_item_id=?`, itemID).Scan(&pending); err != nil || !pending.Valid {
		t.Fatal(err)
	}
	var confirmation PlanningConsumptionConfirmation
	if err = json.Unmarshal([]byte(pending.String), &confirmation); err != nil || confirmation.ConfirmedBy != "pm" || confirmation.Spent == nil || *confirmation.Spent != 0 || confirmation.ConfirmationID == "" || confirmation.ScopeRevision != 1 {
		t.Fatalf("confirmation %+v %v", confirmation, err)
	}
	frozen, err := decodePlanningCapacityBaseline(confirmation.DecisionSnapshot, itemBiz)
	if err != nil || frozen.Effort == nil || *frozen.Effort != 800 {
		t.Fatalf("lost original decision %+v %v", frozen, err)
	}
	view, err := ReadPlanningConsumption(ctx, db, "P-OPEN", "pm", first, itemBiz, permit("view"))
	if err != nil || !view.Current || view.Pending == nil || view.Pending.ConfirmationID != confirmation.ConfirmationID || view.Retained != nil || view.WorkspaceRevision != 4 {
		t.Fatalf("read current %+v %v", view, err)
	}
	wrong := permit("view")
	wrong.Resource = "product_requests"
	_, err = ReadPlanningConsumption(ctx, db, "P-OPEN", "pm", first, itemBiz, wrong)
	requireProductRule(t, err, "product_authorization_invalid")
	_, err = ReadPlanningConsumption(ctx, db, "P-OPEN", "pm", first, first, permit("view"))
	if err == nil {
		t.Fatal("cross-item confirmation returned")
	}
	if _, err = db.Exec(`UPDATE product_planning_items SET scope_revision=scope_revision+1 WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	view, err = ReadPlanningConsumption(ctx, db, "P-OPEN", "pm", first, itemBiz, permit("view"))
	if err != nil || view.Current || view.Blocker == nil || view.Pending == nil || view.Pending.ScopeRevision != 1 || view.ScopeRevision != 2 {
		t.Fatalf("stale confirmation %+v %v", view, err)
	}
	if _, err = db.Exec(`UPDATE product_planning_cycles SET status='closed' WHERE biz_id=?`, first); err != nil {
		t.Fatal(err)
	}
	view, err = ReadPlanningConsumption(ctx, db, "P-OPEN", "pm", first, itemBiz, permit("view"))
	if err != nil || view.Current || view.Pending == nil || view.CycleStatus != "closed" || view.Blocker.Code != "planning_consumption_state_invalid" {
		t.Fatalf("closed history %+v %v", view, err)
	}

}
