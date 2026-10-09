package assets

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
	"unsafe"

	_ "github.com/go-sql-driver/mysql"
)

func TestMySQLProductAdoptionAuthorizedSnapshot(t *testing.T) {
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
	name := fmt.Sprintf("hzy_assets_adoption_%d", time.Now().UnixNano())
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
	for _, table := range []string{"asset_environments", "customer_delivery_assets", "customer_delivery_asset_environment_rel"} {
		ddl := regexp.MustCompile("(?s)CREATE TABLE IF NOT EXISTS `" + table + "` \\(.*?\\) ENGINE=.*?;").FindString(string(schema))
		if ddl == "" {
			t.Fatalf("missing canonical DDL: %s", table)
		}
		exec(ddl)
	}
	exec(`INSERT INTO asset_environments(id,environment_code,environment_name,environment_type,owner_uid,dept_code,project_code) VALUES
 (1,'ENV1','Environment 1','customer_prod','U1','D1','P1'),
 (2,'ENV2','Environment 2','customer_test','U2','D2','P2')`)
	exec(`INSERT INTO customer_delivery_assets(id,delivery_asset_code,customer_code,product_code,product_name,responsible_uid,responsible_dept_code,project_code) VALUES
 (1,'DA1','CU1','PROD','Product','U1','D1','P1'),
 (2,'DA2','CU2','PROD','Product','U2','D2','P2'),
 (3,'DA3','CU3','prod','Other product','U1','D1','P1'),
 (4,'DA4','CU4','PROD','Deleted product','U1','D1','P1')`)
	exec(`UPDATE customer_delivery_assets SET deleted_at=CURRENT_TIMESTAMP WHERE id=4`)
	exec(`INSERT INTO customer_delivery_asset_environment_rel(delivery_asset_id,environment_id,relation_type,deployment_status,deployed_version) VALUES
 (1,1,'production','online','v1'),(1,1,'primary','accepted','v2'),
 (1,2,'test','deployed',NULL),(2,1,'production','online','v1'),
 (3,1,'production','online','v1'),(4,1,'production','online','v1')`)
	owner := adoptionScopeQuery("U1", "relation", assetsScopeUnit{DirectRelation: true, RelationPredicates: []string{"owner"}})
	all := adoptionScopeQuery("U1", "all")
	read := func() ProductAdoptionPage {
		t.Helper()
		got, err := readProductAdoption(context.Background(), db, "PROD", owner, owner, 1, 1)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	got := read()
	if got.Total != 1 || got.Summary.Customers != 1 || !got.Items[0].VersionConflict {
		t.Fatalf("scope/deletion/product filtering failed: %+v", got)
	}
	// Exercise the actual registered Runtime path with canonical DB tables.
	base := &compat.Adapter{}
	field := reflect.ValueOf(base).Elem().FieldByName("db")
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	adapter := &Adapter{Adapter: base}
	query, body := productAdoptionRuntimeFixture(t)
	raw, operation, routeErr := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/assets/internal/product-adoption:read", query, body)
	if routeErr != nil || operation != "assets.product_adoption.read" {
		t.Fatalf("runtime: %s %v", operation, routeErr)
	}
	page := raw.(map[string]any)["data"].(ProductAdoptionPage)
	if page.Total != 1 || !page.Items[0].VersionConflict {
		t.Fatalf("runtime result: %+v", page)
	}
	global, err := readProductAdoption(context.Background(), db, "PROD", all, all, 2, 1)
	if err != nil || global.Total != 3 || global.Summary.Customers != 2 || len(global.Items) != 1 || global.Items[0].EnvironmentCode != "ENV2" {
		t.Fatalf("global page: %+v %v", global, err)
	}
	exec(`UPDATE customer_delivery_asset_environment_rel SET deleted_at=CURRENT_TIMESTAMP WHERE delivery_asset_id=1 AND environment_id=1 AND relation_type='primary'`)
	if got = read(); got.Total != 1 || got.Items[0].VersionConflict {
		t.Fatal("deleted role still contributes version")
	}
	for _, change := range []string{
		"effective_from=DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 DAY)",
		"effective_from=NULL, effective_to=DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 DAY)",
		"effective_to=NULL, status='ended'",
	} {
		exec("UPDATE customer_delivery_asset_environment_rel SET " + change + " WHERE delivery_asset_id=1 AND environment_id=1 AND relation_type='production'")
		if got = read(); got.Total != 0 || got.Summary.Instances != 0 {
			t.Fatalf("inactive relation counted: %s %+v", change, got)
		}
	}
	exec(`UPDATE customer_delivery_asset_environment_rel SET status='active' WHERE delivery_asset_id=1 AND environment_id=1 AND relation_type='production'`)
	exec(`UPDATE asset_environments SET owner_uid='U2' WHERE id=1`)
	if got = read(); got.Total != 0 {
		t.Fatal("revoked environment owner retains access")
	}
}
