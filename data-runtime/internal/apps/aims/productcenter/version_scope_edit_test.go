package productcenter

import (
	"context"
	"database/sql"
	"testing"
)

func exerciseVersionScopeEdit(t *testing.T, db *sql.DB, check PlanningDeliveryCheck, versionID int64) PlanningDeliveryCheck {
	t.Helper()
	ctx := context.Background()
	permit := func(resource, action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-SELECT", "pm", action)
		p.Resource = resource
		return p
	}
	var id int64
	if err := db.QueryRow(`SELECT id FROM product_version_features WHERE version_id=?`, versionID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	input := ProductVersionScopeEdit{ProductVersionScopeDraft: ProductVersionScopeDraft{PlanningDeliveryCheck: check, VersionID: versionID, ExpectedVersionRevision: 2, Title: "调整后的登录范围", Description: "增加异常回调场景说明", AcceptanceCriteria: "登录、注销和重放回调均已测试", ChangeType: "enhancement", Reason: "评审后明确验收边界"}, ScopeID: id}
	identity := CommandIdentity{ProductCode: "P-SELECT", ActorUID: "pm", Action: "product_versions:scope-edit", IdempotencyKey: "scope-edit"}
	run := func() (CommandResult, error) {
		return EditProductVersionScope(ctx, db, identity, permit("product_versions", "edit"), permit("product_priorities", "prioritize"), input)
	}
	_, err := EditProductVersionScope(ctx, db, identity, permit("product_versions", "view"), permit("product_priorities", "prioritize"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	input.ScopeID = id + 100
	_, err = run()
	if err != sql.ErrNoRows {
		t.Fatalf("foreign scope: %v", err)
	}
	input.ScopeID = id
	for _, state := range []string{"delivered", "deferred"} {
		if _, err = db.Exec(`UPDATE product_version_features SET status=? WHERE id=?`, state, id); err != nil {
			t.Fatal(err)
		}
		_, err = run()
		requireProductRule(t, err, "product_version_scope_locked")
	}
	if _, err = db.Exec(`UPDATE product_version_features SET status='planned' WHERE id=?`, id); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`CREATE TRIGGER pc_scope_edit_fail BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='scope edit audit failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run(); err == nil {
		t.Fatal("audit failure committed scope edit")
	}
	var title string
	var revision, scope uint64
	if err = db.QueryRow(`SELECT f.title,v.revision,v.scope_revision FROM product_version_features f JOIN product_versions v ON v.id=f.version_id WHERE f.id=?`, id).Scan(&title, &revision, &scope); err != nil || title == input.Title || revision != 2 || scope != 2 {
		t.Fatalf("rollback: %s %d %d %v", title, revision, scope, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_scope_edit_fail`); err != nil {
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
	if err = db.QueryRow(`SELECT f.title,v.revision,v.scope_revision FROM product_version_features f JOIN product_versions v ON v.id=f.version_id WHERE f.id=?`, id).Scan(&title, &revision, &scope); err != nil || title != input.Title || revision != 3 || scope != 3 {
		t.Fatalf("edited scope: %s %d %d %v", title, revision, scope, err)
	}
	check.ExpectedRevision++
	check.ExpectedItemRevision++
	input.PlanningDeliveryCheck = check
	identity.IdempotencyKey = "scope-edit-stale"
	_, err = run()
	requireProductRule(t, err, "product_version_revision_conflict")

	history, err := ListProductVersionScopeHistory(ctx, db, "P-SELECT", "pm", permit("product_versions", "view"), versionID, id, 1, 10)
	if err != nil || history.Total != 2 || len(history.Items) != 2 || history.Items[0].Action != "scope-edit" || history.Items[0].AfterCriteria == nil || *history.Items[0].AfterCriteria != input.AcceptanceCriteria || history.Items[0].Reason != input.Reason || history.Items[1].Action != "scope-create" || history.Items[1].AfterCriteria == nil {
		t.Fatalf("planning scope history %+v %v", history, err)
	}
	return check
}
