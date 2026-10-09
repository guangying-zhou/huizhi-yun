package productcenter

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

func TestMySQLCustomModelCycleAssessment(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-CUSTOM")
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.29_priority_model_versions.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	for _, name := range []string{"migration_v5.30_rice_reach_observations.sql", "migration_v5.31_rice_assessments.sql"} {
		schema, e := os.ReadFile("../../../../../aims/docs/" + name)
		if e != nil {
			t.Fatal(e)
		}
		executeSQLScript(t, db, string(schema))
	}
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-CUSTOM", "pm", action)
		p.Resource = "product_priorities"
		return p
	}
	identity := func(action, key string) CommandIdentity {
		return CommandIdentity{ProductCode: "P-CUSTOM", ActorUID: "pm", Action: "product_priorities:" + action, IdempotencyKey: key}
	}
	model := WeightedAssessmentModel{Version: "customer-v2", Strategic: 10, UserValue: 60, Business: 20, Risk: 10}
	if _, err = CreateWeightedModelVersion(ctx, db, identity("model-create", "model"), permit("admin"), WeightedModelCreate{ExpectedRevision: 1, Title: "用户价值", Reason: "按价值取舍", Model: model}); err != nil {
		t.Fatal(err)
	}
	zero, total, target := Hundredths(0), Hundredths(1000), "75"
	draft := PlanningCycleDraft{ExpectedRevision: 2, Title: "自定义模型周期", StartsOn: "2099-01-01", EndsOn: "2099-12-31", GoalSummary: "提升成功率", ReviewIntervalDays: 14, Budget: &PlanningCycleBudget{Total: &total, Reserve: &zero, Reliability: &zero, Usability: &zero, Growth: &total}, Metric: &PlanningCycleMetric{Name: "成功率", Unit: "百分比", Direction: "increase", MeasurementMethod: "按用户去重", TargetValue: &target}}
	created, err := CreatePlanningCycle(ctx, db, identity("cycle-create", "cycle"), permit("edit"), draft)
	if err != nil {
		t.Fatal(err)
	}
	var cycle struct {
		BizID string `json:"biz_id"`
	}
	if err = json.Unmarshal(created.Value, &cycle); err != nil {
		t.Fatal(err)
	}
	if _, err = SelectPlanningCycleModel(ctx, db, identity("cycle-model-select", "select-model"), permit("admin"), PlanningCycleModelSelect{BizID: cycle.BizID, ModelVersion: model.Version, ExpectedRevision: 3, ExpectedCycleRevision: 1, Reason: "采用用户价值模型"}); err != nil {
		t.Fatal(err)
	}
	itemID := planningFixture(t, db, "P-CUSTOM")
	input := assessmentDraft()
	if err = db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, itemID).Scan(&input.ItemBizID); err != nil {
		t.Fatal(err)
	}
	input.CycleBizID = cycle.BizID
	input.ExpectedRevision = 4
	input.ExpectedCycleRevision = 2
	if _, err = AddPlanningCycleCandidate(ctx, db, identity("candidate-add", "candidate"), permit("edit"), input.PlanningCycleCandidateAdd); err != nil {
		t.Fatal(err)
	}
	if _, err = OpenPlanningCycle(ctx, db, identity("cycle-open", "open"), permit("prioritize"), PlanningCycleTransition{BizID: cycle.BizID, ExpectedRevision: 5, ExpectedCycleRevision: 3, Reason: "模型及容量已确认"}); err != nil {
		t.Fatal(err)
	}
	input.ExpectedRevision = 6
	input.ExpectedCycleRevision = 4
	input.Assessment.ModelVersion = model.Version
	strategic, user, business, risk := 5, 1, 2, 3
	input.Assessment.Strategic = &strategic
	input.Assessment.UserValue = &user
	input.Assessment.Business = &business
	input.Assessment.Risk = &risk
	saved, err := CreatePlanningAssessment(ctx, db, identity("assess", "assess"), permit("assess"), input)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := CreatePlanningAssessment(ctx, db, identity("assess", "assess"), permit("assess"), input)
	if err != nil || !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	var score, version string
	var value, weight int
	var frozen []byte
	if err = db.QueryRow(`SELECT value_score,priority_score,model_version,JSON_EXTRACT(model_snapshot,'$.cycle_model.weights.user_value'),model_snapshot FROM product_priority_assessments`).Scan(&value, &score, &version, &weight, &frozen); err != nil || value != 36 || score != "3.60000000" || version != model.Version || weight != 60 {
		t.Fatalf("custom score %d %s %s %d %v", value, score, version, weight, err)
	}
	candidates, err := ListPlanningCycleCandidates(ctx, db, "P-CUSTOM", "pm", permit("view"), PlanningCycleCandidateQuery{CycleBizID: cycle.BizID, Page: 1, PageSize: 20})
	if err != nil || len(candidates.Items) != 1 || candidates.Items[0].Assessment == nil || candidates.Items[0].Assessment.Stale || candidates.Items[0].Assessment.PriorityScore == nil || *candidates.Items[0].Assessment.PriorityScore != "3.60000000" {
		t.Fatalf("custom candidate %+v %v", candidates, err)
	}
	model.Version = "customer-v3"
	model.Strategic = 60
	model.UserValue = 10
	if _, err = CreateWeightedModelVersion(ctx, db, identity("model-create", "next-model"), permit("admin"), WeightedModelCreate{ExpectedRevision: 7, Title: "战略优先", Reason: "供后续周期选择", Model: model}); err != nil {
		t.Fatal(err)
	}
	var after []byte
	if err = db.QueryRow(`SELECT model_snapshot FROM product_priority_assessments`).Scan(&after); err != nil || string(after) != string(frozen) {
		t.Fatal("new model rewrote assessment history")
	}
	_, err = SelectPlanningCycleModel(ctx, db, identity("cycle-model-select", "switch-open"), permit("admin"), PlanningCycleModelSelect{BizID: cycle.BizID, ModelVersion: model.Version, ExpectedRevision: 8, ExpectedCycleRevision: 5, Reason: "不能切换开放周期"})
	requireProductRule(t, err, "planning_cycle_readonly")
	insertRICE := `INSERT INTO product_priority_assessments(cycle_id,planning_item_id,scope_revision,evidence_revision,model_version,model_snapshot,model_method,rice_impact,confidence,effort_person_days,priority_score,evidence_snapshot,rationale,assessed_by,assessed_at) SELECT cycle_id,planning_item_id,scope_revision,evidence_revision,'rice-fixture','{}','rice',?,0.80,8.00,?,'{}','{}','pm',UTC_TIMESTAMP(3) FROM product_priority_assessments WHERE model_method='weighted-value-effort' LIMIT 1`
	if _, err = db.Exec(insertRICE, "2.00", "90.00000000"); err == nil {
		t.Fatal("RICE score without observation reference accepted")
	}
	if _, err = db.Exec(insertRICE, "0.75", nil); err == nil {
		t.Fatal("invalid RICE impact accepted")
	}
	if _, err = db.Exec(insertRICE, "2.00", nil); err != nil {
		t.Fatal("incomplete RICE must preserve null score", err)
	}
	migration, e := os.ReadFile("../../../../../aims/docs/migration_v5.31_rice_assessments.sql")
	if e != nil {
		t.Fatal(e)
	}
	executeSQLScript(t, db, string(migration))
	var riceCount int
	if err = db.QueryRow("SELECT COUNT(*) FROM product_priority_assessments WHERE model_method='rice' AND value_score IS NULL AND priority_score IS NULL").Scan(&riceCount); err != nil || riceCount != 1 {
		t.Fatalf("RICE null preservation %d %v", riceCount, err)
	}

}
