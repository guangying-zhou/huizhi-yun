package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLPlanningAssessmentAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-ASSESS")
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-ASSESS", "pm", action)
		p.Resource = "product_priorities"
		return p
	}
	itemID := planningFixture(t, db, "P-ASSESS")
	input := assessmentDraft()
	if err := db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, itemID).Scan(&input.ItemBizID); err != nil {
		t.Fatal(err)
	}
	result, err := CreatePlanningCycle(ctx, db, CommandIdentity{ProductCode: "P-ASSESS", ActorUID: "pm", Action: "product_priorities:cycle-create", IdempotencyKey: "cycle"}, permit("edit"), PlanningCycleDraft{ExpectedRevision: 1, Title: "评估周期", StartsOn: "2099-01-01", EndsOn: "2099-01-31", GoalSummary: "目标", ReviewIntervalDays: 14})
	if err != nil {
		t.Fatal(err)
	}
	var cycle struct {
		BizID string `json:"biz_id"`
	}
	if err = json.Unmarshal(result.Value, &cycle); err != nil {
		t.Fatal(err)
	}
	input.CycleBizID = cycle.BizID
	input.ExpectedRevision = 2
	_, err = AddPlanningCycleCandidate(ctx, db, CommandIdentity{ProductCode: "P-ASSESS", ActorUID: "pm", Action: "product_priorities:candidate-add", IdempotencyKey: "candidate"}, permit("edit"), input.PlanningCycleCandidateAdd)
	if err != nil {
		t.Fatal(err)
	}
	input.ExpectedRevision = 3
	input.ExpectedCycleRevision = 2
	identity := CommandIdentity{ProductCode: "P-ASSESS", ActorUID: "pm", Action: "product_priorities:assess", IdempotencyKey: "assessment"}
	_, err = CreatePlanningAssessment(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	_, err = CreatePlanningAssessment(ctx, db, identity, permit("assess"), input)
	requireProductRule(t, err, "planning_cycle_readonly")
	if _, err = db.Exec(`UPDATE product_planning_cycles SET status='open',total_person_days=10,reserve_person_days=1,reliability_person_days=3,usability_person_days=3,growth_person_days=3 WHERE biz_id=?`, cycle.BizID); err != nil {
		t.Fatal(err)
	}
	stale := input
	stale.ExpectedEvidenceRevision = 2
	_, err = CreatePlanningAssessment(ctx, db, identity, permit("assess"), stale)
	requireProductRule(t, err, "product_planning_revision_conflict")
	if _, err = db.Exec(`CREATE TRIGGER pc_fail_assess BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = CreatePlanningAssessment(ctx, db, identity, permit("assess"), input); err == nil {
		t.Fatal("audit failure committed")
	}
	var count, rootRev, cycleRev, queueRev int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_priority_assessments`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("rollback assessments %d %v", count, err)
	}
	if err = db.QueryRow(`SELECT w.revision,c.revision,c.queue_revision FROM product_workspaces w JOIN product_planning_cycles c ON c.product_code=w.product_code WHERE c.biz_id=?`, cycle.BizID).Scan(&rootRev, &cycleRev, &queueRev); err != nil || rootRev != 3 || cycleRev != 2 || queueRev != 2 {
		t.Fatalf("rollback %d %d %d %v", rootRev, cycleRev, queueRev, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_fail_assess`); err != nil {
		t.Fatal(err)
	}
	result, err = CreatePlanningAssessment(ctx, db, identity, permit("assess"), input)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := CreatePlanningAssessment(ctx, db, identity, permit("assess"), input)
	if err != nil || !replay.Replayed || replay.ReceiptID != result.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	var score, selection, estimator string
	if err = db.QueryRow(`SELECT a.priority_score,i.selection_status,a.estimated_by FROM product_priority_assessments a JOIN product_planning_cycle_items i ON i.current_assessment_id=a.id`).Scan(&score, &selection, &estimator); err != nil || score != "7.80000000" || selection != "candidate" || estimator != "pm" {
		t.Fatalf("assessment %s %s %s %v", score, selection, estimator, err)
	}
	scoredCandidates, err := ListPlanningCycleCandidates(ctx, db, "P-ASSESS", "pm", permit("view"), PlanningCycleCandidateQuery{CycleBizID: cycle.BizID, Page: 1, PageSize: 20})
	if err != nil || len(scoredCandidates.Items) != 1 || scoredCandidates.Items[0].Assessment == nil {
		t.Fatalf("scored candidates %+v %v", scoredCandidates, err)
	}
	currentScore := scoredCandidates.Items[0].Assessment
	if currentScore.Stale || currentScore.PriorityScore == nil || *currentScore.PriorityScore != "7.80000000" || currentScore.Effort == nil || *currentScore.Effort != "8.00" {
		t.Fatalf("current candidate score %+v", currentScore)
	}
	var evidenceKey, reference string
	if err = db.QueryRow(`SELECT JSON_UNQUOTE(JSON_EXTRACT(evidence_snapshot,'$.manual_observations[0].key')),JSON_UNQUOTE(JSON_EXTRACT(rationale,'$.evidence_references.risk[0]')) FROM product_priority_assessments LIMIT 1`).Scan(&evidenceKey, &reference); err != nil || evidenceKey != "trial" || reference != evidenceKey {
		t.Fatalf("frozen reference %s %s %v", evidenceKey, reference, err)
	}
	if _, err = db.Exec(`UPDATE product_priority_assessments SET strategic=0`); err == nil {
		t.Fatal("immutable snapshot updated")
	}
	input.ExpectedRevision = 4
	input.ExpectedCycleRevision = 3
	input.Assessment.Effort = nil
	input.EstimateConfirmed = false
	delete(input.Rationale, "effort_person_days")
	delete(input.EvidenceReferences, "effort_person_days")
	identity.IdempotencyKey = "reassessment"
	if _, err = CreatePlanningAssessment(ctx, db, identity, permit("assess"), input); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_priority_assessments`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("history %d %v", count, err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_priority_assessments a JOIN product_planning_cycle_items i ON i.current_assessment_id=a.id WHERE a.priority_score IS NULL AND a.estimated_by IS NULL`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("unknown assessment %d %v", count, err)
	}
	if err = db.QueryRow(`SELECT queue_revision FROM product_planning_cycles WHERE biz_id=?`, cycle.BizID).Scan(&queueRev); err != nil || queueRev != 2 {
		t.Fatalf("score changed queue %d %v", queueRev, err)
	}
	query := PlanningAssessmentQuery{CycleBizID: cycle.BizID, ItemBizID: input.ItemBizID, Page: 1, PageSize: 1}
	history, err := ListPlanningAssessments(ctx, db, "P-ASSESS", "pm", permit("view"), query)
	if err != nil || history.Total != 2 || len(history.Items) != 1 || !history.Items[0].IsCurrent || history.Items[0].Stale || history.Items[0].PriorityScore != nil || history.Items[0].EstimatedBy != nil {
		t.Fatalf("current history %+v %v", history, err)
	}
	query.Page = 2
	history, err = ListPlanningAssessments(ctx, db, "P-ASSESS", "pm", permit("view"), query)
	if err != nil || history.Total != 2 || len(history.Items) != 1 || history.Items[0].IsCurrent || history.Items[0].PriorityScore == nil || *history.Items[0].PriorityScore != "7.80000000" {
		t.Fatalf("prior history %+v %v", history, err)
	}
	query.Page = 3
	history, err = ListPlanningAssessments(ctx, db, "P-ASSESS", "pm", permit("view"), query)
	if err != nil || history.Total != 2 || history.Items == nil || len(history.Items) != 0 {
		t.Fatalf("empty page %+v %v", history, err)
	}
	wrong := permit("view")
	wrong.Resource = "product_requests"
	_, err = ListPlanningAssessments(ctx, db, "P-ASSESS", "pm", wrong, query)
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`UPDATE product_planning_items SET evidence_revision=evidence_revision+1 WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	query.Page = 1
	history, err = ListPlanningAssessments(ctx, db, "P-ASSESS", "pm", permit("view"), query)
	if err != nil || len(history.Items) != 1 || !history.Items[0].Stale || !history.Items[0].IsCurrent {
		t.Fatalf("stale current %+v %v", history, err)
	}

	candidates, err := ListPlanningCycleCandidates(ctx, db, "P-ASSESS", "pm", permit("view"), PlanningCycleCandidateQuery{CycleBizID: cycle.BizID, Page: 1, PageSize: 20})
	if err != nil || len(candidates.Items) != 1 || candidates.Items[0].Assessment == nil || !candidates.Items[0].Assessment.Stale || candidates.Items[0].Assessment.PriorityScore != nil || candidates.Items[0].Assessment.ValueScore == nil || *candidates.Items[0].Assessment.ValueScore != 78 {
		t.Fatalf("candidate assessment %+v %v", candidates, err)
	}

	// Add two independent current scopes with different exact scores; persisted order is the reverse.
	var expectedFirst string
	for index := 0; index < 2; index++ {
		newID := planningFixture(t, db, "P-ASSESS")
		if index == 1 {
			if err = db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, newID).Scan(&expectedFirst); err != nil {
				t.Fatal(err)
			}
		}
		if _, err = db.Exec(`INSERT INTO product_planning_cycle_items(cycle_id,planning_item_id,product_code,decision_rank) SELECT id,?,'P-ASSESS',? FROM product_planning_cycles WHERE biz_id=?`, newID, index+2, cycle.BizID); err != nil {
			t.Fatal(err)
		}
		effort, priority := "8.00", "7.80000000"
		if index == 1 {
			effort, priority = "4.00", "15.60000000"
		}
		inserted, e := db.Exec(`INSERT INTO product_priority_assessments(cycle_id,planning_item_id,scope_revision,evidence_revision,model_version,model_snapshot,strategic,user_value,business,risk,confidence,effort_person_days,effort_unit,value_score,priority_score,evidence_snapshot,rationale,assessed_by,estimated_by,assessed_at) SELECT cycle_id,?,1,1,model_version,model_snapshot,strategic,user_value,business,risk,confidence,?,'person_day',value_score,?,evidence_snapshot,rationale,assessed_by,estimated_by,assessed_at FROM product_priority_assessments ORDER BY id LIMIT 1`, newID, effort, priority)
		if e != nil {
			t.Fatal(e)
		}
		assessmentID, e := inserted.LastInsertId()
		if e != nil {
			t.Fatal(e)
		}
		if _, err = db.Exec(`UPDATE product_planning_cycle_items SET current_assessment_id=? WHERE planning_item_id=?`, assessmentID, newID); err != nil {
			t.Fatal(err)
		}
	}
	sorted, err := ListPlanningCycleCandidates(ctx, db, "P-ASSESS", "pm", permit("view"), PlanningCycleCandidateQuery{CycleBizID: cycle.BizID, Page: 1, PageSize: 20, Sort: "recommended", InvestmentCategory: "growth"})
	if err != nil || sorted.Total != 3 || len(sorted.Items) != 3 || sorted.Items[0].BizID != expectedFirst || sorted.Items[2].BizID != input.ItemBizID {
		t.Fatalf("recommendation %+v %v", sorted, err)
	}
	decided, err := ListPlanningCycleCandidates(ctx, db, "P-ASSESS", "pm", permit("view"), PlanningCycleCandidateQuery{CycleBizID: cycle.BizID, Page: 1, PageSize: 20})
	if err != nil || decided.Items[0].BizID != input.ItemBizID || decided.QueueRevision != sorted.QueueRevision {
		t.Fatalf("recommendation mutated decision %+v %v", decided, err)
	}
	filtered, err := ListPlanningCycleCandidates(ctx, db, "P-ASSESS", "pm", permit("view"), PlanningCycleCandidateQuery{CycleBizID: cycle.BizID, Page: 1, PageSize: 20, Sort: "recommended", InvestmentCategory: "reliability"})
	if err != nil || filtered.Total != 0 || len(filtered.Items) != 0 {
		t.Fatalf("category filter %+v %v", filtered, err)
	}

	matrix, err := ReadPlanningMatrix(ctx, db, "P-ASSESS", "pm", permit("view"), PlanningMatrixQuery{CycleBizID: cycle.BizID})
	if err != nil || matrix.Total != 3 || matrix.Returned != 3 || matrix.Truncated || len(matrix.Points) != 2 || len(matrix.Unplotted) != 1 || matrix.ValueThreshold != "50.00" || matrix.EffortThreshold != "5.00" {
		t.Fatalf("matrix %+v %v", matrix, err)
	}
	emptyMatrix, err := ReadPlanningMatrix(ctx, db, "P-ASSESS", "pm", permit("view"), PlanningMatrixQuery{CycleBizID: cycle.BizID, InvestmentCategory: "reliability"})
	if err != nil || emptyMatrix.Total != 0 || emptyMatrix.Points == nil || emptyMatrix.Unplotted == nil {
		t.Fatalf("empty matrix %+v %v", emptyMatrix, err)
	}
	move := PlanningQueueMove{CycleBizID: cycle.BizID, ExpectedRevision: sorted.WorkspaceRevision, ExpectedCycleRevision: sorted.CycleRevision, ExpectedQueueRevision: sorted.QueueRevision, Move: Move{ItemID: expectedFirst, BeforeID: input.ItemBizID}, Reason: "优先验证增长事项"}
	capacity, err := ReadPlanningCapacity(ctx, db, "P-ASSESS", "pm", cycle.BizID, permit("view"))
	if err != nil || capacity.Confirmed.SelectedEffort != 0 || capacity.Latest.Remaining != 900 {
		t.Fatalf("empty capacity %+v %v", capacity, err)
	}
	if _, err = db.Exec(`UPDATE product_planning_cycle_items SET selection_status='selected' WHERE cycle_id=(SELECT id FROM product_planning_cycles WHERE biz_id=?) AND planning_item_id=?`, cycle.BizID, itemID); err != nil {
		t.Fatal(err)
	}
	_, err = ReadPlanningCapacity(ctx, db, "P-ASSESS", "pm", cycle.BizID, permit("view"))
	requireProductRule(t, err, "planning_decision_snapshot_invalid")
	baseline, _ := json.Marshal(map[string]any{"capacity": PlanningCapacityBaseline{Version: 1, ItemBizID: input.ItemBizID, Category: Growth, Effort: func() *Hundredths { v := Hundredths(600); return &v }()}})
	if _, err = db.Exec(`UPDATE product_planning_cycle_items SET decision_snapshot=? WHERE planning_item_id=?`, baseline, itemID); err != nil {
		t.Fatal(err)
	}
	capacity, err = ReadPlanningCapacity(ctx, db, "P-ASSESS", "pm", cycle.BizID, permit("view"))
	if err != nil || capacity.Confirmed.SelectedEffort != 600 || len(capacity.Changes) != 1 {
		t.Fatalf("frozen capacity %+v %v", capacity, err)
	}
	badCapacityPermit := permit("view")
	badCapacityPermit.Resource = "product_requests"
	if _, err = ReadPlanningCapacity(ctx, db, "P-ASSESS", "pm", cycle.BizID, badCapacityPermit); err == nil {
		t.Fatal("wrong capacity resource authorized")
	}
	if _, err = db.Exec(`UPDATE product_planning_items SET lifecycle='delivered' WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	capacity, err = ReadPlanningCapacity(ctx, db, "P-ASSESS", "pm", cycle.BizID, permit("view"))
	if err != nil || capacity.Confirmed.SelectedEffort != 600 || capacity.Latest.SelectedEffort != 600 || len(capacity.Changes) != 0 {
		t.Fatalf("completed capacity %+v %v", capacity, err)
	}
	if _, err = db.Exec(`UPDATE product_planning_items SET lifecycle='proposed' WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE product_planning_cycle_items SET selection_status='candidate',decision_snapshot=NULL WHERE planning_item_id=?`, itemID); err != nil {
		t.Fatal(err)
	}

	categoryBaseline, _ := json.Marshal(map[string]any{"capacity": PlanningCapacityBaseline{Version: 1, ItemBizID: expectedFirst, Category: Growth, Effort: func() *Hundredths { v := Hundredths(400); return &v }()}})
	if _, err = db.Exec(`UPDATE product_planning_cycle_items SET selection_status='selected',decision_snapshot=? WHERE planning_item_id=(SELECT id FROM product_planning_items WHERE biz_id=?)`, categoryBaseline, expectedFirst); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE product_planning_items SET investment_category='reliability' WHERE biz_id=?`, expectedFirst); err != nil {
		t.Fatal(err)
	}
	capacity, err = ReadPlanningCapacity(ctx, db, "P-ASSESS", "pm", cycle.BizID, permit("view"))
	if err != nil || capacity.Confirmed.ByCategory[Growth] != 400 || capacity.Latest.ByCategory[Reliability] != 400 || len(capacity.Changes) != 1 || capacity.Changes[0].LatestCategory != Reliability {
		t.Fatalf("category capacity %+v %v", capacity, err)
	}
	foundCategoryIssue := false
	for _, issue := range capacity.Latest.Issues {
		if issue.Code == "category_capacity_exceeded" && issue.Category == Reliability {
			foundCategoryIssue = true
		}
	}
	if !foundCategoryIssue {
		t.Fatal("new category overcapacity hidden")
	}
	if _, err = db.Exec(`UPDATE product_planning_items SET investment_category='growth' WHERE biz_id=?`, expectedFirst); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE product_planning_cycle_items SET selection_status='candidate',decision_snapshot=NULL WHERE planning_item_id=(SELECT id FROM product_planning_items WHERE biz_id=?)`, expectedFirst); err != nil {
		t.Fatal(err)
	}

	preview, err := PreviewPlanningQueueMove(ctx, db, "P-ASSESS", "pm", permit("view"), move)
	if err != nil || preview.Total != 3 || len(preview.Affected) != 3 || preview.Affected[0].ItemBizID != expectedFirst || preview.Affected[0].BeforePosition != 3 || preview.Affected[0].AfterPosition != 1 || preview.QueueRevision != sorted.QueueRevision {
		t.Fatalf("move preview %+v %v", preview, err)
	}
	wrongPreview := permit("view")
	wrongPreview.Resource = "product_requests"
	_, err = PreviewPlanningQueueMove(ctx, db, "P-ASSESS", "pm", wrongPreview, move)
	requireProductRule(t, err, "product_authorization_invalid")
	moveIdentity := CommandIdentity{ProductCode: "P-ASSESS", ActorUID: "pm", Action: "product_priorities:move", IdempotencyKey: "move"}
	_, err = MovePlanningQueue(ctx, db, moveIdentity, permit("edit"), move)
	requireProductRule(t, err, "product_authorization_invalid")
	staleMove := move
	staleMove.ExpectedQueueRevision++
	_, err = MovePlanningQueue(ctx, db, moveIdentity, permit("prioritize"), staleMove)
	requireProductRule(t, err, "priority_queue_conflict")
	if _, err = db.Exec(`CREATE TRIGGER pc_fail_move BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = MovePlanningQueue(ctx, db, moveIdentity, permit("prioritize"), move); err == nil {
		t.Fatal("move audit failure committed")
	}
	rollback, err := ListPlanningCycleCandidates(ctx, db, "P-ASSESS", "pm", permit("view"), PlanningCycleCandidateQuery{CycleBizID: cycle.BizID, Page: 1, PageSize: 20})
	if err != nil || rollback.Items[0].BizID != input.ItemBizID || rollback.QueueRevision != move.ExpectedQueueRevision || rollback.WorkspaceRevision != move.ExpectedRevision {
		t.Fatalf("move rollback %+v %v", rollback, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_fail_move`); err != nil {
		t.Fatal(err)
	}
	moved, err := MovePlanningQueue(ctx, db, moveIdentity, permit("prioritize"), move)
	if err != nil {
		t.Fatal(err)
	}
	assertMoveReceipt := func(result CommandResult, changed bool, workspace, cycleRevision, queue uint64) {
		t.Helper()
		var value struct {
			Cycle     string `json:"cycle_biz_id"`
			Changed   *bool  `json:"changed"`
			Workspace uint64 `json:"workspace_revision"`
			Revision  uint64 `json:"cycle_revision"`
			Queue     uint64 `json:"queue_revision"`
		}
		if err := json.Unmarshal(result.Value, &value); err != nil || result.ReceiptID < 1 || value.Cycle != cycle.BizID || value.Changed == nil || *value.Changed != changed || value.Workspace != workspace || value.Revision != cycleRevision || value.Queue != queue {
			t.Fatalf("queue receipt disagrees with committed revisions: %s %v", result.Value, err)
		}
	}
	assertMoveReceipt(moved, true, move.ExpectedRevision+1, move.ExpectedCycleRevision+1, move.ExpectedQueueRevision+1)
	moveReplay, err := MovePlanningQueue(ctx, db, moveIdentity, permit("prioritize"), move)
	if err != nil || !moveReplay.Replayed || moveReplay.ReceiptID != moved.ReceiptID {
		t.Fatalf("move replay %+v %v", moveReplay, err)
	}
	assertMoveReceipt(moveReplay, true, move.ExpectedRevision+1, move.ExpectedCycleRevision+1, move.ExpectedQueueRevision+1)
	reordered, err := ListPlanningCycleCandidates(ctx, db, "P-ASSESS", "pm", permit("view"), PlanningCycleCandidateQuery{CycleBizID: cycle.BizID, Page: 1, PageSize: 20})
	if err != nil || reordered.Items[0].BizID != expectedFirst || reordered.Items[1].BizID != input.ItemBizID || reordered.QueueRevision != move.ExpectedQueueRevision+1 {
		t.Fatalf("moved queue %+v %v", reordered, err)
	}
	move.ExpectedRevision = reordered.WorkspaceRevision
	move.ExpectedCycleRevision = reordered.CycleRevision
	move.ExpectedQueueRevision = reordered.QueueRevision
	moveIdentity.IdempotencyKey = "noop-move"
	noop, err := MovePlanningQueue(ctx, db, moveIdentity, permit("prioritize"), move)
	if err != nil {
		t.Fatal(err)
	}
	assertMoveReceipt(noop, false, move.ExpectedRevision, move.ExpectedCycleRevision, move.ExpectedQueueRevision)
	unchanged, err := ListPlanningCycleCandidates(ctx, db, "P-ASSESS", "pm", permit("view"), PlanningCycleCandidateQuery{CycleBizID: cycle.BizID, Page: 1, PageSize: 20})
	if err != nil || unchanged.QueueRevision != reordered.QueueRevision || unchanged.WorkspaceRevision != reordered.WorkspaceRevision {
		t.Fatalf("noop changed queue %+v %v", unchanged, err)
	}

	// The currently first item is a selected predecessor of the currently second item.
	if _, err = db.Exec(`UPDATE product_planning_cycle_items SET selection_status='selected' WHERE planning_item_id IN (?,?)`, reordered.Items[0].ID, reordered.Items[1].ID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_planning_dependencies(product_code,planning_item_id,predecessor_id,created_by,created_at) VALUES ('P-ASSESS',?,?,'pm',UTC_TIMESTAMP(3))`, reordered.Items[1].ID, reordered.Items[0].ID); err != nil {
		t.Fatal(err)
	}
	dependencyMove := move
	dependencyMove.Move = Move{ItemID: reordered.Items[1].BizID, BeforeID: reordered.Items[0].BizID}
	moveIdentity.IdempotencyKey = "invalid-dependency-move"
	_, err = MovePlanningQueue(ctx, db, moveIdentity, permit("prioritize"), dependencyMove)
	requireProductRule(t, err, "planning_dependency_order_invalid")
	dependencyRollback, err := ListPlanningCycleCandidates(ctx, db, "P-ASSESS", "pm", permit("view"), PlanningCycleCandidateQuery{CycleBizID: cycle.BizID, Page: 1, PageSize: 20})
	if err != nil || dependencyRollback.Items[0].BizID != reordered.Items[0].BizID || dependencyRollback.QueueRevision != reordered.QueueRevision || dependencyRollback.WorkspaceRevision != reordered.WorkspaceRevision {
		t.Fatalf("dependency rollback %+v %v", dependencyRollback, err)
	}
	// Delivered prerequisites no longer constrain the remaining planning order.
	if _, err = db.Exec(`UPDATE product_planning_items SET lifecycle='delivered' WHERE id=?`, reordered.Items[0].ID); err != nil {
		t.Fatal(err)
	}
	moveIdentity.IdempotencyKey = "delivered-predecessor-move"
	if _, err = MovePlanningQueue(ctx, db, moveIdentity, permit("prioritize"), dependencyMove); err != nil {
		t.Fatal(err)
	}

	for index := 0; index < 199; index++ {
		extraID := planningFixture(t, db, "P-ASSESS")
		if _, err = db.Exec(`INSERT INTO product_planning_cycle_items(cycle_id,planning_item_id,product_code,decision_rank) SELECT id,?,'P-ASSESS',? FROM product_planning_cycles WHERE biz_id=?`, extraID, index+4, cycle.BizID); err != nil {
			t.Fatal(err)
		}
	}
	bounded, err := ReadPlanningMatrix(ctx, db, "P-ASSESS", "pm", permit("view"), PlanningMatrixQuery{CycleBizID: cycle.BizID})
	if err != nil || bounded.Total != 202 || bounded.Returned != 200 || !bounded.Truncated || len(bounded.Points)+len(bounded.Unplotted) != 200 {
		t.Fatalf("bounded matrix total=%d returned=%d %v", bounded.Total, bounded.Returned, err)
	}

}
