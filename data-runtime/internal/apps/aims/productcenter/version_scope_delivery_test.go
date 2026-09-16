package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLProductVersionScopeDelivery(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-ACCEPT")
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-ACCEPT", "pm", action)
		p.Resource = "product_versions"
		return p
	}
	created, err := CreateProductCenterVersion(ctx, db, CommandIdentity{ProductCode: "P-ACCEPT", ActorUID: "pm", Action: "product_versions:create", IdempotencyKey: "version"}, permit("edit"), ProductVersionDraft{ExpectedRevision: 1, VersionCode: "v1"})
	if err != nil {
		t.Fatal(err)
	}
	var version ProductVersionRecord
	if err = json.Unmarshal(created.Value, &version); err != nil {
		t.Fatal(err)
	}
	// Existing unscored scope can be accepted against explicit criteria without
	// fabricating a historical planning decision or project execution record.
	result, err := db.Exec(`INSERT INTO product_version_features(version_id,title,status) VALUES(?,'历史范围','planned')`, version.ID)
	if err != nil {
		t.Fatal(err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	input := ProductVersionScopeDelivery{VersionID: version.ID, ScopeID: id, ExpectedRevision: 2, ExpectedVersionRevision: 1, ExpectedScopeRevision: 1, Evidence: "测试报告 TR-01；登录与注销验证均通过", Reason: "核对验收清单完成"}
	identity := CommandIdentity{ProductCode: "P-ACCEPT", ActorUID: "pm", Action: "product_versions:scope-deliver", IdempotencyKey: "deliver"}
	run := func() (CommandResult, error) {
		return ConfirmProductVersionScopeDelivery(ctx, db, identity, permit("accept"), input)
	}
	_, err = ConfirmProductVersionScopeDelivery(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	_, err = run()
	requireProductRule(t, err, "product_version_acceptance_criteria_required")
	if _, err = db.Exec(`UPDATE product_version_features SET acceptance_criteria='登录与注销均可用' WHERE id=?`, id); err != nil {
		t.Fatal(err)
	}
	input.ExpectedScopeRevision = 2
	_, err = run()
	requireProductRule(t, err, "product_version_revision_conflict")
	input.ExpectedScopeRevision = 1
	if _, err = db.Exec(`CREATE TRIGGER pc_deliver_fail BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='delivery audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run(); err == nil {
		t.Fatal("audit failure committed delivery")
	}
	var state string
	var rev, scope uint64
	if err = db.QueryRow(`SELECT f.status,v.revision,v.scope_revision FROM product_version_features f JOIN product_versions v ON v.id=f.version_id WHERE f.id=?`, id).Scan(&state, &rev, &scope); err != nil || state != "planned" || rev != 1 || scope != 1 {
		t.Fatalf("rollback: %s %d %d %v", state, rev, scope, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_deliver_fail`); err != nil {
		t.Fatal(err)
	}
	saved, err := run()
	if err != nil {
		t.Fatal(err)
	}
	replay, err := run()
	if err != nil || !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	_, err = ConfirmProductVersionScopeDelivery(ctx, db, identity, permit("view"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	var evidence string
	if err = db.QueryRow(`SELECT JSON_UNQUOTE(JSON_EXTRACT(changes,'$.evidence')) FROM product_activity_logs WHERE action='scope-deliver'`).Scan(&evidence); err != nil || evidence != input.Evidence {
		t.Fatalf("evidence: %s %v", evidence, err)
	}
	if err = db.QueryRow(`SELECT f.status,v.revision,v.scope_revision FROM product_version_features f JOIN product_versions v ON v.id=f.version_id WHERE f.id=?`, id).Scan(&state, &rev, &scope); err != nil || state != "delivered" || rev != 2 || scope != 2 {
		t.Fatalf("delivery: %s %d %d %v", state, rev, scope, err)
	}
	identity.IdempotencyKey = "again"
	input.ExpectedRevision = 3
	input.ExpectedVersionRevision = 2
	input.ExpectedScopeRevision = 2
	_, err = run()
	requireProductRule(t, err, "product_version_scope_locked")
	var acceptances, releases int
	if err = db.QueryRow(`SELECT (SELECT COUNT(*) FROM product_version_acceptances),(SELECT COUNT(*) FROM product_release_records)`).Scan(&acceptances, &releases); err != nil || acceptances != 0 || releases != 0 {
		t.Fatalf("fabricated version acceptance/release: %d %d %v", acceptances, releases, err)
	}
	reopenInput := ProductVersionScopeReopen{VersionID: version.ID, ScopeID: id, ExpectedRevision: 3, ExpectedVersionRevision: 2, ExpectedScopeRevision: 2, Reason: "验收标准需补充异常路径"}
	reopenIdentity := CommandIdentity{ProductCode: "P-ACCEPT", ActorUID: "pm", Action: "product_versions:scope-reopen", IdempotencyKey: "scope-reopen"}
	reopen := func(action string) (CommandResult, error) {
		return ReopenProductVersionScope(ctx, db, reopenIdentity, permit(action), reopenInput)
	}
	_, err = reopen("edit")
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`CREATE TRIGGER pc_reopen_fail BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err = reopen("accept"); err == nil {
		t.Fatal("reopen audit failure committed")
	}
	if err = db.QueryRow(`SELECT f.status,v.revision,v.scope_revision FROM product_version_features f JOIN product_versions v ON v.id=f.version_id WHERE f.id=?`, id).Scan(&state, &rev, &scope); err != nil || state != "delivered" || rev != 2 || scope != 2 {
		t.Fatalf("reopen rollback: %s %d %d %v", state, rev, scope, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_reopen_fail`); err != nil {
		t.Fatal(err)
	}
	reopened, err := reopen("accept")
	if err != nil {
		t.Fatal(err)
	}
	replay, err = reopen("accept")
	if err != nil || !replay.Replayed || replay.ReceiptID != reopened.ReceiptID {
		t.Fatalf("reopen replay: %+v %v", replay, err)
	}
	if err = db.QueryRow(`SELECT f.status,v.revision,v.scope_revision FROM product_version_features f JOIN product_versions v ON v.id=f.version_id WHERE f.id=?`, id).Scan(&state, &rev, &scope); err != nil || state != "planned" || rev != 3 || scope != 3 {
		t.Fatalf("reopened: %s %d %d %v", state, rev, scope, err)
	}
	if err = db.QueryRow(`SELECT JSON_UNQUOTE(JSON_EXTRACT(changes,'$.evidence')) FROM product_activity_logs WHERE action='scope-deliver'`).Scan(&evidence); err != nil || evidence != input.Evidence {
		t.Fatalf("delivery evidence lost: %s %v", evidence, err)
	}

	// A fresh command against the now-planned scope cannot withdraw twice.
	reopenIdentity.IdempotencyKey = "reopen-again"
	reopenInput.ExpectedRevision = 4
	reopenInput.ExpectedVersionRevision = 3
	reopenInput.ExpectedScopeRevision = 3
	_, err = reopen("accept")
	requireProductRule(t, err, "product_version_scope_locked")
	// Reconfirmation requires new evidence and creates a distinct immutable audit.
	identity.IdempotencyKey = "deliver-after-reopen"
	input.ExpectedRevision = 4
	input.ExpectedVersionRevision = 3
	input.ExpectedScopeRevision = 3
	input.Evidence = "TR-02 异常路径重新验证通过"
	input.Reason = "重新确认调整后的交付"
	if _, err = run(); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT f.status,v.revision,v.scope_revision FROM product_version_features f JOIN product_versions v ON v.id=f.version_id WHERE f.id=?`, id).Scan(&state, &rev, &scope); err != nil || state != "delivered" || rev != 4 || scope != 4 {
		t.Fatalf("reconfirmed: %s %d %d %v", state, rev, scope, err)
	}
	var auditCount int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_activity_logs WHERE action='scope-deliver'`).Scan(&auditCount); err != nil || auditCount != 2 {
		t.Fatalf("delivery audits: %d %v", auditCount, err)
	}
	if err = db.QueryRow(`SELECT JSON_UNQUOTE(JSON_EXTRACT(changes,'$.evidence')) FROM product_activity_logs WHERE action='scope-deliver' ORDER BY id DESC LIMIT 1`).Scan(&evidence); err != nil || evidence != input.Evidence {
		t.Fatalf("new evidence: %s %v", evidence, err)
	}
	reopenInput.ExpectedRevision = 5
	reopenInput.ExpectedVersionRevision = 4
	reopenInput.ExpectedScopeRevision = 4
	for _, lockedState := range []string{"released", "archived"} {
		if _, err = db.Exec(`UPDATE product_versions SET status=? WHERE id=?`, lockedState, version.ID); err != nil {
			t.Fatal(err)
		}
		_, err = reopen("accept")
		requireProductRule(t, err, "product_version_locked")
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_activity_logs WHERE action='scope-reopen'`).Scan(&auditCount); err != nil || auditCount != 1 {
		t.Fatalf("unexpected withdrawals: %d %v", auditCount, err)
	}

	history, err := ListProductVersionScopeHistory(ctx, db, "P-ACCEPT", "pm", permit("view"), version.ID, id, 1, 2)
	if err != nil || history.Total != 3 || len(history.Items) != 2 || history.Items[0].Action != "scope-deliver" || history.Items[0].Evidence != input.Evidence || history.Items[1].Action != "scope-reopen" || history.Items[1].Reason != reopenInput.Reason || history.Items[1].Evidence != "" {
		t.Fatalf("scope history %+v %v", history, err)
	}
	older, err := ListProductVersionScopeHistory(ctx, db, "P-ACCEPT", "pm", permit("view"), version.ID, id, 2, 2)
	if err != nil || older.Total != 3 || len(older.Items) != 1 || older.Items[0].Evidence != "测试报告 TR-01；登录与注销验证均通过" {
		t.Fatalf("old scope history %+v %v", older, err)
	}
	_, err = ListProductVersionScopeHistory(ctx, db, "P-ACCEPT", "pm", permit("accept"), version.ID, id, 1, 2)
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = ListProductVersionScopeHistory(ctx, db, "P-ACCEPT", "pm", permit("view"), version.ID, id+999, 1, 2); err == nil {
		t.Fatal("unknown scope history accepted")
	}

	workspaceFixture(t, db, "P-HISTORY-OTHER")
	otherPermit := workspacePermit(t, db, "P-HISTORY-OTHER", "pm", "view")
	otherPermit.Resource = "product_versions"
	if _, err = ListProductVersionScopeHistory(ctx, db, "P-HISTORY-OTHER", "pm", otherPermit, version.ID, id, 1, 2); err == nil {
		t.Fatal("cross-product scope history accepted")
	}
	// A different real scope in the same version must have an empty history.
	otherScopeResult, err := db.Exec(`INSERT INTO product_version_features(version_id,title,status) VALUES(?,'另一范围','planned')`, version.ID)
	if err != nil {
		t.Fatal(err)
	}
	otherScopeID, err := otherScopeResult.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	emptyHistory, err := ListProductVersionScopeHistory(ctx, db, "P-ACCEPT", "pm", permit("view"), version.ID, otherScopeID, 1, 2)
	if err != nil || emptyHistory.Total != 0 || len(emptyHistory.Items) != 0 {
		t.Fatalf("scope history leaked: %+v %v", emptyHistory, err)
	}

}

func TestProductVersionScopeDeliveryValidation(t *testing.T) {
	good := ProductVersionScopeDelivery{VersionID: 1, ScopeID: 2, ExpectedRevision: 1, ExpectedVersionRevision: 1, ExpectedScopeRevision: 1, Evidence: "核验依据", Reason: "确认原因"}
	if err := ValidateProductVersionScopeDelivery(good); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*ProductVersionScopeDelivery){func(v *ProductVersionScopeDelivery) { v.ScopeID = 0 }, func(v *ProductVersionScopeDelivery) { v.ExpectedScopeRevision = 0 }, func(v *ProductVersionScopeDelivery) { v.Evidence = " " }, func(v *ProductVersionScopeDelivery) { v.Reason = "" }} {
		v := good
		change(&v)
		if ValidateProductVersionScopeDelivery(v) == nil {
			t.Fatal("invalid delivery accepted")
		}
	}
}
