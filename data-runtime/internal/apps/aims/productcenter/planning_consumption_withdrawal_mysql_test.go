package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
)

func TestMySQLPlanningConsumptionWithdrawal(t *testing.T) {
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
	draft := PlanningCycleDraft{
		ExpectedRevision:   1,
		Title:              "规划周期",
		StartsOn:           "2099-01-01",
		EndsOn:             "2099-01-31",
		GoalSummary:        "提升成功率",
		ReviewIntervalDays: 14,
		Budget: &PlanningCycleBudget{
			Total:       &total,
			Reserve:     &zero,
			Reliability: &zero,
			Usability:   &total,
			Growth:      &zero,
		},
		Metric: &PlanningCycleMetric{
			Name:              "成功率",
			Unit:              "百分比",
			Direction:         "increase",
			MeasurementMethod: "按用户去重",
			TargetValue:       &target,
		},
	}
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

	confirmSpent := Hundredths(325)
	confirm := PlanningConsumptionConfirm{PlanningCycleCandidateAdd: PlanningCycleCandidateAdd{CycleBizID: first, ItemBizID: itemBiz, ExpectedRevision: 3, ExpectedCycleRevision: 2, ExpectedItemRevision: 1}, ExpectedQueueRevision: 2, ExpectedScopeRevision: 1, Spent: &confirmSpent, Reason: "核验三人日后"}
	identity := CommandIdentity{ProductCode: "P-OPEN", ActorUID: "pm", Action: "product_priorities:consumption-confirm", IdempotencyKey: "confirm"}
	if _, err := ConfirmPlanningConsumption(ctx, db, identity, permit("assess"), confirm); err != nil {
		t.Fatal(err)
	}

	var pending sql.NullString
	if err := db.QueryRow(`SELECT JSON_EXTRACT(decision_snapshot,'$.pending_consumption') FROM product_planning_cycle_items WHERE planning_item_id=?`, itemID).Scan(&pending); err != nil || !pending.Valid {
		t.Fatalf("confirm missing pending consumption %v %v", pending, err)
	}
	var confirmation PlanningConsumptionConfirmation
	if err := json.Unmarshal([]byte(pending.String), &confirmation); err != nil {
		t.Fatal(err)
	}

	withdraw := PlanningWithdrawal{
		ConsumptionConfirmationID: confirmation.ConfirmationID,
		PlanningCycleCandidateAdd: PlanningCycleCandidateAdd{CycleBizID: first, ItemBizID: itemBiz, ExpectedRevision: 4, ExpectedCycleRevision: 3, ExpectedItemRevision: 1},
		ExpectedQueueRevision:     3,
		Reason:                    "3.25 人日已入账，待撤回",
		ImpactNote:                "保留已确认消耗并回收未发生耗时",
		Exceptions:                []DecisionException{},
	}

	preview, err := PreviewPlanningWithdrawal(ctx, db, "P-OPEN", "pm", permit("view"), withdraw)
	if err != nil || !preview.CanConfirm || preview.Before.Confirmed.SelectedEffort != 800 || preview.After.Confirmed.SelectedEffort != 0 || preview.After.Confirmed.RetainedEffort != 325 || preview.After.Confirmed.Remaining != 675 {
		t.Fatalf("preview mismatch %+v %v", preview, err)
	}

	baseWorkspace := readWorkspaceAndCycleState(t, db, "P-OPEN", first)
	baseSelection := readSelectionStatus(t, db, itemID)
	if baseSelection != "selected" {
		t.Fatalf("unexpected initial selection %s", baseSelection)
	}

	badID := PlanningWithdrawal{PlanningCycleCandidateAdd: withdraw.PlanningCycleCandidateAdd, ExpectedQueueRevision: withdraw.ExpectedQueueRevision, ConsumptionConfirmationID: "00000000-0000-0000-0000-000000000000", Reason: withdraw.Reason, ImpactNote: withdraw.ImpactNote, Exceptions: []DecisionException{}}
	_, err = WithdrawPlanningCandidate(ctx, db, CommandIdentity{ProductCode: "P-OPEN", ActorUID: "pm", Action: "product_priorities:withdraw", IdempotencyKey: "withdraw-bad-id"}, permit("prioritize"), badID)
	requireProductRule(t, err, "planning_withdrawal_consumption_required")
	ensureNoRevisionChange(t, db, "P-OPEN", first, itemID, baseWorkspace, "wrong confirmation id committed")

	var originalScope uint64
	if err := db.QueryRow(`SELECT scope_revision FROM product_planning_items WHERE id=?`, itemID).Scan(&originalScope); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE product_planning_items SET scope_revision=? WHERE id=?`, originalScope+1, itemID); err != nil {
		t.Fatal(err)
	}
	_, err = WithdrawPlanningCandidate(ctx, db, CommandIdentity{ProductCode: "P-OPEN", ActorUID: "pm", Action: "product_priorities:withdraw", IdempotencyKey: "withdraw-scope"}, permit("prioritize"), withdraw)
	requireProductRule(t, err, "planning_withdrawal_consumption_required")
	ensureNoRevisionChange(t, db, "P-OPEN", first, itemID, baseWorkspace, "scope drift accepted")
	if _, err := db.Exec(`UPDATE product_planning_items SET scope_revision=? WHERE id=?`, originalScope, itemID); err != nil {
		t.Fatal(err)
	}

	var originalDecision []byte
	if err := db.QueryRow(`SELECT decision_snapshot FROM product_planning_cycle_items WHERE planning_item_id=?`, itemID).Scan(&originalDecision); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE product_planning_cycle_items SET decision_snapshot=JSON_SET(decision_snapshot,'$.capacity.effort_person_days', 1000) WHERE planning_item_id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	_, err = WithdrawPlanningCandidate(ctx, db, CommandIdentity{ProductCode: "P-OPEN", ActorUID: "pm", Action: "product_priorities:withdraw", IdempotencyKey: "withdraw-decision"}, permit("prioritize"), withdraw)
	requireProductRule(t, err, "planning_withdrawal_consumption_required")
	ensureNoRevisionChange(t, db, "P-OPEN", first, itemID, baseWorkspace, "drifted decision accepted")
	if _, err := db.Exec(`UPDATE product_planning_cycle_items SET decision_snapshot=? WHERE planning_item_id=?`, originalDecision, itemID); err != nil {
		t.Fatal(err)
	}

	if _, err = db.Exec(`CREATE TRIGGER pc_fail_withdraw_consumption BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	_, err = WithdrawPlanningCandidate(ctx, db, CommandIdentity{ProductCode: "P-OPEN", ActorUID: "pm", Action: "product_priorities:withdraw", IdempotencyKey: "withdraw"}, permit("prioritize"), withdraw)
	if err == nil {
		t.Fatal("audit failure committed")
	}
	if _, err = db.Exec(`DROP TRIGGER pc_fail_withdraw_consumption`); err != nil {
		t.Fatal(err)
	}
	ensureNoRevisionChange(t, db, "P-OPEN", first, itemID, baseWorkspace, "audit failure committed")

	baseWorkspace = readWorkspaceAndCycleState(t, db, "P-OPEN", first)
	result, err := WithdrawPlanningCandidate(ctx, db, CommandIdentity{ProductCode: "P-OPEN", ActorUID: "pm", Action: "product_priorities:withdraw", IdempotencyKey: "withdraw"}, permit("prioritize"), withdraw)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := WithdrawPlanningCandidate(ctx, db, CommandIdentity{ProductCode: "P-OPEN", ActorUID: "pm", Action: "product_priorities:withdraw", IdempotencyKey: "withdraw"}, permit("prioritize"), withdraw)
	if err != nil || !replay.Replayed || result.ReceiptID != replay.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}

	capacity, err := ReadPlanningCapacity(ctx, db, "P-OPEN", "pm", first, permit("view"))
	if err != nil || capacity.WorkspaceRevision != baseWorkspace.workspaceRevision+1 || capacity.CycleRevision != baseWorkspace.cycleRevision+1 || capacity.QueueRevision != baseWorkspace.queueRevision+1 || capacity.Confirmed.SelectedEffort != 0 || capacity.Confirmed.RetainedEffort != 325 || capacity.Confirmed.OccupiedEffort != 325 || capacity.Confirmed.Remaining != 675 {
		t.Fatalf("capacity after withdrawal %+v %v", capacity, err)
	}
	retainedView, readErr := ReadPlanningConsumption(ctx, db, "P-OPEN", "pm", first, itemBiz, permit("view"))
	if readErr != nil || retainedView.Current || retainedView.Pending != nil || retainedView.Retained == nil || *retainedView.Retained.Spent != 325 {
		t.Fatalf("retained history %+v %v", retainedView, readErr)
	}
	var after sql.NullString
	if err := db.QueryRow(`SELECT JSON_EXTRACT(decision_snapshot,'$.retained_consumption') FROM product_planning_cycle_items WHERE planning_item_id=?`, itemID).Scan(&after); err != nil || !after.Valid {
		t.Fatalf("retained missing %v %v", after, err)
	}
	var retained PlanningRetainedConsumption
	if err := json.Unmarshal([]byte(after.String), &retained); err != nil {
		t.Fatal(err)
	}
	if retained.Spent == nil || *retained.Spent != 325 || retained.CycleBizID != first {
		t.Fatalf("retained %+v", retained)
	}
	if err := db.QueryRow(`SELECT JSON_EXTRACT(decision_snapshot,'$.pending_consumption') FROM product_planning_cycle_items WHERE planning_item_id=?`, itemID).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after.Valid {
		t.Fatalf("pending consumption should be removed: %v", after.String)
	}
}

