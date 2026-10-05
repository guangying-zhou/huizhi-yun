package productcenter

import (
	"context"
	"os"
	"testing"
)

func TestMySQLPlanningDependenciesAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	schema, e := os.ReadFile("../../../../../aims/docs/migration_v5.27_cross_product_dependencies.sql")
	if e != nil {
		t.Fatal(e)
	}
	executeSQLScript(t, db, string(schema))
	workspaceFixture(t, db, "P-DEPS")
	workspaceFixture(t, db, "P-OTHER")
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-DEPS", "pm", action)
		p.Resource = "product_priorities"
		return p
	}
	makeItem := func(code string) (int64, string) {
		t.Helper()
		id := planningFixture(t, db, code)
		var biz string
		if err := db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, id).Scan(&biz); err != nil {
			t.Fatal(err)
		}
		return id, biz
	}
	aID, a := makeItem("P-DEPS")
	_, b := makeItem("P-DEPS")
	_, other := makeItem("P-OTHER")
	input := PlanningDependenciesEdit{ItemBizID: a, ExpectedRevision: 1, ExpectedItemRevision: 1, PredecessorBizIDs: []string{b}, Reason: "共用基础能力"}
	identity := CommandIdentity{ProductCode: "P-DEPS", ActorUID: "pm", Action: "product_priorities:dependencies-edit", IdempotencyKey: "deps"}
	_, err := EditPlanningDependencies(ctx, db, identity, permit("view"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	cross := input
	cross.PredecessorBizIDs = []string{other}
	_, err = EditPlanningDependencies(ctx, db, identity, permit("edit"), cross)
	requireProductRule(t, err, "planning_dependency_not_found")
	if _, err = db.Exec(`CREATE TRIGGER pc_fail_deps BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = EditPlanningDependencies(ctx, db, identity, permit("edit"), input); err == nil {
		t.Fatal("audit failure committed")
	}
	var count, revision, scope int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_planning_dependencies`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("dependency leak %d %v", count, err)
	}
	if err = db.QueryRow(`SELECT revision,scope_revision FROM product_planning_items WHERE id=?`, aID).Scan(&revision, &scope); err != nil || revision != 1 || scope != 1 {
		t.Fatalf("revision leak %d %d %v", revision, scope, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_fail_deps`); err != nil {
		t.Fatal(err)
	}
	result, err := EditPlanningDependencies(ctx, db, identity, permit("edit"), input)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := EditPlanningDependencies(ctx, db, identity, permit("edit"), input)
	if err != nil || !replay.Replayed || replay.ReceiptID != result.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	detail, err := ReadPlanningItem(ctx, db, "P-DEPS", "pm", a, permit("view"))
	if err != nil || detail.ScopeRevision != 2 || detail.Revision != 2 || detail.WorkspaceRevision != 2 {
		t.Fatalf("dependency invalidation %+v %v", detail, err)
	}
	dependencies, err := ReadPlanningDependencies(ctx, db, "P-DEPS", "pm", a, permit("view"))
	if err != nil || dependencies.ItemRevision != 2 || dependencies.ScopeRevision != 2 || dependencies.WorkspaceRevision != 2 || len(dependencies.Predecessors) != 1 || dependencies.Predecessors[0].BizID != b || dependencies.Predecessors[0].Title == "" || dependencies.Predecessors[0].Lifecycle != "proposed" {
		t.Fatalf("dependency read %+v %v", dependencies, err)
	}
	wrong := permit("view")
	wrong.Resource = "product_requests"
	_, err = ReadPlanningDependencies(ctx, db, "P-DEPS", "pm", a, wrong)
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = ReadPlanningDependencies(ctx, db, "P-DEPS", "pm", other, permit("view")); err == nil {
		t.Fatal("cross-product item readable")
	}

	cyclic := PlanningDependenciesEdit{ItemBizID: b, ExpectedRevision: 2, ExpectedItemRevision: 1, PredecessorBizIDs: []string{a}, Reason: "反向依赖"}
	identity.IdempotencyKey = "cycle"
	_, err = EditPlanningDependencies(ctx, db, identity, permit("edit"), cyclic)
	requireProductRule(t, err, "planning_dependency_cycle")
	input.ExpectedRevision = 2
	input.ExpectedItemRevision = 2
	identity.IdempotencyKey = "noop"
	if _, err = EditPlanningDependencies(ctx, db, identity, permit("edit"), input); err != nil {
		t.Fatal(err)
	}
	detail, err = ReadPlanningItem(ctx, db, "P-DEPS", "pm", a, permit("view"))
	if err != nil || detail.Revision != 2 || detail.WorkspaceRevision != 2 {
		t.Fatal("no-op invalidated scope", err)
	}
	if _, err = db.Exec(`UPDATE product_planning_items SET lifecycle='in_delivery' WHERE id=?`, aID); err != nil {
		t.Fatal(err)
	}
	input.PredecessorBizIDs = []string{}
	identity.IdempotencyKey = "remove"
	_, err = EditPlanningDependencies(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_planning_impact_required")
	input.ImpactNote = "前置能力已有替代方案，安排重新评估"
	if _, err = EditPlanningDependencies(ctx, db, identity, permit("edit"), input); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_planning_dependencies`).Scan(&count); err != nil || count != 0 {
		t.Fatal("explicit empty did not remove dependency", err)
	}
	empty, err := ReadPlanningDependencies(ctx, db, "P-DEPS", "pm", a, permit("view"))
	if err != nil || empty.Predecessors == nil || len(empty.Predecessors) != 0 || !empty.RequiresImpactNote || empty.ItemRevision != 3 {
		t.Fatalf("empty dependencies %+v %v", empty, err)
	}

}
