package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLPlanningFeatureBindingPreservesScopeHistory(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-PF")
	ctx := context.Background()
	permit := func(resource, action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-PF", "pm", action)
		p.Resource = resource
		return p
	}
	identity := CommandIdentity{ProductCode: "P-PF", ActorUID: "pm", Action: "product_features:create", IdempotencyKey: "feature"}
	result, err := CreateProductFeature(ctx, db, identity, permit("product_features", "edit"), FeatureDraft{ExpectedRevision: 1, Title: "统一登录"})
	if err != nil {
		t.Fatal(err)
	}
	var feature FeatureRecord
	if err = json.Unmarshal(result.Value, &feature); err != nil {
		t.Fatal(err)
	}
	const itemID = "00000000-0000-4000-8000-000000000001"
	if _, err = db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,created_by,updated_by,created_at,updated_at) VALUES(?,'P-PF','OIDC','支持 OIDC','growth','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, itemID); err != nil {
		t.Fatal(err)
	}
	input := PlanningFeatureChange{ExpectedRevision: 2, ItemBizID: itemID, FeatureBizID: feature.BizID, ExpectedItemRevision: 1, ExpectedFeatureRevision: 1, Operation: "link", Reason: "归属长期能力"}
	identity.Action = "product_priorities:feature-link"
	identity.IdempotencyKey = "link"
	_, err = ChangePlanningFeature(ctx, db, identity, permit("product_priorities", "view"), permit("product_features", "view"), input)
	requireProductRule(t, err, "product_authorization_invalid")

	for _, state := range []string{"merged", "delivered", "cancelled"} {
		if _, err = db.Exec(`UPDATE product_planning_items SET lifecycle=? WHERE biz_id=?`, state, itemID); err != nil {
			t.Fatal(err)
		}
		_, err = ChangePlanningFeature(ctx, db, identity, permit("product_priorities", "edit"), permit("product_features", "view"), input)
		requireProductRule(t, err, "product_planning_readonly")
	}
	if _, err = db.Exec(`UPDATE product_planning_items SET lifecycle='in_delivery' WHERE biz_id=?`, itemID); err != nil {
		t.Fatal(err)
	}
	_, err = ChangePlanningFeature(ctx, db, identity, permit("product_priorities", "edit"), permit("product_features", "view"), input)
	requireProductRule(t, err, "product_planning_impact_required")
	input.ImpactNote = "仅调整能力归属，交付范围需重新确认"
	if _, err = db.Exec(`UPDATE product_features SET lifecycle='deprecated' WHERE id=?`, feature.ID); err != nil {
		t.Fatal(err)
	}
	_, err = ChangePlanningFeature(ctx, db, identity, permit("product_priorities", "edit"), permit("product_features", "view"), input)
	requireProductRule(t, err, "product_feature_request_state_invalid")
	if _, err = db.Exec(`UPDATE product_features SET lifecycle='candidate' WHERE id=?`, feature.ID); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"root", "item", "feature"} {
		stale := input
		rule := "product_revision_conflict"
		switch field {
		case "root":
			stale.ExpectedRevision = 1
		case "item":
			stale.ExpectedItemRevision = 2
			rule = "product_planning_revision_conflict"
		case "feature":
			stale.ExpectedFeatureRevision = 2
			rule = "product_feature_revision_conflict"
		}
		_, err = ChangePlanningFeature(ctx, db, identity, permit("product_priorities", "edit"), permit("product_features", "view"), stale)
		requireProductRule(t, err, rule)
	}
	if _, err = ChangePlanningFeature(ctx, db, identity, permit("product_priorities", "edit"), permit("product_features", "view"), input); err != nil {
		t.Fatal(err)
	}
	replay, err := ChangePlanningFeature(ctx, db, identity, permit("product_priorities", "edit"), permit("product_features", "view"), input)
	if err != nil || !replay.Replayed {
		t.Fatalf("replay: %+v %v", replay, err)
	}

	view, err := ReadPlanningFeature(ctx, db, "P-PF", "pm", itemID, permit("product_priorities", "view"), permit("product_features", "view"))
	if err != nil || view.Feature == nil || view.Feature.BizID != feature.BizID || view.WorkspaceRevision != 3 || view.ItemRevision != 2 || view.ScopeRevision != 2 || !view.RequiresImpactNote {
		t.Fatalf("bound view: %+v %v", view, err)
	}
	_, err = ReadPlanningFeature(ctx, db, "P-PF", "pm", itemID, permit("product_priorities", "view"), permit("product_priorities", "view"))
	requireProductRule(t, err, "product_authorization_invalid")

	unscheduledQuery := FeatureUnscheduledQuery{FeatureBizID: feature.BizID, Page: 1, PageSize: 1}
	unscheduled, err := ListFeatureUnscheduled(ctx, db, "P-PF", "pm", permit("product_priorities", "view"), permit("product_features", "view"), unscheduledQuery)
	if err != nil || unscheduled.Total != 1 || len(unscheduled.Items) != 1 || unscheduled.Items[0].BizID != itemID || unscheduled.WorkspaceRevision != 3 {
		t.Fatalf("unscheduled before cycle: %+v %v", unscheduled, err)
	}
	unscheduledQuery.Page = 2
	unscheduled, err = ListFeatureUnscheduled(ctx, db, "P-PF", "pm", permit("product_priorities", "view"), permit("product_features", "view"), unscheduledQuery)
	if err != nil || unscheduled.Total != 1 || unscheduled.Items == nil || len(unscheduled.Items) != 0 {
		t.Fatalf("unscheduled second page: %+v %v", unscheduled, err)
	}
	_, err = ListFeatureUnscheduled(ctx, db, "P-PF", "pm", permit("product_priorities", "view"), permit("product_priorities", "view"), unscheduledQuery)
	requireProductRule(t, err, "product_authorization_invalid")
	const cycleBizID = "00000000-0000-4000-8000-000000000011"
	if _, err = db.Exec(`INSERT INTO product_planning_cycles(biz_id,product_code,title,starts_on,ends_on,goal_summary,model_snapshot,created_by,updated_by,created_at,updated_at) VALUES(?,'P-PF','周期','2026-09-01','2026-09-30','目标',JSON_OBJECT(),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, cycleBizID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_planning_cycle_items(cycle_id,planning_item_id,product_code,decision_rank,roadmap_bucket) SELECT c.id,i.id,'P-PF',2,'now' FROM product_planning_cycles c JOIN product_planning_items i ON i.product_code=c.product_code WHERE c.biz_id=? AND i.biz_id=?`, cycleBizID, itemID); err != nil {
		t.Fatal(err)
	}
	const secondItem = "00000000-0000-4000-8000-000000000012"
	if _, err = db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,feature_id,created_by,updated_by,created_at,updated_at) VALUES(?,'P-PF','SAML','支持 SAML','growth',?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, secondItem, feature.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_planning_cycle_items(cycle_id,planning_item_id,product_code,decision_rank,roadmap_bucket) SELECT c.id,i.id,'P-PF',1,'next' FROM product_planning_cycles c JOIN product_planning_items i ON i.product_code=c.product_code WHERE c.biz_id=? AND i.biz_id=?`, cycleBizID, secondItem); err != nil {
		t.Fatal(err)
	}
	roadmap, err := ReadFeatureRoadmap(ctx, db, "P-PF", "pm", permit("product_priorities", "view"), permit("product_features", "view"), FeatureRoadmapQuery{FeatureBizID: feature.BizID, CycleBizID: cycleBizID, Page: 1, PageSize: 1})
	if err != nil || roadmap.Total != 2 || roadmap.ByBucket["now"] != 1 || roadmap.ByBucket["next"] != 1 || len(roadmap.Items) != 1 || roadmap.Items[0].BizID != secondItem {
		t.Fatalf("roadmap page: %+v %v", roadmap, err)
	}
	roadmap, err = ReadFeatureRoadmap(ctx, db, "P-PF", "pm", permit("product_priorities", "view"), permit("product_features", "view"), FeatureRoadmapQuery{FeatureBizID: feature.BizID, CycleBizID: cycleBizID, Page: 2, PageSize: 1})
	if err != nil || len(roadmap.Items) != 1 || roadmap.Items[0].BizID != itemID || roadmap.Items[0].RoadmapBucket != "now" {
		t.Fatalf("roadmap second: %+v %v", roadmap, err)
	}
	unscheduledQuery.Page = 1
	unscheduled, err = ListFeatureUnscheduled(ctx, db, "P-PF", "pm", permit("product_priorities", "view"), permit("product_features", "view"), unscheduledQuery)
	if err != nil || unscheduled.Total != 0 || unscheduled.Items == nil || len(unscheduled.Items) != 0 {
		t.Fatalf("cycled items excluded: %+v %v", unscheduled, err)
	}
	input.ExpectedRevision = 3
	input.ExpectedItemRevision = 2
	identity.IdempotencyKey = "duplicate"
	_, err = ChangePlanningFeature(ctx, db, identity, permit("product_priorities", "edit"), permit("product_features", "view"), input)
	requireProductRule(t, err, "product_planning_feature_conflict")
	input.Operation = "unlink"
	identity.IdempotencyKey = "unlink"
	if _, err = db.Exec(`CREATE TRIGGER fail_pf_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err = ChangePlanningFeature(ctx, db, identity, permit("product_priorities", "edit"), permit("product_features", "view"), input); err == nil {
		t.Fatal("audit failure committed")
	}
	var bound int64
	var revision, scope int
	if err = db.QueryRow(`SELECT feature_id,revision,scope_revision FROM product_planning_items WHERE biz_id=?`, itemID).Scan(&bound, &revision, &scope); err != nil || bound != feature.ID || revision != 2 || scope != 2 {
		t.Fatalf("rollback: %d %d %d %v", bound, revision, scope, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_pf_audit`); err != nil {
		t.Fatal(err)
	}
	if _, err = ChangePlanningFeature(ctx, db, identity, permit("product_priorities", "edit"), permit("product_features", "view"), input); err != nil {
		t.Fatal(err)
	}
	var unbound bool
	if err = db.QueryRow(`SELECT feature_id IS NULL,revision,scope_revision FROM product_planning_items WHERE biz_id=?`, itemID).Scan(&unbound, &revision, &scope); err != nil || !unbound || revision != 3 || scope != 3 {
		t.Fatalf("unlink: %v %d %d %v", unbound, revision, scope, err)
	}
	view, err = ReadPlanningFeature(ctx, db, "P-PF", "pm", itemID, permit("product_priorities", "view"), permit("product_features", "view"))
	if err != nil || view.Feature != nil || view.WorkspaceRevision != 4 || view.ItemRevision != 3 || view.ScopeRevision != 3 {
		t.Fatalf("unbound view: %+v %v", view, err)
	}

}