type workspaceCycleSnapshot struct {
	workspaceRevision uint64
	cycleRevision     uint64
	queueRevision     uint64
}

func readWorkspaceAndCycleState(t *testing.T, db *sql.DB, code, cycle string) workspaceCycleSnapshot {
	t.Helper()
	var workspaceRevision uint64
	if err := db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code=?`, code).Scan(&workspaceRevision); err != nil {
		t.Fatal(err)
	}
	var cycleRevision, queueRevision uint64
	if err := db.QueryRow(`SELECT revision,queue_revision FROM product_planning_cycles WHERE biz_id=?`, cycle).Scan(&cycleRevision, &queueRevision); err != nil {
		t.Fatal(err)
	}
	return workspaceCycleSnapshot{workspaceRevision: workspaceRevision, cycleRevision: cycleRevision, queueRevision: queueRevision}
}

func readSelectionStatus(t *testing.T, db *sql.DB, itemID int64) string {
	t.Helper()
	var selection string
	if err := db.QueryRow(`SELECT selection_status FROM product_planning_cycle_items WHERE planning_item_id=?`, itemID).Scan(&selection); err != nil {
		t.Fatal(err)
	}
	return selection
}

func ensureNoRevisionChange(t *testing.T, db *sql.DB, code, cycle string, itemID int64, before workspaceCycleSnapshot, msg string) {
	t.Helper()
	now := readWorkspaceAndCycleState(t, db, code, cycle)
	if now.workspaceRevision != before.workspaceRevision || now.cycleRevision != before.cycleRevision || now.queueRevision != before.queueRevision {
		t.Fatalf("%s %+v -> %+v", msg, before, now)
	}
	if status := readSelectionStatus(t, db, itemID); status != "selected" {
		t.Fatalf("%s selection changed to %s", msg, status)
	}
}
