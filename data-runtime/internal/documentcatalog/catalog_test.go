package documentcatalog

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-sql-driver/mysql"
)

func entry(kind, id string) Entry {
	e := Entry{App: "aims", Kind: kind, ObjectID: id, Title: "Design", OwnerType: "project", OwnerCode: "P1", Revision: "c1", Locator: map[string]any{"repoPath": "g/r", "filePath": "docs/a.md", "integrationCode": "gitlab.default"}}
	return e
}

var entryColumns = []string{"uuid", "source_kind", "source_object_id", "title", "owner_type", "owner_code", "storage_locator", "storage_revision", "content_sha256", "status"}

func TestUUIDIsStableAndScoped(t *testing.T) {
	a := UUID("T1", "aims", "project_repo_document", "7")
	if a != UUID("T1", "aims", "project_repo_document", "7") || len(a) != 36 || a[14] != '5' {
		t.Fatalf("uuid=%s", a)
	}
	for _, other := range []string{UUID("T2", "aims", "project_repo_document", "7"), UUID("T1", "aims", "requirement_spec", "7"), UUID("T1", "aims", "project_repo_document", "8"), UUID("T1a", "ims", "project_repo_document", "7")} {
		if other == a {
			t.Fatal("identity collision across tenant, kind or object")
		}
	}
	// The namespace is part of the contract: this value must never change.
	if a != UUID("T1", "aims", "project_repo_document", "7") || namespace.String() != "3f6c8f0e-6b0a-5c1e-9d4a-7a2b8c5e1f90" {
		t.Fatal("catalog namespace changed")
	}
}

