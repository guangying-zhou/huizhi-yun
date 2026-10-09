package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
)

func TestMySQLPlanningCycleCreateAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-CYCLE")
	ctx := context.Background()
	permit := func() AuthorizationPermit {
		p := workspacePermit(t, db, "P-CYCLE", "pm", "edit")
		p.Resource = "product_priorities"
		return p
	}
	identity := CommandIdentity{ProductCode: "P-CYCLE", ActorUID: "pm", Action: "product_priorities:cycle-create", IdempotencyKey: "cycle-draft"}
	input := PlanningCycleDraft{ExpectedRevision: 1, Title: "九月规划", StartsOn: "2026-09-01", EndsOn: "2026-09-30", GoalSummary: "改善首次使用体验", ReviewIntervalDays: 14}
	badPermit := permit()
	badPermit.Resource = "product_requests"
	_, err := CreatePlanningCycle(ctx, db, identity, badPermit, input)
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`CREATE TRIGGER pc_fail_cycle BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = CreatePlanningCycle(ctx, db, identity, permit(), input); err == nil {
		t.Fatal("audit failure committed")
	}
	var count, revision int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_planning_cycles`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("rollback cycles %d %v", count, err)
	}
	if err = db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-CYCLE'`).Scan(&revision); err != nil || revision != 1 {
		t.Fatalf("rollback root %d %v", revision, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_fail_cycle`); err != nil {
		t.Fatal(err)
	}
	result, err := CreatePlanningCycle(ctx, db, identity, permit(), input)
	if err != nil {
		t.Fatal(err)
	}
	var value struct {
		BizID             string `json:"biz_id"`
		WorkspaceRevision int    `json:"workspace_revision"`
	}
	if err = json.Unmarshal(result.Value, &value); err != nil || value.WorkspaceRevision != 2 {
		t.Fatalf("result %s %v", result.Value, err)
	}
	var budget sql.NullString
	var status, model string
	if err = db.QueryRow(`SELECT total_person_days,status,model_version FROM product_planning_cycles WHERE biz_id=?`, value.BizID).Scan(&budget, &status, &model); err != nil || budget.Valid || status != "draft" || model != AssessmentModel {
		t.Fatalf("draft %v %s %s %v", budget, status, model, err)
	}
	viewPermit := func() AuthorizationPermit { p := permit(); p.Action = "view"; return p }
	unknown, err := ReadPlanningCycle(ctx, db, "P-CYCLE", "pm", value.BizID, viewPermit())
	if err != nil || unknown.Budget != nil || unknown.MetricDefinition != nil || unknown.BaselineValue != nil || unknown.TargetValue != nil || unknown.NextReviewAt != nil || unknown.WorkspaceRevision != 2 {
		t.Fatalf("unknown detail %+v %v", unknown, err)
	}
	firstID := value.BizID
	replay, err := CreatePlanningCycle(ctx, db, identity, permit(), input)
	if err != nil || !replay.Replayed || replay.ReceiptID != result.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	input.Title = "different"
	_, err = CreatePlanningCycle(ctx, db, identity, permit(), input)
	requireProductRule(t, err, "idempotency_payload_mismatch")
	identity.IdempotencyKey = "budget-draft"
	input.ExpectedRevision = 2
	total, reserve, part := Hundredths(1075), Hundredths(100), Hundredths(325)
	metricTarget := "75.5"
	input.Metric = &PlanningCycleMetric{Name: "首次使用成功率", Unit: "百分比", Direction: "increase", MeasurementMethod: "成功用户数除以首次使用用户数", TargetValue: &metricTarget}
	input.Budget = &PlanningCycleBudget{Total: &total, Reserve: &reserve, Reliability: &part, Usability: &part, Growth: &part}
	result, err = CreatePlanningCycle(ctx, db, identity, permit(), input)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(result.Value, &value); err != nil {
		t.Fatal(err)
	}
	var stored string
	if err = db.QueryRow(`SELECT total_person_days FROM product_planning_cycles WHERE biz_id=?`, value.BizID).Scan(&stored); err != nil || stored != "10.75" {
		t.Fatalf("decimal %s %v", stored, err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_planning_cycle_items`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("created selection %d %v", count, err)
	}
	detail, err := ReadPlanningCycle(ctx, db, "P-CYCLE", "pm", value.BizID, viewPermit())
	if err != nil || detail.Budget == nil || detail.Budget.Total == nil || *detail.Budget.Total != 1075 || detail.Revision != 1 || detail.QueueRevision != 1 || detail.WorkspaceRevision != 3 {
		t.Fatalf("budget detail %+v %v", detail, err)
	}
	if detail.BaselineValue != nil || detail.TargetValue == nil || *detail.TargetValue != "75.500000" || len(detail.MetricDefinition) == 0 {
		t.Fatalf("created metric %+v", detail)
	}
	if err = detail.Budget.Validate(); err != nil {
		t.Fatal(err)
	}
	page, err := ListPlanningCycles(ctx, db, "P-CYCLE", "pm", viewPermit(), PlanningCyclePageQuery{Page: 1, PageSize: 1})
	if err != nil || page.Total != 2 || len(page.Items) != 1 || page.Items[0].BizID != value.BizID || page.WorkspaceRevision != 3 {
		t.Fatalf("first page %+v %v", page, err)
	}
	page, err = ListPlanningCycles(ctx, db, "P-CYCLE", "pm", viewPermit(), PlanningCyclePageQuery{Page: 2, PageSize: 1})
	if err != nil || page.Total != 2 || len(page.Items) != 1 || page.Items[0].BizID != firstID {
		t.Fatalf("second page %+v %v", page, err)
	}
	for _, q := range []PlanningCyclePageQuery{{Page: 1, PageSize: 10, Status: "open"}, {Page: 1, PageSize: 10, Keyword: "%_"}} {
		page, err = ListPlanningCycles(ctx, db, "P-CYCLE", "pm", viewPermit(), q)
		if err != nil || page.Total != 0 || page.Items == nil || len(page.Items) != 0 {
			t.Fatalf("empty page %+v %v", page, err)
		}
	}
	page, err = ListPlanningCycles(ctx, db, "P-CYCLE", "pm", viewPermit(), PlanningCyclePageQuery{Page: 1, PageSize: 10, Status: "draft", Keyword: "different"})
	if err != nil || page.Total != 1 || len(page.Items) != 1 || page.Items[0].BizID != value.BizID {
		t.Fatalf("filter %+v %v", page, err)
	}
	denied := viewPermit()
	denied.Resource = "product_requests"
	_, err = ReadPlanningCycle(ctx, db, "P-CYCLE", "pm", firstID, denied)
	requireProductRule(t, err, "product_authorization_invalid")
	_, err = ListPlanningCycles(ctx, db, "P-CYCLE", "pm", denied, PlanningCyclePageQuery{Page: 1, PageSize: 10})
	requireProductRule(t, err, "product_authorization_invalid")
	workspaceFixture(t, db, "P-OTHER-CYCLE")
	other := workspacePermit(t, db, "P-OTHER-CYCLE", "pm", "view")
	other.Resource = "product_priorities"
	foreign, err := ReadPlanningCycle(ctx, db, "P-OTHER-CYCLE", "pm", firstID, other)
	if !errors.Is(err, sql.ErrNoRows) || foreign.BizID != "" {
		t.Fatalf("foreign detail %+v %v", foreign, err)
	}
	var receiptsBefore, receiptsAfter int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_activity_logs WHERE product_code='P-CYCLE'`).Scan(&receiptsBefore); err != nil {
		t.Fatal(err)
	}
	if _, err = ReadPlanningCycle(ctx, db, "P-CYCLE", "pm", firstID, viewPermit()); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_activity_logs WHERE product_code='P-CYCLE'`).Scan(&receiptsAfter); err != nil || receiptsBefore != receiptsAfter {
		t.Fatalf("read generated activity %v", err)
	}

	if _, err = db.Exec(`UPDATE product_planning_cycles SET status='open',total_person_days=10,reserve_person_days=0,reliability_person_days=0,usability_person_days=0,growth_person_days=10 WHERE biz_id=?`, value.BizID); err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []struct {
		when string
		want int
	}{{"NULL", 0}, {"UTC_TIMESTAMP(3)+INTERVAL 1 DAY", 0}, {"UTC_TIMESTAMP(3)-INTERVAL 1 DAY", 1}} {
		if _, err = db.Exec("UPDATE product_planning_cycles SET next_review_at="+scenario.when+" WHERE biz_id=?", value.BizID); err != nil {
			t.Fatal(err)
		}
		due, err := ListPlanningCycles(ctx, db, "P-CYCLE", "pm", viewPermit(), PlanningCyclePageQuery{Page: 1, PageSize: 20, ReviewDue: true})
		if err != nil || due.Total != scenario.want || len(due.Items) != scenario.want {
			t.Fatalf("due filter %+v %v", due, err)
		}
	}
	if _, err = db.Exec(`UPDATE product_planning_cycles SET status='closed' WHERE biz_id=?`, value.BizID); err != nil {
		t.Fatal(err)
	}
	due, err := ListPlanningCycles(ctx, db, "P-CYCLE", "pm", viewPermit(), PlanningCyclePageQuery{Page: 1, PageSize: 20, ReviewDue: true})
	if err != nil || due.Total != 0 {
		t.Fatalf("closed cycle overdue %+v %v", due, err)
	}

}
