package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"testing"
)

func exerciseVersionScopeTransaction(t *testing.T, db *sql.DB, check PlanningDeliveryCheck) PlanningDeliveryCheck {
	t.Helper()
	ctx := context.Background()
	permit := func(resource, action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-SELECT", "pm", action)
		p.Resource = resource
		return p
	}
	created, err := CreateProductCenterVersion(ctx, db, CommandIdentity{ProductCode: "P-SELECT", ActorUID: "pm", Action: "product_versions:create", IdempotencyKey: "scope-version"}, permit("product_versions", "edit"), ProductVersionDraft{ExpectedRevision: check.ExpectedRevision, VersionCode: "scope-v1"})
	if err != nil {
		t.Fatal(err)
	}
	var version ProductVersionRecord
	if err = json.Unmarshal(created.Value, &version); err != nil {
		t.Fatal(err)
	}
	check.ExpectedRevision++
	input := ProductVersionScopeDraft{PlanningDeliveryCheck: check, VersionID: version.ID, ExpectedVersionRevision: 1, Title: "统一登录", Description: "本次支持 OIDC", AcceptanceCriteria: "验证登录、注销及异常回调", ChangeType: "new", Reason: "按本周期选择结果排期"}
	// Historical source scope remains in its original version; the successor
	// consumes the currently selected planning item instead of moving the old row.
	sourceResult, err := db.Exec(`INSERT INTO product_versions(product_code,version_code,status) VALUES('P-SELECT','scope-source','developing')`)
	if err != nil {
		t.Fatal(err)
	}
	sourceVersion, err := sourceResult.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	sourceResult, err = db.Exec(`INSERT INTO product_version_features(version_id,title,status,acceptance_criteria) VALUES(?,'原范围','planned','原验收条件')`, sourceVersion)
	if err != nil {
		t.Fatal(err)
	}
	sourceScope, err := sourceResult.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	input.DeferredFrom = &ProductVersionScopeDeferralSource{VersionID: sourceVersion, ScopeID: sourceScope, ExpectedVersionRevision: 1, ExpectedScopeRevision: 1}
	identity := CommandIdentity{ProductCode: "P-SELECT", ActorUID: "pm", Action: "product_versions:scope-create", IdempotencyKey: "scope-add"}

	trusted := integrationoperation.TrustedContext{SourceApp: "aims", TenantCode: "TENANT", DeploymentCode: "AIMS"}
	for _, statement := range []string{
		`INSERT INTO product_requests(biz_id,product_code,title,created_by,updated_by,created_at,updated_at) VALUES('00000000-0000-4000-8000-000000000088','P-SELECT','Feedback','pm','pm',NOW(3),NOW(3))`,
		`INSERT INTO product_request_sources(request_id,source_type,source_note,created_by,updated_by,created_at,updated_at) SELECT id,'service_ticket','Feedback','pm','pm',NOW(3),NOW(3) FROM product_requests WHERE biz_id='00000000-0000-4000-8000-000000000088'`,
		`INSERT INTO product_feedback_bindings(source_app,source_type,source_biz_id,product_code,request_id,source_id,created_by,created_at) SELECT 'altoc','service_ticket','ST-SCOPE','P-SELECT',request_id,id,'pm',NOW(3) FROM product_request_sources WHERE request_id=(SELECT id FROM product_requests WHERE biz_id='00000000-0000-4000-8000-000000000088')`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	run := func() (CommandResult, error) {
		return CreateProductVersionScope(ctx, db, identity, permit("product_versions", "edit"), permit("product_priorities", "prioritize"), input, trusted)
	}
	_, err = CreateProductVersionScope(ctx, db, identity, permit("product_versions", "view"), permit("product_priorities", "prioritize"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	_, err = CreateProductVersionScope(ctx, db, identity, permit("product_versions", "edit"), permit("product_priorities", "view"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`UPDATE product_planning_cycle_items SET selection_status='candidate'`); err != nil {
		t.Fatal(err)
	}
	_, err = run()
	requireProductRule(t, err, "planning_delivery_selection_required")
	if _, err = db.Exec(`UPDATE product_planning_cycle_items SET selection_status='selected'`); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`CREATE TRIGGER pc_scope_fail BEFORE INSERT ON product_activity_logs FOR EACH ROW BEGIN IF NEW.action='scope-defer' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='scope audit failure'; END IF; END`); err != nil {
		t.Fatal(err)
	}
	if _, err = run(); err == nil {
		t.Fatal("failed audit committed scope")
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_version_features WHERE version_id=?`, version.ID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("rollback: %d %v", count, err)
	}
	var sourceStatus string
	var sourceRevision, sourceScopeRevision uint64
	if err = db.QueryRow(`SELECT f.status,v.revision,v.scope_revision FROM product_version_features f JOIN product_versions v ON v.id=f.version_id WHERE f.id=?`, sourceScope).Scan(&sourceStatus, &sourceRevision, &sourceScopeRevision); err != nil || sourceStatus != "planned" || sourceRevision != 1 || sourceScopeRevision != 1 {
		t.Fatalf("source rollback: %s %d %d %v", sourceStatus, sourceRevision, sourceScopeRevision, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_scope_fail`); err != nil {
		t.Fatal(err)
	}
	result, err := run()
	if err != nil {
		t.Fatal(err)
	}
	replay, err := run()
	if err != nil || !replay.Replayed || result.ReceiptID != replay.ReceiptID {
		t.Fatalf("replay: %+v %v", replay, err)
	}

	var events int
	if err := db.QueryRow(`SELECT COUNT(*) FROM integration_operation WHERE operation_code='aims.altoc.product-feedback.update-progress.v1' AND JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.ticketCode'))='ST-SCOPE'`).Scan(&events); err != nil || events != 1 {
		t.Fatalf("scope progress event: %d %v", events, err)
	}
	if _, err := db.Exec(`DELETE FROM product_feedback_bindings WHERE source_biz_id='ST-SCOPE'`); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT f.status,v.revision,v.scope_revision FROM product_version_features f JOIN product_versions v ON v.id=f.version_id WHERE f.id=?`, sourceScope).Scan(&sourceStatus, &sourceRevision, &sourceScopeRevision); err != nil || sourceStatus != "deferred" || sourceRevision != 2 || sourceScopeRevision != 2 {
		t.Fatalf("source after replay: %s %d %d %v", sourceStatus, sourceRevision, sourceScopeRevision, err)
	}
	var linked int64
	if err = db.QueryRow(`SELECT deferred_from_feature_id FROM product_version_features WHERE version_id=?`, version.ID).Scan(&linked); err != nil || linked != sourceScope {
		t.Fatalf("successor link: %d %v", linked, err)
	}
	sourcePage, err := ListProductVersionScope(ctx, db, "P-SELECT", "pm", permit("product_versions", "view"), sourceVersion, PlanningPageQuery{Page: 1, PageSize: 1})
	if err != nil || sourcePage.Total != 1 || len(sourcePage.Items) != 1 || len(sourcePage.Items[0].Successors) != 1 || sourcePage.Items[0].Successors[0].VersionID != version.ID {
		t.Fatalf("successor read: %+v %v", sourcePage, err)
	}
	if _, err = db.Exec(`UPDATE product_versions SET product_code='OTHER' WHERE id=?`, version.ID); err != nil {
		t.Fatal(err)
	}
	hiddenSuccessors, err := ListProductVersionScope(ctx, db, "P-SELECT", "pm", permit("product_versions", "view"), sourceVersion, PlanningPageQuery{Page: 1, PageSize: 1})
	if err != nil || len(hiddenSuccessors.Items) != 1 || len(hiddenSuccessors.Items[0].Successors) != 0 {
		t.Fatalf("cross product successors exposed: %+v %v", hiddenSuccessors, err)
	}
	if _, err = db.Exec(`UPDATE product_versions SET product_code='P-SELECT' WHERE id=?`, version.ID); err != nil {
		t.Fatal(err)
	}
	var scope, revision uint64
	var public bool
	var criteria, state string
	if err = db.QueryRow(`SELECT v.revision,v.scope_revision,f.is_public,f.acceptance_criteria,f.status FROM product_versions v JOIN product_version_features f ON f.version_id=v.id WHERE v.id=?`, version.ID).Scan(&revision, &scope, &public, &criteria, &state); err != nil || revision != 2 || scope != 2 || public || criteria != input.AcceptanceCriteria || state != "planned" {
		t.Fatalf("scope: %d %d %v %s %s %v", revision, scope, public, criteria, state, err)
	}
	check.ExpectedRevision++
	check.ExpectedItemRevision++
	input.PlanningDeliveryCheck = check
	input.ExpectedVersionRevision = 2
	identity.IdempotencyKey = "duplicate-scope"
	_, err = run()
	requireProductRule(t, err, "product_version_scope_conflict")
	for _, state := range []string{"released", "archived"} {
		if _, err = db.Exec(`UPDATE product_versions SET status=? WHERE id=?`, state, version.ID); err != nil {
			t.Fatal(err)
		}
		_, err = run()
		requireProductRule(t, err, "product_version_locked")
	}
	if _, err = db.Exec(`UPDATE product_versions SET status='planning' WHERE id=?`, version.ID); err != nil {
		t.Fatal(err)
	}
	page, err := ListProductVersionScope(ctx, db, "P-SELECT", "pm", permit("product_versions", "view"), version.ID, PlanningPageQuery{Page: 1, PageSize: 1})
	if err != nil || page.Total != 1 || len(page.Items) != 1 || page.Items[0].LegacyUnscored || page.Items[0].PlanningItemBizID == nil || *page.Items[0].PlanningItemBizID != check.ItemBizID || page.ScopeRevision != 2 {
		t.Fatalf("scope list: %+v %v", page, err)
	}
	if page.Items[0].DeferredFromScopeID == nil || *page.Items[0].DeferredFromScopeID != sourceScope || page.Items[0].DeferredFromVersionID == nil || *page.Items[0].DeferredFromVersionID != sourceVersion || page.Items[0].DeferredFromVersionCode == nil || *page.Items[0].DeferredFromVersionCode != "scope-source" {
		t.Fatalf("missing deferral source: %+v", page.Items[0])
	}
	// Legacy foreign keys do not establish a product authorization boundary.
	if _, err = db.Exec(`UPDATE product_versions SET product_code='OTHER' WHERE id=?`, sourceVersion); err != nil {
		t.Fatal(err)
	}
	hidden, err := ListProductVersionScope(ctx, db, "P-SELECT", "pm", permit("product_versions", "view"), version.ID, PlanningPageQuery{Page: 1, PageSize: 1})
	if err != nil || len(hidden.Items) != 1 || hidden.Items[0].DeferredFromScopeID != nil || hidden.Items[0].DeferredFromVersionID != nil || hidden.Items[0].DeferredFromVersionCode != nil {
		t.Fatalf("cross-product source exposed: %+v %v", hidden, err)
	}
	if _, err = db.Exec(`UPDATE product_versions SET product_code='P-SELECT' WHERE id=?`, sourceVersion); err != nil {
		t.Fatal(err)
	}
	page, err = ListProductVersionScope(ctx, db, "P-SELECT", "pm", permit("product_versions", "view"), version.ID, PlanningPageQuery{Page: 2, PageSize: 1})
	if err != nil || page.Total != 1 || page.Items == nil || len(page.Items) != 0 {
		t.Fatalf("scope page 2: %+v %v", page, err)
	}
	page, err = ListProductVersionScope(ctx, db, "P-SELECT", "pm", permit("product_versions", "view"), version.ID, PlanningPageQuery{Page: 1, PageSize: 1, Keyword: "%_"})
	if err != nil || page.Total != 0 {
		t.Fatalf("scope literal search: %+v %v", page, err)
	}
	return exerciseVersionScopeEdit(t, db, check, version.ID)
}

func TestProductVersionScopeDraftValidation(t *testing.T) {
	v := ProductVersionScopeDraft{PlanningDeliveryCheck: PlanningDeliveryCheck{ItemBizID: "00000000-0000-4000-8000-000000000001", CycleBizID: "00000000-0000-4000-8000-000000000002", ExpectedRevision: 1, ExpectedItemRevision: 1, ExpectedCycleRevision: 1, ExpectedQueueRevision: 1}, VersionID: 1, ExpectedVersionRevision: 1, Title: "范围", AcceptanceCriteria: "验收", ChangeType: "new", Reason: "安排"}
	if err := ValidateProductVersionScopeDraft(v); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*ProductVersionScopeDraft){func(x *ProductVersionScopeDraft) { x.ExpectedVersionRevision = 0 }, func(x *ProductVersionScopeDraft) { x.AcceptanceCriteria = "" }, func(x *ProductVersionScopeDraft) { x.ChangeType = "delivered" }, func(x *ProductVersionScopeDraft) { x.Reason = "" }} {
		bad := v
		mutate(&bad)
		if ValidateProductVersionScopeDraft(bad) == nil {
			t.Fatal("invalid scope accepted")
		}
	}
}
