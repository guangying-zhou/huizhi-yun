package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
)

func TestMySQLProductVersionDetailAndEdit(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-V")
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-V", "pm", action)
		p.Resource = "product_versions"
		return p
	}
	draft := ProductVersionDraft{ExpectedRevision: 1, VersionCode: "v1", Name: "初始版本"}
	created, err := CreateProductCenterVersion(ctx, db, CommandIdentity{ProductCode: "P-V", ActorUID: "pm", Action: "product_versions:create", IdempotencyKey: "create"}, permit("edit"), draft)
	if err != nil {
		t.Fatal(err)
	}
	var v ProductVersionRecord
	if err = json.Unmarshal(created.Value, &v); err != nil {
		t.Fatal(err)
	}
	read, err := ReadProductCenterVersion(ctx, db, "P-V", "pm", permit("view"), v.ID)
	if err != nil || read.WorkspaceRevision != 2 || read.Revision != 1 {
		t.Fatalf("detail: %+v %v", read, err)
	}
	draft.ExpectedRevision = 2
	draft.Name = "调整后版本"
	input := ProductVersionEdit{ProductVersionDraft: draft, VersionID: v.ID, ExpectedVersionRevision: 1, Reason: "试点范围沟通更新"}
	identity := CommandIdentity{ProductCode: "P-V", ActorUID: "pm", Action: "product_versions:edit", IdempotencyKey: "edit"}
	_, err = EditProductCenterVersion(ctx, db, identity, permit("view"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`CREATE TRIGGER fail_version_edit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = EditProductCenterVersion(ctx, db, identity, permit("edit"), input); err == nil {
		t.Fatal("failed audit committed")
	}
	read, err = ReadProductCenterVersion(ctx, db, "P-V", "pm", permit("view"), v.ID)
	if err != nil || read.Revision != 1 || read.WorkspaceRevision != 2 || *read.Name != "初始版本" {
		t.Fatalf("rollback: %+v %v", read, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_version_edit`); err != nil {
		t.Fatal(err)
	}
	result, err := EditProductCenterVersion(ctx, db, identity, permit("edit"), input)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := EditProductCenterVersion(ctx, db, identity, permit("edit"), input)
	if err != nil || !replay.Replayed || replay.ReceiptID != result.ReceiptID {
		t.Fatalf("replay: %+v %v", replay, err)
	}
	read, err = ReadProductCenterVersion(ctx, db, "P-V", "pm", permit("view"), v.ID)
	if err != nil || read.Revision != 2 || read.WorkspaceRevision != 3 || read.ScopeRevision != 1 || *read.Name != draft.Name || read.OwnerProjectID != nil {
		t.Fatalf("edited detail: %+v %v", read, err)
	}
	identity.IdempotencyKey = "stale"
	_, err = EditProductCenterVersion(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_revision_conflict")
	input.ExpectedRevision = 3
	_, err = EditProductCenterVersion(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_version_revision_conflict")
	input.ExpectedVersionRevision = 2
	for _, state := range []string{"released", "archived"} {
		if _, err = db.Exec(`UPDATE product_versions SET status=? WHERE id=?`, state, v.ID); err != nil {
			t.Fatal(err)
		}
		_, err = EditProductCenterVersion(ctx, db, identity, permit("edit"), input)
		requireProductRule(t, err, "product_version_locked")
	}
	foreign, err := db.Exec(`INSERT INTO product_versions(product_code,version_code,status) VALUES('p-v','private','planning')`)
	if err != nil {
		t.Fatal(err)
	}
	foreignID, err := foreign.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	_, err = ReadProductCenterVersion(ctx, db, "P-V", "pm", permit("view"), foreignID)
	if err != sql.ErrNoRows {
		t.Fatalf("foreign read: %v", err)
	}
	input.VersionID = foreignID
	_, err = EditProductCenterVersion(ctx, db, identity, permit("edit"), input)
	if err != sql.ErrNoRows {
		t.Fatalf("foreign edit: %v", err)
	}
}
