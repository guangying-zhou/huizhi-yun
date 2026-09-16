package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLPlanningCycleEditAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-CEDIT")
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-CEDIT", "pm", action)
		p.Resource = "product_priorities"
		return p
	}
	total, reserve, part := Hundredths(1075), Hundredths(100), Hundredths(325)
	draft := PlanningCycleDraft{ExpectedRevision: 1, Title: "周期", StartsOn: "2026-09-01", EndsOn: "2026-09-30", GoalSummary: "目标", ReviewIntervalDays: 14, Budget: &PlanningCycleBudget{Total: &total, Reserve: &reserve, Reliability: &part, Usability: &part, Growth: &part}}
	result, err := CreatePlanningCycle(ctx, db, CommandIdentity{ProductCode: "P-CEDIT", ActorUID: "pm", Action: "product_priorities:cycle-create", IdempotencyKey: "create"}, permit("edit"), draft)
	if err != nil {
		t.Fatal(err)
	}
	var created struct {
		BizID string `json:"biz_id"`
	}
	if err = json.Unmarshal(result.Value, &created); err != nil {
		t.Fatal(err)
	}
	draft.ExpectedRevision = 2
	draft.Budget = nil
	draft.Title = "新周期"
	input := PlanningCycleEdit{PlanningCycleDraft: draft, BizID: created.BizID, ExpectedCycleRevision: 1, Reason: "更新计划", BudgetMode: "keep"}
	identity := CommandIdentity{ProductCode: "P-CEDIT", ActorUID: "pm", Action: "product_priorities:cycle-edit", IdempotencyKey: "edit"}
	if _, err = db.Exec(`CREATE TRIGGER pc_fail_cycle_edit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = EditPlanningCycle(ctx, db, identity, permit("edit"), input); err == nil {
		t.Fatal("audit failure committed")
	}
	read := func() PlanningCycleDetail {
		out, err := ReadPlanningCycle(ctx, db, "P-CEDIT", "pm", created.BizID, permit("view"))
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	before := read()
	if before.Revision != 1 || before.WorkspaceRevision != 2 || before.Title != "周期" {
		t.Fatalf("rollback %+v", before)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_fail_cycle_edit`); err != nil {
		t.Fatal(err)
	}
	result, err = EditPlanningCycle(ctx, db, identity, permit("edit"), input)
	if err != nil {
		t.Fatal(err)
	}
	after := read()
	if after.Revision != 2 || after.WorkspaceRevision != 3 || after.Budget == nil || *after.Budget.Total != 1075 || after.Title != "新周期" || after.QueueRevision != 1 {
		t.Fatalf("edit %+v", after)
	}
	replay, err := EditPlanningCycle(ctx, db, identity, permit("edit"), input)
	if err != nil || !replay.Replayed || replay.ReceiptID != result.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	identity.IdempotencyKey = "stale"
	input.ExpectedRevision = 3
	_, err = EditPlanningCycle(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "planning_cycle_revision_conflict")
	input.ExpectedCycleRevision = 2
	identity.IdempotencyKey = "same"
	if _, err = EditPlanningCycle(ctx, db, identity, permit("edit"), input); err != nil {
		t.Fatal(err)
	}
	unchanged := read()
	if unchanged.Revision != 2 || unchanged.WorkspaceRevision != 3 {
		t.Fatalf("no-op changed versions %+v", unchanged)
	}
	identity.IdempotencyKey = "clear"
	input.BudgetMode = "clear"
	if _, err = EditPlanningCycle(ctx, db, identity, permit("edit"), input); err != nil {
		t.Fatal(err)
	}
	after = read()
	if after.Budget != nil || after.Revision != 3 || after.WorkspaceRevision != 4 {
		t.Fatalf("clear %+v", after)
	}
	input.ExpectedRevision = 4
	input.ExpectedCycleRevision = 3
	input.BudgetMode = "set"
	input.Budget = &PlanningCycleBudget{Total: &total, Reserve: &reserve, Reliability: &part, Usability: &part, Growth: &part}
	identity.IdempotencyKey = "set"
	if _, err = EditPlanningCycle(ctx, db, identity, permit("edit"), input); err != nil {
		t.Fatal(err)
	}
	input.ExpectedRevision = 5
	input.ExpectedCycleRevision = 4
	input.BudgetMode = "keep"
	input.Budget = nil

	baseline, target := "0", "99999999999999.123456"
	input.Metric = &PlanningCycleMetric{Name: "观测指标", Unit: "次", Direction: "increase", MeasurementMethod: "按周期去重计数", BaselineValue: &baseline, TargetValue: &target}
	identity.IdempotencyKey = "metric"
	if _, err = EditPlanningCycle(ctx, db, identity, permit("edit"), input); err != nil {
		t.Fatal(err)
	}
	measured := read()
	if measured.BaselineValue == nil || *measured.BaselineValue != "0.000000" || measured.TargetValue == nil || *measured.TargetValue != target {
		t.Fatalf("metric precision %+v", measured)
	}
	input.ExpectedRevision = measured.WorkspaceRevision
	input.ExpectedCycleRevision = measured.Revision
	identity.IdempotencyKey = "same-metric"
	if _, err = EditPlanningCycle(ctx, db, identity, permit("edit"), input); err != nil {
		t.Fatal(err)
	}
	if unchanged := read(); unchanged.Revision != measured.Revision || unchanged.WorkspaceRevision != measured.WorkspaceRevision {
		t.Fatalf("equivalent metric changed revision %+v", unchanged)
	}
	input.Metric = nil
	input.Title = "保留指标"
	identity.IdempotencyKey = "preserve-metric"
	if _, err = EditPlanningCycle(ctx, db, identity, permit("edit"), input); err != nil {
		t.Fatal(err)
	}
	preserved := read()
	if preserved.TargetValue == nil || *preserved.TargetValue != target {
		t.Fatalf("omitted metric erased %+v", preserved)
	}
	input.ExpectedRevision = preserved.WorkspaceRevision
	input.ExpectedCycleRevision = preserved.Revision
	for _, state := range []string{"open", "closed"} {
		if _, err = db.Exec(`UPDATE product_planning_cycles SET status=? WHERE biz_id=?`, state, created.BizID); err != nil {
			t.Fatal(err)
		}
		identity.IdempotencyKey = state
		_, err = EditPlanningCycle(ctx, db, identity, permit("edit"), input)
		requireProductRule(t, err, "planning_cycle_readonly")
	}
}
