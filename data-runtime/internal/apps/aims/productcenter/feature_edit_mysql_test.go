package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLFeatureEditPreservesLifecycleAndRollsBack(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-EDIT")
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-EDIT", "pm", action)
		p.Resource = "product_features"
		return p
	}
	draft := FeatureDraft{ExpectedRevision: 1, Title: "统一登录", Description: "重复登录"}
	result, err := CreateProductFeature(ctx, db, CommandIdentity{ProductCode: "P-EDIT", ActorUID: "pm", Action: "product_features:create", IdempotencyKey: "create"}, permit("edit"), draft)
	if err != nil {
		t.Fatal(err)
	}
	var created struct {
		ID    int64  `json:"id"`
		BizID string `json:"biz_id"`
	}
	if err := json.Unmarshal(result.Value, &created); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE product_features SET lifecycle='active',lifecycle_evidence=JSON_OBJECT('kind','legacy','reason','存量登录能力') WHERE id=?`, created.ID); err != nil {
		t.Fatal(err)
	}

	draft.ExpectedRevision = 2
	draft.Description = "跨应用重复登录"
	input := FeatureEdit{FeatureDraft: draft, BizID: created.BizID, ExpectedFeatureRevision: 1, Reason: "补充使用场景"}
	identity := CommandIdentity{ProductCode: "P-EDIT", ActorUID: "pm", Action: "product_features:edit", IdempotencyKey: "edit"}
	if _, err := EditProductFeature(ctx, db, identity, permit("edit"), input); err != nil {
		t.Fatal(err)
	}
	replay, err := EditProductFeature(ctx, db, identity, permit("edit"), input)
	if err != nil || !replay.Replayed {
		t.Fatalf("replay: %v %v", replay, err)
	}
	detail, err := ReadProductFeature(ctx, db, "P-EDIT", "pm", created.BizID, permit("view"))
	if err != nil || detail.Revision != 2 || detail.Lifecycle != "active" || detail.Description == nil || *detail.Description != draft.Description || len(detail.LifecycleEvidence) == 0 {
		t.Fatalf("detail: %+v %v", detail, err)
	}

	input.ExpectedRevision = 3
	identity.IdempotencyKey = "stale"
	_, err = EditProductFeature(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_feature_revision_conflict")
	input.ExpectedFeatureRevision = 2
	identity.IdempotencyKey = "rollback"
	if _, err := db.Exec(`CREATE TRIGGER pc_fail_edit_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'`); err != nil {
		t.Fatal(err)
	}
	input.Title = "不应保存"
	if _, err := EditProductFeature(ctx, db, identity, permit("edit"), input); err == nil {
		t.Fatal("audit failure committed")
	}
	if _, err := db.Exec(`DROP TRIGGER pc_fail_edit_audit`); err != nil {
		t.Fatal(err)
	}
	detail, err = ReadProductFeature(ctx, db, "P-EDIT", "pm", created.BizID, permit("view"))
	if err != nil || detail.Title == input.Title || detail.Revision != 2 {
		t.Fatalf("rollback: %+v %v", detail, err)
	}
	var rootRevision, receipts int
	if err := db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-EDIT'`).Scan(&rootRevision); err != nil || rootRevision != 3 {
		t.Fatalf("root rollback: %d %v", rootRevision, err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts`).Scan(&receipts); err != nil || receipts != 2 {
		t.Fatalf("receipt rollback: %d %v", receipts, err)
	}
	wrong := permit("view")
	_, err = EditProductFeature(ctx, db, identity, wrong, input)
	requireProductRule(t, err, "product_authorization_invalid")
}
