package productcenter

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func TestMySQLProductDocumentCreateAtomic(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-DOC-CREATE")
	ctx := context.Background()
	permit := func() AuthorizationPermit {
		p := workspacePermit(t, db, "P-DOC-CREATE", "pm", "edit")
		p.Resource = "product_documents"
		return p
	}
	identity := CommandIdentity{ProductCode: "P-DOC-CREATE", ActorUID: "pm", Action: "product_documents:create", IdempotencyKey: "doc-create"}
	input := ProductDocumentCreate{ExpectedRevision: 1, DocumentUUID: "00000000-0000-4000-8000-000000000001", Purpose: "requirements"}
	wrong := permit()
	wrong.Resource = "product_features"
	if _, err := CreateProductDocument(ctx, db, identity, wrong, input); err == nil {
		t.Fatal("wrong resource accepted")
	}
	if _, err := db.Exec(`CREATE TRIGGER pc_doc_audit_fail BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err := CreateProductDocument(ctx, db, identity, permit(), input); err == nil {
		t.Fatal("audit failure committed")
	}
	for _, table := range []string{"product_documents", "product_command_receipts"} {
		var count int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("rollback %s %d %v", table, count, err)
		}
	}
	var revision int
	if err := db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-DOC-CREATE'`).Scan(&revision); err != nil || revision != 1 {
		t.Fatalf("root rollback %d %v", revision, err)
	}
	if _, err := db.Exec(`DROP TRIGGER pc_doc_audit_fail`); err != nil {
		t.Fatal(err)
	}
	created, err := CreateProductDocument(ctx, db, identity, permit(), input)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := CreateProductDocument(ctx, db, identity, permit(), input)
	var original, replayed map[string]any
	if e := json.Unmarshal(created.Value, &original); e != nil {
		t.Fatal(e)
	}
	if e := json.Unmarshal(replay.Value, &replayed); e != nil {
		t.Fatal(e)
	}
	if err != nil || !replay.Replayed || !reflect.DeepEqual(original, replayed) {
		t.Fatalf("replay %+v %v", replay, err)
	}
	identity.IdempotencyKey = "duplicate"
	input.ExpectedRevision = 2
	if _, err = CreateProductDocument(ctx, db, identity, permit(), input); err == nil {
		t.Fatal("duplicate relation accepted")
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_documents`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("duplicate %d %v", count, err)
	}
	var leaked int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_activity_logs WHERE CAST(changes AS CHAR) LIKE '%00000000-0000-4000-8000-000000000001%'`).Scan(&leaked); err != nil || leaked != 0 {
		t.Fatalf("activity leaks UUID %d %v", leaked, err)
	}
}