func TestReconcileRejectsEntriesOutsideTheClosedContract(t *testing.T) {
	db, m, _ := sqlmock.New()
	defer db.Close()
	store := NewStore(db)
	scope := Scope{App: "aims", Kinds: []string{"project_repo_document"}}
	bad := []Entry{}
	for _, mutate := range []func(*Entry){
		func(e *Entry) { e.Kind = "anything" },
		func(e *Entry) { e.App = "codocs" },
		func(e *Entry) { e.ObjectID = "../1" },
		func(e *Entry) { e.Title = " " },
		func(e *Entry) { e.OwnerType = "department" },
		func(e *Entry) { e.OwnerCode = "" },
		func(e *Entry) { e.ContentSHA256 = "xyz" },
		func(e *Entry) { e.Locator = nil },
		func(e *Entry) { e.Kind = "requirement_spec" }, // a registered kind, but outside this scope
	} {
		e := entry("project_repo_document", "1")
		mutate(&e)
		bad = append(bad, e)
	}
	for i, e := range bad {
		if _, err := store.Reconcile(context.Background(), "T1", scope, []Entry{e}, true); !errors.Is(err, ErrInvalid) {
			t.Fatalf("case %d err=%v", i, err)
		}
	}
	if _, err := store.Reconcile(context.Background(), "T1", Scope{App: "aims", Kinds: []string{"unknown"}}, nil, true); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unknown kind err=%v", err)
	}
	if _, err := store.Reconcile(context.Background(), "", scope, nil, true); !errors.Is(err, ErrInvalid) {
		t.Fatalf("empty tenant err=%v", err)
	}
	// Validation happens before any statement.
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReconcileReportsUnavailableWhenTheCatalogIsNotInstalled(t *testing.T) {
	if _, err := NewStore(nil).Reconcile(context.Background(), "T1", Scope{App: "aims", Kinds: []string{"project_repo_document"}}, nil, true); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("nil db err=%v", err)
	}
	db, m, _ := sqlmock.New()
	defer db.Close()
	m.ExpectBegin()
	m.ExpectQuery("FROM document_catalog_entries").WillReturnError(&mysql.MySQLError{Number: 1146, Message: "Table 'x.document_catalog_entries' doesn't exist"})
	m.ExpectRollback()
	if _, err := NewStore(db).Reconcile(context.Background(), "T1", Scope{App: "aims", Kinds: []string{"project_repo_document"}}, []Entry{entry("project_repo_document", "1")}, true); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("missing table err=%v", err)
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReconcileCreatesUpdatesDeactivatesAndIsIdempotent(t *testing.T) {
	db, m, _ := sqlmock.New()
	defer db.Close()
	store := NewStore(db)
	scope := Scope{App: "aims", Kinds: []string{"project_repo_document"}}
	keep, change, fresh := entry("project_repo_document", "1"), entry("project_repo_document", "2"), entry("project_repo_document", "3")
	change.Revision = "c2"
	gone := UUID("T1", "aims", "project_repo_document", "9")
	rows := func() *sqlmock.Rows {
		return sqlmock.NewRows(entryColumns).
			AddRow(UUID("T1", "aims", "project_repo_document", "1"), "project_repo_document", "1", "Design", "project", "P1", `{"filePath": "docs/a.md", "repoPath": "g/r", "integrationCode": "gitlab.default"}`, "c1", nil, "active").
			AddRow(UUID("T1", "aims", "project_repo_document", "2"), "project_repo_document", "2", "Design", "project", "P1", `{"filePath": "docs/a.md", "repoPath": "g/r", "integrationCode": "gitlab.default"}`, "c1", nil, "active").
			AddRow(gone, "project_repo_document", "9", "Old", "project", "P1", `{}`, "c0", nil, "active")
	}

	// Dry run: differences are reported and nothing is written.
	m.ExpectBegin()
	m.ExpectQuery("FROM document_catalog_entries WHERE tenant_code=\\? AND source_app=\\? AND source_kind IN \\(\\?\\)$").WithArgs("T1", "aims", "project_repo_document").WillReturnRows(rows())
	m.ExpectRollback()
	report, err := store.Reconcile(context.Background(), "T1", scope, []Entry{keep, change, fresh}, false)
	if err != nil || report.Applied || report.Unchanged != 1 || len(report.Changes) != 3 {
		t.Fatalf("dry run report=%+v err=%v", report, err)
	}
	actions := map[string]string{}
	for _, c := range report.Changes {
		actions[c.ObjectID] = c.Action
	}
	if actions["2"] != "update" || actions["3"] != "create" || actions["9"] != "deactivate" {
		t.Fatalf("actions=%v", actions)
	}

	// Apply: locked read, then exactly the reported writes.
	m.ExpectBegin()
	m.ExpectQuery("FROM document_catalog_entries .* FOR UPDATE$").WillReturnRows(rows())
	// Entries are processed in identity order; the unchanged one writes nothing.
	m.MatchExpectationsInOrder(false)
	m.ExpectExec("UPDATE document_catalog_entries SET title=").WillReturnResult(sqlmock.NewResult(0, 1))
	m.ExpectExec("INSERT IGNORE INTO document_catalog_entry_versions").WillReturnResult(sqlmock.NewResult(0, 1))
	m.ExpectExec("INSERT INTO document_catalog_entries").WillReturnResult(sqlmock.NewResult(0, 1))
	m.ExpectExec("INSERT IGNORE INTO document_catalog_entry_versions").WillReturnResult(sqlmock.NewResult(0, 1))
	m.ExpectExec("UPDATE document_catalog_entries SET status='inactive'").WithArgs(gone).WillReturnResult(sqlmock.NewResult(0, 1))
	m.ExpectCommit()
	if report, err = store.Reconcile(context.Background(), "T1", scope, []Entry{keep, change, fresh}, true); err != nil || !report.Applied || len(report.Changes) != 3 {
		t.Fatalf("apply report=%+v err=%v", report, err)
	}
	if err = m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The catalog tables and view are reachable only through this package. Any
// other production code naming them would bypass the structural isolation from
// Codocs user-facing reads.
func TestCatalogTablesHaveASingleOwner(t *testing.T) {
	root, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{
		"data-runtime/internal/documentcatalog/catalog.go": true,
	}
	scan := func(dir string, extensions ...string) {
		_ = filepath.WalkDir(filepath.Join(root, dir), func(path string, d os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return nil
			}
			name := d.Name()
			if d.IsDir() {
				if name == "node_modules" || name == ".nuxt" || name == ".output" || name == "docs" || name == "test" || name == "testdata" {
					return filepath.SkipDir
				}
				return nil
			}
			matched := false
			for _, extension := range extensions {
				matched = matched || strings.HasSuffix(name, extension)
			}
			if !matched || strings.HasSuffix(name, "_test.go") || strings.HasSuffix(name, ".test.ts") || strings.HasSuffix(name, ".test.mjs") {
				return nil
			}
			rel, _ := filepath.Rel(root, path)
			rel = filepath.ToSlash(rel)
			source, readErr := os.ReadFile(path)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if strings.Contains(string(source), "document_catalog") && !allowed[rel] {
				t.Errorf("%s names the catalog tables or view; only internal/documentcatalog may", rel)
			}
			return nil
		})
	}
	scan("data-runtime", ".go")
	// No user-facing server, page, route table, gateway topology or egress list.
	for _, dir := range []string{"codocs", "enterprise", "foundation", "aims", "console", "workflow", "deploy"} {
		scan(dir, ".ts", ".vue", ".mjs", ".js", ".json", ".py")
	}
}
