package aims

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestEnterpriseAccessibleProjectDocumentsMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ACCESSIBLE_PROJECT_DOCUMENT_SOCKET")
	if socket == "" {
		t.Skip("isolated MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.Net = "unix"
	mc.Addr = socket
	mc.ParseTime = true
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	name := "hzy_accessible_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	exec := func(db *sql.DB, q string) {
		t.Helper()
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	exec(root, "CREATE DATABASE "+name)
	defer exec(root, "DROP DATABASE "+name)
	mc.DBName = name
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	source, err := os.ReadFile("../../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	exec(db, "SET FOREIGN_KEY_CHECKS=0")
	for _, ddl := range regexp.MustCompile("(?ms)^CREATE TABLE IF NOT EXISTS `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(source), -1) {
		exec(db, ddl[0])
	}
	exec(db, "SET FOREIGN_KEY_CHECKS=1")
	db.SetMaxOpenConns(8)
	exec(db, "INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by) VALUES(1,'P1','Project','P1','U1','U1'),(2,'P2','Other','P2','U4','U4')")
	exec(db, "INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(1,'U1','manager','active'),(2,'U4','manager','active')")
	var port int
	if err = root.QueryRow("SELECT @@port").Scan(&port); err != nil {
		t.Fatal(err)
	}
	secret := uuid.NewString()
	exec(root, "CREATE USER 'hzy_accessible'@'127.0.0.1' IDENTIFIED BY '"+secret+"'")
	defer exec(root, "DROP USER 'hzy_accessible'@'127.0.0.1'")
	exec(root, "GRANT ALL ON "+name+".* TO 'hzy_accessible'@'127.0.0.1'")
	base, err := New(config.AimsConfig{DB: config.DBConfig{Host: "127.0.0.1", Port: port, User: "hzy_accessible", Password: secret, Database: name}})
	if err != nil {
		t.Fatal(err)
	}
	defer base.DB().Close()
	a := base
	ctx := context.Background()
	exec(db, "UPDATE aims_projects SET security_level='project_team' WHERE id=2")
	exec(db, "INSERT INTO project_documents(id,uuid,project_id,project_code,title,is_folder,created_by) VALUES(1,'11111111-1111-4111-8111-111111111111',1,'P1','folder',1,'U1')")
	exec(db, "INSERT INTO project_documents(id,uuid,codocs_uuid,project_id,project_code,parent_id,title,created_by) VALUES(2,'22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222',1,'P1',1,'spec','U1')")
	exec(db, "INSERT INTO project_documents(id,uuid,project_id,project_code,title,document_source,repo_project_code,repo_file_path,created_by) VALUES(3,'33333333-3333-4333-8333-333333333333',1,'P1','repo','repo','R1','docs/spec.md','U1')")
	for i := 1; i <= 101; i++ {
		exec(db, fmt.Sprintf("INSERT INTO deliverables(project_owner_id,project_id,project_code,name,deliverable_type,document_uuid,created_by) VALUES(1,1,'P1','fixture','document','%08d-4444-4444-8444-444444444444','U1')", i))
	}
	calls := 0
	check := func(_ context.Context, doc, ref string, f EnterpriseProjectDocumentAccessFacts) (map[string]any, error) {
		calls++
		if f.ActorUID != "U1" || f.ProjectCode != "P1" || len(f.Roles) != 1 || f.Roles[0] != "project_manager" {
			t.Fatal("untrusted facts", f)
		}
		return map[string]any{"allowed": true, "readonly": true, "reason": "source_project_member", "permission": "view", "lifecycleStage": "draft", "confidentialityLevel": "L2"}, nil
	}
	out, err := a.ListEnterpriseAccessibleProjectDocuments(ctx, "1", "U1", nil, false, check)
	if err != nil {
		t.Fatal(err)
	}
	if out["total"] != 103 || len(out["items"].([]map[string]any)) != 104 || calls != 102 {
		t.Fatalf("pagination/candidates incorrect: total=%v calls=%d", out["total"], calls)
	}
	calls = 0
	if _, err = a.ListEnterpriseAccessibleProjectDocuments(ctx, "2", "U1", nil, false, check); err == nil || calls != 0 {
		t.Fatal("private project read or ACL call allowed")
	}
	exec(db, "INSERT INTO project_documents(id,uuid,codocs_uuid,project_id,project_code,title,created_by) VALUES(4,'44444444-4444-4444-8444-444444444444','44444444-4444-4444-8444-444444444444',2,'P2','admin fixture','U4')")
	adminCalls := 0
	adminOut, e := a.ListEnterpriseAccessibleProjectDocuments(ctx, "2", "U1", nil, true, func(_ context.Context, _ string, _ string, f EnterpriseProjectDocumentAccessFacts) (map[string]any, error) {
		adminCalls++
		if f.Roles[0] != "project_manager" {
			t.Fatal("admin not manager")
		}
		return map[string]any{"allowed": true}, nil
	})
	if e != nil || adminOut == nil || adminCalls != 1 {
		t.Fatal("scoped non-member admin denied", e)
	}
	// The project-bound admin fact must not expose unrelated project codes.

	calls = 0
	out, err = a.ListEnterpriseAccessibleProjectDocuments(ctx, "1", "U1", nil, false, func(context.Context, string, string, EnterpriseProjectDocumentAccessFacts) (map[string]any, error) {
		calls++
		if calls == 2 {
			return nil, errors.New("dependency failed")
		}
		return map[string]any{"allowed": true}, nil
	})
	if err == nil || out != nil {
		t.Fatal("partial result after dependency failure")
	}
}
