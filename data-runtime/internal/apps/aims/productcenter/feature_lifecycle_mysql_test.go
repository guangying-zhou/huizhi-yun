package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLFeatureLifecyclePreservesEvidenceAndAudit(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-LIFE")
	ctx := context.Background()
	permit := func() AuthorizationPermit {
		p := workspacePermit(t, db, "P-LIFE", "pm", "edit")
		p.Resource = "product_features"
		return p
	}
	identity := CommandIdentity{ProductCode: "P-LIFE", ActorUID: "pm", Action: "product_features:create", IdempotencyKey: "create"}
	result, err := CreateProductFeature(ctx, db, identity, permit(), FeatureDraft{ExpectedRevision: 1, Title: "单点登录"})
	if err != nil {
		t.Fatal(err)
	}
	var f FeatureRecord
	if err = json.Unmarshal(result.Value, &f); err != nil {
		t.Fatal(err)
	}
	input := FeatureLifecycleChange{ExpectedRevision: 2, ExpectedFeatureRevision: 1, BizID: f.BizID, Target: "active", Reason: "核实已有能力", Evidence: &FeatureActivationEvidence{Kind: "legacy", Description: "现有企业账户已使用单点登录"}}
	identity.Action = "product_features:lifecycle"
	identity.IdempotencyKey = "activate"
	_, err = ChangeFeatureLifecycle(ctx, db, identity, permit(), input)
	requireProductRule(t, err, "product_feature_manager_required")
	managerFixture(t, db, "P-LIFE", "pm")
	if _, err = ChangeFeatureLifecycle(ctx, db, identity, permit(), input); err != nil {
		t.Fatal(err)
	}
	replay, err := ChangeFeatureLifecycle(ctx, db, identity, permit(), input)
	if err != nil || !replay.Replayed {
		t.Fatalf("replay: %+v %v", replay, err)
	}
	read := func() FeatureRecord {
		p := permit()
		p.Action = "view"
		value, err := ReadProductFeature(ctx, db, "P-LIFE", "pm", f.BizID, p)
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	active := read()
	if active.Lifecycle != "active" || active.Revision != 2 || len(active.LifecycleEvidence) == 0 {
		t.Fatalf("activation: %+v", active)
	}
	input.ExpectedRevision = 3
	input.ExpectedFeatureRevision = 2
	input.Target = "deprecated"
	input.Evidence = nil
	input.Reason = "由新能力替代"
	identity.IdempotencyKey = "deprecate"
	if _, err = db.Exec(`CREATE TRIGGER fail_lifecycle_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err = ChangeFeatureLifecycle(ctx, db, identity, permit(), input); err == nil {
		t.Fatal("audit failure committed")
	}
	if value := read(); value.Lifecycle != "active" || value.Revision != 2 {
		t.Fatalf("rollback: %+v", value)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_lifecycle_audit`); err != nil {
		t.Fatal(err)
	}
	if _, err = ChangeFeatureLifecycle(ctx, db, identity, permit(), input); err != nil {
		t.Fatal(err)
	}
	deprecated := read()
	if deprecated.Lifecycle != "deprecated" || string(deprecated.LifecycleEvidence) != string(active.LifecycleEvidence) {
		t.Fatalf("evidence lost: %+v", deprecated)
	}
	input.ExpectedRevision = 4
	input.ExpectedFeatureRevision = 3
	input.Target = "active"
	input.Evidence = &FeatureActivationEvidence{Kind: "release", ReleaseBizID: "00000000-0000-4000-8000-000000000001"}
	identity.IdempotencyKey = "invalid-release"
	_, err = ChangeFeatureLifecycle(ctx, db, identity, permit(), input)
	requireProductRule(t, err, "product_feature_release_evidence_invalid")
	input.Evidence = &FeatureActivationEvidence{Kind: "legacy", Description: "恢复后重新验证单点登录"}
	identity.IdempotencyKey = "restore"
	if _, err = ChangeFeatureLifecycle(ctx, db, identity, permit(), input); err != nil {
		t.Fatal(err)
	}
	restored := read()
	if restored.Lifecycle != "active" || restored.Revision != 4 || string(restored.LifecycleEvidence) == string(active.LifecycleEvidence) {
		t.Fatalf("restore: %+v", restored)
	}
}
