package productcenter

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

func TestMySQLRICEObservationMigration(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-REACH")
	workspaceFixture(t, db, "P-OTHER")
	for _, name := range []string{"migration_v5.29_priority_model_versions.sql", "migration_v5.30_rice_reach_observations.sql"} {
		script, err := os.ReadFile("../../../../../aims/docs/" + name)
		if err != nil {
			t.Fatal(err)
		}
		executeSQLScript(t, db, string(script))
	}
	item := planningFixture(t, db, "P-REACH")
	permit := workspacePermit(t, db, "P-REACH", "pm", "admin")
	permit.Resource = "product_priorities"
	_, err := CreateRICEModelVersion(context.Background(), db, CommandIdentity{ProductCode: "P-REACH", ActorUID: "pm", Action: "product_priorities:model-create", IdempotencyKey: "model"}, permit, RICEModelCreate{ExpectedRevision: 1, Title: "RICE", Reason: "统计口径", Model: riceModel()})
	if err != nil {
		t.Fatal(err)
	}
	insert := `INSERT INTO product_rice_reach_observations(biz_id,product_code,planning_item_id,model_version,scope_revision,evidence_revision,reach_count,snapshot,recorded_by,recorded_at) VALUES(UUID(),?,?,?, ?,1,?,?,'pm',UTC_TIMESTAMP(3))`
	if _, err = db.Exec(insert, "P-REACH", item, riceModel().Version, 1, 0, `{"source_reference":"report-1"}`); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]any{
		{"P-OTHER", item, riceModel().Version, 1, 1, `{}`},
		{"P-REACH", item, "missing-model", 1, 1, `{}`},
		{"P-REACH", item, riceModel().Version, 0, 1, `{}`},
		{"P-REACH", item, riceModel().Version, 1, 1000000001, `{}`},
		{"P-REACH", item, riceModel().Version, 1, 1, `[]`},
	} {
		if _, err = db.Exec(insert, args...); err == nil {
			t.Fatalf("accepted invalid row %+v", args)
		}
	}
	for _, sql := range []string{"UPDATE product_rice_reach_observations SET reach_count=1", "DELETE FROM product_rice_reach_observations"} {
		if _, err = db.Exec(sql); err == nil {
			t.Fatal("immutable evidence changed")
		}
	}
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.30_rice_reach_observations.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	var count, reach int
	if err = db.QueryRow("SELECT COUNT(*),SUM(reach_count) FROM product_rice_reach_observations").Scan(&count, &reach); err != nil || count != 1 || reach != 0 {
		t.Fatalf("repeat migration %d %d %v", count, reach, err)
	}
	var itemBiz string
	var itemRevision, scopeRevision, evidenceRevision uint64
	if err = db.QueryRow("SELECT biz_id,revision,scope_revision,evidence_revision FROM product_planning_items WHERE id=?", item).Scan(&itemBiz, &itemRevision, &scopeRevision, &evidenceRevision); err != nil {
		t.Fatal(err)
	}
	input := RICEObservationCreate{ItemBizID: itemBiz, ModelVersion: riceModel().Version, ExpectedRevision: 2, ExpectedItemRevision: itemRevision, ExpectedScopeRevision: scopeRevision, ExpectedEvidenceRevision: evidenceRevision, Reach: 450, SourceReference: "report-2026-q4", Methodology: "按 UID 去重并排除测试账号"}
	identity := CommandIdentity{ProductCode: "P-REACH", ActorUID: "pm", Action: "product_priorities:reach-record", IdempotencyKey: "reach"}
	freshPermit := func() AuthorizationPermit {
		p := workspacePermit(t, db, "P-REACH", "pm", "assess")
		p.Resource = "product_priorities"
		return p
	}
	if _, err = db.Exec("CREATE TRIGGER reject_reach_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit unavailable'"); err != nil {
		t.Fatal(err)
	}
	if _, err = CreateRICEReachObservation(context.Background(), db, identity, freshPermit(), input); err == nil {
		t.Fatal("audit failure accepted")
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM product_rice_reach_observations").Scan(&count); err != nil || count != 1 {
		t.Fatal("failed command persisted observation", err)
	}
	if _, err = db.Exec("DROP TRIGGER reject_reach_audit"); err != nil {
		t.Fatal(err)
	}
	saved, err := CreateRICEReachObservation(context.Background(), db, identity, freshPermit(), input)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := CreateRICEReachObservation(context.Background(), db, identity, freshPermit(), input)
	if err != nil || !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	var finalEvidence uint64
	var recorder string
	if err = db.QueryRow("SELECT evidence_revision FROM product_planning_items WHERE id=?", item).Scan(&finalEvidence); err != nil || finalEvidence != evidenceRevision+1 {
		t.Fatal("evidence did not advance once", err)
	}
	if err = db.QueryRow("SELECT recorded_by FROM product_rice_reach_observations WHERE reach_count=450").Scan(&recorder); err != nil || recorder != "pm" {
		t.Fatal("recorder not bound", err)
	}

	var receipt struct {
		Observation RICEReachObservation `json:"observation"`
	}
	if err = json.Unmarshal(saved.Value, &receipt); err != nil {
		t.Fatal(err)
	}
	viewPermit := func() AuthorizationPermit {
		p := workspacePermit(t, db, "P-REACH", "pm", "view")
		p.Resource = "product_priorities"
		return p
	}
	view, err := ReadRICEReachObservation(context.Background(), db, "P-REACH", "pm", itemBiz, receipt.Observation.BizID, viewPermit())
	if err != nil || view.Stale || view.Observation.Reach != 450 || view.ItemRevision != itemRevision+1 {
		t.Fatalf("view %+v %v", view, err)
	}
	if _, err = ReadRICEReachObservation(context.Background(), db, "P-REACH", "pm", "00000000-0000-4000-8000-000000000099", receipt.Observation.BizID, viewPermit()); err == nil {
		t.Fatal("wrong item read succeeded")
	}

	schema31, e := os.ReadFile("../../../../../aims/docs/migration_v5.31_rice_assessments.sql")
	if e != nil {
		t.Fatal(e)
	}
	executeSQLScript(t, db, string(schema31))
	editPermit := func() AuthorizationPermit {
		p := workspacePermit(t, db, "P-REACH", "pm", "edit")
		p.Resource = "product_priorities"
		return p
	}
	zeroBudget, totalBudget, targetMetric := Hundredths(0), Hundredths(1000), "75"
	cycleCreated, e := CreatePlanningCycle(context.Background(), db, CommandIdentity{ProductCode: "P-REACH", ActorUID: "pm", Action: "product_priorities:cycle-create", IdempotencyKey: "rice-cycle"}, editPermit(), PlanningCycleDraft{ExpectedRevision: 3, Title: "RICE 评估事务测试", StartsOn: "2026-10-01", EndsOn: "2026-12-31", GoalSummary: "验证评估保存", ReviewIntervalDays: 14, Budget: &PlanningCycleBudget{Total: &totalBudget, Reserve: &zeroBudget, Reliability: &zeroBudget, Usability: &zeroBudget, Growth: &totalBudget}, Metric: &PlanningCycleMetric{Name: "成功率", Unit: "百分比", Direction: "increase", MeasurementMethod: "按用户去重", TargetValue: &targetMetric}})
	if e != nil {
		t.Fatal(e)
	}
	var riceCycle struct {
		BizID string `json:"biz_id"`
	}
	if e = json.Unmarshal(cycleCreated.Value, &riceCycle); e != nil {
		t.Fatal(e)
	}
	candidate := PlanningCycleCandidateAdd{CycleBizID: riceCycle.BizID, ItemBizID: itemBiz, ExpectedRevision: 4, ExpectedCycleRevision: 1, ExpectedItemRevision: itemRevision + 1}
	if _, e = AddPlanningCycleCandidate(context.Background(), db, CommandIdentity{ProductCode: "P-REACH", ActorUID: "pm", Action: "product_priorities:candidate-add", IdempotencyKey: "rice-candidate"}, editPermit(), candidate); e != nil {
		t.Fatal(e)
	}
	adminPermit := workspacePermit(t, db, "P-REACH", "pm", "admin")
	adminPermit.Resource = "product_priorities"
	if _, e = SelectPlanningCycleModel(context.Background(), db, CommandIdentity{ProductCode: "P-REACH", ActorUID: "pm", Action: "product_priorities:cycle-model-select", IdempotencyKey: "rice-select"}, adminPermit, PlanningCycleModelSelect{BizID: riceCycle.BizID, ModelVersion: riceModel().Version, ExpectedRevision: 5, ExpectedCycleRevision: 2, Reason: "已有当前 Reach 观测"}); e != nil {
		t.Fatal(e)
	}
	prioritizePermit := workspacePermit(t, db, "P-REACH", "pm", "prioritize")
	prioritizePermit.Resource = "product_priorities"
	if _, e = OpenPlanningCycle(context.Background(), db, CommandIdentity{ProductCode: "P-REACH", ActorUID: "pm", Action: "product_priorities:cycle-open", IdempotencyKey: "rice-open"}, prioritizePermit, PlanningCycleTransition{BizID: riceCycle.BizID, ExpectedRevision: 6, ExpectedCycleRevision: 3, Reason: "口径及观测已确认"}); e != nil {
		t.Fatal(e)
	}
	impact, confidence, effort := Hundredths(200), Hundredths(80), Hundredths(800)
	riceInput := PlanningRICEAssessmentCreate{PlanningCycleCandidateAdd: candidate, ExpectedScopeRevision: scopeRevision, ExpectedEvidenceRevision: evidenceRevision + 1, Assessment: RICEObservedAssessmentInput{ModelVersion: riceModel().Version, ObservationBizID: receipt.Observation.BizID, EffortUnit: "person_day", Impact: &impact, Confidence: &confidence, Effort: &effort}, Rationale: map[string]string{"impact": "降低阻断", "confidence": "试点证据", "effort_person_days": "设计开发测试"}, EvidenceReferences: map[string][]string{"impact": {"trial"}, "confidence": {"trial"}, "effort_person_days": {"trial"}}, Evidence: []AssessmentEvidence{{Key: "trial", Summary: "试点反馈", ObservedOn: "2026-10-02", Kind: "fact", Polarity: "supporting"}}, EstimateConfirmed: true}
	riceInput.ExpectedRevision = 7
	riceInput.ExpectedCycleRevision = 4
	riceIdentity := CommandIdentity{ProductCode: "P-REACH", ActorUID: "pm", Action: "product_priorities:rice-assess", IdempotencyKey: "rice-assess"}
	if _, e = db.Exec("CREATE TRIGGER reject_rice_assessment_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='rice audit unavailable'"); e != nil {
		t.Fatal(e)
	}
	if _, e = CreatePlanningRICEAssessment(context.Background(), db, riceIdentity, freshPermit(), riceInput); e == nil {
		t.Fatal("RICE assessment accepted audit failure")
	}
	for _, query := range []string{
		"SELECT COUNT(*) FROM product_priority_assessments WHERE model_method='rice'",
		"SELECT COUNT(*) FROM product_command_receipts WHERE action='product_priorities:rice-assess'",
		"SELECT COUNT(*) FROM product_planning_cycle_items WHERE current_assessment_id IS NOT NULL",
	} {
		var persisted int
		if e = db.QueryRow(query).Scan(&persisted); e != nil || persisted != 0 {
			t.Fatalf("audit failure left partial RICE state: %s => %d %v", query, persisted, e)
		}
	}
	var rootAfterFailure, cycleAfterFailure uint64
	if e = db.QueryRow("SELECT revision FROM product_workspaces WHERE product_code='P-REACH'").Scan(&rootAfterFailure); e != nil || rootAfterFailure != riceInput.ExpectedRevision {
		t.Fatalf("audit failure advanced product revision: %d %v", rootAfterFailure, e)
	}
	if e = db.QueryRow("SELECT revision FROM product_planning_cycles WHERE biz_id=?", riceCycle.BizID).Scan(&cycleAfterFailure); e != nil || cycleAfterFailure != riceInput.ExpectedCycleRevision {
		t.Fatalf("audit failure advanced cycle revision: %d %v", cycleAfterFailure, e)
	}
	if _, e = db.Exec("DROP TRIGGER reject_rice_assessment_audit"); e != nil {
		t.Fatal(e)
	}
	riceSaved, e := CreatePlanningRICEAssessment(context.Background(), db, riceIdentity, freshPermit(), riceInput)
	if e != nil {
		t.Fatal(e)
	}
	riceReplay, e := CreatePlanningRICEAssessment(context.Background(), db, riceIdentity, freshPermit(), riceInput)
	if e != nil || !riceReplay.Replayed || riceReplay.ReceiptID != riceSaved.ReceiptID {
		t.Fatalf("RICE replay %+v %v", riceReplay, e)
	}
	var priority, method string
	var valueScore any
	if e = db.QueryRow("SELECT priority_score,model_method,value_score FROM product_priority_assessments WHERE model_method='rice'").Scan(&priority, &method, &valueScore); e != nil || priority != "90.00000000" || method != "rice" || valueScore != nil {
		t.Fatalf("RICE persisted %s %s %v %v", priority, method, valueScore, e)
	}

	history, e := ListPlanningAssessments(context.Background(), db, "P-REACH", "pm", viewPermit(), PlanningAssessmentQuery{CycleBizID: riceCycle.BizID, ItemBizID: itemBiz, Page: 1, PageSize: 20})
	if e != nil || history.Total != 1 || len(history.Items) != 1 {
		t.Fatalf("RICE history %+v %v", history, e)
	}
	row := history.Items[0]
	if row.ModelMethod != "rice" || row.RICEImpact == nil || *row.RICEImpact != "2.00" || row.ReachObservationBizID == nil || *row.ReachObservationBizID != receipt.Observation.BizID || row.ValueScore != nil || !row.IsCurrent || row.Stale {
		t.Fatalf("RICE history fields %+v", row)
	}
	candidates, e := ListPlanningCycleCandidates(context.Background(), db, "P-REACH", "pm", viewPermit(), PlanningCycleCandidateQuery{CycleBizID: riceCycle.BizID, Sort: "recommended", Page: 1, PageSize: 20})
	if e != nil || len(candidates.Items) != 1 || candidates.Items[0].Assessment == nil {
		t.Fatalf("RICE recommended candidates %+v %v", candidates, e)
	}
	candidateAssessment := candidates.Items[0].Assessment
	if candidateAssessment.ModelMethod != "rice" || candidateAssessment.ValueScore != nil || candidateAssessment.RICEImpact == nil || *candidateAssessment.RICEImpact != "2.00" || candidateAssessment.PriorityScore == nil || *candidateAssessment.PriorityScore != "90.00000000" || candidateAssessment.Stale {
		t.Fatalf("RICE candidate assessment %+v", candidateAssessment)
	}
	matrix, e := ReadPlanningMatrix(context.Background(), db, "P-REACH", "pm", viewPermit(), PlanningMatrixQuery{CycleBizID: riceCycle.BizID})
	if e != nil || matrix.ModelMethod != "rice" || len(matrix.Points) != 1 || len(matrix.Unplotted) != 0 || matrix.Points[0].Assessment.ValueScore != nil {
		t.Fatalf("RICE matrix %+v %v", matrix, e)
	}
	checkScore := func(expectStale bool) {
		t.Helper()
		tx, e := db.BeginTx(context.Background(), nil)
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback()
		if e = AuthorizeWorkspaceTransaction(context.Background(), tx, "P-REACH", "pm", "product_priorities", "assess", freshPermit()); e != nil {
			t.Fatal(e)
		}
		current, e := loadPlanningItemDetail(context.Background(), tx, "P-REACH", itemBiz)
		if e != nil {
			t.Fatal(e)
		}
		impact, confidence, effort := Hundredths(200), Hundredths(80), Hundredths(800)
		input := RICEObservedAssessmentInput{ModelVersion: riceModel().Version, ObservationBizID: receipt.Observation.BizID, EffortUnit: "person_day", Impact: &impact, Confidence: &confidence, Effort: &effort}
		score, source, e := calculateObservedRICEAssessment(context.Background(), tx, "P-REACH", current, riceModel(), input)
		if expectStale {
			if e == nil {
				t.Fatal("stale Reach scored")
			}
			return
		}
		if e != nil || source == nil || source.Reach != 450 || score.PriorityDecimal() == nil || *score.PriorityDecimal() != "90.00000000" {
			t.Fatalf("observed score %+v %+v %v", score, source, e)
		}
		input.ObservationBizID = ""
		score, source, e = calculateObservedRICEAssessment(context.Background(), tx, "P-REACH", current, riceModel(), input)
		if e != nil || source != nil || score.PriorityUnits != nil || len(score.Missing) != 1 || score.Missing[0] != "reach" {
			t.Fatal("missing Reach fabricated score", e)
		}
	}
	checkScore(false)
	if _, err = db.Exec("UPDATE product_planning_items SET scope_revision=scope_revision+1 WHERE id=?", item); err != nil {
		t.Fatal(err)
	}
	view, err = ReadRICEReachObservation(context.Background(), db, "P-REACH", "pm", itemBiz, receipt.Observation.BizID, viewPermit())
	if err != nil || !view.Stale || view.Observation.ScopeRevision != scopeRevision {
		t.Fatalf("historical view %+v %v", view, err)
	}

	checkScore(true)
	txReady, e := db.BeginTx(context.Background(), nil)
	if e != nil {
		t.Fatal(e)
	}
	var frozenRICE []byte
	if e = txReady.QueryRow("SELECT configuration FROM product_priority_model_versions WHERE product_code='P-REACH' AND version=?", riceModel().Version).Scan(&frozenRICE); e != nil {
		t.Fatal(e)
	}
	if e = validatePlanningCycleModelReady(context.Background(), txReady, "P-REACH", riceModel().Version, frozenRICE); e == nil {
		t.Fatal("RICE enabled with only stale observations")
	}
	txReady.Rollback()

	pageResult, err := ListRICEReachObservations(context.Background(), db, "P-REACH", "pm", itemBiz, viewPermit(), 1, 1)
	if err != nil || pageResult.Total != 2 || len(pageResult.Items) != 1 || pageResult.Items[0].Observation.BizID != receipt.Observation.BizID || !pageResult.Items[0].Stale {
		t.Fatalf("page %+v %v", pageResult, err)
	}
	emptyPage, err := ListRICEReachObservations(context.Background(), db, "P-REACH", "pm", itemBiz, viewPermit(), 3, 1)
	if err != nil || emptyPage.Total != 2 || len(emptyPage.Items) != 0 {
		t.Fatalf("empty page %+v %v", emptyPage, err)
	}
	// The first migration-only fixture deliberately stores an incomplete object.
	// Historical listing must expose corruption as an error, not fabricated data.
	if _, err = ListRICEReachObservations(context.Background(), db, "P-REACH", "pm", itemBiz, viewPermit(), 2, 1); err == nil {
		t.Fatal("corrupt history silently accepted")
	}
	if _, err = ListRICEReachObservations(context.Background(), db, "P-REACH", "pm", itemBiz, viewPermit(), 1, 101); err == nil {
		t.Fatal("unbounded page accepted")
	}

}
