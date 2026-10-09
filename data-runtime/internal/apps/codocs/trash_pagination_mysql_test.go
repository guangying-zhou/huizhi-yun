package codocs

import (
	"context"
	"database/sql"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTrashPaginationIsolatedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_TRASH_PAGINATION_SOCKET")
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
	name := "trash_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	exec("CREATE TABLE documents(id BIGINT PRIMARY KEY,uuid VARCHAR(40),title VARCHAR(100),doc_type VARCHAR(40),oss_path VARCHAR(100),owner_uid VARCHAR(40),dept_code VARCHAR(40),project_code VARCHAR(40),folder_id BIGINT,content_size BIGINT,last_editor_uid VARCHAR(40),created_at DATETIME,updated_at DATETIME,deleted_at DATETIME,status INT)")
	exec("CREATE TABLE folders(id BIGINT PRIMARY KEY,name VARCHAR(100))")
	exec("CREATE TABLE document_shares(document_id BIGINT,shared_to_uid VARCHAR(40))")
	exec("CREATE TABLE document_relations(document_id BIGINT,related_uid VARCHAR(40),status INT,can_read INT,source_type VARCHAR(40),updated_at DATETIME)")
	exec("INSERT INTO documents(id,uuid,title,doc_type,owner_uid,status,deleted_at) VALUES(1,'one','Owner','private','viewer',0,'2026-01-01'),(2,'two','Shared','private','other',0,'2026-01-01'),(3,'three','Related','private','other',0,'2026-01-01'),(4,'four','Hidden','private','other',0,'2026-01-01'),(5,'five','Active','private','viewer',1,NULL),(6,'six','Expired preview','private','other',0,'2026-01-01')")
	exec("INSERT INTO document_shares VALUES(2,'viewer')")
	exec("INSERT INTO document_relations VALUES(3,'viewer',1,1,'share',NOW()),(6,'viewer',1,1,'project_preview_access',DATE_SUB(NOW(),INTERVAL 13 HOUR))")
	adapter := &Adapter{db: db}
	q := trustedDocumentListQuery("viewer")
	legacy, e := adapter.documentsTrash(context.Background(), q)
	if e != nil || legacy["total"] != 3 || legacy["pageSize"] != 3 {
		t.Fatal(legacy, e)
	}
	q.Set("page", "2")
	q.Set("pageSize", "2")
	out, e := adapter.documentsTrash(context.Background(), q)
	if e != nil || out["total"] != int64(3) || out["page"] != 2 || len(out["items"].([]map[string]any)) != 1 {
		t.Fatal(out, e)
	}
	q.Set("page", "9")
	out, e = adapter.documentsTrash(context.Background(), q)
	if e != nil || out["total"] != int64(3) || len(out["items"].([]map[string]any)) != 0 {
		t.Fatal(out, e)
	}
	q.Set("owner", "viewer")
	out, e = adapter.documentsTrash(context.Background(), q)
	if e != nil || out["total"] != int64(1) {
		t.Fatal(out, e)
	}
	q.Del("owner")
	exec("DELETE FROM document_shares WHERE document_id=2")
	out, e = adapter.documentsTrash(context.Background(), q)
	if e != nil || out["total"] != int64(2) {
		t.Fatal("revoked share count", out, e)
	}
}
