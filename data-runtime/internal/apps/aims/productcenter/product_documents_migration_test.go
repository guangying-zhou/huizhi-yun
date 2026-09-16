package productcenter

import (
	"os"
	"testing"
)

func TestMySQLProductDocumentsMigration(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-DOC")
	insert := `INSERT INTO product_documents(biz_id,product_code,document_uuid,purpose,created_by,updated_by,created_at,updated_at) VALUES(UUID(),?,?,?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`
	const uuid = "00000000-0000-4000-8000-000000000001"
	result, err := db.Exec(insert, "P-DOC", uuid, "requirements")
	if err != nil {
		t.Fatal(err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(insert, "P-DOC", uuid, "design"); err == nil {
		t.Fatal("duplicate relation accepted")
	}
	if _, err = db.Exec(insert, "OTHER", uuid, "design"); err == nil {
		t.Fatal("missing workspace accepted")
	}
	if _, err = db.Exec(insert, "P-DOC", "00000000-0000-4000-8000-000000000002", "invalid"); err == nil {
		t.Fatal("invalid purpose accepted")
	}
	if _, err = db.Exec(`UPDATE product_documents SET removed_at=UTC_TIMESTAMP(3) WHERE id=?`, id); err == nil {
		t.Fatal("removal without actor accepted")
	}
	if _, err = db.Exec(`UPDATE product_documents SET removed_at=UTC_TIMESTAMP(3),removed_by='pm',revision=revision+1 WHERE id=?`, id); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(insert, "P-DOC", uuid, "design"); err == nil {
		t.Fatal("removed relation identity duplicated")
	}
	if _, err = db.Exec(`UPDATE product_documents SET removed_at=NULL,removed_by=NULL,revision=revision+1 WHERE id=?`, id); err != nil {
		t.Fatal(err)
	}
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.34_product_documents.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	var count, revision int
	if err = db.QueryRow(`SELECT COUNT(*),MAX(revision) FROM product_documents WHERE id=? AND removed_at IS NULL`, id).Scan(&count, &revision); err != nil || count != 1 || revision != 3 {
		t.Fatalf("migration lost restored relation: %d %d %v", count, revision, err)
	}
}
