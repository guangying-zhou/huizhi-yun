package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLProductVersionTransition(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-TRANSITION")
	versionExecutionFixture(t, db, nil)
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-TRANSITION", "pm", action)
		p.Resource = "product_versions"
		return p
	}
	created, err := CreateProductCenterVersion(ctx, db, CommandIdentity{ProductCode: "P-TRANSITION", ActorUID: "pm", Action: "product_versions:create", IdempotencyKey: "create"}, permit("edit"), ProductVersionDraft{ExpectedRevision: 1, VersionCode: "v1"})
	if err != nil {
		t.Fatal(err)
	}
	var version ProductVersionRecord
	if err = json.Unmarshal(created.Value, &version); err != nil {
		t.Fatal(err)
	}
	identity := CommandIdentity{ProductCode: "P-TRANSITION", ActorUID: "pm", Action: "product_versions:transition", IdempotencyKey: "start"}
	input := ProductVersionTransitionInput{VersionID: version.ID, ExpectedRevision: 2, ExpectedVersionRevision: 1, ToStatus: "developing", Reason: "范围已确认"}
	run := func() (CommandResult, error) {
		return TransitionProductVersion(ctx, db, identity, permit("edit"), input)
	}
	_, err = TransitionProductVersion(ctx, db, identity, permit("view"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	input.ExpectedVersionRevision = 2
	_, err = run()
	requireProductRule(t, err, "product_version_revision_conflict")
	input.ExpectedVersionRevision = 1
	if _, err = db.Exec(`CREATE TRIGGER pc_transition_fail BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run(); err == nil {
		t.Fatal("audit failure committed")
	}
	var status string
	var revision, scope uint64
	if err = db.QueryRow(`SELECT status,revision,scope_revision FROM product_versions WHERE id=?`, version.ID).Scan(&status, &revision, &scope); err != nil || status != "planning" || revision != 1 || scope != 1 {
		t.Fatalf("rollback: %s %d %d %v", status, revision, scope, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_transition_fail`); err != nil {
		t.Fatal(err)
	}
	saved, err := run()
	if err != nil {
		t.Fatal(err)
	}
	replay, err := run()
	if err != nil || !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatalf("replay: %+v %v", replay, err)
	}
	if err = db.QueryRow(`SELECT status,revision,scope_revision FROM product_versions WHERE id=?`, version.ID).Scan(&status, &revision, &scope); err != nil || status != "developing" || revision != 2 || scope != 1 {
		t.Fatalf("transition: %s %d %d %v", status, revision, scope, err)
	}
	identity.IdempotencyKey = "again"
	input.ExpectedRevision = 3
	input.ExpectedVersionRevision = 2
	_, err = run()
	requireProductRule(t, err, "product_version_locked")
}
