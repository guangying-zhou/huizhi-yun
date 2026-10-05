package codocs

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

func TestCollaborationPaginationIsolatedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_COLLAB_PAGINATION_SOCKET")
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
	name := "collab_page_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	exec("CREATE TABLE documents(id BIGINT PRIMARY KEY,uuid VARCHAR(40),title VARCHAR(100),doc_type VARCHAR(40),oss_path VARCHAR(100),owner_uid VARCHAR(40),dept_code VARCHAR(40),readonly_flag INT,status INT,publish_info TEXT,updated_at DATETIME)")
	exec("CREATE TABLE document_relations(id BIGINT PRIMARY KEY,document_id BIGINT,related_uid VARCHAR(40),status INT,relation_type VARCHAR(40),source_type VARCHAR(40),source_id VARCHAR(40),can_edit INT,metadata JSON)")
	exec("CREATE TABLE document_reviews(id BIGINT PRIMARY KEY,status VARCHAR(40),review_type VARCHAR(40),sub_type VARCHAR(40),execution_status VARCHAR(40),current_node INT,flow_snapshot JSON)")
	exec("CREATE TABLE document_publish_requests(id BIGINT PRIMARY KEY,archive_oss_path VARCHAR(100),workflow_status VARCHAR(40),review_type VARCHAR(40),sub_type VARCHAR(40),execution_status VARCHAR(40),published_document_uuid VARCHAR(40))")
	exec("INSERT INTO documents VALUES(1,'A','First','private','','owner-a','D1',0,1,NULL,'2026-01-01'),(2,'B','Second','private','','owner-b','D2',0,1,NULL,'2026-01-01'),(3,'C','Third','private','','owner-c','D3',0,1,NULL,'2026-01-01'),(4,'HIDDEN','Hidden','private','','secret-owner','SECRET',0,1,NULL,'2026-01-01'),(5,'DELETED','Deleted','private','','secret-owner','SECRET',0,0,NULL,'2026-01-01'),(6,'REVOKED','Revoked','private','','secret-owner','SECRET',0,1,NULL,'2026-01-01')")
	exec("INSERT INTO document_relations(id,document_id,related_uid,status,relation_type,source_type,source_id,can_edit) VALUES(1,1,'viewer',1,'shared_to_me','share','1',1),(2,1,'viewer',1,'shared_by_me','share','2',1),(3,2,'viewer',1,'shared_by_me','share','3',1),(4,3,'viewer',1,'shared_with_me','share','4',1),(5,4,'other',1,'shared_to_me','share','5',1),(6,5,'viewer',1,'shared_to_me','share','6',1),(7,6,'viewer',0,'shared_to_me','share','7',1)")
	a := &Adapter{db: db}
	ctx := context.Background()
	q := url.Values{"current_user": {"viewer"}, "category": {"shared"}, "scope": {"all"}}
	legacy, e := a.collabDocs(ctx, q)
	if e != nil || legacy["total"] != 3 || len(legacy) != 2 {
		t.Fatal(legacy, e)
	}
	q.Set("page", "2")
	q.Set("pageSize", "1")
	q.Set("sharedTab", "received")
	out, e := a.collabDocs(ctx, q)
	if e != nil {
		t.Fatal(e)
	}
	if out["total"] != 2 || out["items"].([]map[string]any)[0]["uuid"] != "A" || len(out["ownerUids"].([]string)) != 2 {
		t.Fatal(out)
	}
	q.Set("sharedTab", "sent")
	out, e = a.collabDocs(ctx, q)
	if e != nil || out["total"] != 2 || out["items"].([]map[string]any)[0]["uuid"] != "A" {
		t.Fatal(out, e)
	}
	q.Set("scope", "participated")
	out, e = a.collabDocs(ctx, q)
	if e != nil || out["total"] != 0 || len(out["items"].([]map[string]any)) != 0 {
		t.Fatal(out, e)
	}
	q.Set("scope", "all")
	q.Set("sharedTab", "received")
	q.Set("dept_code", "D1")
	out, e = a.collabDocs(ctx, q)
	if e != nil || out["total"] != 1 || len(out["items"].([]map[string]any)) != 0 {
		t.Fatal(out, e)
	}
	q.Del("dept_code")
	q.Set("page", "1")
	exec("UPDATE document_relations SET status=0 WHERE document_id=1 AND related_uid='viewer'")
	out, e = a.collabDocs(ctx, q)
	if e != nil || out["total"] != 1 || out["items"].([]map[string]any)[0]["uuid"] != "C" {
		t.Fatal(out, e)
	}
}
