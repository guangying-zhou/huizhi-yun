package productcenter

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

func TestMySQLPriorityModelVersionMigration(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-MODEL-A")
	workspaceFixture(t, db, "P-MODEL-B")
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.29_priority_model_versions.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	insert := `INSERT INTO product_priority_model_versions(biz_id,product_code,version,title,method,configuration,reason,created_by,created_at) VALUES(UUID(),?,?,'价值模型',?,?, '调整战略权重','pm',UTC_TIMESTAMP(3))`
	for _, args := range [][]any{{"MISSING", "v2", "weighted-value-effort", `{}`}, {"P-MODEL-A", "v2", "unknown", `{}`}, {"P-MODEL-A", "v2", "weighted-value-effort", `[]`}, {"P-MODEL-A", " ", "weighted-value-effort", `{}`}} {
		if _, err = db.Exec(insert, args...); err == nil {
			t.Fatal("invalid model accepted")
		}
	}
	for _, code := range []string{"P-MODEL-A", "P-MODEL-B"} {
		if _, err = db.Exec(insert, code, "v2", "weighted-value-effort", `{"strategic":30,"user_value":30,"business":20,"risk":20}`); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = db.Exec(insert, "P-MODEL-A", "v2", "weighted-value-effort", `{}`); err == nil {
		t.Fatal("same-product version collision accepted")
	}
	for _, statement := range []string{`UPDATE product_priority_model_versions SET title='改写'`, `DELETE FROM product_priority_model_versions`} {
		if _, err = db.Exec(statement); err == nil {
			t.Fatal("immutable version mutated")
		}
	}
	executeSQLScript(t, db, string(script))
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_priority_model_versions WHERE title='价值模型' AND JSON_EXTRACT(configuration,'$.strategic')=30`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("preserved models %d %v", count, err)
	}
	input := WeightedModelCreate{ExpectedRevision: 1, Title: "用户价值优先", Reason: "调整取舍", Model: WeightedAssessmentModel{Version: "v3", Strategic: 10, UserValue: 60, Business: 20, Risk: 10}}
	identity := CommandIdentity{ProductCode: "P-MODEL-A", ActorUID: "pm", Action: "product_priorities:model-create", IdempotencyKey: "model-v3"}
	run := func() (CommandResult, error) {
		permit := workspacePermit(t, db, "P-MODEL-A", "pm", "admin")
		permit.Resource = "product_priorities"
		return CreateWeightedModelVersion(context.Background(), db, identity, permit, input)
	}
	if _, err = db.Exec(`CREATE TRIGGER fail_model_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run(); err == nil {
		t.Fatal("audit failure accepted")
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_priority_model_versions WHERE version='v3'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("model leaked %d %v", count, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_model_audit`); err != nil {
		t.Fatal(err)
	}
	saved, err := run()
	if err != nil {
		t.Fatal(err)
	}
	replay, err := run()
	if err != nil || !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatalf("model replay %+v %v", replay, err)
	}
	identity.IdempotencyKey = "duplicate-version"
	input.ExpectedRevision = 2
	_, err = run()
	requireProductRule(t, err, "assessment_model_version_conflict")
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_priority_model_versions WHERE version='v3'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("duplicate version %d %v", count, err)
	}

	view := workspacePermit(t, db, "P-MODEL-A", "pm", "view")
	view.Resource = "product_priorities"
	first, err := ListPriorityModels(context.Background(), db, "P-MODEL-A", "pm", view, 1, 1)
	if err != nil || first.Total != 2 || len(first.Items) != 1 || first.Items[0].Version != "v3" || first.Items[0].ProductCode != "P-MODEL-A" || first.Builtin["version"] != AssessmentModel || first.WorkspaceRevision != 2 {
		t.Fatalf("models %+v %v", first, err)
	}
	second, err := ListPriorityModels(context.Background(), db, "P-MODEL-A", "pm", view, 2, 1)
	if err != nil || second.Total != 2 || len(second.Items) != 1 || second.Items[0].Version != "v2" {
		t.Fatalf("second models %+v %v", second, err)
	}
	last, err := ListPriorityModels(context.Background(), db, "P-MODEL-A", "pm", view, 3, 1)
	if err != nil || last.Total != 2 || len(last.Items) != 0 {
		t.Fatalf("last models %+v %v", last, err)
	}
	_, err = ListPriorityModels(context.Background(), db, "P-MODEL-B", "pm", view, 1, 20)
	requireProductRule(t, err, "product_authorization_invalid")

	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	frozen, err := loadFrozenWeightedModel(context.Background(), tx, "P-MODEL-A", "v3", first.Items[0].Configuration)
	if err != nil || frozen.UserValue != 60 || frozen.Strategic != 10 {
		t.Fatalf("loaded model %+v %v", frozen, err)
	}
	_, err = loadFrozenWeightedModel(context.Background(), tx, "P-MODEL-A", "v3", []byte(`{"version":"v3","weights":{"strategic":30,"user_value":30,"business":20,"risk":20}}`))
	requireProductRule(t, err, "assessment_model_mismatch")
	if _, err = loadFrozenWeightedModel(context.Background(), tx, "P-MODEL-B", "v3", first.Items[0].Configuration); err == nil {
		t.Fatal("model resolved across product boundary")
	}

	tx.Rollback()
	edit := workspacePermit(t, db, "P-MODEL-A", "pm", "edit")
	edit.Resource = "product_priorities"
	cycleResult, err := CreatePlanningCycle(context.Background(), db, CommandIdentity{ProductCode: "P-MODEL-A", ActorUID: "pm", Action: "product_priorities:cycle-create", IdempotencyKey: "model-cycle"}, edit, PlanningCycleDraft{ExpectedRevision: 2, Title: "模型周期", StartsOn: "2099-01-01", EndsOn: "2099-12-31", GoalSummary: "比较投入", ReviewIntervalDays: 14})
	if err != nil {
		t.Fatal(err)
	}
	var cycle struct {
		BizID string `json:"biz_id"`
	}
	if err = json.Unmarshal(cycleResult.Value, &cycle); err != nil || cycle.BizID == "" {
		t.Fatalf("cycle %s %v", cycleResult.Value, err)
	}
	selection := PlanningCycleModelSelect{BizID: cycle.BizID, ModelVersion: "v3", ExpectedRevision: 3, ExpectedCycleRevision: 1, Reason: "使用用户价值模型"}
	selectIdentity := CommandIdentity{ProductCode: "P-MODEL-A", ActorUID: "pm", Action: "product_priorities:cycle-model-select", IdempotencyKey: "select-model"}
	selectModel := func() (CommandResult, error) {
		p := workspacePermit(t, db, "P-MODEL-A", "pm", "admin")
		p.Resource = "product_priorities"
		return SelectPlanningCycleModel(context.Background(), db, selectIdentity, p, selection)
	}
	if _, err = db.Exec(`CREATE TRIGGER fail_model_select_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = selectModel(); err == nil {
		t.Fatal("model selection audit failure accepted")
	}
	var original string
	if err = db.QueryRow(`SELECT model_version FROM product_planning_cycles WHERE biz_id=?`, cycle.BizID).Scan(&original); err != nil || original != AssessmentModel {
		t.Fatalf("selection leaked %s %v", original, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_model_select_audit`); err != nil {
		t.Fatal(err)
	}
	chosen, err := selectModel()
	if err != nil {
		t.Fatal(err)
	}
	replay, err = selectModel()
	if err != nil || !replay.Replayed || replay.ReceiptID != chosen.ReceiptID {
		t.Fatalf("model selection replay %+v %v", replay, err)
	}
	var selectedWeight, queueRevision int
	if err = db.QueryRow(`SELECT JSON_EXTRACT(model_snapshot,'$.weights.user_value'),queue_revision FROM product_planning_cycles WHERE biz_id=?`, cycle.BizID).Scan(&selectedWeight, &queueRevision); err != nil || selectedWeight != 60 || queueRevision != 1 {
		t.Fatalf("selected weights/order %d %d %v", selectedWeight, queueRevision, err)
	}
	selectIdentity.IdempotencyKey = "model-no-change"
	selection.ExpectedRevision = 4
	selection.ExpectedCycleRevision = 2
	_, err = selectModel()
	requireProductRule(t, err, "assessment_model_unchanged")
	if _, err = db.Exec(`UPDATE product_planning_cycles SET status='closed' WHERE biz_id=?`, cycle.BizID); err != nil {
		t.Fatal(err)
	}
	selection.ModelVersion = AssessmentModel
	_, err = selectModel()
	requireProductRule(t, err, "planning_cycle_readonly")

}
