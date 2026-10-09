package productcenter

import (
	"os"
	"testing"
)

func TestMySQLProductComponentsMigration(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenterBeforeComponents(t, db)
	workspaceFixture(t, db, "P-TREE")
	workspaceFixture(t, db, "P-OTHER-TREE")
	if _, err := db.Exec(`INSERT INTO product_features(biz_id,product_code,title,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-TREE','原有功能','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`); err != nil {
		t.Fatal(err)
	}
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.21_product_components.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	executeSQLScript(t, db, string(script))
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_features WHERE product_code='P-TREE' AND title='原有功能' AND component_id IS NULL AND revision=1`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("existing feature changed %d %v", count, err)
	}
	result, err := db.Exec(`INSERT INTO product_components(biz_id,product_code,name,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-TREE','认证模块','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`)
	if err != nil {
		t.Fatal(err)
	}
	parent, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_components(biz_id,product_code,parent_id,name,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-OTHER-TREE',?,'跨产品子模块','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, parent); err == nil {
		t.Fatal("cross-product parent accepted")
	}
	child, err := db.Exec(`INSERT INTO product_components(biz_id,product_code,parent_id,name,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-TREE',?,'登录模块','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, parent)
	if err != nil {
		t.Fatal(err)
	}
	childID, err := child.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE product_features SET component_id=? WHERE product_code='P-TREE'`, childID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_features(biz_id,product_code,component_id,title,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-OTHER-TREE',?,'跨产品功能','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, childID); err == nil {
		t.Fatal("cross-product feature assignment accepted")
	}
	if _, err = db.Exec(`DELETE FROM product_components WHERE id=?`, parent); err == nil {
		t.Fatal("parent with child deleted")
	}
	if _, err = db.Exec(`DELETE FROM product_components WHERE id=?`, childID); err == nil {
		t.Fatal("component with feature deleted")
	}
}
