package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLProductVersionDeleteAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-DELETE")
	for _, table := range []string{"work_items", "aims_project_products"} {
		if _, err := db.Exec("CREATE TABLE IF NOT EXISTS " + table + "(id BIGINT PRIMARY KEY,version_id BIGINT)"); err != nil {
			t.Fatal(err)
		}
	}
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-DELETE", "pm", action)
		p.Resource = "product_versions"
		return p
	}
	saved, err := CreateProductCenterVersion(context.Background(), db, CommandIdentity{ProductCode: "P-DELETE", ActorUID: "pm", Action: "product_versions:create", IdempotencyKey: "create"}, permit("edit"), ProductVersionDraft{ExpectedRevision: 1, VersionCode: "v1"})
	if err != nil {
		t.Fatal(err)
	}
	var version ProductVersionRecord
	if err = json.Unmarshal(saved.Value, &version); err != nil {
		t.Fatal(err)
	}
	identity := CommandIdentity{ProductCode: "P-DELETE", ActorUID: "pm", Action: "product_versions:delete", IdempotencyKey: "delete"}
	input := ProductVersionDeleteInput{VersionID: version.ID, ExpectedRevision: 2, ExpectedVersionRevision: 1, ExpectedScopeRevision: 1, Reason: "撤销未使用草案"}
	run := func(action string) (CommandResult, error) {
		return DeleteProductCenterVersion(context.Background(), db, identity, permit(action), input)
	}
	_, err = run("edit")
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`INSERT INTO work_items(id,version_id) VALUES(1,?)`, version.ID); err != nil {
		t.Fatal(err)
	}
	_, err = run("delete")
	requireProductRule(t, err, "product_version_referenced")
	if _, err = db.Exec(`DELETE FROM work_items`); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ table, insert string }{
		{"aims_project_products", `INSERT INTO aims_project_products(id,version_id) VALUES(1,?)`},
		{"product_version_features", `INSERT INTO product_version_features(version_id,title) VALUES(?,'scope')`},
		{"product_version_acceptances", `INSERT INTO product_version_acceptances(version_id,scope_revision,accepted_by,accepted_at,checklist,exceptions) VALUES(?,1,'pm',UTC_TIMESTAMP(3),JSON_ARRAY(),JSON_ARRAY())`},
		{"product_release_records", `INSERT INTO product_release_records(biz_id,version_id,release_seq,scope_revision,scope_snapshot,acceptance_snapshot,content_hash,evidence_level,recorded_at) VALUES(UUID(),?,1,1,JSON_OBJECT(),JSON_OBJECT(),REPEAT('a',64),'legacy_import',UTC_TIMESTAMP(3))`},
	} {
		t.Run(tc.table, func(t *testing.T) {
			db := mysqlTestDatabase(t)
			migrateProductCenter(t, db)
			workspaceFixture(t, db, "P-DELETE")
			for _, table := range []string{"work_items", "aims_project_products"} {
				if _, err := db.Exec("CREATE TABLE IF NOT EXISTS " + table + "(id BIGINT PRIMARY KEY,version_id BIGINT)"); err != nil {
					t.Fatal(err)
				}
			}
			permit := func(action string) AuthorizationPermit {
				p := workspacePermit(t, db, "P-DELETE", "pm", action)
				p.Resource = "product_versions"
				return p
			}
			saved, err := CreateProductCenterVersion(context.Background(), db, CommandIdentity{ProductCode: "P-DELETE", ActorUID: "pm", Action: "product_versions:create", IdempotencyKey: "create"}, permit("edit"), ProductVersionDraft{ExpectedRevision: 1, VersionCode: "v1"})
			if err != nil {
				t.Fatal(err)
			}
			var version ProductVersionRecord
			if err := json.Unmarshal(saved.Value, &version); err != nil {
				t.Fatal(err)
			}
			isolatedInput := input
			isolatedInput.VersionID = version.ID

			if _, err := db.Exec(tc.insert, version.ID); err != nil {
				t.Fatal(err)
			}
			_, err = DeleteProductCenterVersion(context.Background(), db, identity, permit("delete"), isolatedInput)
			requireProductRule(t, err, "product_version_referenced")
			var rootRevision, remaining int
			if err := db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-DELETE'`).Scan(&rootRevision); err != nil || rootRevision != 2 {
				t.Fatalf("root changed: %d %v", rootRevision, err)
			}
			if err := db.QueryRow(`SELECT COUNT(*) FROM product_versions WHERE id=?`, version.ID).Scan(&remaining); err != nil || remaining != 1 {
				t.Fatalf("version missing: %d %v", remaining, err)
			}

		})
	}
	for _, revision := range []*uint64{&input.ExpectedRevision, &input.ExpectedVersionRevision, &input.ExpectedScopeRevision} {
		*revision++
		_, err = run("delete")
		code := "product_version_revision_conflict"
		if revision == &input.ExpectedRevision {
			code = "product_revision_conflict"
		}
		requireProductRule(t, err, code)
		*revision--
	}
	if _, err = db.Exec(`UPDATE product_versions SET status='developing' WHERE id=?`, version.ID); err != nil {
		t.Fatal(err)
	}
	_, err = run("delete")
	requireProductRule(t, err, "product_version_locked")
	if _, err = db.Exec(`UPDATE product_versions SET status='planning' WHERE id=?`, version.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`CREATE TRIGGER fail_delete_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run("delete"); err == nil {
		t.Fatal("audit failure committed deletion")
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_versions WHERE id=?`, version.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("rollback %d %v", count, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_delete_audit`); err != nil {
		t.Fatal(err)
	}
	deleted, err := run("delete")
	if err != nil {
		t.Fatal(err)
	}
	replay, err := run("delete")
	if err != nil || !replay.Replayed || replay.ReceiptID != deleted.ReceiptID {
		t.Fatalf("delete replay %+v %v", replay, err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_versions WHERE id=?`, version.ID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("not deleted %d %v", count, err)
	}
}
