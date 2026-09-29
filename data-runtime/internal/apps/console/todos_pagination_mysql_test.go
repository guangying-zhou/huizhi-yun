package console

import (
	"context"
	"database/sql"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTodoPaginationIsolatedMySQL(t *testing.T) {
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
	name := "todo_page_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e = root.Exec("CREATE DATABASE " + name); e != nil {
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

	exec("CREATE TABLE portal_notifications(notification_id VARCHAR(40) PRIMARY KEY,category VARCHAR(40),severity VARCHAR(40),expires_at DATETIME)")
	exec("CREATE TABLE portal_actionable_projections(id BIGINT PRIMARY KEY,current_notification_id VARCHAR(40),uid VARCHAR(40),state VARCHAR(40),source_app_code VARCHAR(40),target_app_code VARCHAR(40),created_at DATETIME,updated_at DATETIME)")
	exec("INSERT INTO portal_notifications VALUES('N1','approval','info',NULL),('N2','approval','info',NULL),('N3','project-risk','warning',NULL),('N4','receivable','info',NULL),('N5','system','info',NULL),('N6','approval','info','2000-01-01'),('N7','approval','info',NULL),('N8','approval','info',NULL)")
	exec("INSERT INTO portal_actionable_projections VALUES(1,'N1','viewer','pending','aims','enterprise','2026-01-01','2026-01-01'),(2,'N2','viewer','pending','aims','enterprise','2026-01-01','2026-01-01'),(3,'N3','viewer','pending','aims','enterprise','2026-01-01','2026-01-01'),(4,'N4','viewer','pending','altoc','enterprise','2026-01-01','2026-01-01'),(5,'N5','viewer','pending','console','enterprise','2026-01-01','2026-01-01'),(6,'N6','viewer','pending','aims','enterprise','2026-01-01','2026-01-01'),(7,'N7','other','pending','aims','enterprise','2026-01-01','2026-01-01'),(8,'N8','viewer','closed','aims','enterprise','2026-01-01','2026-01-01')")
	a := NewWithDB(config.ConsoleConfig{}, "C000001", db)
	ctx := context.Background()
	read := func(q url.Values) map[string]any {
		t.Helper()
		r, e := a.UserNotificationTodos(ctx, "viewer", q)
		if e != nil {
			t.Fatal(e)
		}
		return r["data"].(map[string]any)
	}
	legacy := read(url.Values{})
	if len(legacy) != 2 || len(legacy["items"].([]map[string]any)) != 5 {
		t.Fatal(legacy)
	}
	var counts map[string]uint64
	for _, page := range []string{"1", "2", "9"} {
		d := read(url.Values{"page": {page}, "pageSize": {"1"}, "todoKind": {"approval"}})
		counts = d["kindCounts"].(map[string]uint64)
		if d["total"] != uint64(2) || d["totalPending"] != uint64(5) || counts["approval"] != 2 || counts["risk"] != 1 || counts["due"] != 1 || counts["follow_up"] != 1 {
			t.Fatal(d)
		}
		items := d["items"].([]map[string]any)
		if page == "9" {
			if len(items) != 0 {
				t.Fatal(d)
			}
		} else if len(items) != 1 || items[0]["notificationId"] != map[string]string{"1": "N2", "2": "N1"}[page] {
			t.Fatal(d)
		}
	}
	d := read(url.Values{"page": {"1"}, "sourceAppCode": {"aims"}})
	if d["total"] != uint64(3) || d["totalPending"] != uint64(3) {
		t.Fatal(d)
	}
	exec("UPDATE portal_actionable_projections SET state='closed' WHERE id=2")
	d = read(url.Values{"page": {"1"}, "todoKind": {"approval"}})
	if d["total"] != uint64(1) {
		t.Fatal(d)
	}
}
