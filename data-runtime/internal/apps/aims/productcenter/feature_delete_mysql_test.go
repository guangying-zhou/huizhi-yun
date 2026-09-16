package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
)

func TestMySQLFeatureDeletionGuardsAndRollback(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-DELETE")
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-DELETE", "pm", action)
		p.Resource = "product_features"
		return p
	}
	result, err := CreateProductFeature(ctx, db, CommandIdentity{ProductCode: "P-DELETE", ActorUID: "pm", Action: "product_features:create", IdempotencyKey: "create"}, permit("edit"), FeatureDraft{ExpectedRevision: 1, Title: "候选功能"})
	if err != nil {
		t.Fatal(err)
	}
	var feature FeatureRecord
	if err = json.Unmarshal(result.Value, &feature); err != nil {
		t.Fatal(err)
	}
	input := FeatureDelete{ExpectedRevision: 2, BizID: feature.BizID, ExpectedFeatureRevision: 1, Reason: "重复草稿"}
	identity := CommandIdentity{ProductCode: "P-DELETE", ActorUID: "pm", Action: "product_features:delete", IdempotencyKey: "delete"}
	_, err = DeleteProductFeature(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	for _, state := range []string{"active", "deprecated"} {
		if _, err = db.Exec(`UPDATE product_features SET lifecycle=? WHERE id=?`, state, feature.ID); err != nil {
			t.Fatal(err)
		}
		_, err = DeleteProductFeature(ctx, db, identity, permit("delete"), input)
		requireProductRule(t, err, "product_feature_delete_state_invalid")
	}
	if _, err = db.Exec(`UPDATE product_features SET lifecycle='candidate' WHERE id=?`, feature.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,feature_id,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-DELETE','规划','范围','growth',?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, feature.ID); err != nil {
		t.Fatal(err)
	}
	_, err = DeleteProductFeature(ctx, db, identity, permit("delete"), input)
	requireProductRule(t, err, "product_feature_referenced")
	if _, err = db.Exec(`DELETE FROM product_planning_items WHERE product_code='P-DELETE'`); err != nil {
		t.Fatal(err)
	}

	// Each relationship independently protects the long-lived feature.
	if _, err = db.Exec(`INSERT INTO product_requests(biz_id,product_code,title,problem_statement,source_type,urgency_level,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-DELETE','登录需求','重复登录','internal','P2','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_request_features(product_code,request_id,product_feature_id,created_by,created_at) SELECT 'P-DELETE',id,?,'pm',UTC_TIMESTAMP(3) FROM product_requests WHERE product_code='P-DELETE'`, feature.ID); err != nil {
		t.Fatal(err)
	}
	_, err = DeleteProductFeature(ctx, db, identity, permit("delete"), input)
	requireProductRule(t, err, "product_feature_referenced")
	if _, err = db.Exec(`DELETE FROM product_request_features WHERE product_feature_id=?`, feature.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_versions(product_code,version_code) VALUES('P-DELETE','v-test')`); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_version_features(version_id,title,product_feature_id) SELECT id,'登录特性',? FROM product_versions WHERE product_code='P-DELETE'`, feature.ID); err != nil {
		t.Fatal(err)
	}
	_, err = DeleteProductFeature(ctx, db, identity, permit("delete"), input)
	requireProductRule(t, err, "product_feature_referenced")
	if _, err = db.Exec(`DELETE FROM product_version_features WHERE product_feature_id=?`, feature.ID); err != nil {
		t.Fatal(err)
	}
	// Evidence survives lifecycle changes; candidate alone does not imply deletable.
	if _, err = db.Exec(`UPDATE product_features SET lifecycle_evidence=JSON_OBJECT('kind','legacy','reason','历史能力') WHERE id=?`, feature.ID); err != nil {
		t.Fatal(err)
	}
	_, err = DeleteProductFeature(ctx, db, identity, permit("delete"), input)
	requireProductRule(t, err, "product_feature_delete_state_invalid")
	if _, err = db.Exec(`UPDATE product_features SET lifecycle_evidence=NULL WHERE id=?`, feature.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`CREATE TRIGGER pc_fail_feature_delete BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err = DeleteProductFeature(ctx, db, identity, permit("delete"), input); err == nil {
		t.Fatal("audit failure committed")
	}
	detail, err := ReadProductFeature(ctx, db, "P-DELETE", "pm", feature.BizID, permit("view"))
	if err != nil || detail.Revision != 1 {
		t.Fatalf("rollback: %+v %v", detail, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_fail_feature_delete`); err != nil {
		t.Fatal(err)
	}
	if _, err = DeleteProductFeature(ctx, db, identity, permit("delete"), input); err != nil {
		t.Fatal(err)
	}
	replay, err := DeleteProductFeature(ctx, db, identity, permit("delete"), input)
	if err != nil || !replay.Replayed {
		t.Fatalf("replay: %+v %v", replay, err)
	}
	_, err = ReadProductFeature(ctx, db, "P-DELETE", "pm", feature.BizID, permit("view"))
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("deleted detail: %v", err)
	}
	var revision, receipts, logs int
	if err = db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-DELETE'`).Scan(&revision); err != nil || revision != 3 {
		t.Fatalf("revision: %d %v", revision, err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts`).Scan(&receipts); err != nil || receipts != 2 {
		t.Fatalf("receipts: %d %v", receipts, err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_activity_logs`).Scan(&logs); err != nil || logs != 2 {
		t.Fatalf("logs: %d %v", logs, err)
	}
}
