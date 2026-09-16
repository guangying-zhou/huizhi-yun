package assets

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
	"unsafe"
)

func TestMySQLProductMasterScopeTransactions(t *testing.T) {
	socket := os.Getenv("HZY_PRODUCT_CENTER_TEST_SOCKET")
	if socket == "" {
		t.Skip("dedicated MySQL socket not configured")
	}
	if !strings.HasPrefix(socket, "/tmp/hzy-product-center.") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("refusing non-test socket")
	}
	admin, err := sql.Open("mysql", "root@unix("+socket+")/?parseTime=true")
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := fmt.Sprintf("hzy_assets_product_write_%d", time.Now().UnixNano())
	if _, err := admin.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP DATABASE " + name)
	db, err := sql.Open("mysql", "root@unix("+socket+")/"+name+"?parseTime=true")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exec := func(statement string) {
		t.Helper()
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	schema, err := os.ReadFile("../../../../assets/docs/assets_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"asset_category_groups", "product_assets", "asset_events", "technology_bases", "product_asset_bases", "asset_items", "product_asset_resources", "asset_documents"} {
		ddl := regexp.MustCompile("(?s)CREATE TABLE IF NOT EXISTS `" + table + "` \\(.*?\\) ENGINE=.*?;").FindString(string(schema))
		if ddl == "" {
			t.Fatalf("missing canonical DDL: %s", table)
		}
		exec(ddl)
	}

	// Reproduce the previous canonical schema, then exercise both upgrade and replay.
	exec(`ALTER TABLE product_assets DROP COLUMN build_stage, DROP COLUMN current_version, DROP COLUMN target_version, DROP COLUMN productization_value_level, DROP COLUMN supported_terminals, DROP COLUMN covered_legacy_systems`)
	migration, err := os.ReadFile("../../../../assets/docs/migrations/20260909_product_master_runtime_fields.sql")
	if err != nil {
		t.Fatal(err)
	}
	conn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for repeat := 0; repeat < 2; repeat++ {
		for _, statement := range strings.Split(string(migration), ";") {
			if strings.TrimSpace(statement) != "" {
				if _, err := conn.ExecContext(context.Background(), statement); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	conn.Close()
	base := &compat.Adapter{}
	field := reflect.ValueOf(base).Elem().FieldByName("db")
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	adapter := &Adapter{Adapter: base}
	q := url.Values{"current_user": {"u1"}, assetsObjectAccessQueryKey: {"relation"}, assetsPermissionActionQueryKey: {"edit"}, assetsScopeUnitsQueryKey: {`[{"directRelation":true,"projectCodes":["P1"]}]`}}
	id, err := adapter.createProduct(context.Background(), map[string]any{"product_code": "PROD1", "product_name": "Product", "business_owner_uid": "u1", "project_code": "P1"}, q)
	if err != nil {
		t.Fatal(err)
	}
	if err := adapter.updateProduct(context.Background(), id, map[string]any{"project_code": "OTHER"}, q); err == nil {
		t.Fatal("out of scope update allowed")
	}
	var project string
	if err := db.QueryRow("SELECT project_code FROM product_assets WHERE id=?", id).Scan(&project); err != nil || project != "P1" {
		t.Fatalf("rollback %s %v", project, err)
	}
	if _, err := adapter.createProduct(context.Background(), map[string]any{"product_code": "PROD2", "business_owner_uid": "other", "project_code": "P1"}, q); err == nil {
		t.Fatal("out of scope creation allowed")
	}
	var products, events int
	if err := db.QueryRow("SELECT COUNT(*) FROM product_assets").Scan(&products); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM asset_events").Scan(&events); err != nil {
		t.Fatal(err)
	}
	if products != 1 || events != 1 {
		t.Fatalf("partial writes: products=%d events=%d", products, events)
	}
	exec(`INSERT INTO technology_bases(id,base_code,base_name,base_type,owner_uid,project_code) VALUES(1,'B1','Base 1','platform','u1','P1'),(2,'B2','Base 2','platform','other','P1')`)
	q.Set("current_user_product_target_access", "relation")
	q.Set("current_user_product_target_units", `[{"directRelation":true,"projectCodes":["P1"]}]`)
	if err := adapter.linkProductBase(context.Background(), id, map[string]any{"technology_base_id": 2}, q); err == nil {
		t.Fatal("out of scope target linked")
	}
	checkRelations := func(wantLinks, wantEvents int) {
		t.Helper()
		var links, events int
		if err := db.QueryRow("SELECT COUNT(*) FROM product_asset_bases").Scan(&links); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRow("SELECT COUNT(*) FROM asset_events").Scan(&events); err != nil {
			t.Fatal(err)
		}
		if links != wantLinks || events != wantEvents {
			t.Fatalf("links=%d events=%d", links, events)
		}
	}
	checkRelations(0, 1)
	exec(`CREATE TRIGGER reject_product_relation_audit BEFORE INSERT ON asset_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected audit failure'`)
	if err := adapter.linkProductBase(context.Background(), id, map[string]any{"technology_base_id": 1}, q); err == nil {
		t.Fatal("audit failure ignored")
	}
	checkRelations(0, 1)
	exec(`DROP TRIGGER reject_product_relation_audit`)
	if err := adapter.linkProductBase(context.Background(), id, map[string]any{"technology_base_id": 1}, q); err != nil {
		t.Fatal(err)
	}
	checkRelations(1, 2)

	exec(`INSERT INTO asset_items(id,asset_code,asset_name,asset_subtype,dept_code,project_code,owner_uid,status,archived_at) VALUES(1,'A1','Asset 1','server','D1','P1','u1','active',NULL),(2,'A2','Asset 2','server','D1','P2','u1','active',NULL),(3,'A3','Archived','server','D1','P1','u1','active',NOW())`)
	q.Set("current_user_product_target_units", `[{"projectCodes":["P1"]}]`)
	for _, targetID := range []int{2, 3} {
		if err := adapter.linkProductAsset(context.Background(), id, map[string]any{"asset_id": targetID}, q); err == nil {
			t.Fatal("inaccessible asset linked", targetID)
		}
	}
	exec(`CREATE TRIGGER reject_product_asset_audit BEFORE INSERT ON asset_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected audit failure'`)
	if err := adapter.linkProductAsset(context.Background(), id, map[string]any{"asset_id": 1}, q); err == nil {
		t.Fatal("asset audit failure ignored")
	}
	var assetLinks int
	if err := db.QueryRow("SELECT COUNT(*) FROM product_asset_resources").Scan(&assetLinks); err != nil || assetLinks != 0 {
		t.Fatalf("asset rollback %d %v", assetLinks, err)
	}
	checkRelations(1, 2)
	exec(`DROP TRIGGER reject_product_asset_audit`)
	if err := adapter.linkProductAsset(context.Background(), id, map[string]any{"asset_id": 1}, q); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM product_asset_resources").Scan(&assetLinks); err != nil || assetLinks != 1 {
		t.Fatalf("asset commit %d %v", assetLinks, err)
	}
	checkRelations(1, 3)

	documentUUID := "00000000-0000-4000-8000-000000000001"
	q.Set("current_user_product_document_actor", "u1")
	q.Set("current_user_product_document_id", strconv.FormatInt(id, 10))
	q.Set("current_user_product_document_code", "PROD1")
	q.Set("current_user_product_document_uuid", documentUUID)
	q.Set("current_user_product_document_expires", strconv.FormatInt(time.Now().Add(-time.Second).UnixMilli(), 10))
	documentBody := map[string]any{"document_id": documentUUID, "document_type": "design", "remark": "Original"}
	if err := adapter.linkProductDocument(context.Background(), id, documentBody, q); err == nil {
		t.Fatal("expired proof allowed")
	}
	q.Set("current_user_product_document_expires", strconv.FormatInt(time.Now().Add(10*time.Second).UnixMilli(), 10))
	q.Set("current_user_product_document_code", "OTHER")
	if err := adapter.linkProductDocument(context.Background(), id, documentBody, q); err == nil {
		t.Fatal("wrong product proof allowed")
	}
	q.Set("current_user_product_document_code", "PROD1")
	var documents int
	if err := db.QueryRow("SELECT COUNT(*) FROM asset_documents").Scan(&documents); err != nil || documents != 0 {
		t.Fatalf("unauthorized document persisted: %d %v", documents, err)
	}
	for repeat := 0; repeat < 2; repeat++ {
		if err := adapter.linkProductDocument(context.Background(), id, documentBody, q); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM asset_documents").Scan(&documents); err != nil || documents != 1 {
		t.Fatalf("duplicate document: %d %v", documents, err)
	}
	exec(`CREATE TRIGGER reject_product_document_update BEFORE UPDATE ON asset_documents FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected document write failure'`)
	documentBody["remark"] = "Changed"
	if err := adapter.linkProductDocument(context.Background(), id, documentBody, q); err == nil {
		t.Fatal("document write failure ignored")
	}
	var remark, linkedBy string
	if err := db.QueryRow("SELECT remark,linked_by FROM asset_documents").Scan(&remark, &linkedBy); err != nil || remark != "Original" || linkedBy != "u1" {
		t.Fatalf("document changed: %s %s %v", remark, linkedBy, err)
	}

	// Real paginated reads must keep all filtered totals, even on empty pages.
	exec(`UPDATE product_assets SET product_line='platform',status='mvp'`)
	exec(`INSERT INTO product_assets(product_code,product_name,product_line,status,business_owner_uid,project_code,customer_domain,business_domain) VALUES
	('PROD3','Second','platform','mvp','u1','P1','',''),
	('PROD4','Other category','other','mvp','u1','P1','',''),
	('PROD5','Other owner','platform','mvp','other','P1','',''),
	('PROD6','Other project','platform','mvp','u1','P2','','')`)
	q.Set("pageSize", "1")
	q.Set("product_line", "platform")
	q.Set("sortBy", "code")
	q.Set("sortOrder", "asc")
	for page, want := range []string{"PROD1", "PROD3", ""} {
		q.Set("page", strconv.Itoa(page+1))
		result, err := adapter.listProducts(context.Background(), q)
		if err != nil {
			t.Fatal(err)
		}
		if result["total"] != int64(2) {
			t.Fatalf("filtered total: %#v", result)
		}
		items := result["items"].([]map[string]any)
		if want == "" {
			if len(items) != 0 {
				t.Fatal("expected empty page")
			}
		} else if len(items) != 1 || items[0]["product_code"] != want {
			t.Fatalf("page order: %#v", items)
		}
	}

}
