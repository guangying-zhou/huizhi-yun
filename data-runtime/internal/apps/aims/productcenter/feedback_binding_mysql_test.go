package productcenter

import "testing"

func TestMySQLFeedbackOriginUnique(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-FEEDBACK")
	statements := []string{
		`INSERT INTO product_requests(biz_id,product_code,title,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-FEEDBACK','Feedback','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
		`INSERT INTO product_request_sources(request_id,source_type,source_note,created_by,updated_by,created_at,updated_at) SELECT id,'service_ticket','Feedback','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3) FROM product_requests`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	insert := `INSERT INTO product_feedback_bindings(source_app,source_type,source_biz_id,product_code,request_id,source_id,created_by,created_at) SELECT ?,? ,?,'P-FEEDBACK',request_id,id,?,UTC_TIMESTAMP(3) FROM product_request_sources LIMIT 1`
	if _, err := db.Exec(insert, "altoc", "service_ticket", "ST-1", "pm"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(statements[1]); err != nil {
		t.Fatal(err)
	}
	duplicateOrigin := `INSERT INTO product_feedback_bindings(source_app,source_type,source_biz_id,product_code,request_id,source_id,created_by,created_at) SELECT 'altoc','service_ticket','ST-1','P-FEEDBACK',request_id,id,'pm',UTC_TIMESTAMP(3) FROM product_request_sources ORDER BY id DESC LIMIT 1`
	if _, err := db.Exec(duplicateOrigin); err == nil {
		t.Fatal("same origin bound to different evidence")
	}
	if _, err := db.Exec(insert, "altoc", "service_ticket", "ST-1", "pm"); err == nil {
		t.Fatal("duplicate source accepted")
	}
	if _, err := db.Exec(insert, "altoc", "service_ticket", "ST-2", "pm"); err == nil {
		t.Fatal("one evidence bound twice")
	}
	if _, err := db.Exec(`DELETE FROM product_feedback_bindings`); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]any{{"manual", "service_ticket", "ST-1", "pm"}, {"altoc", "other", "ST-1", "pm"}, {"altoc", "service_ticket", "", "pm"}, {"altoc", "service_ticket", "ST-1", ""}} {
		if _, err := db.Exec(insert, args...); err == nil {
			t.Fatalf("invalid binding accepted %v", args)
		}
	}
}
