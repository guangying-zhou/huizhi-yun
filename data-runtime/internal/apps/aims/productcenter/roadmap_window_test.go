package productcenter

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"testing"
)

func TestMySQLPlanningRoadmapWindowAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-WINDOW-EDIT")
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.25_planning_roadmap_windows.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	itemID := planningFixture(t, db, "P-WINDOW-EDIT")
	var bizID string
	if err = db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, itemID).Scan(&bizID); err != nil {
		t.Fatal(err)
	}
	start, end := "2026-10-01", "2027-03-31"
	input := PlanningRoadmapWindow{BizID: bizID, StartsOn: &start, EndsOn: &end, ExpectedRevision: 1, ExpectedItemRevision: 1, Reason: "季度探索安排"}
	identity := CommandIdentity{ProductCode: "P-WINDOW-EDIT", ActorUID: "pm", Action: "product_roadmaps:window-edit", IdempotencyKey: "window"}
	run := func(action string) (CommandResult, error) {
		p := workspacePermit(t, db, identity.ProductCode, "pm", action)
		p.Resource = "product_roadmaps"
		return EditPlanningRoadmapWindow(context.Background(), db, identity, p, input)
	}
	_, err = run("view")
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`CREATE TRIGGER fail_window_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run("edit"); err == nil {
		t.Fatal("audit failure committed")
	}
	var untouched bool
	if err = db.QueryRow(`SELECT roadmap_starts_on IS NULL AND roadmap_ends_on IS NULL AND revision=1 FROM product_planning_items WHERE id=?`, itemID).Scan(&untouched); err != nil || !untouched {
		t.Fatalf("rollback %v %v", untouched, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_window_audit`); err != nil {
		t.Fatal(err)
	}
	saved, err := run("edit")
	if err != nil {
		t.Fatal(err)
	}
	replay, err := run("edit")
	if err != nil || !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatalf("replay %v", err)
	}
	viewPermit := workspacePermit(t, db, identity.ProductCode, "pm", "view")
	viewPermit.Resource = "product_roadmaps"
	window, err := ReadPlanningRoadmapWindow(context.Background(), db, identity.ProductCode, "pm", bizID, viewPermit)
	if err != nil || window.StartsOn == nil || *window.StartsOn != start || window.EndsOn == nil || *window.EndsOn != end || window.Revision != 2 || window.WorkspaceRevision != 2 || window.BizID != bizID {
		t.Fatalf("window read %+v %v", window, err)
	}
	wrong := viewPermit
	wrong.Resource = "product_priorities"
	_, err = ReadPlanningRoadmapWindow(context.Background(), db, identity.ProductCode, "pm", bizID, wrong)
	requireProductRule(t, err, "product_authorization_invalid")
	workspaceFixture(t, db, "P-OTHER-WINDOW")
	foreignPermit := workspacePermit(t, db, "P-OTHER-WINDOW", "pm", "view")
	foreignPermit.Resource = "product_roadmaps"
	_, err = ReadPlanningRoadmapWindow(context.Background(), db, "P-OTHER-WINDOW", "pm", bizID, foreignPermit)
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign window read %v", err)
	}
	identity.IdempotencyKey = "clear-window"
	_, err = run("edit")
	requireProductRule(t, err, "product_revision_conflict")
	input.ExpectedRevision = 2
	_, err = run("edit")
	requireProductRule(t, err, "product_planning_revision_conflict")
	input.ExpectedItemRevision = 2
	input.StartsOn = nil
	input.EndsOn = nil
	if _, err = run("edit"); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT roadmap_starts_on IS NULL AND roadmap_ends_on IS NULL AND revision=3 AND scope_revision=1 AND evidence_revision=1 FROM product_planning_items WHERE id=?`, itemID).Scan(&untouched); err != nil || !untouched {
		t.Fatalf("clear %v %v", untouched, err)
	}
	viewPermit = workspacePermit(t, db, identity.ProductCode, "pm", "view")
	viewPermit.Resource = "product_roadmaps"
	window, err = ReadPlanningRoadmapWindow(context.Background(), db, identity.ProductCode, "pm", bizID, viewPermit)
	if err != nil || window.StartsOn != nil || window.EndsOn != nil || window.Revision != 3 || window.WorkspaceRevision != 3 {
		t.Fatalf("cleared window read %+v %v", window, err)
	}
	input.ExpectedRevision = 3
	input.ExpectedItemRevision = 3
	identity.IdempotencyKey = "readonly-window"
	if _, err = db.Exec(`UPDATE product_planning_items SET lifecycle='delivered' WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	_, err = run("edit")
	requireProductRule(t, err, "product_planning_readonly")
}
func TestPlanningRoadmapWindowValidation(t *testing.T) {
	start, end := "2026-10-01", "2027-03-31"
	input := PlanningRoadmapWindow{BizID: "00000000-0000-4000-8000-000000000001", StartsOn: &start, EndsOn: &end, ExpectedRevision: 1, ExpectedItemRevision: 1, Reason: "安排"}
	if err := ValidatePlanningRoadmapWindow(input); err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"2026-02-30", "0999-10-01", "2026-9-01", "2028-01-01"} {
		bad := input
		bad.StartsOn = &value
		if err := ValidatePlanningRoadmapWindow(bad); err == nil {
			t.Fatalf("bad start %s accepted", value)
		}
	}
	input.StartsOn = nil
	if err := ValidatePlanningRoadmapWindow(input); err == nil {
		t.Fatal("one date accepted")
	}
	input.EndsOn = nil
	if err := ValidatePlanningRoadmapWindow(input); err != nil {
		t.Fatal(err)
	}
}
