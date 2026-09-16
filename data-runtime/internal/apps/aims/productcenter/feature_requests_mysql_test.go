package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"testing"
)

func TestMySQLFeatureRequestLinkAndUnlink(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-LINK")
	ctx := context.Background()
	permit := func(resource, action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-LINK", "pm", action)
		p.Resource = resource
		return p
	}
	command := func(action, key string) CommandIdentity {
		return CommandIdentity{ProductCode: "P-LINK", ActorUID: "pm", Action: action, IdempotencyKey: key}
	}
	f, err := CreateProductFeature(ctx, db, command("product_features:create", "feature"), permit("product_features", "edit"), FeatureDraft{ExpectedRevision: 1, Title: "单点登录"})
	if err != nil {
		t.Fatal(err)
	}
	r, err := CreateProductRequest(ctx, db, command("product_requests:create", "request"), permit("product_requests", "create"), RequestDraft{ExpectedRevision: 2, Title: "企业登录", ProblemStatement: "重复登录", SourceType: "customer", UrgencyLevel: "P2"})
	if err != nil {
		t.Fatal(err)
	}
	var feature FeatureRecord
	var request RequestRecord
	if err = json.Unmarshal(f.Value, &feature); err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(r.Value, &request); err != nil {
		t.Fatal(err)
	}

	if _, err = db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-LINK','登录规划','统一登录','growth','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_planning_item_requests(product_code,planning_item_id,request_id,created_by,created_at) SELECT 'P-LINK',id,?,'pm',UTC_TIMESTAMP(3) FROM product_planning_items WHERE product_code='P-LINK'`, request.ID); err != nil {
		t.Fatal(err)
	}

	trusted := integrationoperation.TrustedContext{SourceApp: "aims", TenantCode: "TENANT", DeploymentCode: "AIMS"}
	if _, err := db.Exec(`INSERT INTO product_request_sources(request_id,source_type,source_note,created_by,updated_by,created_at,updated_at) VALUES(?,'service_ticket','Feedback','pm','pm',NOW(3),NOW(3))`, request.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO product_feedback_bindings(source_app,source_type,source_biz_id,product_code,request_id,source_id,created_by,created_at) SELECT 'altoc','service_ticket','ST-LINK','P-LINK',request_id,id,'pm',NOW(3) FROM product_request_sources WHERE request_id=?`, request.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO product_versions(id,product_code,version_code,status) VALUES(900,'P-LINK','v1','planning')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO product_version_features(version_id,product_feature_id,title,status,is_public) VALUES(900,?,'Public','planned',1)`, feature.ID); err != nil {
		t.Fatal(err)
	}
	input := FeatureRequestChange{ExpectedRevision: 3, FeatureBizID: feature.BizID, RequestBizID: request.BizID, ExpectedFeatureRevision: 1, ExpectedRequestRevision: 1, Operation: "link", Reason: "归集需求"}
	identity := command("product_features:request-link", "link")

	// Reject foreign object identities even with valid permissions on this product.
	workspaceFixture(t, db, "P-FOREIGN")
	const foreignFeature = "00000000-0000-4000-8000-000000000091"
	const foreignRequest = "00000000-0000-4000-8000-000000000092"
	if _, err = db.Exec(`INSERT INTO product_features(biz_id,product_code,title,created_by,updated_by,created_at,updated_at) VALUES(?,'P-FOREIGN','其他功能','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, foreignFeature); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_requests(biz_id,product_code,title,problem_statement,source_type,urgency_level,created_by,updated_by,created_at,updated_at) VALUES(?,'P-FOREIGN','其他需求','其他问题','internal','P2','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, foreignRequest); err != nil {
		t.Fatal(err)
	}
	for _, foreign := range []FeatureRequestChange{
		{ExpectedRevision: 3, FeatureBizID: foreignFeature, RequestBizID: request.BizID, ExpectedFeatureRevision: 1, ExpectedRequestRevision: 1, Operation: "link", Reason: "跨产品"},
		{ExpectedRevision: 3, FeatureBizID: feature.BizID, RequestBizID: foreignRequest, ExpectedFeatureRevision: 1, ExpectedRequestRevision: 1, Operation: "link", Reason: "跨产品"},
	} {
		_, err = ChangeFeatureRequest(ctx, db, identity, permit("product_requests", "edit"), permit("product_features", "view"), foreign, trusted)
		if !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("foreign relation: %v", err)
		}
	}
	_, err = ListFeatureRequests(ctx, db, "P-LINK", "pm", permit("product_requests", "view"), permit("product_features", "view"), FeatureRequestPageQuery{FeatureBizID: foreignFeature, Page: 1, PageSize: 20})
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign feature read: %v", err)
	}
	for _, field := range []string{"root", "feature", "request"} {
		stale := input
		expected := "product_revision_conflict"
		switch field {
		case "root":
			stale.ExpectedRevision = 2
		case "feature":
			stale.ExpectedFeatureRevision = 2
			expected = "product_feature_revision_conflict"
		case "request":
			stale.ExpectedRequestRevision = 2
			expected = "product_request_revision_conflict"
		}
		_, err = ChangeFeatureRequest(ctx, db, identity, permit("product_requests", "edit"), permit("product_features", "view"), stale, trusted)
		requireProductRule(t, err, expected)
	}
	if _, err = db.Exec(`UPDATE product_requests SET decision_status='merged' WHERE id=?`, request.ID); err != nil {
		t.Fatal(err)
	}
	_, err = ChangeFeatureRequest(ctx, db, identity, permit("product_requests", "edit"), permit("product_features", "view"), input, trusted)
	requireProductRule(t, err, "product_request_merged_readonly")
	if _, err = db.Exec(`UPDATE product_requests SET decision_status='submitted' WHERE id=?`, request.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE product_features SET lifecycle='deprecated' WHERE id=?`, feature.ID); err != nil {
		t.Fatal(err)
	}
	_, err = ChangeFeatureRequest(ctx, db, identity, permit("product_requests", "edit"), permit("product_features", "view"), input, trusted)
	requireProductRule(t, err, "product_feature_request_state_invalid")
	if _, err = db.Exec(`UPDATE product_features SET lifecycle='candidate' WHERE id=?`, feature.ID); err != nil {
		t.Fatal(err)
	}
	var rejectedLinks int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_request_features`).Scan(&rejectedLinks); err != nil || rejectedLinks != 0 {
		t.Fatalf("rejected links persisted: %d %v", rejectedLinks, err)
	}
	_, err = ChangeFeatureRequest(ctx, db, identity, permit("product_requests", "view"), permit("product_features", "view"), input, trusted)
	requireProductRule(t, err, "product_authorization_invalid")
	_, err = ChangeFeatureRequest(ctx, db, identity, permit("product_requests", "edit"), permit("product_requests", "view"), input, trusted)
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = ChangeFeatureRequest(ctx, db, identity, permit("product_requests", "edit"), permit("product_features", "view"), input, trusted); err != nil {
		t.Fatal(err)
	}
	replay, err := ChangeFeatureRequest(ctx, db, identity, permit("product_requests", "edit"), permit("product_features", "view"), input, trusted)
	if err != nil || !replay.Replayed {
		t.Fatalf("replay: %+v %v", replay, err)
	}

	page, err := ListFeatureRequests(ctx, db, "P-LINK", "pm", permit("product_requests", "view"), permit("product_features", "view"), FeatureRequestPageQuery{FeatureBizID: feature.BizID, Page: 1, PageSize: 1})
	if err != nil || page.Total != 1 || len(page.Items) != 1 || page.Items[0].BizID != request.BizID || page.WorkspaceRevision != 4 {
		t.Fatalf("linked page: %+v %v", page, err)
	}
	page, err = ListFeatureRequests(ctx, db, "P-LINK", "pm", permit("product_requests", "view"), permit("product_features", "view"), FeatureRequestPageQuery{FeatureBizID: feature.BizID, Page: 2, PageSize: 1})
	if err != nil || page.Total != 1 || len(page.Items) != 0 || page.Items == nil {
		t.Fatalf("second page: %+v %v", page, err)
	}
	_, err = ListFeatureRequests(ctx, db, "P-LINK", "pm", permit("product_features", "view"), permit("product_features", "view"), FeatureRequestPageQuery{FeatureBizID: feature.BizID, Page: 1, PageSize: 1})
	requireProductRule(t, err, "product_authorization_invalid")
	input.ExpectedRevision = 4
	input.ExpectedFeatureRevision = 2
	input.ExpectedRequestRevision = 2
	_, err = ChangeFeatureRequest(ctx, db, command("product_features:request-link", "duplicate"), permit("product_requests", "edit"), permit("product_features", "view"), input, trusted)
	requireProductRule(t, err, "product_feature_request_state_conflict")
	input.Operation = "unlink"
	if _, err = db.Exec(`CREATE TRIGGER fail_relation_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err = ChangeFeatureRequest(ctx, db, command("product_features:request-link", "unlink"), permit("product_requests", "edit"), permit("product_features", "view"), input, trusted); err == nil {
		t.Fatal("audit failure committed")
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_request_features`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("rollback relation: %d %v", count, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_relation_audit`); err != nil {
		t.Fatal(err)
	}
	if _, err = ChangeFeatureRequest(ctx, db, command("product_features:request-link", "unlink"), permit("product_requests", "edit"), permit("product_features", "view"), input, trusted); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_request_features`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("unlink: %d %v", count, err)
	}
	var root, fr, rr int
	if err = db.QueryRow(`SELECT w.revision,f.revision,r.revision FROM product_workspaces w JOIN product_features f ON f.product_code=w.product_code JOIN product_requests r ON r.product_code=w.product_code WHERE w.product_code='P-LINK'`).Scan(&root, &fr, &rr); err != nil || root != 5 || fr != 3 || rr != 3 {
		t.Fatalf("versions: %d %d %d %v", root, fr, rr, err)
	}
	var evidence, itemRevision int
	if err = db.QueryRow(`SELECT evidence_revision,revision FROM product_planning_items WHERE product_code='P-LINK'`).Scan(&evidence, &itemRevision); err != nil || evidence != 3 || itemRevision != 3 {
		t.Fatalf("planning evidence: %d %d %v", evidence, itemRevision, err)
	}
	page, err = ListFeatureRequests(ctx, db, "P-LINK", "pm", permit("product_requests", "view"), permit("product_features", "view"), FeatureRequestPageQuery{FeatureBizID: feature.BizID, Page: 1, PageSize: 1})
	if err != nil || page.Total != 0 || len(page.Items) != 0 {
		t.Fatalf("unlinked page: %+v %v", page, err)
	}

	for revision, want := range map[int]int{4: 1, 5: 0} {
		var length int
		if err := db.QueryRow(`SELECT JSON_LENGTH(command_json,'$.versions') FROM integration_operation WHERE operation_code='aims.altoc.product-feedback.update-progress.v1' AND JSON_EXTRACT(command_json,'$.sourceRevision')=?`, revision).Scan(&length); err != nil || length != want {
			t.Fatalf("progress revision %d: %d %v", revision, length, err)
		}
	}

}
