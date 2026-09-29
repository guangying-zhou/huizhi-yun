package codocs

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

func TestPrivateTreePaginationIsolatedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_PRIVATE_TREE_SOCKET")
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
	name := "tree_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	exec := func(query string) {
		t.Helper()
		if _, e = db.Exec(query); e != nil {
			t.Fatal(e)
		}
	}
	exec("CREATE TABLE folders(id BIGINT PRIMARY KEY,name VARCHAR(100),folder_type VARCHAR(20),owner_uid VARCHAR(40),parent_id BIGINT NULL,sort_order INT NOT NULL DEFAULT 0,created_at DATETIME,updated_at DATETIME)")
	exec("CREATE TABLE documents(id BIGINT PRIMARY KEY,uuid VARCHAR(40),title VARCHAR(100),doc_type VARCHAR(40),oss_path VARCHAR(100),owner_uid VARCHAR(40),dept_code VARCHAR(40),project_code VARCHAR(40),folder_id BIGINT,content_size BIGINT,last_editor_uid VARCHAR(40),created_at DATETIME,updated_at DATETIME,status INT,star_flag INT,home_flag INT,readonly_flag INT,publish_info TEXT)")
	exec("CREATE TABLE document_shares(document_id BIGINT,shared_to_uid VARCHAR(40))")
	exec("CREATE TABLE document_relations(document_id BIGINT,related_uid VARCHAR(40),status INT,can_read INT,source_type VARCHAR(40),updated_at DATETIME)")
	exec("INSERT INTO folders(id,name,folder_type,owner_uid,parent_id,created_at,updated_at) VALUES(9,'Parent','private','viewer',NULL,NOW(),NOW()),(42,'Current','private','viewer',9,NOW(),NOW()),(90,'Other','private','other',NULL,NOW(),NOW())")
	for i := 1; i <= 23; i++ {
		exec(fmt.Sprintf("INSERT INTO folders(id,name,folder_type,owner_uid,parent_id,created_at,updated_at) VALUES(%d,'Child %d','private','viewer',42,NOW(),NOW())", 100+i, i))
	}
	for i := 1; i <= 21; i++ {
		exec(fmt.Sprintf("INSERT INTO documents(id,uuid,title,doc_type,oss_path,owner_uid,folder_id,created_at,updated_at,status,star_flag,home_flag,readonly_flag) VALUES(%d,'doc-%d','Doc %d','private','codocs/private/%d.md','viewer',42,NOW(),NOW(),1,0,0,0)", i, i, i, i))
	}
	exec("INSERT INTO documents(id,uuid,title,doc_type,oss_path,owner_uid,folder_id,status) VALUES(99,'hidden','Hidden','private','codocs/private/hidden.md','other',42,1),(98,'worklog','Log','private','codocs/worklogs/a.md','viewer',42,1)")
	adapter := &Adapter{db: db}
	fq := trustedDocumentListQuery("viewer")
	fq.Set("folder_type", "private")
	fq.Set("parent_id", "42")
	fq.Set("page", "2")
	fq.Set("pageSize", "20")
	folders, e := adapter.foldersList(context.Background(), fq)
	if e != nil || folders["total"] != int64(23) || len(folders["items"].([]map[string]any)) != 3 {
		t.Fatal(folders, e)
	}
	chain := folders["parentChain"].([]map[string]any)
	if len(chain) != 2 || chain[0]["id"] != int64(9) || chain[1]["id"] != int64(42) {
		t.Fatal(chain)
	}
	rootFolder := trustedDocumentListQuery("viewer")
	rootFolder.Set("folder_type", "private")
	rootFolder.Set("parent_id", "null")
	rootFolder.Set("pageSize", "20")
	roots, e := adapter.foldersList(context.Background(), rootFolder)
	if e != nil || roots["total"] != int64(1) {
		t.Fatal(roots, e)
	}
	child := roots["items"].([]map[string]any)[0]
	if child["folderCount"] != int64(1) {
		t.Fatal(child)
	}
	fq.Set("parent_id", "90")
	if _, e = adapter.foldersList(context.Background(), fq); e == nil {
		t.Fatal("foreign parent visible")
	}
	dq := trustedDocumentListQuery("viewer")
	dq.Set("type", "private")
	dq.Set("owner", "viewer")
	dq.Set("folder_id", "42")
	dq.Set("exclude_worklogs", "1")
	dq.Set("page", "2")
	dq.Set("pageSize", "20")
	docs, e := adapter.documentsList(context.Background(), dq)
	if e != nil || docs["total"] != int64(21) || len(docs["items"].([]map[string]any)) != 1 {
		t.Fatal(docs, e)
	}
	dq.Set("page", "4")
	docs, e = adapter.documentsList(context.Background(), dq)
	if e != nil || docs["total"] != int64(21) || len(docs["items"].([]map[string]any)) != 0 {
		t.Fatal(docs, e)
	}
}
