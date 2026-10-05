package productcenter

import (
	"context"
	"testing"
)

func TestMySQLProductDocumentCandidatePagination(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-DOC-READ")
	workspaceFixture(t, db, "OTHER")
	for _, row := range []struct{ code, purpose, uuid string }{{"P-DOC-READ", "design", "00000000-0000-4000-8000-000000000001"}, {"P-DOC-READ", "requirements", "00000000-0000-4000-8000-000000000002"}, {"P-DOC-READ", "design", "00000000-0000-4000-8000-000000000003"}, {"OTHER", "design", "00000000-0000-4000-8000-000000000004"}} {
		if _, err := db.Exec(`INSERT INTO product_documents(biz_id,product_code,document_uuid,purpose,created_by,updated_by,created_at,updated_at) VALUES(UUID(),?,?,?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, row.code, row.uuid, row.purpose); err != nil {
			t.Fatal(err)
		}
	}
	ctx := context.Background()
	permit := workspacePermit(t, db, "P-DOC-READ", "pm", "view")
	permit.Resource = "product_documents"
	query := ProductDocumentQuery{Page: 1, PageSize: 1, Purpose: "design"}
	read := func() (ProductDocumentPage, error) {
		return ListProductDocuments(ctx, db, "P-DOC-READ", "pm", permit, query)
	}
	first, err := read()
	if err != nil || first.Total != 2 || len(first.Items) != 1 || first.Items[0].DocumentUUID != "00000000-0000-4000-8000-000000000003" || first.WorkspaceRevision != permit.Facts.Revision {
		t.Fatalf("first %+v %v", first, err)
	}
	query.Page = 2
	second, err := read()
	if err != nil || second.Total != 2 || len(second.Items) != 1 || second.Items[0].DocumentUUID != "00000000-0000-4000-8000-000000000001" {
		t.Fatalf("second %+v %v", second, err)
	}
	query.Page = 3
	empty, err := read()
	if err != nil || empty.Total != 2 || len(empty.Items) != 0 {
		t.Fatalf("empty %+v %v", empty, err)
	}
	if _, err = db.Exec(`UPDATE product_documents SET removed_at=UTC_TIMESTAMP(3),removed_by='pm' WHERE biz_id=?`, first.Items[0].BizID); err != nil {
		t.Fatal(err)
	}
	query.Page = 1
	query.Removed = true
	removed, err := read()
	if err != nil || removed.Total != 1 || len(removed.Items) != 1 || !removed.Items[0].Removed || removed.Items[0].BizID != first.Items[0].BizID {
		t.Fatalf("removed %+v %v", removed, err)
	}
	detail, err := ReadProductDocument(ctx, db, "P-DOC-READ", "pm", first.Items[0].BizID, permit)
	if err != nil || detail.Item != removed.Items[0] || detail.WorkspaceRevision != permit.Facts.Revision {
		t.Fatalf("detail %+v %v", detail, err)
	}
	otherPermit := workspacePermit(t, db, "OTHER", "pm", "view")
	otherPermit.Resource = "product_documents"
	if _, err = ReadProductDocument(ctx, db, "OTHER", "pm", first.Items[0].BizID, otherPermit); err == nil {
		t.Fatal("cross product detail accepted")
	}
	wrongPermit := permit
	wrongPermit.Resource = "product_features"
	if _, err = ReadProductDocument(ctx, db, "P-DOC-READ", "pm", first.Items[0].BizID, wrongPermit); err == nil {
		t.Fatal("wrong detail resource accepted")
	}
	if _, err = ReadProductDocument(ctx, db, "P-DOC-READ", "pm", "invalid", permit); err == nil {
		t.Fatal("invalid detail identity accepted")
	}
	query.Removed = false
	active, err := read()
	if err != nil || active.Total != 1 || active.Items[0].BizID != second.Items[0].BizID {
		t.Fatalf("active %+v %v", active, err)
	}
	wrong := permit
	wrong.Resource = "product_features"
	if _, err = ListProductDocuments(ctx, db, "P-DOC-READ", "pm", wrong, query); err == nil {
		t.Fatal("wrong resource accepted")
	}
	query.Purpose = "invalid"
	if _, err = read(); err == nil {
		t.Fatal("invalid purpose accepted")
	}
}
