package productcenter

import (
	"context"
	"os"
	"testing"
)

func TestMySQLProductComponentMoveAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.21_product_components.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	workspaceFixture(t, db, "P-MOVE")
	workspaceFixture(t, db, "P-OTHER-MOVE")
	insert := func(code string, parent *int64) int64 {
		t.Helper()
		r, err := db.Exec(`INSERT INTO product_components(biz_id,product_code,parent_id,name,created_by,updated_by,created_at,updated_at) VALUES(UUID(),?,?,'模块','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code, parent)
		if err != nil {
			t.Fatal(err)
		}
		id, err := r.LastInsertId()
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	root := insert("P-MOVE", nil)
	child := insert("P-MOVE", &root)
	target := insert("P-MOVE", nil)
	targetChild := insert("P-MOVE", &target)
	foreign := insert("P-OTHER-MOVE", nil)
	identity := CommandIdentity{ProductCode: "P-MOVE", ActorUID: "pm", Action: "product_components:move", IdempotencyKey: "move"}
	input := ProductComponentMove{ComponentID: root, ParentID: &target, ExpectedRevision: 1, ExpectedComponentRevision: 1, Reason: "调整模块归属"}
	run := func(action string) (CommandResult, error) {
		p := workspacePermit(t, db, "P-MOVE", "pm", action)
		p.Resource = "product_components"
		return MoveProductComponent(context.Background(), db, identity, p, input)
	}
	assertState := func(parent *int64, revision uint64, count int) {
		t.Helper()
		var actualParent *int64
		var actualRevision, workspaceRevision uint64
		if err := db.QueryRow(`SELECT parent_id,revision FROM product_components WHERE id=?`, root).Scan(&actualParent, &actualRevision); err != nil {
			t.Fatal(err)
		}
		if (parent == nil) != (actualParent == nil) || (parent != nil && actualParent != nil && *parent != *actualParent) || actualRevision != revision {
			t.Fatalf("component parent=%v revision=%d", actualParent, actualRevision)
		}
		if err := db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-MOVE'`).Scan(&workspaceRevision); err != nil || workspaceRevision != revision {
			t.Fatalf("workspace revision=%d: %v", workspaceRevision, err)
		}
		for _, table := range []string{"product_activity_logs", "product_command_receipts"} {
			var actual int
			if err := db.QueryRow("SELECT COUNT(*) FROM " + table + " WHERE product_code='P-MOVE'").Scan(&actual); err != nil || actual != count {
				t.Fatalf("%s count=%d: %v", table, actual, err)
			}
		}
	}
	_, err = run("view")
	requireProductRule(t, err, "product_authorization_invalid")
	input.ParentID = &child
	_, err = run("edit")
	requireProductRule(t, err, "product_component_cycle")
	input.ParentID = &foreign
	_, err = run("edit")
	requireProductRule(t, err, "product_component_parent_invalid")
	input.ParentID = &targetChild
	_, err = run("edit")
	requireProductRule(t, err, "product_component_depth_exceeded")
	input.ParentID = &target
	input.ExpectedComponentRevision = 2
	_, err = run("edit")
	requireProductRule(t, err, "product_component_revision_conflict")
	input.ExpectedComponentRevision = 1
	assertState(nil, 1, 0)
	if _, err = db.Exec(`CREATE TRIGGER fail_component_move BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run("edit"); err == nil {
		t.Fatal("audit failure committed")
	}
	assertState(nil, 1, 0)
	if _, err = db.Exec(`DROP TRIGGER fail_component_move`); err != nil {
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
	assertState(&target, 2, 1)
	var reason string
	var recordedParent int64
	if err = db.QueryRow(`SELECT JSON_UNQUOTE(JSON_EXTRACT(changes,'$.reason')),CAST(JSON_UNQUOTE(JSON_EXTRACT(changes,'$.after.parent_id')) AS UNSIGNED) FROM product_activity_logs WHERE product_code='P-MOVE' AND object_type='component' AND action='move'`).Scan(&reason, &recordedParent); err != nil || reason != input.Reason || recordedParent != target {
		t.Fatalf("move audit reason=%q parent=%d: %v", reason, recordedParent, err)
	}
	_, err = run("view")
	requireProductRule(t, err, "product_authorization_invalid")
	identity.IdempotencyKey = "stale-move"
	_, err = run("edit")
	requireProductRule(t, err, "product_revision_conflict")
	input.ExpectedRevision = 2
	input.ExpectedComponentRevision = 2
	input.ParentID = nil
	if _, err = run("edit"); err != nil {
		t.Fatal(err)
	}
	assertState(nil, 3, 2)
	var actualChildParent int64
	if err = db.QueryRow(`SELECT parent_id FROM product_components WHERE id=?`, child).Scan(&actualChildParent); err != nil || actualChildParent != root {
		t.Fatalf("descendant changed %d %v", actualChildParent, err)
	}
	edit := ProductComponentEdit{ComponentID: root, Name: "认证平台", Description: "统一身份与会话", SortOrder: -2, ExpectedRevision: 3, ExpectedComponentRevision: 3, Reason: "明确模块职责"}
	editIdentity := CommandIdentity{ProductCode: "P-MOVE", ActorUID: "pm", Action: "product_components:edit", IdempotencyKey: "edit"}
	runEdit := func(action string) (CommandResult, error) {
		p := workspacePermit(t, db, "P-MOVE", "pm", action)
		p.Resource = "product_components"
		return EditProductComponent(context.Background(), db, editIdentity, p, edit)
	}
	_, err = runEdit("view")
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`CREATE TRIGGER fail_component_edit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = runEdit("edit"); err == nil {
		t.Fatal("edit audit failure committed")
	}
	assertState(nil, 3, 2)
	var name string
	if err = db.QueryRow(`SELECT name FROM product_components WHERE id=?`, root).Scan(&name); err != nil || name != "模块" {
		t.Fatalf("name rollback %q %v", name, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_component_edit`); err != nil {
		t.Fatal(err)
	}
	edited, err := runEdit("edit")
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := runEdit("edit")
	if err != nil || !replayed.Replayed || replayed.ReceiptID != edited.ReceiptID {
		t.Fatalf("edit replay %+v %v", replayed, err)
	}
	assertState(nil, 4, 3)
	var description string
	var sort int32
	if err = db.QueryRow(`SELECT name,description,sort_order FROM product_components WHERE id=?`, root).Scan(&name, &description, &sort); err != nil || name != edit.Name || description != edit.Description || sort != edit.SortOrder {
		t.Fatalf("edit fields %s %s %d %v", name, description, sort, err)
	}
	if err = db.QueryRow(`SELECT parent_id FROM product_components WHERE id=?`, child).Scan(&actualChildParent); err != nil || actualChildParent != root {
		t.Fatalf("edit changed descendant %d %v", actualChildParent, err)
	}
	editIdentity.IdempotencyKey = "stale-edit"
	_, err = runEdit("edit")
	requireProductRule(t, err, "product_revision_conflict")
	edit.ExpectedRevision = 4
	_, err = runEdit("edit")
	requireProductRule(t, err, "product_component_revision_conflict")
}
