package workflow

import (
	"context"
	"database/sql"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorkflowPendingPaginationIsolatedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_PENDING_PAGINATION_SOCKET")
	if socket == "" {
		t.Skip("temporary MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	cfg := mysql.NewConfig()
	cfg.User = "root"
	cfg.Net = "unix"
	cfg.Addr = socket
	cfg.ParseTime = true
	root, e := sql.Open("mysql", cfg.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	defer root.Close()
	name := "pending_page_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e = root.Exec("CREATE DATABASE " + name + " CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"); e != nil {
		t.Fatal(e)
	}
	defer root.Exec("DROP DATABASE " + name)
	cfg.DBName = name
	db, e := sql.Open("mysql", cfg.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	exec := func(q string) {
		t.Helper()
		if _, e := db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}

	exec("CREATE TABLE flow_instances(id BIGINT PRIMARY KEY,instance_no VARCHAR(40),app_code VARCHAR(40),resource_code VARCHAR(40),action_code VARCHAR(40),biz_title VARCHAR(40),biz_url VARCHAR(40),initiator_uid VARCHAR(40),status VARCHAR(40),action_def_id BIGINT)")
	exec("CREATE TABLE flow_tasks(id BIGINT PRIMARY KEY,instance_id BIGINT,assignee_uid VARCHAR(40),status VARCHAR(40),node_name VARCHAR(40),task_type VARCHAR(40),created_at DATETIME,due_at DATETIME)")
	exec("CREATE TABLE flow_action_defs(id BIGINT PRIMARY KEY,name VARCHAR(40))")
	exec("INSERT INTO flow_instances VALUES(1,'I1','aims','tasks','complete','valid','/none','other','running',NULL),(2,'I2','aims','tasks','complete','self','/none','viewer','running',NULL),(3,'I3','aims','projects','complete','wrong resource','/none','other','running',NULL),(4,'I4','aims','tasks','approve','wrong action','/none','other','running',NULL),(5,'I5','altoc','tasks','complete','wrong app','/none','other','running',NULL),(6,'I6','aims','tasks','complete','stopped','/none','other','completed',NULL),(7,'I7','aims','tasks','complete','null initiator','/none',NULL,'running',NULL)")
	exec("INSERT INTO flow_tasks VALUES(1,1,'viewer','pending','N','approval','2026-01-01',NULL),(2,2,'viewer','pending','N','approval','2026-01-01',NULL),(3,3,'viewer','pending','N','approval','2026-01-01',NULL),(4,4,'viewer','pending','N','approval','2026-01-01',NULL),(5,5,'viewer','pending','N','approval','2026-01-01',NULL),(6,6,'viewer','pending','N','approval','2026-01-01',NULL),(7,1,'outsider','pending','N','approval','2026-01-01',NULL),(8,1,'viewer','completed','N','approval','2026-01-01',NULL),(9,7,'viewer','pending','N','approval','2026-01-01',NULL)")
	exec("INSERT INTO flow_instances VALUES(10,'I10','AIMS','tasks','complete','case app','/none','other','running',NULL),(11,'I11','aims','TASKS','complete','case resource','/none','other','running',NULL),(12,'I12','aims','tasks','complete ','trailing action','/none','other','running',NULL)")
	exec("INSERT INTO flow_tasks VALUES(10,10,'viewer','pending','N','approval','2026-01-01',NULL),(11,11,'viewer','pending','N','approval','2026-01-01',NULL),(12,12,'viewer','pending','N','approval','2026-01-01',NULL)")
	a := &Adapter{db: db}
	ctx := context.Background()
	q := url.Values{"current_user": {"viewer"}, "app_code": {"aims"}, "resource_code": {"tasks"}, "action_code": {"complete"}, "exclude_initiator": {"true"}, "pageSize": {"1"}}
	read := func() map[string]any {
		t.Helper()
		r, _, e := a.listTasks(ctx, q, "pending")
		if e != nil {
			t.Fatal(e)
		}
		return r.Data.(map[string]any)
	}
	for _, page := range []string{"1", "2", "9"} {
		q.Set("page", page)
		d := read()
		if d["total"] != int64(2) {
			t.Fatal(d)
		}
		items := d["items"].([]map[string]any)
		if page == "9" {
			if len(items) != 0 {
				t.Fatal(d)
			}
		} else if len(items) != 1 || items[0]["task_id"] != map[string]int64{"1": 9, "2": 1}[page] {
			t.Fatal(d)
		}
	}
	// Current facts are evaluated on every read: a reassignment removes the row
	// from both total and page; a self-initiated row is never counted.
	exec("UPDATE flow_tasks SET assignee_uid='other' WHERE id=9")
	q.Set("page", "1")
	d := read()
	if d["total"] != int64(1) {
		t.Fatal(d)
	}
	q.Set("current_user", "outsider")
	d = read()
	if d["total"] != int64(1) || d["items"].([]map[string]any)[0]["task_id"] != int64(7) {
		t.Fatal(d)
	}
	q = url.Values{"current_user": {"viewer"}, "page_size": {"20"}}
	d = read()
	if len(d) != 2 {
		t.Fatal("legacy shape changed", d)
	}
}
