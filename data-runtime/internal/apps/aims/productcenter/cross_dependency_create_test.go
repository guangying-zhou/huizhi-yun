package productcenter

import (
	"context"
	"os"
	"testing"
)

func TestMySQLCreateCrossDependency(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-XA")
	workspaceFixture(t, db, "P-XB")
	a := planningFixture(t, db, "P-XA")
	b := planningFixture(t, db, "P-XB")
	script, e := os.ReadFile("../../../../../aims/docs/migration_v5.27_cross_product_dependencies.sql")
	if e != nil {
		t.Fatal(e)
	}
	executeSQLScript(t, db, string(script))
	input := CrossDependencyCreate{PredecessorProductCode: "P-XB", ExpectedRevision: 1, ExpectedItemRevision: 1, ExpectedPredecessorProductRevision: 1, ExpectedPredecessorRevision: 1, Reason: "依赖共享能力"}
	if e = db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, a).Scan(&input.ItemBizID); e != nil {
		t.Fatal(e)
	}
	if e = db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, b).Scan(&input.PredecessorBizID); e != nil {
		t.Fatal(e)
	}
	identity := CommandIdentity{ProductCode: "P-XA", ActorUID: "pm", Action: "product_priorities:cross-dependency-create", IdempotencyKey: "cross"}
	run := func() (CommandResult, error) {
		p := workspacePermit(t, db, "P-XA", "pm", "edit")
		p.Resource = "product_priorities"
		q := workspacePermit(t, db, "P-XB", "pm", "view")
		q.Resource = "product_priorities"
		return CreateCrossDependency(context.Background(), db, identity, p, q, input)
	}
	if _, e = db.Exec(`CREATE TRIGGER fail_cross_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); e != nil {
		t.Fatal(e)
	}
	if _, e = run(); e == nil {
		t.Fatal("audit failure accepted")
	}
	var count int
	if e = db.QueryRow(`SELECT COUNT(*) FROM product_cross_dependencies`).Scan(&count); e != nil || count != 0 {
		t.Fatalf("rollback %d %v", count, e)
	}
	if _, e = db.Exec(`DROP TRIGGER fail_cross_audit`); e != nil {
		t.Fatal(e)
	}
	saved, e := run()
	if e != nil {
		t.Fatal(e)
	}
	replay, e := run()
	if e != nil || !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatalf("replay %+v %v", replay, e)
	}
	identity.IdempotencyKey = "new-cross"
	_, e = run()
	requireProductRule(t, e, "product_revision_conflict")
	input.ExpectedRevision = 2
	input.ExpectedItemRevision = 2
	_, e = run()
	requireProductRule(t, e, "planning_dependency_duplicate")
	var unchanged bool
	if e = db.QueryRow(`SELECT revision=1 AND scope_revision=1 FROM product_planning_items WHERE id=?`, b).Scan(&unchanged); e != nil || !unchanged {
		t.Fatalf("target changed %v %v", unchanged, e)
	}

	c := planningFixture(t, db, "P-XA")
	var cBiz string
	if e = db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, c).Scan(&cBiz); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(`INSERT INTO product_cross_dependencies(biz_id,product_code,planning_item_id,predecessor_product_code,predecessor_id,reason,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-XB',?,'P-XA',?,'测试链路','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, b, c); e != nil {
		t.Fatal(e)
	}
	p := workspacePermit(t, db, "P-XA", "pm", "edit")
	p.Resource = "product_priorities"
	_, e = EditPlanningDependencies(context.Background(), db, CommandIdentity{ProductCode: "P-XA", ActorUID: "pm", Action: "product_priorities:dependencies-edit", IdempotencyKey: "mixed-cycle"}, p, PlanningDependenciesEdit{ItemBizID: cBiz, PredecessorBizIDs: []string{input.ItemBizID}, ExpectedRevision: 2, ExpectedItemRevision: 1, Reason: "建立前置"})
	requireProductRule(t, e, "planning_dependency_cycle")
	if e = db.QueryRow(`SELECT COUNT(*) FROM product_planning_dependencies WHERE planning_item_id=?`, c).Scan(&count); e != nil || count != 0 {
		t.Fatalf("cycle edge not rolled back %d %v", count, e)
	}

	remove := CrossDependencyRemove{CrossDependencyCreate: input, ExpectedDependencyRevision: 1}
	if e = db.QueryRow(`SELECT biz_id FROM product_cross_dependencies WHERE planning_item_id=?`, a).Scan(&remove.DependencyBizID); e != nil {
		t.Fatal(e)
	}
	sourceView := workspacePermit(t, db, "P-XA", "pm", "view")
	sourceView.Resource = "product_priorities"
	targetView := workspacePermit(t, db, "P-XB", "pm", "view")
	targetView.Resource = "product_priorities"
	detail, e := ReadCrossDependency(context.Background(), db, "P-XA", "P-XB", "pm", remove.DependencyBizID, sourceView, targetView)
	if e != nil || detail.ItemBizID != input.ItemBizID || detail.PredecessorBizID != input.PredecessorBizID || detail.ItemRevision != 2 || detail.WorkspaceRevision != 2 || detail.PredecessorRevision != 1 || detail.Reason != input.Reason {
		t.Fatalf("detail %+v %v", detail, e)
	}
	discovered, e := DiscoverCrossDependencyTargets(context.Background(), db, "P-XA", "pm", input.ItemBizID, sourceView)
	if e != nil || len(discovered.ProductCodes) != 1 || discovered.ProductCodes[0] != "P-XB" || discovered.ItemRevision != 2 {
		t.Fatalf("target discovery %+v %v", discovered, e)
	}
	visible, e := ListCrossDependencies(context.Background(), db, "P-XA", "pm", input.ItemBizID, sourceView, map[string]AuthorizationPermit{"P-XB": targetView}, 1, 1)
	if e != nil || visible.Total != 1 || len(visible.Items) != 1 || visible.Items[0].BizID != remove.DependencyBizID {
		t.Fatalf("visible list %+v %v", visible, e)
	}
	hidden, e := ListCrossDependencies(context.Background(), db, "P-XA", "pm", input.ItemBizID, sourceView, map[string]AuthorizationPermit{}, 1, 1)
	if e != nil || hidden.Total != 0 || len(hidden.Items) != 0 {
		t.Fatalf("hidden list leaked %+v %v", hidden, e)
	}
	second, e := ListCrossDependencies(context.Background(), db, "P-XA", "pm", input.ItemBizID, sourceView, map[string]AuthorizationPermit{"P-XB": targetView}, 2, 1)
	if e != nil || second.Total != 1 || len(second.Items) != 0 {
		t.Fatalf("page two %+v %v", second, e)
	}
	denied := targetView
	denied.Resource = "product_features"
	_, e = ReadCrossDependency(context.Background(), db, "P-XA", "P-XB", "pm", remove.DependencyBizID, sourceView, denied)
	requireProductRule(t, e, "product_authorization_invalid")
	removeIdentity := CommandIdentity{ProductCode: "P-XA", ActorUID: "pm", Action: "product_priorities:cross-dependency-remove", IdempotencyKey: "remove-cross"}
	removeRun := func() (CommandResult, error) {
		p := workspacePermit(t, db, "P-XA", "pm", "edit")
		p.Resource = "product_priorities"
		q := workspacePermit(t, db, "P-XB", "pm", "view")
		q.Resource = "product_priorities"
		return RemoveCrossDependency(context.Background(), db, removeIdentity, p, q, remove)
	}
	if _, e = db.Exec(`CREATE TRIGGER fail_remove_cross_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); e != nil {
		t.Fatal(e)
	}
	if _, e = removeRun(); e == nil {
		t.Fatal("remove audit failure accepted")
	}
	if e = db.QueryRow(`SELECT COUNT(*) FROM product_cross_dependencies WHERE planning_item_id=?`, a).Scan(&count); e != nil || count != 1 {
		t.Fatalf("remove rollback %d %v", count, e)
	}
	if _, e = db.Exec(`DROP TRIGGER fail_remove_cross_audit`); e != nil {
		t.Fatal(e)
	}
	removed, e := removeRun()
	if e != nil {
		t.Fatal(e)
	}
	repeated, e := removeRun()
	if e != nil || !repeated.Replayed || repeated.ReceiptID != removed.ReceiptID {
		t.Fatalf("remove replay %+v %v", repeated, e)
	}
	if e = db.QueryRow(`SELECT COUNT(*) FROM product_cross_dependencies WHERE planning_item_id=?`, a).Scan(&count); e != nil || count != 0 {
		t.Fatalf("not removed %d %v", count, e)
	}
}
