package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLPlanningObservationsAppendAndCorrect(t *testing.T) {
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

	value := "12.123456"
	input := PlanningObservationCreate{PlanningCycleTransition: PlanningCycleTransition{BizID: first, ExpectedRevision: 2, ExpectedCycleRevision: 1, Reason: "登记试点结果"}, ValueMode: "known", ObservedValue: &value, ObservedAt: "2026-01-02T03:04:05Z", EvidenceSummary: "按去重用户测量", EvidenceSource: "试点统计表第一版", Conclusion: "尚需持续观察"}
	identity := CommandIdentity{ProductCode: "P-OPEN", ActorUID: "pm", Action: "product_priorities:observation-create", IdempotencyKey: "observe"}
	_, err := CreatePlanningObservation(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	_, err = CreatePlanningObservation(ctx, db, identity, permit("observe"), input)
	requireProductRule(t, err, "planning_cycle_state_conflict")
	// Closed cycles must remain observable; opening requirements were tested separately.
	if _, err = db.Exec(`UPDATE product_planning_cycles SET status='closed' WHERE biz_id=?`, first); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`CREATE TRIGGER pc_fail_observe BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = CreatePlanningObservation(ctx, db, identity, permit("observe"), input); err == nil {
		t.Fatal("audit failure committed")
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_outcome_observations`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("rollback count %d %v", count, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_fail_observe`); err != nil {
		t.Fatal(err)
	}
	result, err := CreatePlanningObservation(ctx, db, identity, permit("observe"), input)
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		ID int64 `json:"id"`
	}
	if err = json.Unmarshal(result.Value, &out); err != nil {
		t.Fatal(err)
	}
	replay, err := CreatePlanningObservation(ctx, db, identity, permit("observe"), input)
	if err != nil || !replay.Replayed || replay.ReceiptID != result.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	_, err = CreatePlanningObservation(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	var stored string
	if err = db.QueryRow(`SELECT observed_value FROM product_outcome_observations WHERE id=?`, out.ID).Scan(&stored); err != nil || stored != value {
		t.Fatalf("precision %s %v", stored, err)
	}
	input.ExpectedRevision = 3
	input.ExpectedCycleRevision = 2
	input.CorrectionOfID = &out.ID
	input.ValueMode = "unknown"
	input.ObservedValue = nil
	input.Reason = "原统计口径发现重复，撤回数值待重测"
	identity.IdempotencyKey = "correct"
	correction, err := CreatePlanningObservation(ctx, db, identity, permit("observe"), input)
	if err != nil {
		t.Fatal(err)
	}
	var corrected struct {
		ID int64 `json:"id"`
	}
	if err = json.Unmarshal(correction.Value, &corrected); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_outcome_observations WHERE id=? AND correction_of_id=? AND observed_value IS NULL`, corrected.ID, out.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("correction %d %v", count, err)
	}
	input.ExpectedRevision = 4
	input.ExpectedCycleRevision = 3
	identity.IdempotencyKey = "branch"
	_, err = CreatePlanningObservation(ctx, db, identity, permit("observe"), input)
	requireProductRule(t, err, "planning_observation_already_corrected")
	if _, err = db.Exec(`UPDATE product_outcome_observations SET conclusion='overwrite' WHERE id=?`, out.ID); err == nil {
		t.Fatal("observation mutable")
	}
	if _, err = db.Exec(`DELETE FROM product_outcome_observations WHERE id=?`, corrected.ID); err == nil {
		t.Fatal("correction deletable")
	}
	cycle, err := ReadPlanningCycle(ctx, db, "P-OPEN", "pm", first, permit("view"))
	if err != nil || cycle.Status != "closed" || cycle.TargetValue == nil || *cycle.TargetValue != "75.000000" || cycle.BaselineValue != nil || cycle.QueueRevision != 1 {
		t.Fatalf("metric changed %+v %v", cycle, err)
	}
	q := PlanningObservationQuery{CycleBizID: first, Page: 1, PageSize: 1}
	page, err := ListPlanningObservations(ctx, db, "P-OPEN", "pm", permit("view"), q)
	if err != nil || page.Total != 2 || len(page.Items) != 1 || page.Items[0].ID != corrected.ID || page.Items[0].CorrectionOfID == nil || *page.Items[0].CorrectionOfID != out.ID || page.Items[0].CorrectedByID != nil || page.Items[0].ObservedValue != nil {
		t.Fatalf("latest page %+v %v", page, err)
	}
	q.Page = 2
	page, err = ListPlanningObservations(ctx, db, "P-OPEN", "pm", permit("view"), q)
	if err != nil || page.Total != 2 || len(page.Items) != 1 || page.Items[0].ID != out.ID || page.Items[0].CorrectedByID == nil || *page.Items[0].CorrectedByID != corrected.ID || page.Items[0].ObservedValue == nil || *page.Items[0].ObservedValue != value {
		t.Fatalf("history page %+v %v", page, err)
	}
	q.Page = 3
	page, err = ListPlanningObservations(ctx, db, "P-OPEN", "pm", permit("view"), q)
	if err != nil || page.Total != 2 || page.Items == nil || len(page.Items) != 0 {
		t.Fatalf("empty page %+v %v", page, err)
	}
	wrong := permit("view")
	wrong.Resource = "product_requests"
	_, err = ListPlanningObservations(ctx, db, "P-OPEN", "pm", wrong, q)
	requireProductRule(t, err, "product_authorization_invalid")
	workspaceFixture(t, db, "P-OTHER-OBS")
	other := workspacePermit(t, db, "P-OTHER-OBS", "pm", "view")
	other.Resource = "product_priorities"
	if _, err = ListPlanningObservations(ctx, db, "P-OTHER-OBS", "pm", other, q); err == nil {
		t.Fatal("cross-product observations visible")
	}

	detailQuery := PlanningObservationDetailQuery{CycleBizID: first, ObservationID: out.ID}
	detail, err := ReadPlanningObservation(ctx, db, "P-OPEN", "pm", permit("view"), detailQuery)
	if err != nil || detail.ID != out.ID || detail.CorrectedByID == nil || *detail.CorrectedByID != corrected.ID || detail.ObservedValue == nil || *detail.ObservedValue != value {
		t.Fatalf("detail %+v %v", detail, err)
	}
	if _, err = ReadPlanningObservation(ctx, db, "P-OTHER-OBS", "pm", other, detailQuery); err == nil {
		t.Fatal("foreign detail visible")
	}
	_, err = ReadPlanningObservation(ctx, db, "P-OPEN", "pm", wrong, detailQuery)
	requireProductRule(t, err, "product_authorization_invalid")
	detailQuery.ObservationID = corrected.ID + 100
	if _, err = ReadPlanningObservation(ctx, db, "P-OPEN", "pm", permit("view"), detailQuery); err == nil {
		t.Fatal("missing detail accepted")
	}

}
