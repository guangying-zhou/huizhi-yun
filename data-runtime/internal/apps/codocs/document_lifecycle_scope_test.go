package codocs

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func lifecycleDocumentRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "uuid", "title", "doc_type", "owner_uid", "dept_code", "project_code", "folder_id", "status", "readonly_flag"}).
		AddRow(11, "doc-scope", "Notes", "private", "owner-1", nil, nil, 1, 1, 0)
}

func TestDocumentLifecycleUpdateRejectsCrossOwnerFolderTarget(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &Adapter{db: db}
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1`).
		WithArgs("doc-scope").WillReturnRows(lifecycleDocumentRows())
	mock.ExpectQuery(`SELECT folder_type, owner_uid, dept_code, project_code\s+FROM folders`).
		WithArgs(int64(42)).WillReturnRows(sqlmock.NewRows([]string{"folder_type", "owner_uid", "dept_code", "project_code"}).AddRow("private", "other-owner", nil, nil))

	_, _, err = a.HandleRuntime(context.Background(), http.MethodPatch, "/v1/codocs/documents/doc-scope", url.Values{"current_user": {"owner-1"}}, map[string]any{"folder_id": 42})
	if err == nil {
		t.Fatal("cross-owner folder target must be rejected")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDocumentLifecycleUpdateRejectsCrossTypeFolderTarget(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &Adapter{db: db}
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1`).
		WithArgs("doc-slide").WillReturnRows(sqlmock.NewRows([]string{"id", "uuid", "title", "doc_type", "owner_uid", "folder_id", "status", "readonly_flag"}).
		AddRow(12, "doc-slide", "Deck", "slide", "owner-1", 1, 1, 0))
	mock.ExpectQuery(`SELECT folder_type, owner_uid, dept_code, project_code\s+FROM folders`).
		WithArgs(int64(42)).WillReturnRows(sqlmock.NewRows([]string{"folder_type", "owner_uid", "dept_code", "project_code"}).AddRow("private", "owner-1", nil, nil))

	_, _, err = a.HandleRuntime(context.Background(), http.MethodPatch, "/v1/codocs/documents/doc-slide", url.Values{"current_user": {"owner-1"}}, map[string]any{"folder_id": 42})
	if err == nil {
		t.Fatal("cross-type folder target must be rejected")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDocumentLifecycleUpdateRejectsFolderScopeMutationBypass(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &Adapter{db: db}
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1`).
		WithArgs("doc-scope").WillReturnRows(lifecycleDocumentRows())

	_, _, err = a.HandleRuntime(context.Background(), http.MethodPatch, "/v1/codocs/documents/doc-scope", url.Values{"current_user": {"owner-1"}}, map[string]any{"folder_id": 42, "doc_type": "department"})
	if err == nil {
		t.Fatal("folder move must not accept a simultaneous scope rewrite")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDocumentLifecycleUpdateShareWriterCannotChangeReadonly(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &Adapter{db: db}
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1`).
		WithArgs("doc-scope").WillReturnRows(lifecycleDocumentRows())
	mock.ExpectQuery(`SELECT permission\s+FROM document_shares`).
		WithArgs(int64(11), "writer").WillReturnRows(sqlmock.NewRows([]string{"permission"}).AddRow("write"))

	_, _, err = a.HandleRuntime(context.Background(), http.MethodPatch, "/v1/codocs/documents/doc-scope", url.Values{"current_user": {"writer"}}, map[string]any{"readonly_flag": true})
	if err == nil {
		t.Fatal("share writer must not change readonly flag")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDocumentLifecycleUpdateMoveOnlyChecksTitleConflictAtRoot(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &Adapter{db: db}
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1`).
		WithArgs("doc-scope").WillReturnRows(lifecycleDocumentRows())
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents WHERE .*folder_id IS NULL`).
		WithArgs("Notes", "owner-1", "doc-scope", "private").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(1))

	_, _, err = a.HandleRuntime(context.Background(), http.MethodPatch, "/v1/codocs/documents/doc-scope", url.Values{"current_user": {"owner-1"}}, map[string]any{"folder_id": nil})
	if err == nil {
		t.Fatal("move to root must still enforce same-title conflict")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDocumentLifecycleUpdateMoveOnlyChecksTitleConflictInTargetFolder(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &Adapter{db: db}
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1`).
		WithArgs("doc-scope").WillReturnRows(lifecycleDocumentRows())
	mock.ExpectQuery(`SELECT folder_type, owner_uid, dept_code, project_code\s+FROM folders`).
		WithArgs(int64(2)).WillReturnRows(sqlmock.NewRows([]string{"folder_type", "owner_uid", "dept_code", "project_code"}).AddRow("private", "owner-1", nil, nil))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents WHERE .*folder_id = \?`).
		WithArgs("Notes", "owner-1", "doc-scope", "private", int64(2)).WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(1))

	_, _, err = a.HandleRuntime(context.Background(), http.MethodPatch, "/v1/codocs/documents/doc-scope", url.Values{"current_user": {"owner-1"}}, map[string]any{"folder_id": 2})
	if err == nil {
		t.Fatal("move-only update must enforce target-folder title conflict")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
