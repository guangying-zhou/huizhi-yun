package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
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
	exec(db, "INSERT INTO project_portfolios(id,code,name,created_by) VALUES(9,'P1','portfolio-only','U1')")
	exec(db, "INSERT INTO project_documents(id,uuid,portfolio_id,project_code,title,is_folder,created_by) VALUES(90,'90000000-1111-4111-8111-111111111111',9,'P1','portfolio folder',1,'U1')")
	exec(db, "INSERT INTO project_documents(id,uuid,portfolio_id,project_code,parent_id,title,created_by) VALUES(91,'91000000-1111-4111-8111-111111111111',9,'P1',90,'portfolio child','U1')")
	t.Run("HostRepositoryNamespaceBinding", func(t *testing.T) {
		exec(db, "INSERT INTO aims_project_repos(project_id,repo_project_code) VALUES(1,'huizhi-yun/huizhiyun')")
		out, e := a.EnterpriseProjectDocumentContext(ctx, "1", "", "huizhi-yun/huizhiyun", "U1", false, nil)
		if e != nil || out["isMember"] != true {
			t.Fatalf("linked namespace repository rejected: %v", e)
		}
		for _, repo := range []string{"Huizhi-yun/huizhiyun", "other/huizhiyun"} {
			_, e = a.EnterpriseProjectDocumentContext(ctx, "1", "", repo, "U1", false, nil)
			var failure httperror.Error
			if !errors.As(e, &failure) || failure.Status != 403 || failure.Code != "project_repository_mismatch" {
				t.Fatalf("unlinked or differently cased repository must be denied: %q %v", repo, e)
			}
		}
	})
	t.Run("RepositoryDocumentAccessContext", func(t *testing.T) {
		_, err := a.EnterpriseProjectDocumentContext(ctx, "1", "3", "", "U1", false, nil)
		var denied httperror.Error
		if !errors.As(err, &denied) || denied.Code != "project_repository_mismatch" {
			t.Fatalf("unbound repository must fail: %v", err)
		}
		exec(db, "INSERT INTO aims_project_repos(project_id,repo_project_code) VALUES(1,'R1')")
		out, err := a.EnterpriseProjectDocumentContext(ctx, "1", "3", "", "U1", false, nil)
		if err != nil || out["repositoryReference"] != true || out["documentRefType"] != "cabinet_file" {
			t.Fatalf("bound repository document: %v %v", out, err)
		}
		document, _ := out["document"].(map[string]any)
		if document["repo_project_code"] != "R1" || document["repo_file_path"] != "docs/spec.md" {
			t.Fatal("actual owning document column contract", document)
		}
		_, err = a.EnterpriseProjectDocumentContext(ctx, "2", "3", "", "U4", false, nil)
		if !errors.As(err, &denied) || denied.Code != "project_document_not_found" {
			t.Fatalf("wrong project must fail: %v", err)
		}
		exec(db, "UPDATE project_documents SET repo_project_code='r1' WHERE id=3")
		_, err = a.EnterpriseProjectDocumentContext(ctx, "1", "3", "", "U1", false, nil)
		if !errors.As(err, &denied) || denied.Code != "project_repository_mismatch" {
			t.Fatalf("case mismatch must fail: %v", err)
		}
		exec(db, "UPDATE project_documents SET repo_project_code='R1' WHERE id=3")
	})

	t.Run("HostContentUUIDAssociation", func(t *testing.T) {
		title, e := a.EnterpriseProjectDocumentUUIDTitle(ctx, "1", "22222222-2222-4222-8222-222222222222")
		if e != nil || title != "spec" {
			t.Fatalf("legal project parent chain title=%q err=%v", title, e)
		}
		_, e = a.EnterpriseProjectDocumentUUIDTitle(ctx, "2", "22222222-2222-4222-8222-222222222222")
		var failure httperror.Error
		if !errors.As(e, &failure) || failure.Status != 403 {
			t.Fatalf("cross-project UUID must be rejected: %v", e)
		}
		title, e = a.EnterpriseProjectDocumentUUIDTitle(ctx, "1", "00000001-4444-4444-8444-444444444444")
		if e != nil || title != "fixture" {
			t.Fatalf("deliverable title=%q err=%v", title, e)
		}
	})
	t.Run("HostContentUUIDStaleOtherProject", func(t *testing.T) {
		t.Cleanup(func() { exec(db, "DELETE FROM project_documents WHERE id IN (2001,2002)") })
		// Reproduce a legacy dangling index without changing the canonical schema.
		conn, e := db.Conn(ctx)
		if e != nil {
			t.Fatal(e)
		}
		defer conn.Close()
		if _, e = conn.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS=0"); e != nil {
			t.Fatal(e)
		}
		_, insertErr := conn.ExecContext(ctx, "INSERT INTO project_documents(id,uuid,codocs_uuid,project_id,project_code,title,created_by) VALUES (2001,'20010000-1111-4111-8111-111111111111','20000000-2222-4222-8222-222222222222',999999,'missing','stale','U1'),(2002,'20020000-1111-4111-8111-111111111111','20000000-2222-4222-8222-222222222222',1,'P1','valid','U1')")
		if _, e = conn.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS=1"); e != nil {
			t.Fatal(e)
		}
		if insertErr != nil {
			t.Fatal(insertErr)
		}
		title, e := a.EnterpriseProjectDocumentUUIDTitle(ctx, "1", "20000000-2222-4222-8222-222222222222")
		if e != nil || title != "valid" {
			t.Fatalf("stale unrelated index masked valid association: %q %v", title, e)
		}
		_, e = a.EnterpriseProjectDocumentUUIDTitle(ctx, "2", "20000000-2222-4222-8222-222222222222")
		var failure httperror.Error
		if !errors.As(e, &failure) || failure.Status != 403 {
			t.Fatalf("unlinked target must remain denied: %v", e)
		}
	})
	t.Run("R2cReferenceOnlyAndFrozenVersion", func(t *testing.T) {
		// This subtest owns every fixture below and leaves the shared suite clean.
		t.Cleanup(func() {
			for _, q := range []string{
				"DELETE FROM project_documents WHERE id BETWEEN 992101 AND 992109 OR project_id=992100",
				"DELETE FROM aims_project_members WHERE project_id=992100",
				"DELETE FROM aims_projects WHERE id=992100",
			} {
				if _, e := db.Exec(q); e != nil {
					t.Errorf("R2c cleanup: %v", e)
				}
			}
		})
		exec(db, "INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by) VALUES(992100,'R2C','R2c test','R2C','U1','U1')")
		exec(db, "INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(992100,'U1','manager','active')")
		exec(db, "INSERT INTO project_documents(id,uuid,project_id,project_code,title,is_folder,created_by,parent_id) VALUES(992101,'99210100-1111-4111-8111-111111111111',992100,'R2C','root',1,'U1',NULL),(992102,'99210200-1111-4111-8111-111111111111',992100,'R2C','nested',1,'U1',992101),(992103,'99210300-1111-4111-8111-111111111111',992100,'R2C','file',0,'U1',992102)")
		identity := EnterpriseProjectUpdateIdentity{ActorUID: "U1", CommandScope: &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, Masks: []int{65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}}
		_, e := a.WriteEnterpriseProjectDocument(ctx, identity, "992100", "992101", "delete", nil, false)
		var failure httperror.Error
		if !errors.As(e, &failure) || failure.Status != 409 || failure.Code != "project_document_folder_not_empty" {
			t.Fatalf("nonempty folder must fail before any deletion: %v", e)
		}
		var count int
		if e = db.QueryRow("SELECT COUNT(*) FROM project_documents WHERE id BETWEEN 992101 AND 992103").Scan(&count); e != nil || count != 3 {
			t.Fatalf("folder rejection changed refs count=%d err=%v", count, e)
		}
		if _, e = a.WriteEnterpriseProjectDocument(ctx, identity, "992100", "992103", "delete", nil, false); e != nil {
			t.Fatal(e)
		}
		if _, e = a.WriteEnterpriseProjectDocument(ctx, identity, "992100", "992101", "delete", nil, false); e != nil {
			t.Fatalf("empty folder descendants should delete: %v", e)
		}
		// Canonical Host index shape: reject unfrozen Git references, then accept
		// a fixed commit and preserve it when a sibling reference is removed.
		payload := map[string]any{"uuid": "99210400-1111-4111-8111-111111111111", "projectId": 992100, "title": "fixed", "documentSource": "repo", "repoProjectCode": "group/repo", "repoFilePath": "docs/spec.md"}
		if _, e = a.WriteEnterpriseProjectDocument(ctx, identity, "992100", "", "create", payload, false); e == nil {
			t.Fatal("unfrozen repository reference accepted")
		}
		payload["repoCommitId"] = "abcdef012345"
		payload["contentSize"] = 100*1024*1024 + 1
		if _, e = a.WriteEnterpriseProjectDocument(ctx, identity, "992100", "", "create", payload, false); e == nil {
			t.Fatal("oversized attachment metadata accepted")
		}
		payload["contentSize"] = 100 * 1024 * 1024
		out, e := a.WriteEnterpriseProjectDocument(ctx, identity, "992100", "", "create", payload, false)
		if e != nil {
			t.Fatalf("fixed version at maximum size: %v", e)
		}
		id := fmt.Sprint(out["id"])
		var commit string
		if e = db.QueryRow("SELECT repo_commit_id FROM project_documents WHERE id=?", id).Scan(&commit); e != nil || commit != "abcdef012345" {
			t.Fatalf("snapshot=%q err=%v", commit, e)
		}
		if _, e = a.WriteEnterpriseProjectDocument(ctx, identity, "992100", id, "delete", nil, false); e != nil {
			t.Fatal(e)
		}
		// Independent entry also refuses folder cascades and deletes only refs.
		exec(db, "INSERT INTO project_documents(id,uuid,project_id,project_code,title,is_folder,created_by,parent_id) VALUES(992105,'99210500-1111-4111-8111-111111111111',992100,'R2C','legacy folder',1,'U1',NULL),(992106,'99210600-1111-4111-8111-111111111111',992100,'R2C','legacy doc',0,'U1',992105)")
		if _, e = a.deleteDirectDocumentReference(ctx, "992105", url.Values{"current_user": {"U1"}}); e == nil {
			t.Fatal("independent nonempty folder cascade allowed")
		}
	})
	t.Run("HostPortfolioOwnerBoundary", func(t *testing.T) {
		scope := &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, Masks: []int{65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
		identity := EnterpriseProjectUpdateIdentity{ActorUID: "U1", CommandScope: scope}
		var before int
		if e := db.QueryRow("SELECT COUNT(*) FROM project_documents").Scan(&before); e != nil {
			t.Fatal(e)
		}
		for _, payload := range []map[string]any{{"portfolioId": 9}, {"parentId": 90}, {"projectId": 1, "parentId": 90}} {
			_, e := a.WriteEnterpriseProjectDocument(ctx, identity, "1", "", "create", payload, false)
			var failure httperror.Error
			if !errors.As(e, &failure) || failure.Status != 409 || failure.Code != "project_document_portfolio_owner_unsupported" {
				t.Fatalf("err=%v", e)
			}
		}
		var after int
		if e := db.QueryRow("SELECT COUNT(*) FROM project_documents").Scan(&after); e != nil || before != after {
			t.Fatalf("count %d -> %d err=%v", before, after, e)
		}
		readCtx := context.WithValue(ctx, enterpriseDocumentReadKey{}, true)
		docs, e := a.listDirectDocuments(readCtx, url.Values{"current_user": {"U1"}, "project_code": {"P1"}})
		if e != nil {
			t.Fatalf("read project document tree: %v", e)
		}
		// listDirectDocuments returns roots, not a flat list: folder 1 owns
		// child 2, while repository document 3 is the other root.
		ids := projectDocumentTreeIDs(t, docs)
		if len(docs) != 2 || !reflect.DeepEqual(ids, []int64{1, 2, 3}) {
			t.Fatalf("project document tree mismatch: roots=%d IDs=%v, want 2 roots and IDs [1 2 3]", len(docs), ids)
		}
		if docs[0].ID != 1 || len(docs[0].Children) != 1 || docs[0].Children[0].ID != 2 {
			t.Fatalf("project-owned child 2 missing from folder 1: IDs=%v", ids)
		}
		// Shared fixture is the real project page folder body, verified by
		// executing Host util -> owning typed core in the TS contract test.
		fixture, e := os.ReadFile("../../../../enterprise/test/fixtures/host-project-document-create-index.json")
		if e != nil {
			t.Fatal(e)
		}
		var payload map[string]any
		if e = json.Unmarshal(fixture, &payload); e != nil {
			t.Fatal(e)
		}
		first, e := a.WriteEnterpriseProjectDocument(ctx, identity, "1", "", "create", payload, false)
		if e != nil {
			t.Fatal(e)
		}
		var storedSource string
		if e = db.QueryRow("SELECT document_source FROM project_documents WHERE uuid=?", payload["uuid"]).Scan(&storedSource); e != nil || storedSource != "codocs" {
			t.Fatalf("Host create-index source=%q err=%v, want codocs", storedSource, e)
		}
		if _, mutated := payload["documentSource"]; mutated {
			t.Fatal("caller payload mutated")
		}
		second, e := a.WriteEnterpriseProjectDocument(ctx, identity, "1", "", "create", payload, false)
		if e != nil || first["id"] != second["id"] {
			t.Fatalf("UUID replay=%v err=%v", second, e)
		}
		identity.CommandScope = &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, Masks: []int{0}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
		if _, e = a.WriteEnterpriseProjectDocument(ctx, identity, "1", "", "create", payload, false); e == nil {
			t.Fatal("replay after revoked scope allowed")
		}
		exec(db, "DELETE FROM project_documents WHERE uuid='92000000-1111-4111-8111-111111111111'")
	})
	t.Run("HostProjectOwnedParentChainRemainsVisible", func(t *testing.T) {
		// Every node has authoritative project ownership, including the
		// document below two folders; portfolio-code aliases must not hide it.
		exec(db, "INSERT INTO project_documents(id,uuid,project_id,project_code,parent_id,title,is_folder,created_by) VALUES(80,'80000000-1111-4111-8111-111111111111',1,'P1',1,'nested project folder',1,'U1'),(81,'81000000-1111-4111-8111-111111111111',1,'P1',80,'nested project document',0,'U1')")
		defer exec(db, "DELETE FROM project_documents WHERE id IN (80,81)")
		readCtx := context.WithValue(ctx, enterpriseDocumentReadKey{}, true)
		docs, e := a.listDirectDocuments(readCtx, url.Values{"current_user": {"U1"}, "project_code": {"P1"}})
		if e != nil {
			t.Fatal(e)
		}
		ids := projectDocumentTreeIDs(t, docs)
		if !reflect.DeepEqual(ids, []int64{1, 2, 3, 80, 81}) {
			t.Fatalf("project-owned parent chain omitted or portfolio rows leaked: IDs=%v, want [1 2 3 80 81]", ids)
		}
		var nested *directDocumentListItem
		for _, child := range docs[0].Children {
			if child.ID == 80 {
				nested = child
			}
		}
		if nested == nil || len(nested.Children) != 1 || nested.Children[0].ID != 81 {
			t.Fatal("project-owned chain 1 -> 80 -> 81 not preserved")
		}
	})
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
