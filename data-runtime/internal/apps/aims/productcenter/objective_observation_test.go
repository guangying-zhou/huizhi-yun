package productcenter

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

func TestMySQLProductObjectiveObservation(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-OBS")
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.22_product_objectives.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	correctionMigration, err := os.ReadFile("../../../../../aims/docs/migration_v5.23_objective_observation_corrections.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(correctionMigration))
	r, err := db.Exec(`INSERT INTO product_objectives(biz_id,product_code,title,starts_on,ends_on,owner_uid,metric_name,metric_unit,measurement_definition,direction,baseline_value,target_value,status,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-OBS','降低失败率','2020-01-01','2099-12-31','pm','失败率','%','失败次数/总次数','decrease',5,2,'active','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`)
	if err != nil {
		t.Fatal(err)
	}
	id, err := r.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	identity := CommandIdentity{ProductCode: "P-OBS", ActorUID: "pm", Action: "product_objectives:observe", IdempotencyKey: "obs"}
	input := ProductObjectiveObservation{ObjectiveID: id, ExpectedRevision: 1, ExpectedObjectiveRevision: 1, ObservedOn: "2026-01-01", MeasuredValue: "4.5", Evidence: "统计报表"}
	run := func(action string) (CommandResult, error) {
		p := workspacePermit(t, db, "P-OBS", "pm", action)
		p.Resource = "product_objectives"
		return CreateProductObjectiveObservation(context.Background(), db, identity, p, input)
	}
	_, err = run("edit")
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`CREATE TRIGGER fail_objective_observation BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run("observe"); err == nil {
		t.Fatal("audit failure committed")
	}
	var count int
	for _, table := range []string{"product_objective_observations", "product_command_receipts"} {
		if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("rollback %s %d %v", table, count, err)
		}
	}
	if _, err = db.Exec(`DROP TRIGGER fail_objective_observation`); err != nil {
		t.Fatal(err)
	}
	saved, err := run("observe")
	if err != nil {
		t.Fatal(err)
	}
	replay, err := run("observe")
	if err != nil || !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	var out struct {
		Attainment string `json:"attainment_percent"`
		Revision   uint64 `json:"objective_revision"`
	}
	if err = json.Unmarshal(saved.Value, &out); err != nil || out.Attainment != "16.666667" || out.Revision != 1 {
		t.Fatalf("result %+v %v", out, err)
	}
	identity.IdempotencyKey = "new-obs"
	_, err = run("observe")
	requireProductRule(t, err, "product_revision_conflict")
	input.ExpectedRevision = 2
	input.ExpectedObjectiveRevision = 2
	_, err = run("observe")
	requireProductRule(t, err, "product_objective_revision_conflict")
	input.ExpectedObjectiveRevision = 1
	input.ObservedOn = "2099-01-01"
	_, err = run("observe")
	requireProductRule(t, err, "product_objective_observation_invalid")
	input.ObservedOn = "2019-01-01"
	_, err = run("observe")
	requireProductRule(t, err, "product_objective_observation_invalid")
	input.ObservedOn = "2026-01-01"
	if _, err = db.Exec(`UPDATE product_objectives SET status='draft'`); err != nil {
		t.Fatal(err)
	}
	_, err = run("observe")
	requireProductRule(t, err, "product_objective_state_conflict")
	if _, err = db.Exec(`UPDATE product_objectives SET target_value=1,revision=2`); err != nil {
		t.Fatal(err)
	}
	var snapshot []byte
	if err = db.QueryRow(`SELECT metric_snapshot FROM product_objective_observations`).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	var metric ProductObjectiveMetric
	if err = json.Unmarshal(snapshot, &metric); err != nil || metric.TargetValue != "2.000000" {
		t.Fatalf("snapshot changed %s %v", snapshot, err)
	}
	if _, err = db.Exec(`UPDATE product_objectives SET status='active'`); err != nil {
		t.Fatal(err)
	}
	input.ExpectedObjectiveRevision = 2
	input.ObservedOn = "2026-01-02"
	input.MeasuredValue = "3"
	if _, err = run("observe"); err != nil {
		t.Fatal(err)
	}
	permit := workspacePermit(t, db, "P-OBS", "pm", "view")
	permit.Resource = "product_objectives"
	first, err := ListProductObjectiveObservations(context.Background(), db, "P-OBS", "pm", permit, id, 1, 1)
	if err != nil || first.Total != 2 || len(first.Items) != 1 || first.Items[0].AttainmentPercent == nil || *first.Items[0].AttainmentPercent != "50.000000" || first.WorkspaceRevision != 3 {
		t.Fatalf("first %+v %v", first, err)
	}
	second, err := ListProductObjectiveObservations(context.Background(), db, "P-OBS", "pm", permit, id, 2, 1)
	if err != nil || second.Total != 2 || len(second.Items) != 1 || second.Items[0].AttainmentPercent == nil || *second.Items[0].AttainmentPercent != "16.666667" || second.Items[0].MetricSnapshot.TargetValue != "2.000000" || first.Items[0].ID == second.Items[0].ID {
		t.Fatalf("historical %+v %v", second, err)
	}
	_, err = ListProductObjectiveObservations(context.Background(), db, "P-OBS", "pm", permit, id, 0, 1)
	requireProductRule(t, err, "product_objective_observation_list_invalid")
	permit.Resource = "product_components"
	_, err = ListProductObjectiveObservations(context.Background(), db, "P-OBS", "pm", permit, id, 1, 1)
	requireProductRule(t, err, "product_authorization_invalid")

	correctionScript, err := os.ReadFile("../../../../../aims/docs/migration_v5.23_objective_observation_corrections.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(correctionScript))
	originalID := second.Items[0].ID
	input.CorrectionOfID = &originalID
	input.CorrectionReason = "修正统计分母"
	input.ExpectedRevision = 3
	input.ExpectedObjectiveRevision = 2
	input.ObservedOn = "2026-01-01"
	input.MeasuredValue = "4"
	identity.IdempotencyKey = "correction"
	if _, err = db.Exec(`CREATE TRIGGER fail_correction_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='correction audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run("observe"); err == nil {
		t.Fatal("correction audit failure committed")
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_objective_observations WHERE correction_of_id IS NOT NULL`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("failed correction remained %d %v", count, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_correction_audit`); err != nil {
		t.Fatal(err)
	}
	corrected, err := run("observe")
	if err != nil {
		t.Fatal(err)
	}
	var correction struct {
		ID         int64                  `json:"id"`
		Revision   uint64                 `json:"objective_revision"`
		Metric     ProductObjectiveMetric `json:"metric_snapshot"`
		Attainment string                 `json:"attainment_percent"`
	}
	if err = json.Unmarshal(corrected.Value, &correction); err != nil || correction.Revision != 1 || correction.Metric.TargetValue != "2.000000" || correction.Attainment != "33.333333" {
		t.Fatalf("correction snapshot %+v %v", correction, err)
	}
	repeated, err := run("observe")
	if err != nil || !repeated.Replayed || repeated.ReceiptID != corrected.ReceiptID {
		t.Fatalf("correction replay %+v %v", repeated, err)
	}
	input.ExpectedRevision = 4
	identity.IdempotencyKey = "competing-correction"
	_, err = run("observe")
	requireProductRule(t, err, "product_objective_correction_conflict")
	input.CorrectionOfID = &correction.ID
	input.ObservedOn = "2026-01-02"
	_, err = run("observe")
	requireProductRule(t, err, "product_objective_correction_invalid")
	input.ObservedOn = "2026-01-01"
	input.MeasuredValue = "3.5"
	identity.IdempotencyKey = "next-correction"
	if _, err = run("observe"); err != nil {
		t.Fatal(err)
	}
	var originalValue string
	if err = db.QueryRow(`SELECT measured_value FROM product_objective_observations WHERE id=?`, originalID).Scan(&originalValue); err != nil || originalValue != "4.500000" {
		t.Fatalf("original changed %s %v", originalValue, err)
	}

	permit = workspacePermit(t, db, "P-OBS", "pm", "view")
	permit.Resource = "product_objectives"
	history, err := ListProductObjectiveObservations(context.Background(), db, "P-OBS", "pm", permit, id, 1, 10)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[int64]ProductObjectiveObservationRecord{}
	for _, row := range history.Items {
		byID[row.ID] = row
	}
	original := byID[originalID]
	if original.SupersededByID == nil || *original.SupersededByID != correction.ID || original.CorrectionOfID != nil {
		t.Fatalf("original correction state %+v", original)
	}
	correctedRow := byID[correction.ID]
	if correctedRow.CorrectionOfID == nil || *correctedRow.CorrectionOfID != originalID || correctedRow.SupersededByID == nil || correctedRow.CorrectionReason != "修正统计分母" {
		t.Fatalf("correction state %+v", correctedRow)
	}
	leaf := byID[*correctedRow.SupersededByID]
	if leaf.SupersededByID != nil || leaf.MetricSnapshot.TargetValue != "2.000000" {
		t.Fatalf("leaf %+v", leaf)
	}

}
