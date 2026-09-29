package directory

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

func TestConsoleSyncPaginationIsolatedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_SYNC_PAGINATION_SOCKET")
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
	name := "sync_page_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	exec("CREATE TABLE directory_sync_jobs(job_code VARCHAR(40) PRIMARY KEY,provider_code VARCHAR(40),sync_type VARCHAR(40),object_scope VARCHAR(40),cursor_before VARCHAR(40),cursor_after VARCHAR(40),status VARCHAR(40),started_at DATETIME,finished_at DATETIME,requested_by VARCHAR(40),total_count BIGINT,created_count BIGINT,updated_count BIGINT,deleted_count BIGINT,skipped_count BIGINT,error_count BIGINT,error_message TEXT,created_at DATETIME NOT NULL,updated_at DATETIME NOT NULL)")
	exec("CREATE TABLE directory_sync_events(id BIGINT PRIMARY KEY,job_code VARCHAR(40),object_type VARCHAR(40),object_code VARCHAR(40),change_type VARCHAR(40),source_provider VARCHAR(40),external_ref VARCHAR(40),status VARCHAR(40),message TEXT,before_hash VARCHAR(40),after_hash VARCHAR(40),created_at DATETIME NOT NULL)")
	for _, code := range []string{"J1", "J2", "J3"} {
		exec("INSERT INTO directory_sync_jobs(job_code,provider_code,sync_type,object_scope,status,total_count,created_count,updated_count,deleted_count,skipped_count,error_count,created_at,updated_at) VALUES('" + code + "','manual','full','users','success',999,0,0,0,0,0,'2026-01-01','2026-01-01')")
	}
	exec("INSERT INTO directory_sync_events(id,job_code,object_type,object_code,change_type,source_provider,status,created_at) VALUES(1,'J1','user','U1','update','manual','success','2026-01-01'),(2,'J1','user','U2','update','manual','success','2026-01-01'),(3,'J2','user','OTHER','update','manual','success','2026-01-01')")
	a := &Adapter{db: db}
	ctx := context.Background()
	legacy, e := a.ConsoleDirectorySyncJobs(ctx, url.Values{})
	if e != nil || len(legacy.([]map[string]any)) != 3 {
		t.Fatal(legacy, e)
	}
	result, e := a.ConsoleDirectorySyncJobs(ctx, url.Values{"page": {"2"}, "pageSize": {"2"}})
	if e != nil {
		t.Fatal(e)
	}
	page := result.(map[string]any)
	if page["total"] != int64(3) || page["items"].([]map[string]any)[0]["jobCode"] != "J1" || page["items"].([]map[string]any)[0]["totalCount"] != int64(999) {
		t.Fatal(page)
	}
	events, e := a.ConsoleDirectorySyncEvents(ctx, "J1", url.Values{"page": {"2"}, "pageSize": {"1"}})
	if e != nil {
		t.Fatal(e)
	}
	page = events.(map[string]any)
	if page["total"] != int64(2) || page["items"].([]map[string]any)[0]["objectCode"] != "U1" {
		t.Fatal(page)
	}
	events, e = a.ConsoleDirectorySyncEvents(ctx, "J1", url.Values{"page": {"9"}, "pageSize": {"1"}})
	if e != nil || len(events.(map[string]any)["items"].([]map[string]any)) != 0 {
		t.Fatal(events, e)
	}
	if _, e = a.ConsoleDirectorySyncEvents(ctx, "MISSING", url.Values{"page": {"1"}}); e == nil {
		t.Fatal("missing job accepted")
	}
	// A concurrent insertion after COUNT cannot alter the page's RR snapshot.
	conn, tx, total, e := a.consoleSyncSnapshot(ctx, true, "directory_sync_events", " WHERE job_code=?", []any{"J1"})
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback()
	exec("INSERT INTO directory_sync_events(id,job_code,object_type,object_code,change_type,source_provider,status,created_at) VALUES(4,'J1','user','NEW','update','manual','success','2026-01-01')")
	rows, e := conn.QueryContext(ctx, "SELECT id FROM directory_sync_events WHERE job_code=? ORDER BY id DESC", "J1")
	if e != nil {
		t.Fatal(e)
	}
	n := 0
	for rows.Next() {
		n++
	}
	rows.Close()
	tx.Commit()
	if total != int64(n) || n != 2 {
		t.Fatal(total, n)
	}
}

// Console schemas default to utf8mb4_0900_ai_ci while directory tables use
// utf8mb4_unicode_ci; the LDAP full-sync temporary table must join cleanly.
func TestLDAPFullSyncTempTableCollationIsolatedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_SYNC_PAGINATION_SOCKET")
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
	root, e := sql.Open("mysql", cfg.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	defer root.Close()
	name := "ldap_coll_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e = root.Exec("CREATE DATABASE " + name + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"); e != nil {
		t.Fatal(e)
	}
	defer root.Exec("DROP DATABASE " + name)
	cfg.DBName = name
	db, e := sql.Open("mysql", cfg.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if _, e = db.Exec(`CREATE TABLE directory_users (id BIGINT AUTO_INCREMENT PRIMARY KEY, external_ref VARCHAR(255) NULL,
		source_provider VARCHAR(32) NOT NULL, status VARCHAR(32) NOT NULL, synced_at DATETIME NULL, updated_at DATETIME NULL)
		DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(`INSERT INTO directory_users (external_ref, source_provider, status) VALUES ('cn=keep','ldap','active'),('cn=gone','ldap','active')`); e != nil {
		t.Fatal(e)
	}
	tx, e := db.Begin()
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback()
	for _, q := range []string{ldapExternalRefsTempTableDDL, "INSERT INTO tmp_hzy_ldap_external_refs (external_ref) VALUES ('cn=keep')"} {
		if _, e = tx.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	res, e := tx.Exec(ldapMarkMissingUsersDeletedSQL)
	if e != nil {
		t.Fatalf("full-sync join failed: %v", e)
	}
	if n, _ := res.RowsAffected(); n != 1 {
		t.Fatalf("expected exactly the missing LDAP user to be deleted, got %d", n)
	}
}
