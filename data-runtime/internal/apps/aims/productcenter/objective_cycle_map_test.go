package productcenter

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

func TestMySQLProductObjectiveCycleMapAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.22_product_objectives.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	workspaceFixture(t, db, "P-CREATE-TREE")
	identity := CommandIdentity{ProductCode: "P-CREATE-TREE", ActorUID: "pm", Action: "product_objectives:create", IdempotencyKey: "root"}
	input := ProductObjectiveDraft{Title: "降低失败率", StartsOn: "2026-09-01", EndsOn: "2026-12-31", OwnerUID: "pm", ExpectedRevision: 1, Metric: ProductObjectiveMetric{"失败率", "%", "失败次数/总次数", "decrease", "5", "2"}}
	if _, err = db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P-CREATE-TREE','pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`); err != nil {
		t.Fatal(err)
	}

	permit := workspacePermit(t, db, identity.ProductCode, "pm", "edit")
	permit.Resource = "product_objectives"
	created, err := CreateProductObjective(context.Background(), db, identity, permit, input)
	if err != nil {
		t.Fatal(err)
	}
	var original ProductObjectiveRecord
	if err = json.Unmarshal(created.Value, &original); err != nil {
		t.Fatal(err)
	}
	script, err = os.ReadFile("../../../../../aims/docs/migration_v5.24_objective_cycle_mappings.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	cycle, err := db.Exec(`INSERT INTO product_planning_cycles(biz_id,product_code,title,starts_on,ends_on,goal_summary,model_snapshot,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-CREATE-TREE','季度规划','2026-09-01','2026-12-31','原摘要',JSON_OBJECT(),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`)
	if err != nil {
		t.Fatal(err)
	}
	cycleID, err := cycle.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	mapping := ProductObjectiveCycleMap{ObjectiveID: original.ID, CycleID: cycleID, ExpectedRevision: 2, ExpectedObjectiveRevision: 1, ExpectedCycleRevision: 1, Reason: "季度目标对应"}
	identity.Action = "product_objectives:cycle-map"
	identity.IdempotencyKey = "map"
	run := func(action string) (CommandResult, error) {
		p := workspacePermit(t, db, identity.ProductCode, "pm", action)
		p.Resource = "product_objectives"
		return MapProductObjectiveCycle(context.Background(), db, identity, p, mapping)
	}
	_, err = run("view")
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`CREATE TRIGGER fail_map_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run("edit"); err == nil {
		t.Fatal("audit failure committed")
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_objective_cycles`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("rollback %d %v", count, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_map_audit`); err != nil {
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
	var output struct {
		ObjectiveSnapshot ProductObjectiveRecord `json:"objective_snapshot"`
		CycleSnapshot     PlanningCycleRecord    `json:"cycle_snapshot"`
		ObjectiveRevision uint64                 `json:"objective_revision"`
		WorkspaceRevision uint64                 `json:"workspace_revision"`
	}
	if err = json.Unmarshal(saved.Value, &output); err != nil || output.ObjectiveSnapshot != original || output.CycleSnapshot.GoalSummary != "原摘要" || output.ObjectiveRevision != 2 || output.WorkspaceRevision != 3 {
		t.Fatalf("snapshot %+v %v", output, err)
	}
	identity.IdempotencyKey = "map-new"
	_, err = run("edit")
	requireProductRule(t, err, "product_revision_conflict")
	mapping.ExpectedRevision = 3
	_, err = run("edit")
	requireProductRule(t, err, "product_objective_revision_conflict")
	mapping.ExpectedObjectiveRevision = 2
	mapping.ExpectedCycleRevision = 2
	_, err = run("edit")
	requireProductRule(t, err, "planning_cycle_revision_conflict")
	mapping.ExpectedCycleRevision = 1
	_, err = run("edit")
	requireProductRule(t, err, "product_objective_cycle_mapping_conflict")
	if _, err = db.Exec(`UPDATE product_planning_cycles SET goal_summary='新摘要',revision=revision+1 WHERE id=?`, cycleID); err != nil {
		t.Fatal(err)
	}
	var summary string
	if err = db.QueryRow(`SELECT JSON_UNQUOTE(JSON_EXTRACT(cycle_snapshot,'$.goal_summary')) FROM product_objective_cycles`).Scan(&summary); err != nil || summary != "原摘要" {
		t.Fatalf("snapshot changed %s %v", summary, err)
	}
	var mappingID int64
	if err = db.QueryRow(`SELECT id FROM product_objective_cycles`).Scan(&mappingID); err != nil {
		t.Fatal(err)
	}
	revoke := ProductObjectiveCycleRevoke{MappingID: mappingID, ObjectiveID: original.ID, ExpectedRevision: 3, ExpectedObjectiveRevision: 2, Reason: "调整对应关系"}
	identity.Action = "product_objectives:cycle-revoke"
	identity.IdempotencyKey = "revoke-mapping"
	revokeRun := func(action string) (CommandResult, error) {
		p := workspacePermit(t, db, identity.ProductCode, "pm", action)
		p.Resource = "product_objectives"
		return RevokeProductObjectiveCycle(context.Background(), db, identity, p, revoke)
	}
	_, err = revokeRun("view")
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`CREATE TRIGGER fail_revoke_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = revokeRun("edit"); err == nil {
		t.Fatal("revoke audit failure committed")
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_objective_cycles WHERE revoked_at IS NOT NULL`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("revoke rollback %d %v", count, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_revoke_audit`); err != nil {
		t.Fatal(err)
	}
	revoked, err := revokeRun("edit")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := revokeRun("edit")
	if err != nil || !raw.Replayed || raw.ReceiptID != revoked.ReceiptID {
		t.Fatalf("revoke replay %v", err)
	}
	identity.IdempotencyKey = "revoke-again"
	_, err = revokeRun("edit")
	requireProductRule(t, err, "product_revision_conflict")
	revoke.ExpectedRevision = 4
	_, err = revokeRun("edit")
	requireProductRule(t, err, "product_objective_revision_conflict")
	revoke.ExpectedObjectiveRevision = 3
	_, err = revokeRun("edit")
	requireProductRule(t, err, "product_objective_cycle_mapping_conflict")
	var reason, actor string
	if err = db.QueryRow(`SELECT revocation_reason,revoked_by,JSON_UNQUOTE(JSON_EXTRACT(cycle_snapshot,'$.goal_summary')) FROM product_objective_cycles WHERE id=?`, mappingID).Scan(&reason, &actor, &summary); err != nil || reason != revoke.Reason || actor != "pm" || summary != "原摘要" {
		t.Fatalf("revocation %s %s %s %v", reason, actor, summary, err)
	}
	identity.Action = "product_objectives:cycle-map"
	identity.IdempotencyKey = "remap"
	mapping.ExpectedRevision = 4
	mapping.ExpectedObjectiveRevision = 3
	mapping.ExpectedCycleRevision = 2
	if _, err = run("edit"); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_objective_cycles`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("remap history %d %v", count, err)
	}

	viewPermit := workspacePermit(t, db, identity.ProductCode, "pm", "view")
	viewPermit.Resource = "product_objectives"
	page, err := ListProductObjectiveCycles(context.Background(), db, identity.ProductCode, "pm", viewPermit, original.ID, 1, 1)
	if err != nil || page.Total != 2 || len(page.Items) != 1 || page.ObjectiveRevision != 4 || page.WorkspaceRevision != 5 || page.Items[0].RevokedAt != nil || page.Items[0].CycleSnapshot.GoalSummary != "新摘要" || page.Items[0].CycleRevision != 2 {
		t.Fatalf("latest mapping page %+v %v", page, err)
	}
	page, err = ListProductObjectiveCycles(context.Background(), db, identity.ProductCode, "pm", viewPermit, original.ID, 2, 1)
	if err != nil || page.Total != 2 || len(page.Items) != 1 || page.Items[0].ID != mappingID || page.Items[0].RevokedAt == nil || page.Items[0].RevocationReason == nil || *page.Items[0].RevocationReason != revoke.Reason || page.Items[0].CycleSnapshot.GoalSummary != "原摘要" || page.Items[0].ObjectiveSnapshot != original {
		t.Fatalf("revoked mapping page %+v %v", page, err)
	}
	_, err = ListProductObjectiveCycles(context.Background(), db, identity.ProductCode, "pm", viewPermit, original.ID, 0, 1)
	requireProductRule(t, err, "product_objective_cycle_list_invalid")
	viewPermit.Resource = "product_features"
	_, err = ListProductObjectiveCycles(context.Background(), db, identity.ProductCode, "pm", viewPermit, original.ID, 1, 1)
	requireProductRule(t, err, "product_authorization_invalid")

}
