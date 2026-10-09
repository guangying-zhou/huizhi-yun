package documentcatalog

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

func TestDocumentCatalogMySQL(t *testing.T) {
	socket := os.Getenv("HZY_DOCUMENT_CATALOG_SOCKET")
	if socket == "" {
		t.Skip("isolated MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	mc := mysql.NewConfig()
	mc.User, mc.Net, mc.Addr, mc.MultiStatements = "root", "unix", socket, false
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	name := "hzy_catalog_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	must := func(db *sql.DB, q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatalf("%v\n%s", err, q)
		}
	}
	must(root, "CREATE DATABASE "+name+" DEFAULT CHARSET utf8mb4")
	defer must(root, "DROP DATABASE "+name)
	mc.DBName = name
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	store := NewStore(db)
	scope := Scope{App: "aims", Kinds: []string{"project_repo_document", "requirement_spec"}}
	repo := Entry{App: "aims", Kind: "project_repo_document", ObjectID: "11", Title: "Design", OwnerType: "project", OwnerCode: "P1", Revision: "c1", Locator: map[string]any{"integrationCode": "gitlab.default", "repoPath": "g/r", "filePath": "docs/a.md"}}
	spec := Entry{App: "aims", Kind: "requirement_spec", ObjectID: "5", Title: "P1 需求规格书", OwnerType: "project", OwnerCode: "P1", Revision: strings.Repeat("a", 64), ContentSHA256: strings.Repeat("a", 64), Locator: map[string]any{"app": "aims", "kind": "requirement_spec", "projectId": "5", "objectId": "5"}}

	// Not installed: a fixed, recognisable error and nothing else.
	if _, err = store.Reconcile(ctx, "T1", scope, []Entry{repo}, true); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("uninstalled catalog err=%v", err)
	}

	// Canonical documents table plus the real migration file.
	schema, err := os.ReadFile("../../../codocs/docs/codocs_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	must(db, "SET FOREIGN_KEY_CHECKS=0")
	for _, table := range []string{"folders", "documents"} {
		ddl := regexp.MustCompile("(?ms)^CREATE TABLE `" + table + "` \\(.*?^\\) ENGINE=.*?;").FindString(string(schema))
		if ddl == "" {
			t.Fatal("canonical DDL missing: " + table)
		}
		must(db, ddl)
	}
	must(db, "SET FOREIGN_KEY_CHECKS=1")
	migration, err := os.ReadFile("../../../codocs/docs/migrations/20261006_document_catalog.sql")
	if err != nil {
		t.Fatal(err)
	}
	statements := regexp.MustCompile(`(?m)^--.*$`).ReplaceAllString(string(migration), "")
	for _, statement := range strings.Split(statements, ";") {
		if strings.TrimSpace(statement) != "" {
			must(db, statement)
		}
	}
	must(db, "INSERT INTO documents(uuid,title,doc_type,oss_path,owner_uid,status,deleted_at) VALUES ('d-active','Active','private','p/a','U1',1,NULL),('d-published','Published','company','p/b','U1',2,NULL),('d-deleted','Deleted','private','p/c','U1',0,NOW()),('d-recycled','Recycled','private','p/d','U1',1,NOW())")
	count := func(q string, args ...any) (n int) {
		t.Helper()
		if err := db.QueryRow(q, args...).Scan(&n); err != nil {
			t.Fatalf("%v\n%s", err, q)
		}
		return n
	}
	var documentsBefore string
	if err = db.QueryRow("SELECT CONCAT(COUNT(*),':',COALESCE(MAX(updated_at),''),':',GROUP_CONCAT(title ORDER BY id)) FROM documents").Scan(&documentsBefore); err != nil {
		t.Fatal(err)
	}

	// Dry run writes nothing.
	report, err := store.Reconcile(ctx, "T1", scope, []Entry{repo, spec}, false)
	if err != nil || len(report.Changes) != 2 || count("SELECT COUNT(*) FROM document_catalog_entries") != 0 {
		t.Fatalf("dry run report=%+v err=%v", report, err)
	}
	// Apply, then apply again: the second run changes nothing.
	if report, err = store.Reconcile(ctx, "T1", scope, []Entry{repo, spec}, true); err != nil || len(report.Changes) != 2 {
		t.Fatalf("apply report=%+v err=%v", report, err)
	}
	if report, err = store.Reconcile(ctx, "T1", scope, []Entry{repo, spec}, true); err != nil || len(report.Changes) != 0 || report.Unchanged != 2 {
		t.Fatalf("replay report=%+v err=%v", report, err)
	}
	if n := count("SELECT COUNT(*) FROM document_catalog_entries WHERE status='active' AND row_version=1"); n != 2 {
		t.Fatalf("entries=%d", n)
	}
	if n := count("SELECT COUNT(*) FROM document_catalog_entries WHERE uuid=? AND storage_type='git' AND tenant_code='T1'", UUID("T1", "aims", "project_repo_document", "11")); n != 1 {
		t.Fatalf("deterministic identity rows=%d", n)
	}
	if n := count("SELECT COUNT(*) FROM document_catalog_entries WHERE source_kind='requirement_spec' AND storage_type='module'"); n != 1 {
		t.Fatalf("module rows=%d", n)
	}
	// A new revision updates the entry and records one more immutable version.
	repo.Revision = "c2"
	if report, err = store.Reconcile(ctx, "T1", scope, []Entry{repo, spec}, true); err != nil || len(report.Changes) != 1 || report.Changes[0].Action != "update" {
		t.Fatalf("revision report=%+v err=%v", report, err)
	}
	if n := count("SELECT COUNT(*) FROM document_catalog_entry_versions WHERE entry_uuid=?", UUID("T1", "aims", "project_repo_document", "11")); n != 2 {
		t.Fatalf("versions=%d", n)
	}
	// A targeted reconcile never touches other objects of the kind.
	if report, err = store.Reconcile(ctx, "T1", Scope{App: "aims", Kinds: []string{"requirement_spec"}, ObjectIDs: []string{"99"}}, nil, true); err != nil || len(report.Changes) != 0 {
		t.Fatalf("targeted report=%+v err=%v", report, err)
	}
	// A source object that no longer exists is marked inactive, not deleted.
	if report, err = store.Reconcile(ctx, "T1", scope, []Entry{spec}, true); err != nil || len(report.Changes) != 1 || report.Changes[0].Action != "deactivate" {
		t.Fatalf("deactivate report=%+v err=%v", report, err)
	}
	if count("SELECT COUNT(*) FROM document_catalog_entries") != 2 || count("SELECT COUNT(*) FROM document_catalog_entries WHERE status='inactive'") != 1 {
		t.Fatal("deactivation must keep the row")
	}
	// It comes back under the same identity when the source reappears.
	if report, err = store.Reconcile(ctx, "T1", scope, []Entry{repo, spec}, true); err != nil || len(report.Changes) != 1 || report.Changes[0].Action != "update" {
		t.Fatalf("reactivate report=%+v err=%v", report, err)
	}
	// Another tenant is a different identity space.
	if _, err = store.Reconcile(ctx, "T2", scope, []Entry{repo}, true); err != nil || count("SELECT COUNT(*) FROM document_catalog_entries WHERE tenant_code='T2'") != 1 || count("SELECT COUNT(*) FROM document_catalog_entries WHERE tenant_code='T1'") != 2 {
		t.Fatalf("tenant isolation err=%v", err)
	}

	// An owner-scoped reconcile creates, updates and deactivates only that
	// owner's entries.
	other := Entry{App: "aims", Kind: "project_repo_document", ObjectID: "12", Title: "Other", OwnerType: "project", OwnerCode: "P2", Revision: "x1", Locator: map[string]any{"integrationCode": "gitlab.default", "repoPath": "g/r2", "filePath": "docs/b.md"}}
	if _, err = store.Reconcile(ctx, "T1", Scope{App: "aims", Kinds: []string{"project_repo_document"}}, []Entry{repo, other}, true); err != nil {
		t.Fatal(err)
	}
	p1 := Scope{App: "aims", Kinds: []string{"project_repo_document"}, OwnerType: "project", OwnerCode: "P1"}
	if _, err = store.Reconcile(ctx, "T1", p1, []Entry{other}, true); !errors.Is(err, ErrInvalid) {
		t.Fatalf("entry outside the owner scope err=%v", err)
	}
	if report, err = store.Reconcile(ctx, "T1", p1, nil, true); err != nil || len(report.Changes) != 1 || report.Changes[0].ObjectID != "11" || report.Changes[0].Action != "deactivate" {
		t.Fatalf("owner-scoped report=%+v err=%v", report, err)
	}
	if n := count("SELECT COUNT(*) FROM document_catalog_entries WHERE tenant_code='T1' AND source_object_id='12' AND status='active'"); n != 1 {
		t.Fatal("an owner-scoped reconcile must not touch another owner")
	}
	if _, err = store.Reconcile(ctx, "T1", Scope{App: "aims", Kinds: []string{"project_repo_document"}, OwnerType: "project"}, nil, true); !errors.Is(err, ErrInvalid) {
		t.Fatalf("half an owner scope err=%v", err)
	}
	must(db, "DELETE FROM document_catalog_entry_versions WHERE entry_uuid=?", UUID("T1", "aims", "project_repo_document", "12"))
	must(db, "DELETE FROM document_catalog_entries WHERE uuid=?", UUID("T1", "aims", "project_repo_document", "12"))
	if _, err = store.Reconcile(ctx, "T1", scope, []Entry{repo, spec}, true); err != nil {
		t.Fatal(err)
	}

	// Ordering (contract §7): Sync takes the per tenant/app/kind lock first and
	// reads the source inside it. A sync that started earlier can therefore
	// never write a state older than one a later sync already wrote.
	source := &orderedSource{entry: repo, reading: make(chan struct{}, 4), proceed: make(chan struct{}, 4)}
	source.setRevision("c3")
	results := make(chan error, 2)
	go func() {
		_, err := Sync(ctx, store, "T1", "aims", source, "project_repo_document", Filter{ObjectIDs: []string{"11"}}, true)
		results <- err
	}()
	<-source.reading // the first sync holds the lock and is about to read
	source.setRevision("c4")
	go func() {
		_, err := Sync(ctx, store, "T1", "aims", source, "project_repo_document", Filter{ObjectIDs: []string{"11"}}, true)
		results <- err
	}()
	select {
	case <-source.reading:
		t.Fatal("the second sync read the source without holding the lock")
	case <-time.After(500 * time.Millisecond):
	}
	// Another tenant, app or kind is a different lock and is not held up.
	if _, err = Sync(ctx, store, "T2", "aims", staticSource{}, "project_repo_document", Filter{ObjectIDs: []string{"404"}}, true); err != nil {
		t.Fatalf("unrelated sync err=%v", err)
	}
	source.proceed <- struct{}{}
	<-source.reading
	source.proceed <- struct{}{}
	for i := 0; i < 2; i++ {
		if err = <-results; err != nil {
			t.Fatalf("concurrent sync err=%v", err)
		}
	}
	var current string
	if err = db.QueryRow("SELECT storage_revision FROM document_catalog_entries WHERE uuid=?", UUID("T1", "aims", "project_repo_document", "11")).Scan(&current); err != nil || current != "c4" {
		t.Fatalf("current revision=%q err=%v", current, err)
	}
	if n := count("SELECT COUNT(*) FROM document_catalog_entry_versions WHERE entry_uuid=? AND storage_revision='c3'", UUID("T1", "aims", "project_repo_document", "11")); n != 0 {
		t.Fatal("the stale read must not have been recorded: the first sync read inside the lock")
	}
	// A dry run takes no lock and writes nothing.
	source.setRevision("c5")
	source.proceed <- struct{}{}
	if report, err = Sync(ctx, store, "T1", "aims", source, "project_repo_document", Filter{ObjectIDs: []string{"11"}}, false); err != nil || len(report.Changes) != 1 || report.Applied {
		t.Fatalf("dry sync report=%+v err=%v", report, err)
	}
	<-source.reading
	source.setRevision("c4")

	// The documents table is untouched by every registration.
	var documentsAfter string
	if err = db.QueryRow("SELECT CONCAT(COUNT(*),':',COALESCE(MAX(updated_at),''),':',GROUP_CONCAT(title ORDER BY id)) FROM documents").Scan(&documentsAfter); err != nil || documentsAfter != documentsBefore {
		t.Fatalf("documents changed: %q -> %q err=%v", documentsBefore, documentsAfter, err)
	}
	// The view: live documents and active registrations, no deleted or recycled rows.
	if n := count("SELECT COUNT(*) FROM document_catalog WHERE storage_type='oss'"); n != 2 {
		t.Fatalf("view documents=%d", n)
	}
	if n := count("SELECT COUNT(*) FROM document_catalog WHERE title IN ('Deleted','Recycled')"); n != 0 {
		t.Fatalf("view leaks removed documents=%d", n)
	}
	must(db, "UPDATE document_catalog_entries SET status='inactive' WHERE tenant_code='T2'")
	if n := count("SELECT COUNT(*) FROM document_catalog WHERE storage_type IN ('git','module')"); n != 2 {
		t.Fatalf("view registrations=%d", n)
	}
	// The view is read-only by construction (UNION): it cannot be written through.
	if _, err = db.Exec("UPDATE document_catalog SET title='x'"); err == nil {
		t.Fatal("the catalog view must not be updatable")
	}
}

// orderedSource reports the revision current at the moment it is read and lets
// the test hold the read, to model slow and out-of-order background syncs.
type orderedSource struct {
	mu      sync.Mutex
	entry   Entry
	reading chan struct{}
	proceed chan struct{}
}

func (s *orderedSource) setRevision(revision string) {
	s.mu.Lock()
	s.entry.Revision = revision
	s.mu.Unlock()
}

func (s *orderedSource) DocumentCatalogEntries(context.Context, string, Filter) ([]Entry, error) {
	s.reading <- struct{}{}
	<-s.proceed
	s.mu.Lock()
	defer s.mu.Unlock()
	return []Entry{s.entry}, nil
}

type staticSource struct{}

func (staticSource) DocumentCatalogEntries(context.Context, string, Filter) ([]Entry, error) {
	return nil, nil
}
