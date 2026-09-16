package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"testing"
)

func TestMySQLProductObjectiveItemLinkAtomicity(t *testing.T) {
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
	result, err := db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-CREATE-TREE','登录改进','范围','reliability','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`)
	if err != nil {
		t.Fatal(err)
	}
	itemID, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	link := ProductObjectiveItemLink{ObjectiveID: original.ID, PlanningItemID: itemID, ExpectedRevision: 2, ExpectedObjectiveRevision: 1, ExpectedPlanningRevision: 1, ContributionNote: "降低登录故障", Reason: "建立目标追踪"}
	identity.Action = "product_objectives:item-link"
	identity.IdempotencyKey = "link"
	run := func(action string) (CommandResult, error) {
		p := workspacePermit(t, db, identity.ProductCode, "pm", action)
		p.Resource = "product_objectives"
		return LinkProductObjectiveItem(context.Background(), db, identity, p, link)
	}
	_, err = run("view")
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`CREATE TRIGGER fail_link_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run("edit"); err == nil {
		t.Fatal("audit failure committed")
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_objective_items`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("rollback count %d %v", count, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_link_audit`); err != nil {
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
	viewPermit.Resource = "product_objectives"
	page, err := ListProductObjectiveItems(context.Background(), db, identity.ProductCode, "pm", viewPermit, original.ID, 1, 1)
	if err != nil || page.Total != 1 || len(page.Items) != 1 || page.Items[0].PlanningItemID != itemID || page.Items[0].ContributionNote != link.ContributionNote || page.Items[0].PlanningRevision != 1 || page.Items[0].Lifecycle != "proposed" || page.ObjectiveRevision != 2 || page.WorkspaceRevision != 3 {
		t.Fatalf("linked page %+v %v", page, err)
	}

	var itemBizID string
	if err = db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, itemID).Scan(&itemBizID); err != nil {
		t.Fatal(err)
	}
	planningPermit := workspacePermit(t, db, identity.ProductCode, "pm", "view")
	planningPermit.Resource = "product_priorities"
	reverse, err := ListPlanningItemObjectives(context.Background(), db, identity.ProductCode, "pm", viewPermit, planningPermit, itemBizID, 1, 1)
	if err != nil || reverse.Total != 1 || len(reverse.Items) != 1 || reverse.Items[0].ObjectiveID != original.ID || reverse.Items[0].ContributionNote != link.ContributionNote || reverse.ItemRevision != 1 || reverse.WorkspaceRevision != 3 {
		t.Fatalf("reverse objectives %+v %v", reverse, err)
	}
	reverse, err = ListPlanningItemObjectives(context.Background(), db, identity.ProductCode, "pm", viewPermit, planningPermit, itemBizID, 2, 1)
	if err != nil || reverse.Total != 1 || len(reverse.Items) != 0 {
		t.Fatalf("reverse pagination %+v %v", reverse, err)
	}
	_, err = ListPlanningItemObjectives(context.Background(), db, identity.ProductCode, "pm", viewPermit, viewPermit, itemBizID, 1, 1)
	requireProductRule(t, err, "product_authorization_invalid")
	_, err = ListPlanningItemObjectives(context.Background(), db, identity.ProductCode, "pm", viewPermit, planningPermit, "bad-id", 1, 1)
	requireProductRule(t, err, "product_planning_item_objectives_invalid")
	page, err = ListProductObjectiveItems(context.Background(), db, identity.ProductCode, "pm", viewPermit, original.ID, 2, 1)
	if err != nil || page.Total != 1 || len(page.Items) != 0 || page.Page != 2 {
		t.Fatalf("empty second page %+v %v", page, err)
	}
	_, err = ListProductObjectiveItems(context.Background(), db, identity.ProductCode, "pm", viewPermit, original.ID, 0, 1)
	requireProductRule(t, err, "product_objective_item_list_invalid")
	wrongPermit := viewPermit
	wrongPermit.Resource = "product_features"
	_, err = ListProductObjectiveItems(context.Background(), db, identity.ProductCode, "pm", wrongPermit, original.ID, 1, 1)
	requireProductRule(t, err, "product_authorization_invalid")
	identity.IdempotencyKey = "update-link"
	_, err = run("edit")
	requireProductRule(t, err, "product_revision_conflict")
	link.ExpectedRevision = 3
	_, err = run("edit")
	requireProductRule(t, err, "product_objective_revision_conflict")
	link.ExpectedObjectiveRevision = 2
	link.ExpectedPlanningRevision = 2
	_, err = run("edit")
	requireProductRule(t, err, "product_planning_revision_conflict")
	link.ExpectedPlanningRevision = 1
	link.ContributionNote = "改善登录稳定性"
	if _, err = run("edit"); err != nil {
		t.Fatal(err)
	}
	var note string
	if err = db.QueryRow(`SELECT contribution_note FROM product_objective_items WHERE objective_id=? AND planning_item_id=?`, original.ID, itemID).Scan(&note); err != nil || note != link.ContributionNote {
		t.Fatalf("updated note %s %v", note, err)
	}
	link.ExpectedRevision = 4
	link.ExpectedObjectiveRevision = 3
	identity.IdempotencyKey = "remove-link"
	link.Remove = true
	link.ContributionNote = ""
	if _, err = run("edit"); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_objective_items`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("remove count %d %v", count, err)
	}
	workspaceFixture(t, db, "P-FOREIGN-GOAL")
	foreign, err := db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-FOREIGN-GOAL','别的产品事项','范围','growth','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`)
	if err != nil {
		t.Fatal(err)
	}
	link.PlanningItemID, err = foreign.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	link.ExpectedRevision = 5
	link.ExpectedObjectiveRevision = 4
	link.Remove = false
	link.ContributionNote = "跨产品尝试"
	identity.IdempotencyKey = "foreign-link"
	_, err = run("edit")
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign item %v", err)
	}
	foreignPermit := workspacePermit(t, db, "P-FOREIGN-GOAL", "pm", "view")
	foreignPermit.Resource = "product_objectives"
	_, err = ListProductObjectiveItems(context.Background(), db, "P-FOREIGN-GOAL", "pm", foreignPermit, original.ID, 1, 10)
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign objective read %v", err)
	}
	link.PlanningItemID = itemID
	if _, err = db.Exec(`UPDATE product_planning_items SET lifecycle='cancelled' WHERE id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	_, err = run("edit")
	requireProductRule(t, err, "product_objective_item_link_invalid")
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts`).Scan(&count); err != nil || count != 4 {
		t.Fatalf("receipts %d %v", count, err)
	}
}
