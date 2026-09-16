package productcenter

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestMySQLPlanningCycleOpenGatesAndAtomicity(t *testing.T) {
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
	draft.ExpectedRevision = 2
	second := create("second")
	input := PlanningCycleTransition{BizID: first, ExpectedRevision: 3, ExpectedCycleRevision: 1, Reason: "目标与容量已确认"}
	identity := CommandIdentity{ProductCode: "P-OPEN", ActorUID: "pm", Action: "product_priorities:cycle-open", IdempotencyKey: "open"}
	_, err := OpenPlanningCycle(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`UPDATE product_planning_cycles SET total_person_days=NULL WHERE biz_id=?`, first); err != nil {
		t.Fatal(err)
	}
	_, err = OpenPlanningCycle(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "planning_capacity_missing")
	if _, err = db.Exec(`UPDATE product_planning_cycles SET total_person_days=10,target_value=NULL WHERE biz_id=?`, first); err != nil {
		t.Fatal(err)
	}
	_, err = OpenPlanningCycle(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "planning_cycle_metric_required")
	if _, err = db.Exec(`UPDATE product_planning_cycles SET target_value=75 WHERE biz_id=?`, first); err != nil {
		t.Fatal(err)
	}

	if _, err = db.Exec(`UPDATE product_planning_cycles SET starts_on='2000-01-01',ends_on='2000-01-31' WHERE biz_id=?`, first); err != nil {
		t.Fatal(err)
	}
	_, err = OpenPlanningCycle(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "planning_cycle_period_expired")
	if _, err = db.Exec(`UPDATE product_planning_cycles SET starts_on='2099-01-01',ends_on='2099-01-31',model_snapshot='{}' WHERE biz_id=?`, first); err != nil {
		t.Fatal(err)
	}
	_, err = OpenPlanningCycle(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "assessment_model_mismatch")
	model, err := json.Marshal(planningCycleModelSnapshot())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE product_planning_cycles SET model_snapshot=? WHERE biz_id=?`, model, first); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`CREATE TRIGGER pc_fail_open BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = OpenPlanningCycle(ctx, db, identity, permit("prioritize"), input); err == nil {
		t.Fatal("audit failure committed")
	}
	before, err := ReadPlanningCycle(ctx, db, "P-OPEN", "pm", first, permit("view"))
	if err != nil || before.Status != "draft" || before.NextReviewAt != nil || before.Revision != 1 || before.WorkspaceRevision != 3 {
		t.Fatalf("rollback %+v %v", before, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_fail_open`); err != nil {
		t.Fatal(err)
	}
	result, err := OpenPlanningCycle(ctx, db, identity, permit("prioritize"), input)
	if err != nil {
		t.Fatal(err)
	}
	after, err := ReadPlanningCycle(ctx, db, "P-OPEN", "pm", first, permit("view"))
	if err != nil || after.Status != "open" || after.Revision != 2 || after.WorkspaceRevision != 4 || after.NextReviewAt == nil || *after.NextReviewAt != "2099-01-15T00:00:00.000000Z" || after.QueueRevision != 1 {
		t.Fatalf("opened %+v %v", after, err)
	}
	replay, err := OpenPlanningCycle(ctx, db, identity, permit("prioritize"), input)
	if err != nil || !replay.Replayed || replay.ReceiptID != result.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	input.BizID = second
	input.ExpectedRevision = 4
	identity.IdempotencyKey = "second-open"
	_, err = OpenPlanningCycle(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "planning_cycle_already_open")
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_planning_cycles WHERE status='open'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("open count %d %v", count, err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_planning_cycle_items`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("opening selected items %d %v", count, err)
	}
}

func TestMySQLConcurrentPlanningCycleOpenSerializesProduct(t *testing.T) {
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
	draft.ExpectedRevision = 2
	second := create("second")

	sharedPermit := permit("prioritize")
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, id := range []string{first, second} {
		go func(id string) {
			<-start
			_, err := OpenPlanningCycle(ctx, db, CommandIdentity{ProductCode: "P-OPEN", ActorUID: "pm", Action: "product_priorities:cycle-open", IdempotencyKey: id}, sharedPermit, PlanningCycleTransition{BizID: id, ExpectedRevision: 3, ExpectedCycleRevision: 1, Reason: "并发开放"})
			results <- err
		}(id)
	}
	close(start)
	successes, conflicts := 0, 0
	for i := 0; i < 2; i++ {
		err := <-results
		if err == nil {
			successes++
			continue
		}
		var rule *RuleError
		if !errors.As(err, &rule) || (rule.Code != "product_authorization_changed" && rule.Code != "product_revision_conflict" && rule.Code != "planning_cycle_already_open") {
			t.Fatalf("unexpected concurrent error %v", err)
		}
		conflicts++
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("outcomes success=%d conflicts=%d", successes, conflicts)
	}
	var count, revision int
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_planning_cycles WHERE status='open'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("open count %d %v", count, err)
	}
	if err := db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-OPEN'`).Scan(&revision); err != nil || revision != 4 {
		t.Fatalf("root revision %d %v", revision, err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_activity_logs WHERE action='open'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("open audits %d %v", count, err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts WHERE action='product_priorities:cycle-open'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("open receipts %d %v", count, err)
	}
}
