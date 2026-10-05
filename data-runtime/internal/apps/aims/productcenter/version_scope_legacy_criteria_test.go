package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLLegacyScopeCriteriaAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-LEGACY")
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-LEGACY", "pm", action)
		p.Resource = "product_versions"
		return p
	}
	created, err := CreateProductCenterVersion(ctx, db, CommandIdentity{ProductCode: "P-LEGACY", ActorUID: "pm", Action: "product_versions:create", IdempotencyKey: "create"}, permit("edit"), ProductVersionDraft{ExpectedRevision: 1, VersionCode: "v1"})
	if err != nil {
		t.Fatal(err)
	}
	var version ProductVersionRecord
	if err = json.Unmarshal(created.Value, &version); err != nil {
		t.Fatal(err)
	}
	result, err := db.Exec(`INSERT INTO product_version_features(version_id,title,status) VALUES(?,'历史范围','planned')`, version.ID)
	if err != nil {
		t.Fatal(err)
	}
	scopeID, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	input := LegacyProductVersionScopeCriteria{VersionID: version.ID, ScopeID: scopeID, ExpectedRevision: 2, ExpectedVersionRevision: 1, ExpectedScopeRevision: 1, Reason: "补录历史验收标准", AcceptanceCriteria: "登录注销和异常回调均通过"}
	identity := CommandIdentity{ProductCode: "P-LEGACY", ActorUID: "pm", Action: "product_versions:scope-legacy-criteria", IdempotencyKey: "criteria"}
	run := func(action string) (CommandResult, error) {
		return UpdateLegacyProductVersionScopeCriteria(ctx, db, identity, permit(action), input)
	}
	_, err = run("view")
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`CREATE TRIGGER fail_criteria BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run("edit"); err == nil {
		t.Fatal("audit failure committed")
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_version_features WHERE id=? AND acceptance_criteria IS NULL`, scopeID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("rollback %d %v", count, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_criteria`); err != nil {
		t.Fatal(err)
	}
	saved, err := run("edit")
	if err != nil {
		t.Fatal(err)
	}
	replay, err := run("edit")
	if err != nil || !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_version_features f JOIN product_versions v ON v.id=f.version_id WHERE f.id=? AND f.planning_item_id IS NULL AND f.acceptance_criteria=? AND v.revision=2 AND v.scope_revision=2`, scopeID, input.AcceptanceCriteria).Scan(&count); err != nil || count != 1 {
		t.Fatalf("criteria result %d %v", count, err)
	}
	history, err := ListProductVersionScopeHistory(ctx, db, "P-LEGACY", "pm", permit("view"), version.ID, scopeID, 1, 10)
	if err != nil || history.Total != 1 || len(history.Items) != 1 || history.Items[0].Action != "scope-legacy-criteria" || history.Items[0].BeforeCriteria != nil || history.Items[0].AfterCriteria == nil || *history.Items[0].AfterCriteria != input.AcceptanceCriteria || history.Items[0].Reason != input.Reason {
		t.Fatalf("criteria history %+v %v", history, err)
	}

	_, err = ConfirmProductVersionScopeDelivery(ctx, db, CommandIdentity{ProductCode: "P-LEGACY", ActorUID: "pm", Action: "product_versions:scope-deliver", IdempotencyKey: "delivery"}, permit("accept"), ProductVersionScopeDelivery{VersionID: version.ID, ScopeID: scopeID, ExpectedRevision: 3, ExpectedVersionRevision: 2, ExpectedScopeRevision: 2, Evidence: "TR-LEGACY", Reason: "核对补录标准"})
	if err != nil {
		t.Fatal(err)
	}
	input.ExpectedRevision = 4
	input.ExpectedVersionRevision = 3
	input.ExpectedScopeRevision = 3
	identity.IdempotencyKey = "delivered-edit"
	_, err = run("edit")
	requireProductRule(t, err, "product_version_scope_locked")
	planned, err := db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-LEGACY','正式事项','正式范围','growth','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`)
	if err != nil {
		t.Fatal(err)
	}
	plannedID, err := planned.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	linked, err := db.Exec(`INSERT INTO product_version_features(version_id,title,status,planning_item_id) VALUES(?,'已规划范围','planned',?)`, version.ID, plannedID)
	if err != nil {
		t.Fatal(err)
	}
	linkedID, err := linked.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	input.ScopeID = linkedID
	identity.IdempotencyKey = "linked-criteria"
	_, err = run("edit")
	requireProductRule(t, err, "product_version_scope_locked")
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_version_features WHERE id=? AND planning_item_id=? AND acceptance_criteria IS NULL`, linkedID, plannedID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("linked scope changed %d %v", count, err)
	}
	workspaceFixture(t, db, "P-OTHER-LEGACY")
	otherPermit := workspacePermit(t, db, "P-OTHER-LEGACY", "pm", "edit")
	otherPermit.Resource = "product_versions"
	otherIdentity := identity
	otherIdentity.ProductCode = "P-OTHER-LEGACY"
	input.ExpectedRevision = 1
	if _, err = UpdateLegacyProductVersionScopeCriteria(ctx, db, otherIdentity, otherPermit, input); err == nil {
		t.Fatal("cross-product criteria accepted")
	}

}
