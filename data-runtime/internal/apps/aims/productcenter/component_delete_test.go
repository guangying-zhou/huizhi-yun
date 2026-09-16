package productcenter

import (
	"context"
	"testing"
)

func TestMySQLProductComponentDeleteAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-DELETE-COMP")
	inserted, err := db.Exec(`INSERT INTO product_components(biz_id,product_code,name,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-DELETE-COMP','模块','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`)
	if err != nil {
		t.Fatal(err)
	}
	id, err := inserted.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	identity := CommandIdentity{ProductCode: "P-DELETE-COMP", ActorUID: "pm", Action: "product_components:delete", IdempotencyKey: "delete"}
	input := ProductComponentDelete{ComponentID: id, ExpectedRevision: 1, ExpectedComponentRevision: 1, Reason: "清理空模块"}
	run := func(action string) (CommandResult, error) {
		p := workspacePermit(t, db, identity.ProductCode, "pm", action)
		p.Resource = "product_components"
		return DeleteProductComponent(context.Background(), db, identity, p, input)
	}
	assertState := func(exists, receipts int, revision uint64) {
		t.Helper()
		var count int
		var rev uint64
		if err = db.QueryRow(`SELECT COUNT(*) FROM product_components WHERE id=?`, id).Scan(&count); err != nil || count != exists {
			t.Fatalf("component %d %v", count, err)
		}
		if err = db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-DELETE-COMP'`).Scan(&rev); err != nil || rev != revision {
			t.Fatalf("revision %d %v", rev, err)
		}
		for _, table := range []string{"product_activity_logs", "product_command_receipts"} {
			if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != receipts {
				t.Fatalf("%s %d %v", table, count, err)
			}
		}
	}
	_, err = run("edit")
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`INSERT INTO product_components(biz_id,product_code,parent_id,name,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-DELETE-COMP',?,'子模块','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, id); err != nil {
		t.Fatal(err)
	}
	_, err = run("delete")
	requireProductRule(t, err, "product_component_referenced")
	assertState(1, 0, 1)
	if _, err = db.Exec(`DELETE FROM product_components WHERE parent_id=?`, id); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_features(biz_id,product_code,component_id,title,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-DELETE-COMP',?,'功能','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, id); err != nil {
		t.Fatal(err)
	}
	_, err = run("delete")
	requireProductRule(t, err, "product_component_referenced")
	assertState(1, 0, 1)
	if _, err = db.Exec(`UPDATE product_features SET component_id=NULL WHERE component_id=?`, id); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`CREATE TRIGGER fail_component_delete BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run("delete"); err == nil {
		t.Fatal("audit failure committed")
	}
	assertState(1, 0, 1)
	if _, err = db.Exec(`DROP TRIGGER fail_component_delete`); err != nil {
		t.Fatal(err)
	}
	saved, err := run("delete")
	if err != nil {
		t.Fatal(err)
	}
	replay, err := run("delete")
	if err != nil || !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	assertState(0, 1, 2)
	_, err = run("edit")
	requireProductRule(t, err, "product_authorization_invalid")
}
