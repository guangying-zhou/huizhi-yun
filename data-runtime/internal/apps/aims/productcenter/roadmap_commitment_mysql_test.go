package productcenter

import (
	"context"
	"encoding/json"
	"os"
	"slices"
	"testing"
)

func TestMySQLRoadmapCommitmentAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-SELECT")
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-SELECT", "pm", action)
		p.Resource = "product_priorities"
		return p
	}
	itemID := planningFixture(t, db, "P-SELECT")
	draft := assessmentDraft()
	if err := db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, itemID).Scan(&draft.ItemBizID); err != nil {
		t.Fatal(err)
	}
	result, err := CreatePlanningCycle(ctx, db, CommandIdentity{ProductCode: "P-SELECT", ActorUID: "pm", Action: "product_priorities:cycle-create", IdempotencyKey: "cycle"}, permit("edit"), PlanningCycleDraft{ExpectedRevision: 1, Title: "选入测试", StartsOn: "2099-01-01", EndsOn: "2099-01-31", GoalSummary: "目标", ReviewIntervalDays: 14})
	if err != nil {
		t.Fatal(err)
	}
	var cycle struct {
		BizID string `json:"biz_id"`
	}
	if err = json.Unmarshal(result.Value, &cycle); err != nil {
		t.Fatal(err)
	}
	draft.CycleBizID = cycle.BizID
	draft.ExpectedRevision = 2
	draft.ExpectedCycleRevision = 1
	draft.ExpectedItemRevision = 1
	if _, err = AddPlanningCycleCandidate(ctx, db, CommandIdentity{ProductCode: "P-SELECT", ActorUID: "pm", Action: "product_priorities:candidate-add", IdempotencyKey: "candidate"}, permit("edit"), draft.PlanningCycleCandidateAdd); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE product_planning_cycles SET status='open',total_person_days=10,reserve_person_days=1,reliability_person_days=3,usability_person_days=3,growth_person_days=3 WHERE biz_id=?`, cycle.BizID); err != nil {
		t.Fatal(err)
	}
	draft.ExpectedRevision = 3
	draft.ExpectedCycleRevision = 2
	if _, err = CreatePlanningAssessment(ctx, db, CommandIdentity{ProductCode: "P-SELECT", ActorUID: "pm", Action: "product_priorities:assess", IdempotencyKey: "assess"}, permit("assess"), draft); err != nil {
		t.Fatal(err)
	}
	detail, err := ReadPlanningCycle(ctx, db, "P-SELECT", "pm", cycle.BizID, permit("view"))
	if err != nil {
		t.Fatal(err)
	}
	input := PlanningSelection{PlanningCycleCandidateAdd: PlanningCycleCandidateAdd{CycleBizID: cycle.BizID, ItemBizID: draft.ItemBizID, ExpectedRevision: detail.WorkspaceRevision, ExpectedCycleRevision: detail.Revision, ExpectedItemRevision: 1}, ExpectedQueueRevision: detail.QueueRevision, Reason: "确认本期建设", Exceptions: []DecisionException{}}
	if err = db.QueryRow(`SELECT current_assessment_id FROM product_planning_cycle_items WHERE planning_item_id=?`, itemID).Scan(&input.ExpectedAssessmentID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`CREATE TRIGGER pc_no_preview_write BEFORE UPDATE ON product_planning_cycle_items FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='preview must not write'`); err != nil {
		t.Fatal(err)
	}
	preview, err := PreviewPlanningSelection(ctx, db, "P-SELECT", "pm", permit("view"), input)
	if err != nil || preview.CanConfirm || preview.Blocker == nil || preview.Before.Confirmed.SelectedEffort != 0 || preview.After.Latest.SelectedEffort != 800 || preview.QueueRevision != input.ExpectedQueueRevision {
		t.Fatalf("selection preview %+v %v", preview, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_no_preview_write`); err != nil {
		t.Fatal(err)
	}
	wrongPreview := permit("view")
	wrongPreview.Resource = "product_requests"
	if _, err = PreviewPlanningSelection(ctx, db, "P-SELECT", "pm", wrongPreview, input); err == nil {
		t.Fatal("wrong resource preview authorized")
	}

	identity := CommandIdentity{ProductCode: "P-SELECT", ActorUID: "pm", Action: "product_priorities:select", IdempotencyKey: "select"}
	_, err = SelectPlanningCandidate(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	stale := input
	stale.ExpectedQueueRevision++
	_, err = SelectPlanningCandidate(ctx, db, identity, permit("prioritize"), stale)
	requireProductRule(t, err, "priority_queue_conflict")
	_, err = SelectPlanningCandidate(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "decision_issues_unresolved")
	assertUnselected := func() {
		t.Helper()
		var status string
		var snapshot []byte
		if e := db.QueryRow(`SELECT selection_status,decision_snapshot FROM product_planning_cycle_items WHERE planning_item_id=?`, itemID).Scan(&status, &snapshot); e != nil || status != "candidate" || snapshot != nil {
			t.Fatalf("selection leaked %s %s %v", status, snapshot, e)
		}
	}
	assertUnselected()
	input.Exceptions = []DecisionException{{Code: "category_capacity_exceeded", Category: Growth, Reason: "本期明确调整投入取舍", ResponsibleUID: "pm", Impact: "增长类别超过原预算 5 人日，保留风险"}}
	approvedPreview, err := PreviewPlanningSelection(ctx, db, "P-SELECT", "pm", permit("view"), input)
	if err != nil || !approvedPreview.CanConfirm || approvedPreview.Blocker != nil || approvedPreview.After.Latest.SelectedEffort != 800 {
		t.Fatalf("exception preview %+v %v", approvedPreview, err)
	}
	assertUnselected()

	predecessorID := planningFixture(t, db, "P-SELECT")
	if _, err = db.Exec(`INSERT INTO product_planning_dependencies(product_code,planning_item_id,predecessor_id,created_by,created_at) VALUES ('P-SELECT',?,?,'pm',UTC_TIMESTAMP(3))`, itemID, predecessorID); err != nil {
		t.Fatal(err)
	}
	_, err = SelectPlanningCandidate(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "decision_issues_unresolved")
	assertUnselected()
	if _, err = db.Exec(`DELETE FROM product_planning_dependencies WHERE planning_item_id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE product_planning_items SET evidence_revision=evidence_revision+1 WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	_, err = SelectPlanningCandidate(ctx, db, identity, permit("prioritize"), input)
	requireProductRule(t, err, "assessment_required")
	assertUnselected()
	if _, err = db.Exec(`UPDATE product_planning_items SET evidence_revision=evidence_revision-1 WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}

	if _, err = db.Exec(`CREATE TRIGGER pc_fail_select BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = SelectPlanningCandidate(ctx, db, identity, permit("prioritize"), input); err == nil {
		t.Fatal("audit failure committed selection")
	}
	assertUnselected()
	if _, err = db.Exec(`DROP TRIGGER pc_fail_select`); err != nil {
		t.Fatal(err)
	}
	selected, err := SelectPlanningCandidate(ctx, db, identity, permit("prioritize"), input)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := SelectPlanningCandidate(ctx, db, identity, permit("prioritize"), input)
	if err != nil || !replay.Replayed || replay.ReceiptID != selected.ReceiptID {
		t.Fatalf("selection replay %+v %v", replay, err)
	}
	capacity, err := ReadPlanningCapacity(ctx, db, "P-SELECT", "pm", cycle.BizID, permit("view"))
	if err != nil || capacity.Confirmed.SelectedEffort != 800 || capacity.Latest.SelectedEffort != 800 || capacity.WorkspaceRevision != input.ExpectedRevision+1 || capacity.QueueRevision != input.ExpectedQueueRevision+1 {
		t.Fatalf("selected capacity %+v %v", capacity, err)
	}
	var snapshot []byte
	if err = db.QueryRow(`SELECT decision_snapshot FROM product_planning_cycle_items WHERE planning_item_id=?`, itemID).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	baseline, err := decodePlanningCapacityBaseline(snapshot, draft.ItemBizID)
	if err != nil || baseline.Effort == nil || *baseline.Effort != 800 {
		t.Fatalf("frozen decision %+v %v", baseline, err)
	}
	gateInput := PlanningDeliveryCheck{ItemBizID: draft.ItemBizID, CycleBizID: cycle.BizID, ExpectedRevision: capacity.WorkspaceRevision, ExpectedItemRevision: 1, ExpectedCycleRevision: capacity.CycleRevision, ExpectedQueueRevision: capacity.QueueRevision}

	for _, name := range []string{"migration_v5.25_planning_roadmap_windows.sql", "migration_v5.26_roadmap_commitments.sql", "migration_v5.28_roadmap_cross_dependency_snapshots.sql"} {
		script, e := os.ReadFile("../../../../../aims/docs/" + name)
		if e != nil {
			t.Fatal(e)
		}
		executeSQLScript(t, db, string(script))
	}
	if _, err = db.Exec(`UPDATE product_planning_items SET roadmap_starts_on='2099-01-01',roadmap_ends_on='2099-03-31' WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	commitInput := RoadmapCommitmentInput{ItemBizID: gateInput.ItemBizID, CycleBizID: gateInput.CycleBizID, ExpectedRevision: gateInput.ExpectedRevision, ExpectedItemRevision: gateInput.ExpectedItemRevision, ExpectedCycleRevision: gateInput.ExpectedCycleRevision, ExpectedQueueRevision: gateInput.ExpectedQueueRevision, Reason: "正式确认季度探索交付"}
	commitIdentity := CommandIdentity{ProductCode: "P-SELECT", ActorUID: "pm", Action: "product_roadmaps:commit", IdempotencyKey: "roadmap-commit"}
	run := func(action string) (CommandResult, error) {
		p := permit(action)
		p.Resource = "product_roadmaps"
		return CommitRoadmap(ctx, db, commitIdentity, p, commitInput)
	}
	_, err = run("edit")
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`CREATE TRIGGER fail_commit_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run("commit"); err == nil {
		t.Fatal("audit failure accepted")
	}
	var count int
	var rootRevision uint64
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_roadmap_commitments`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("rollback count %d %v", count, err)
	}
	if err = db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-SELECT'`).Scan(&rootRevision); err != nil || rootRevision != commitInput.ExpectedRevision {
		t.Fatalf("rollback revision %d %v", rootRevision, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_commit_audit`); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_planning_dependencies(product_code,planning_item_id,predecessor_id,created_by,created_at) VALUES('P-SELECT',?,?,'pm',UTC_TIMESTAMP(3))`, itemID, predecessorID); err != nil {
		t.Fatal(err)
	}
	_, err = run("commit")
	requireProductRule(t, err, "decision_issues_unresolved")
	if _, err = db.Exec(`UPDATE product_planning_items SET lifecycle='delivered' WHERE id=?`, predecessorID); err != nil {
		t.Fatal(err)
	}
	committed, err := run("commit")
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := run("commit")
	if err != nil || !repeated.Replayed || repeated.ReceiptID != committed.ReceiptID {
		t.Fatalf("replay %+v %v", repeated, err)
	}
	var dependencyCount int
	if err = db.QueryRow(`SELECT JSON_LENGTH(JSON_EXTRACT(item_snapshot,'$.dependencies')) FROM product_roadmap_commitments`).Scan(&dependencyCount); err != nil || dependencyCount != 1 {
		t.Fatalf("dependency snapshot %d %v", dependencyCount, err)
	}
	commitIdentity.IdempotencyKey = "new-commit"
	_, err = run("commit")
	requireProductRule(t, err, "product_revision_conflict")
	commitInput.ExpectedRevision++
	_, err = run("commit")
	requireProductRule(t, err, "product_roadmap_commitment_conflict")
	if err = db.QueryRow(`SELECT id FROM product_roadmap_commitments`).Scan(&commitInput.ExpectedPreviousID); err != nil {
		t.Fatal(err)
	}
	_, err = run("commit")
	requireProductRule(t, err, "product_roadmap_commitment_unchanged")
	previousID := commitInput.ExpectedPreviousID
	if _, err = db.Exec(`UPDATE product_planning_items SET roadmap_ends_on='2099-04-30',revision=revision+1 WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	commitInput.ExpectedItemRevision++
	if _, err = run("commit"); err != nil {
		t.Fatal(err)
	}
	var linked int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_roadmap_commitments WHERE JSON_EXTRACT(item_snapshot,'$.previous_commitment_id')=?`, previousID).Scan(&linked); err != nil || linked != 1 {
		t.Fatalf("successor link %d %v", linked, err)
	}
	commitIdentity.IdempotencyKey = "stale-evidence-commit"
	commitInput.ExpectedRevision++
	if _, err = db.Exec(`UPDATE product_planning_items SET evidence_revision=evidence_revision+1 WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	_, err = run("commit")
	requireProductRule(t, err, "planning_decision_changed")
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_roadmap_commitments WHERE evidence_revision=1`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("history changed %d %v", count, err)
	}
	view := permit("view")
	view.Resource = "product_roadmaps"
	history, e := ListRoadmapCommitments(ctx, db, "P-SELECT", "pm", draft.ItemBizID, view, permit("view"), 1, 1)
	if e != nil || history.Total != 2 || len(history.Items) != 1 || history.Items[0].EndsOn != "2099-04-30" || history.LatestID != history.Items[0].ID {
		t.Fatalf("latest history %+v %v", history, e)
	}
	if !history.Items[0].RequiresReview || !slices.Contains(history.Items[0].ReviewReasons, "evidence_changed") || slices.Contains(history.Items[0].ReviewReasons, "window_changed") || slices.Contains(history.Items[0].ReviewReasons, "decision_changed") {
		t.Fatalf("latest review reasons %+v", history.Items[0].ReviewReasons)
	}
	latestID := history.LatestID
	history, e = ListRoadmapCommitments(ctx, db, "P-SELECT", "pm", draft.ItemBizID, view, permit("view"), 2, 1)
	if e != nil || history.Total != 2 || len(history.Items) != 1 || history.Items[0].EndsOn != "2099-03-31" || history.LatestID != latestID || history.Items[0].EvidenceRevision != 1 {
		t.Fatalf("original history %+v %v", history, e)
	}
	if !history.Items[0].RequiresReview || !slices.Contains(history.Items[0].ReviewReasons, "window_changed") || !slices.Contains(history.Items[0].ReviewReasons, "evidence_changed") {
		t.Fatalf("original review reasons %+v", history.Items[0].ReviewReasons)
	}
	if slices.Contains(history.Items[0].ReviewReasons, "dependencies_changed") {
		t.Fatal("unchanged dependency marked changed")
	}
	if _, e = db.Exec(`UPDATE product_planning_items SET lifecycle='proposed',revision=revision+1 WHERE id=?`, predecessorID); e != nil {
		t.Fatal(e)
	}
	history, e = ListRoadmapCommitments(ctx, db, "P-SELECT", "pm", draft.ItemBizID, view, permit("view"), 1, 1)
	if e != nil || !slices.Contains(history.Items[0].ReviewReasons, "dependencies_changed") {
		t.Fatalf("dependency lifecycle review %+v %v", history, e)
	}
	if _, e = db.Exec(`DELETE FROM product_planning_dependencies WHERE planning_item_id=?`, itemID); e != nil {
		t.Fatal(e)
	}
	history, e = ListRoadmapCommitments(ctx, db, "P-SELECT", "pm", draft.ItemBizID, view, permit("view"), 1, 1)
	if e != nil || !slices.Contains(history.Items[0].ReviewReasons, "dependencies_changed") {
		t.Fatalf("dependency removal review %+v %v", history, e)
	}
	if slices.Contains(history.Items[0].ReviewReasons, "cross_dependencies_changed") || slices.Contains(history.Items[0].ReviewReasons, "cross_dependency_snapshot_missing") {
		t.Fatal("unchanged cross dependency marked changed")
	}
	workspaceFixture(t, db, "P-CROSS-REVIEW")
	crossID := planningFixture(t, db, "P-CROSS-REVIEW")
	if _, e = db.Exec(`INSERT INTO product_cross_dependencies(biz_id,product_code,planning_item_id,predecessor_product_code,predecessor_id,reason,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-SELECT',?,'P-CROSS-REVIEW',?,'共享能力','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, itemID, crossID); e != nil {
		t.Fatal(e)
	}
	history, e = ListRoadmapCommitments(ctx, db, "P-SELECT", "pm", draft.ItemBizID, view, permit("view"), 1, 1)
	if e != nil || !slices.Contains(history.Items[0].ReviewReasons, "cross_dependencies_changed") {
		t.Fatalf("cross review %+v %v", history, e)
	}
	// Restore this test's deliberate evidence drift, then establish a baseline
	// with a delivered cross-product predecessor.
	if _, e = db.Exec(`UPDATE product_planning_items SET evidence_revision=1 WHERE id=?`, itemID); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(`UPDATE product_planning_items SET lifecycle='delivered' WHERE id=?`, crossID); e != nil {
		t.Fatal(e)
	}
	commitInput.ExpectedPreviousID = latestID
	commitIdentity.IdempotencyKey = "cross-baseline"
	if _, err = db.Exec(`CREATE TRIGGER fail_cross_snapshot BEFORE INSERT ON product_roadmap_cross_dependency_snapshots FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='snapshot failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run("commit"); err == nil {
		t.Fatal("snapshot failure accepted")
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_roadmap_commitments`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("snapshot rollback baseline count %d %v", count, err)
	}
	if err = db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-SELECT'`).Scan(&rootRevision); err != nil || rootRevision != commitInput.ExpectedRevision {
		t.Fatalf("snapshot rollback root %d %v", rootRevision, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_cross_snapshot`); err != nil {
		t.Fatal(err)
	}
	if _, err = run("commit"); err != nil {
		t.Fatal(err)
	}
	var crossBaselineID int64
	var oldSnapshot []byte
	if err = db.QueryRow(`SELECT id,item_snapshot FROM product_roadmap_commitments ORDER BY id DESC LIMIT 1`).Scan(&crossBaselineID, &oldSnapshot); err != nil {
		t.Fatal(err)
	}
	// Only the predecessor changes; source item/cycle/queue stay unchanged.
	if _, err = db.Exec(`UPDATE product_planning_items SET revision=revision+1 WHERE id=?`, crossID); err != nil {
		t.Fatal(err)
	}
	commitInput.ExpectedRevision++
	commitInput.ExpectedPreviousID = crossBaselineID
	commitIdentity.IdempotencyKey = "cross-reconfirmation"
	reconfirmed, err := run("commit")
	if err != nil {
		t.Fatalf("cross-only reconfirmation: %v", err)
	}
	replayed, err := run("commit")
	if err != nil || !replayed.Replayed || replayed.ReceiptID != reconfirmed.ReceiptID {
		t.Fatalf("reconfirmation replay %+v %v", replayed, err)
	}
	var unchangedSnapshot []byte
	if err = db.QueryRow(`SELECT item_snapshot FROM product_roadmap_commitments WHERE id=?`, crossBaselineID).Scan(&unchangedSnapshot); err != nil {
		t.Fatal(err)
	}
	if string(oldSnapshot) != string(unchangedSnapshot) {
		t.Fatal("reconfirmation rewrote previous baseline")
	}
	var previousLink int64
	var fingerprintChanged bool
	if err = db.QueryRow(`SELECT JSON_EXTRACT(n.item_snapshot,'$.previous_commitment_id'),JSON_EXTRACT(n.item_snapshot,'$.cross_dependency_fingerprint')<>JSON_EXTRACT(p.item_snapshot,'$.cross_dependency_fingerprint') FROM product_roadmap_commitments n JOIN product_roadmap_commitments p ON p.id=? ORDER BY n.id DESC LIMIT 1`, crossBaselineID).Scan(&previousLink, &fingerprintChanged); err != nil || previousLink != crossBaselineID || !fingerprintChanged {
		t.Fatalf("reconfirmation evidence %d %v %v", previousLink, fingerprintChanged, err)
	}
	var storedRevision uint64
	var storedLifecycle, storedTitle string
	if err = db.QueryRow(`SELECT predecessor_revision,JSON_UNQUOTE(JSON_EXTRACT(snapshot,'$.lifecycle')),JSON_UNQUOTE(JSON_EXTRACT(snapshot,'$.title')) FROM product_roadmap_cross_dependency_snapshots WHERE commitment_id=?`, crossBaselineID).Scan(&storedRevision, &storedLifecycle, &storedTitle); err != nil || storedRevision != 1 || storedLifecycle != "delivered" || storedTitle == "" {
		t.Fatalf("original predecessor snapshot %d %s %s %v", storedRevision, storedLifecycle, storedTitle, err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_roadmap_cross_dependency_snapshots`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("snapshot replay count %d %v", count, err)
	}
	view = permit("view")
	view.Resource = "product_roadmaps"
	history, e = ListRoadmapCommitments(ctx, db, "P-SELECT", "pm", draft.ItemBizID, view, permit("view"), 1, 2)
	if e != nil || len(history.Items) != 2 || slices.Contains(history.Items[0].ReviewReasons, "cross_dependencies_changed") || !slices.Contains(history.Items[1].ReviewReasons, "cross_dependencies_changed") {
		t.Fatalf("reconfirmed review %+v %v", history, e)
	}
	var baselineBizID string
	if err = db.QueryRow(`SELECT biz_id FROM product_roadmap_commitments WHERE id=?`, crossBaselineID).Scan(&baselineBizID); err != nil {
		t.Fatal(err)
	}
	targetView := workspacePermit(t, db, "P-CROSS-REVIEW", "pm", "view")
	targetView.Resource = "product_priorities"
	visibleTargets := map[string]AuthorizationPermit{"P-CROSS-REVIEW": targetView}
	frozenPage, err := ListRoadmapCrossSnapshots(ctx, db, "P-SELECT", "pm", baselineBizID, view, permit("view"), visibleTargets, 1, 20)
	if err != nil || frozenPage.Total != 1 || len(frozenPage.Items) != 1 || frozenPage.Items[0].PredecessorRevision != 1 {
		t.Fatalf("visible snapshot %+v %v", frozenPage, err)
	}
	hiddenPage, err := ListRoadmapCrossSnapshots(ctx, db, "P-SELECT", "pm", baselineBizID, view, permit("view"), nil, 1, 20)
	if err != nil || hiddenPage.Total != 0 || len(hiddenPage.Items) != 0 {
		t.Fatalf("hidden snapshot leaked %+v %v", hiddenPage, err)
	}
	secondPage, err := ListRoadmapCrossSnapshots(ctx, db, "P-SELECT", "pm", baselineBizID, view, permit("view"), visibleTargets, 2, 1)
	if err != nil || secondPage.Total != 1 || len(secondPage.Items) != 0 {
		t.Fatalf("snapshot pagination %+v %v", secondPage, err)
	}
	wrongTarget := targetView
	wrongTarget.Resource = "product_features"
	_, err = ListRoadmapCrossSnapshots(ctx, db, "P-SELECT", "pm", baselineBizID, view, permit("view"), map[string]AuthorizationPermit{"P-CROSS-REVIEW": wrongTarget}, 1, 20)
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`DELETE FROM product_cross_dependencies WHERE planning_item_id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	retained, err := ListRoadmapCrossSnapshots(ctx, db, "P-SELECT", "pm", baselineBizID, view, permit("view"), visibleTargets, 1, 20)
	if err != nil || len(retained.Items) != 1 || string(retained.Items[0].Snapshot) != string(frozenPage.Items[0].Snapshot) {
		t.Fatalf("deleted live dependency lost history %+v %v", retained, err)
	}
	targets, err := DiscoverRoadmapCrossSnapshotTargets(ctx, db, "P-SELECT", "pm", baselineBizID, view, permit("view"))
	if err != nil || targets.CommitmentBizID != baselineBizID || targets.ItemBizID != draft.ItemBizID || len(targets.ProductCodes) != 1 || targets.ProductCodes[0] != "P-CROSS-REVIEW" {
		t.Fatalf("historical targets %+v %v", targets, err)
	}
	wrong := view
	wrong.Resource = "product_features"
	_, e = ListRoadmapCommitments(ctx, db, "P-SELECT", "pm", draft.ItemBizID, view, wrong, 1, 1)
	requireProductRule(t, e, "product_authorization_invalid")
}
