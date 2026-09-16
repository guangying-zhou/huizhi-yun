package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
)

// A valid assignment is insufficient if membership has since expired or ended.
func exerciseInactiveVersionOwner(t *testing.T, db *sql.DB, run func() (CommandResult, error)) {
	t.Helper()
	for _, change := range []string{
		"status='inactive'",
		"status='active',valid_from=UTC_TIMESTAMP(3)-INTERVAL 2 DAY,valid_until=UTC_TIMESTAMP(3)-INTERVAL 1 DAY",
		"valid_until=NULL,valid_from=UTC_TIMESTAMP(3)+INTERVAL 1 DAY",
	} {
		if _, err := db.Exec("UPDATE product_members SET " + change + " WHERE product_code='P-ACCEPT' AND uid='pm'"); err != nil {
			t.Fatal(err)
		}
		_, err := run()
		requireProductRule(t, err, "product_version_owner_unavailable")
	}
	if _, err := db.Exec(`UPDATE product_members SET status='active',valid_from=UTC_TIMESTAMP(3)-INTERVAL 1 DAY,valid_until=NULL WHERE product_code='P-ACCEPT' AND uid='pm'`); err != nil {
		t.Fatal(err)
	}
}

func TestMySQLVersionOwnerAssignment(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-OWNER")
	ctx := context.Background()
	permit := func() AuthorizationPermit {
		p := workspacePermit(t, db, "P-OWNER", "pm", "edit")
		p.Resource = "product_versions"
		return p
	}
	owner := "member"
	identity := CommandIdentity{ProductCode: "P-OWNER", ActorUID: "pm", Action: "product_versions:create", IdempotencyKey: "create-owner"}
	input := ProductVersionDraft{ExpectedRevision: 1, VersionCode: "v1", BusinessOwnerUID: &owner}
	create := func() (CommandResult, error) { return CreateProductCenterVersion(ctx, db, identity, permit(), input) }
	_, err := create()
	requireProductRule(t, err, "product_version_owner_unavailable")
	if _, err = db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,valid_until,created_by,updated_by,created_at,updated_at) VALUES('P-OWNER','member','contributor','active',UTC_TIMESTAMP(3)-INTERVAL 2 DAY,UTC_TIMESTAMP(3)-INTERVAL 1 DAY,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`); err != nil {
		t.Fatal(err)
	}
	_, err = create()
	requireProductRule(t, err, "product_version_owner_unavailable")
	if _, err = db.Exec(`UPDATE product_members SET valid_until=NULL,valid_from=UTC_TIMESTAMP(3)+INTERVAL 1 DAY`); err != nil {
		t.Fatal(err)
	}
	_, err = create()
	requireProductRule(t, err, "product_version_owner_unavailable")
	if _, err = db.Exec(`UPDATE product_members SET valid_from=UTC_TIMESTAMP(3)-INTERVAL 1 DAY,status='inactive'`); err != nil {
		t.Fatal(err)
	}
	_, err = create()
	requireProductRule(t, err, "product_version_owner_unavailable")
	if _, err = db.Exec(`UPDATE product_members SET status='active'`); err != nil {
		t.Fatal(err)
	}
	saved, err := create()
	if err != nil {
		t.Fatal(err)
	}
	var version ProductVersionRecord
	if err = json.Unmarshal(saved.Value, &version); err != nil || version.BusinessOwnerUID == nil || *version.BusinessOwnerUID != owner {
		t.Fatalf("owner response %+v %v", version, err)
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_versions`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("failed assignments left versions: %d %v", count, err)
	}
	if _, err = db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P-OWNER','next','contributor','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`); err != nil {
		t.Fatal(err)
	}
	next := "next"
	edit := ProductVersionEdit{ProductVersionDraft: ProductVersionDraft{ExpectedRevision: 2, VersionCode: "v1", BusinessOwnerUID: &next}, VersionID: version.ID, ExpectedVersionRevision: 1, Reason: "交接版本责任"}
	editIdentity := CommandIdentity{ProductCode: "P-OWNER", ActorUID: "pm", Action: "product_versions:edit", IdempotencyKey: "owner-transfer"}
	update := func() (CommandResult, error) { return EditProductCenterVersion(ctx, db, editIdentity, permit(), edit) }
	if _, err = db.Exec(`CREATE TRIGGER fail_owner_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='owner audit failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err = update(); err == nil {
		t.Fatal("audit failure committed owner transfer")
	}
	var persisted string
	var revision int
	if err = db.QueryRow(`SELECT business_owner_uid,revision FROM product_versions WHERE id=?`, version.ID).Scan(&persisted, &revision); err != nil || persisted != owner || revision != 1 {
		t.Fatalf("owner rollback: %s %d %v", persisted, revision, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_owner_audit`); err != nil {
		t.Fatal(err)
	}
	changed, err := update()
	if err != nil {
		t.Fatal(err)
	}
	replay, err := update()
	if err != nil || !replay.Replayed || replay.ReceiptID != changed.ReceiptID {
		t.Fatalf("owner replay %+v %v", replay, err)
	}
	if err = db.QueryRow(`SELECT business_owner_uid,revision FROM product_versions WHERE id=?`, version.ID).Scan(&persisted, &revision); err != nil || persisted != next || revision != 2 {
		t.Fatalf("owner transfer: %s %d %v", persisted, revision, err)
	}
}
