package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"unsafe"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
)

func TestWorkItemPaginationIsolatedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_WORK_ITEM_PAGINATION_SOCKET")
	if socket == "" {
		t.Skip("temporary MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	cfg := mysql.NewConfig()
	cfg.User, cfg.Net, cfg.Addr, cfg.ParseTime = "root", "unix", socket, true
	root, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	database := "work_page_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := root.Exec("CREATE DATABASE " + database); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE " + database)
	cfg.DBName = database
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
	}
	schema, err := os.ReadFile("../../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	exec("SET FOREIGN_KEY_CHECKS=0")
	tables := regexp.MustCompile("(?ms)^CREATE TABLE IF NOT EXISTS `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(schema), -1)
	if len(tables) < 30 {
		t.Fatal("canonical schema incomplete")
	}
	for _, table := range tables {
		exec(table[0])
	}
	exec("SET FOREIGN_KEY_CHECKS=1")
	db.SetMaxOpenConns(5)
	exec("INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by) VALUES(1,'P-1','One','One','u1','u1'),(2,'P-2','Two','Two','u2','u2')")
	exec("UPDATE aims_projects SET security_level='project_team' WHERE id=2")
	for id := 1; id <= 28; id++ {
		status := "todo"
		if id > 25 {
			status = "in_progress"
		}
		var parent any
		if id == 25 {
			parent = 2
		} else if id == 2 {
			parent = 1
		}
		exec("INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status,assignee_uid,reporter_uid,parent_id,sort_order) VALUES(?,1,?,?,'matter','task',?,?, 'u1','u1',?,?)",
			id, id, fmt.Sprintf("P-1-%d", id), fmt.Sprintf("Item %d", id), status, parent, id)
	}
	exec("INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status,assignee_uid) VALUES(100,2,1,'P-2-1','matter','task','Other','todo','u1')")
	base := &compat.Adapter{}
	field := reflect.ValueOf(base).Elem().FieldByName("db")
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	a := &Adapter{Adapter: base}
	ctx := context.Background()
	query := url.Values{"current_user": {"u1"}, "current_user_is_project_admin": {"1"}, "view": {"board"}, "tier": {"matter"}, "status": {"todo"}, "page": {"2"}, "pageSize": {"20"}}
	response, err := a.projectWorkItems(ctx, "1", query)
	if err != nil {
		t.Fatal(err)
	}
	page := response.(map[string]any)
	if page["total"] != int64(25) || len(page["items"].([]map[string]any)) != 5 {
		t.Fatalf("board page %#v", page)
	}
	summary := page["summary"].(map[string]any)
	if summary["total"] != int64(28) || summary["status"].(map[string]int64)["in_progress"] != 3 {
		t.Fatalf("board summary %#v", summary)
	}
	closure := page["ancestors"].([]map[string]any)
	ids := map[int64]bool{}
	for _, item := range closure {
		ids[item["id"].(int64)] = true
	}
	if !ids[1] || !ids[2] {
		t.Fatalf("missing ancestor closure %#v", closure)
	}
	query.Set("quickFilter", "my_assigned")
	filtered, err := a.projectWorkItems(ctx, "1", query)
	if err != nil {
		t.Fatal(err)
	}
	wip := filtered.(map[string]any)["summary"].(map[string]any)["wipStatus"].(map[string]int64)
	if wip["todo"] != 25 {
		t.Fatalf("WIP count %#v", wip)
	}
	listQuery := url.Values{"current_user": {"u1"}, "current_user_is_project_admin": {"1"}, "tier": {"matter"}, "page": {"2"}, "pageSize": {"20"}}
	listed, err := a.projectWorkItems(ctx, "1", listQuery)
	if err != nil {
		t.Fatal(err)
	}
	if listed.(map[string]any)["total"] != int64(28) || len(listed.(map[string]any)["items"].([]map[string]any)) != 8 {
		t.Fatalf("list page %#v", listed)
	}
	direct, err := a.directWorkItems(ctx, url.Values{"current_user": {"u1"}, "tier": {"matter"}, "page": {"2"}, "pageSize": {"20"}})
	if err != nil {
		t.Fatal(err)
	}
	if direct.(map[string]any)["total"] != int64(28) || len(direct.(map[string]any)["items"].([]map[string]any)) != 8 {
		t.Fatalf("direct page %#v", direct)
	}
	mine, err := a.myWorkItems(ctx, url.Values{"current_user": {"u1"}, "uid": {"u1"}, "page": {"2"}, "pageSize": {"20"}, "status": {"todo"}})
	if err != nil {
		t.Fatal(err)
	}
	if mine["total"] != int64(26) || len(mine["items"].([]myWorkItem)) != 6 {
		t.Fatalf("my page %#v", mine)
	}
	mineSummary := mine["summary"].(map[string]any)
	if mineSummary["total"] != int64(29) || mineSummary["projectCount"] != int64(2) || len(mine["projects"].([]map[string]any)) != 2 {
		t.Fatalf("my full summary %#v", mine)
	}
}
