package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLProductDocumentRemoveRestore(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-DOC-LIFE")
	ctx := context.Background()
	permit := func() AuthorizationPermit {
		p := workspacePermit(t, db, "P-DOC-LIFE", "pm", "edit")
		p.Resource = "product_documents"
		return p
	}
	identity := CommandIdentity{ProductCode: "P-DOC-LIFE", ActorUID: "pm", Action: "product_documents:create", IdempotencyKey: "create"}
	created, err := CreateProductDocument(ctx, db, identity, permit(), ProductDocumentCreate{ExpectedRevision: 1, DocumentUUID: "00000000-0000-4000-8000-000000000001", Purpose: "design"})
	if err != nil {
		t.Fatal(err)
	}
	var receipt struct {
		BizID string `json:"biz_id"`
	}
	if err = json.Unmarshal(created.Value, &receipt); err != nil {
		t.Fatal(err)
	}
	input := ProductDocumentTransition{BizID: receipt.BizID, ExpectedRevision: 2, ExpectedDocumentRevision: 1}
	identity.Action = "product_documents:remove"
	identity.IdempotencyKey = "remove"
	if _, err = db.Exec(`CREATE TRIGGER pc_doc_remove_fail BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err = TransitionProductDocument(ctx, db, identity, permit(), input); err == nil {
		t.Fatal("audit failure committed")
	}
	var revision int
	var removed bool
	if err = db.QueryRow(`SELECT revision,removed_at IS NOT NULL FROM product_documents WHERE biz_id=?`, receipt.BizID).Scan(&revision, &removed); err != nil || revision != 1 || removed {
		t.Fatalf("rollback %d %v %v", revision, removed, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_doc_remove_fail`); err != nil {
		t.Fatal(err)
	}
	if _, err = TransitionProductDocument(ctx, db, identity, permit(), input); err != nil {
		t.Fatal(err)
	}
	replay, err := TransitionProductDocument(ctx, db, identity, permit(), input)
	if err != nil || !replay.Replayed {
		t.Fatalf("remove replay %+v %v", replay, err)
	}
	identity.Action = "product_documents:restore"
	identity.IdempotencyKey = "restore"
	input.ExpectedRevision = 3
	if _, err = TransitionProductDocument(ctx, db, identity, permit(), input); err == nil {
		t.Fatal("stale relation revision accepted")
	}
	input.ExpectedDocumentRevision = 2
	if _, err = TransitionProductDocument(ctx, db, identity, permit(), input); err != nil {
		t.Fatal(err)
	}
	replay, err = TransitionProductDocument(ctx, db, identity, permit(), input)
	if err != nil || !replay.Replayed {
		t.Fatalf("restore replay %+v %v", replay, err)
	}
	if err = db.QueryRow(`SELECT revision,removed_at IS NOT NULL FROM product_documents WHERE biz_id=?`, receipt.BizID).Scan(&revision, &removed); err != nil || revision != 3 || removed {
		t.Fatalf("restore identity %d %v %v", revision, removed, err)
	}
	identity.IdempotencyKey = "restore-again"
	input.ExpectedRevision = 4
	input.ExpectedDocumentRevision = 3
	if _, err = TransitionProductDocument(ctx, db, identity, permit(), input); err == nil {
		t.Fatal("active relation restored twice")
	}
	identity.Action = "product_documents:edit"
	identity.IdempotencyKey = "purpose"
	edit := ProductDocumentPurposeChange{BizID: receipt.BizID, ExpectedRevision: 4, ExpectedDocumentRevision: 3, Purpose: "user-guide"}
	if _, err = ChangeProductDocumentPurpose(ctx, db, identity, permit(), edit); err != nil {
		t.Fatal(err)
	}
	replay, err = ChangeProductDocumentPurpose(ctx, db, identity, permit(), edit)
	if err != nil || !replay.Replayed {
		t.Fatalf("purpose replay %+v %v", replay, err)
	}
	var purpose, documentUUID string
	if err = db.QueryRow(`SELECT purpose,document_uuid,revision FROM product_documents WHERE biz_id=?`, receipt.BizID).Scan(&purpose, &documentUUID, &revision); err != nil || purpose != "user-guide" || documentUUID != "00000000-0000-4000-8000-000000000001" || revision != 4 {
		t.Fatalf("purpose mutation %s %s %d %v", purpose, documentUUID, revision, err)
	}
	identity.IdempotencyKey = "purpose-stale"
	edit.ExpectedRevision = 5
	edit.Purpose = "other"
	if _, err = ChangeProductDocumentPurpose(ctx, db, identity, permit(), edit); err == nil {
		t.Fatal("stale purpose revision accepted")
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_documents`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("identity duplicated %d %v", count, err)
	}
}
