package productcenter

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"testing"
)

func TestMySQLPlanningCycleReviewAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-REVIEW")
	id := uuid.NewString()
	if _, err := db.Exec(`INSERT INTO product_planning_cycles(biz_id,product_code,title,starts_on,ends_on,goal_summary,model_snapshot,status,total_person_days,reserve_person_days,reliability_person_days,usability_person_days,growth_person_days,next_review_at,created_by,updated_by,created_at,updated_at) VALUES(?,'P-REVIEW','复评','2026-01-01','2026-12-31','目标',JSON_OBJECT(),'open',10,0,0,0,10,UTC_TIMESTAMP(3)-INTERVAL 1 DAY,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, id); err != nil {
		t.Fatal(err)
	}
	identity := CommandIdentity{ProductCode: "P-REVIEW", ActorUID: "pm", Action: "product_priorities:cycle-review", IdempotencyKey: "review"}
	input := PlanningCycleTransition{BizID: id, ExpectedRevision: 1, ExpectedCycleRevision: 1, Reason: "核对当前证据，保留顺序；投入变化事项另行复评"}
	run := func(action string) (CommandResult, error) {
		p := workspacePermit(t, db, "P-REVIEW", "pm", action)
		p.Resource = "product_priorities"
		return ReviewPlanningCycle(context.Background(), db, identity, p, input)
	}
	_, err := run("assess")
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`CREATE TRIGGER fail_review_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run("prioritize"); err == nil {
		t.Fatal("audit failure committed review")
	}
	var due bool
	var revision int
	if err = db.QueryRow(`SELECT next_review_at<UTC_TIMESTAMP(3),revision FROM product_planning_cycles WHERE biz_id=?`, id).Scan(&due, &revision); err != nil || !due || revision != 1 {
		t.Fatalf("review rollback %v %d %v", due, revision, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_review_audit`); err != nil {
		t.Fatal(err)
	}

	viewPermit := func() AuthorizationPermit {
		p := workspacePermit(t, db, "P-REVIEW", "pm", "view")
		p.Resource = "product_priorities"
		return p
	}
	pending, err := ListPlanningCycles(context.Background(), db, "P-REVIEW", "pm", viewPermit(), PlanningCyclePageQuery{Page: 1, PageSize: 10, ReviewDue: true})
	if err != nil || pending.Total != 1 {
		t.Fatalf("missing due checkpoint %+v %v", pending, err)
	}
	saved, err := run("prioritize")
	if err != nil {
		t.Fatal(err)
	}
	replay, err := run("prioritize")
	if err != nil || !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatalf("review replay %+v %v", replay, err)
	}
	var result PlanningCycleDetail
	if err = json.Unmarshal(saved.Value, &result); err != nil || result.Status != "open" || result.QueueRevision != 1 || result.Revision != 2 || result.WorkspaceRevision != 2 {
		t.Fatalf("review result %+v %v", result, err)
	}
	if err = db.QueryRow(`SELECT next_review_at>UTC_TIMESTAMP(3)+INTERVAL 13 DAY FROM product_planning_cycles WHERE biz_id=?`, id).Scan(&due); err != nil || !due {
		t.Fatalf("next review %v %v", due, err)
	}
	p := workspacePermit(t, db, "P-REVIEW", "pm", "view")
	p.Resource = "product_priorities"
	history, err := ListPlanningCycleReviews(context.Background(), db, "P-REVIEW", "pm", p, PlanningObservationQuery{CycleBizID: id, Page: 1, PageSize: 1})
	if err != nil || history.Total != 1 || len(history.Items) != 1 || history.Items[0].Conclusion != input.Reason || history.Items[0].Before.Revision != 1 || history.Items[0].After.Revision != 2 {
		t.Fatalf("review evidence %+v %v", history, err)
	}
	p.Action = "prioritize"
	_, err = ListPlanningCycleReviews(context.Background(), db, "P-REVIEW", "pm", p, PlanningObservationQuery{CycleBizID: id, Page: 1, PageSize: 1})
	requireProductRule(t, err, "product_authorization_invalid")
	workspaceFixture(t, db, "P-OTHER-REVIEW")
	p = workspacePermit(t, db, "P-OTHER-REVIEW", "pm", "view")
	p.Resource = "product_priorities"
	if _, err = ListPlanningCycleReviews(context.Background(), db, "P-OTHER-REVIEW", "pm", p, PlanningObservationQuery{CycleBizID: id, Page: 1, PageSize: 1}); err == nil {
		t.Fatal("cross-product review history exposed")
	}

	pending, err = ListPlanningCycles(context.Background(), db, "P-REVIEW", "pm", viewPermit(), PlanningCyclePageQuery{Page: 1, PageSize: 10, ReviewDue: true})
	if err != nil || pending.Total != 0 {
		t.Fatalf("review did not clear due checkpoint %+v %v", pending, err)
	}
	closePermit := workspacePermit(t, db, "P-REVIEW", "pm", "prioritize")
	closePermit.Resource = "product_priorities"
	_, err = ClosePlanningCycle(context.Background(), db, CommandIdentity{ProductCode: "P-REVIEW", ActorUID: "pm", Action: "product_priorities:cycle-close", IdempotencyKey: "close"}, closePermit, PlanningCycleTransition{BizID: id, ExpectedRevision: 2, ExpectedCycleRevision: 2, Reason: "周期结束"})
	if err != nil {
		t.Fatal(err)
	}
	input.ExpectedRevision = 3
	input.ExpectedCycleRevision = 3
	identity.IdempotencyKey = "review-after-close"
	_, err = run("prioritize")
	requireProductRule(t, err, "planning_cycle_state_conflict")
	history, err = ListPlanningCycleReviews(context.Background(), db, "P-REVIEW", "pm", viewPermit(), PlanningObservationQuery{CycleBizID: id, Page: 1, PageSize: 10})
	if err != nil || history.Total != 1 || history.Items[0].After.Revision != 2 {
		t.Fatalf("close changed review history %+v %v", history, err)
	}

}
