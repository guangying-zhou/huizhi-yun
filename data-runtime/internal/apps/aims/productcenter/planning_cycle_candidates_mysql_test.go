package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
)

func TestMySQLPlanningCycleCandidatesAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-CAND")
	ctx := context.Background()
	permit := func() AuthorizationPermit {
		p := workspacePermit(t, db, "P-CAND", "pm", "edit")
		p.Resource = "product_priorities"
		return p
	}
	itemID := planningFixture(t, db, "P-CAND")
	var itemBiz string
	if err := db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, itemID).Scan(&itemBiz); err != nil {
		t.Fatal(err)
	}
	result, err := CreatePlanningCycle(ctx, db, CommandIdentity{ProductCode: "P-CAND", ActorUID: "pm", Action: "product_priorities:cycle-create", IdempotencyKey: "cycle"}, permit(), PlanningCycleDraft{ExpectedRevision: 1, Title: "候选周期", StartsOn: "2099-01-01", EndsOn: "2099-01-31", GoalSummary: "目标", ReviewIntervalDays: 14})
	if err != nil {
		t.Fatal(err)
	}
	var cycle struct {
		BizID string `json:"biz_id"`
	}
	if err = json.Unmarshal(result.Value, &cycle); err != nil {
		t.Fatal(err)
	}
	input := PlanningCycleCandidateAdd{CycleBizID: cycle.BizID, ItemBizID: itemBiz, ExpectedRevision: 2, ExpectedCycleRevision: 1, ExpectedItemRevision: 1}
	identity := CommandIdentity{ProductCode: "P-CAND", ActorUID: "pm", Action: "product_priorities:candidate-add", IdempotencyKey: "add"}
	wrong := permit()
	wrong.Resource = "product_requests"
	_, err = AddPlanningCycleCandidate(ctx, db, identity, wrong, input)
	requireProductRule(t, err, "product_authorization_invalid")
	stale := input
	stale.ExpectedItemRevision = 2
	_, err = AddPlanningCycleCandidate(ctx, db, identity, permit(), stale)
	requireProductRule(t, err, "product_planning_revision_conflict")
	workspaceFixture(t, db, "P-FOREIGN-CAND")
	foreignID := planningFixture(t, db, "P-FOREIGN-CAND")
	foreign := input
	if err = db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, foreignID).Scan(&foreign.ItemBizID); err != nil {
		t.Fatal(err)
	}
	_, err = AddPlanningCycleCandidate(ctx, db, identity, permit(), foreign)
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign item %v", err)
	}
	if _, err = db.Exec(`CREATE TRIGGER pc_fail_candidate BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = AddPlanningCycleCandidate(ctx, db, identity, permit(), input); err == nil {
		t.Fatal("audit failure committed")
	}
	var count, rootRev, cycleRev, queueRev int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_planning_cycle_items`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("rollback count %d %v", count, err)
	}
	if err = db.QueryRow(`SELECT w.revision,c.revision,c.queue_revision FROM product_workspaces w JOIN product_planning_cycles c ON c.product_code=w.product_code WHERE c.biz_id=?`, cycle.BizID).Scan(&rootRev, &cycleRev, &queueRev); err != nil || rootRev != 2 || cycleRev != 1 || queueRev != 1 {
		t.Fatalf("rollback revisions %d %d %d %v", rootRev, cycleRev, queueRev, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_fail_candidate`); err != nil {
		t.Fatal(err)
	}
	result, err = AddPlanningCycleCandidate(ctx, db, identity, permit(), input)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := AddPlanningCycleCandidate(ctx, db, identity, permit(), input)
	if err != nil || !replay.Replayed || replay.ReceiptID != result.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	var selection string
	var assessment sql.NullInt64
	if err = db.QueryRow(`SELECT selection_status,current_assessment_id FROM product_planning_cycle_items WHERE planning_item_id=?`, itemID).Scan(&selection, &assessment); err != nil || selection != "candidate" || assessment.Valid {
		t.Fatalf("candidate facts %s %v %v", selection, assessment, err)
	}
	if _, err = db.Exec(`UPDATE product_planning_cycle_items SET selection_status='selected' WHERE planning_item_id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	input.ExpectedRevision = 3
	input.ExpectedCycleRevision = 2
	identity.IdempotencyKey = "existing"
	existing, err := AddPlanningCycleCandidate(ctx, db, identity, permit(), input)
	if err != nil {
		t.Fatal(err)
	}
	var already struct {
		Present   bool   `json:"already_present"`
		Selection string `json:"selection_status"`
		Revision  int    `json:"workspace_revision"`
	}
	if err = json.Unmarshal(existing.Value, &already); err != nil || !already.Present || already.Selection != "selected" || already.Revision != 3 {
		t.Fatalf("duplicate reset selection %s %v", existing.Value, err)
	}

	view := permit()
	view.Action = "view"
	q := PlanningCycleCandidateQuery{CycleBizID: cycle.BizID, Page: 1, PageSize: 1}
	page, err := ListPlanningCycleCandidates(ctx, db, "P-CAND", "pm", view, q)
	if err != nil || page.Total != 1 || len(page.Items) != 1 || page.Items[0].BizID != itemBiz || page.Items[0].SelectionStatus != "selected" || page.Items[0].AssessmentID != nil || page.CycleRevision != 2 || page.QueueRevision != 2 || page.WorkspaceRevision != 3 {
		t.Fatalf("candidate page %+v %v", page, err)
	}
	q.Page = 2
	page, err = ListPlanningCycleCandidates(ctx, db, "P-CAND", "pm", view, q)
	if err != nil || page.Total != 1 || page.Items == nil || len(page.Items) != 0 {
		t.Fatalf("empty second page %+v %v", page, err)
	}
	q.Page = 1
	q.SelectionStatus = "candidate"
	page, err = ListPlanningCycleCandidates(ctx, db, "P-CAND", "pm", view, q)
	if err != nil || page.Total != 0 || len(page.Items) != 0 {
		t.Fatalf("candidate filter %+v %v", page, err)
	}
	q.SelectionStatus = "selected"
	q.Keyword = "%_"
	page, err = ListPlanningCycleCandidates(ctx, db, "P-CAND", "pm", view, q)
	if err != nil || page.Total != 0 {
		t.Fatalf("literal search %+v %v", page, err)
	}
	denied := view
	denied.Resource = "product_requests"
	_, err = ListPlanningCycleCandidates(ctx, db, "P-CAND", "pm", denied, q)
	requireProductRule(t, err, "product_authorization_invalid")
	other := workspacePermit(t, db, "P-FOREIGN-CAND", "pm", "view")
	other.Resource = "product_priorities"
	_, err = ListPlanningCycleCandidates(ctx, db, "P-FOREIGN-CAND", "pm", other, q)
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign cycle query %v", err)
	}
	if _, err = db.Exec(`UPDATE product_planning_cycles SET status='closed' WHERE biz_id=?`, cycle.BizID); err != nil {
		t.Fatal(err)
	}
	identity.IdempotencyKey = "closed"
	_, err = AddPlanningCycleCandidate(ctx, db, identity, permit(), input)
	requireProductRule(t, err, "planning_cycle_readonly")
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_activity_logs WHERE action='candidate-add'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("candidate audit count %d %v", count, err)
	}
}
