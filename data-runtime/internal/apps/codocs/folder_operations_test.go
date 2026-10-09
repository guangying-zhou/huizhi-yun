package codocs

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const folderScopeQuery = "SELECT id, name, folder_type, owner_uid, dept_code, project_code, parent_id FROM folders WHERE id = ?"
const folderScopeLockQuery = folderScopeQuery + " FOR UPDATE"

func trustedFolderQuery(actor string) url.Values {
	return url.Values{
		"current_user":                {actor},
		"hzy_runtime_actor_delegated": {"1"},
	}
}

func folderRows(id int64, name, kind, owner, department, project string, parent any) *sqlmock.Rows {
	var ownerValue, departmentValue, projectValue any
	if owner != "" {
		ownerValue = owner
	}
	if department != "" {
		departmentValue = department
	}
	if project != "" {
		projectValue = project
	}
	return sqlmock.NewRows([]string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id"}).
		AddRow(id, name, kind, ownerValue, departmentValue, projectValue, parent)
}

func expectFolderScope(mock sqlmock.Sqlmock, id int64, name, kind, owner, department, project string, parent any, lock bool) {
	query := folderScopeQuery
	if lock {
		query = folderScopeLockQuery
	}
	mock.ExpectQuery(regexp.QuoteMeta(query)).WithArgs(id).
		WillReturnRows(folderRows(id, name, kind, owner, department, project, parent))
}

func expectFolderError(t *testing.T, err error, code string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected %s error", code)
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Code != code {
		t.Fatalf("error = %#v, want code %s", err, code)
	}
}

func callFolder(t *testing.T, adapter *Adapter, method, id string, query url.Values, body map[string]any) (map[string]any, error) {
	t.Helper()
	result, _, err := adapter.HandleRuntime(context.Background(), method, "/v1/codocs/folders/"+id, query, body)
	if result == nil {
		return nil, err
	}
	data, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("result type = %T", result)
	}
	if nested, ok := data["data"].(map[string]any); ok {
		return nested, err
	}
	return data, err
}

func newFolderTestDB(t *testing.T) (*sql.DB, sqlmock.Sqlmock, *Adapter) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db, mock, &Adapter{db: db}
}

func TestFolderDetailScopesPersonalAndSlideToTrustedOwner(t *testing.T) {
	for _, tc := range []struct{ kind string }{{"private"}, {"slide"}} {
		t.Run(tc.kind, func(t *testing.T) {
			_, mock, adapter := newFolderTestDB(t)
			expectFolderScope(mock, 42, "Owned", tc.kind, "actor-a", "", "", nil, false)
			result, err := callFolder(t, adapter, http.MethodGet, "42", trustedFolderQuery("actor-a"), nil)
			if err != nil {
				t.Fatal(err)
			}
			if result["owner_uid"] != "actor-a" || result["folder_type"] != tc.kind {
				t.Fatalf("result = %#v", result)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestFolderScopeDoesNotTrustForgedOwnerOrDepartmentQuery(t *testing.T) {
	t.Run("owner cannot replace personal actor scope", func(t *testing.T) {
		_, mock, adapter := newFolderTestDB(t)
		expectFolderScope(mock, 42, "Other", "private", "victim", "", "", nil, false)
		query := trustedFolderQuery("actor-a")
		query.Set("owner_uid", "actor-a")
		_, err := callFolder(t, adapter, http.MethodGet, "42", query, nil)
		expectFolderError(t, err, "folder_scope_denied")
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("department requires exact trusted marker", func(t *testing.T) {
		_, mock, adapter := newFolderTestDB(t)
		expectFolderScope(mock, 43, "Dept", "department", "actor-a", "D1", "", nil, false)
		query := trustedFolderQuery("actor-a")
		query.Set("owner_uid", "actor-a")
		query.Set(codocsTrustedDepartmentReadQueryKey, "D2")
		_, err := callFolder(t, adapter, http.MethodGet, "43", query, nil)
		expectFolderError(t, err, "folder_scope_denied")
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}

func TestFolderRenameCommitsOnlyAfterScopedLock(t *testing.T) {
	_, mock, adapter := newFolderTestDB(t)
	mock.ExpectBegin()
	expectFolderScope(mock, 42, "Before", "private", "actor-a", "", "", nil, true)
	mock.ExpectExec("UPDATE folders SET name = \\?, parent_id = \\?, updated_at = NOW\\(\\) WHERE id = \\?").
		WithArgs("After", nil, int64(42)).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	_, err := callFolder(t, adapter, http.MethodPatch, "42", trustedFolderQuery("actor-a"), map[string]any{"name": "After"})
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestFolderParentRejectsCrossOwnerTypeAndCyclesWithRollback(t *testing.T) {
	tests := []struct {
		name                                string
		parentID                            int64
		parentName, parentKind, parentOwner string
		want                                string
	}{
		{"cross owner", 9, "Victim", "private", "victim", "folder_parent_scope_mismatch"},
		{"cross type", 9, "Slide", "slide", "actor-a", "folder_parent_scope_mismatch"},
		{"cycle", 42, "", "", "", "folder_cycle"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, mock, adapter := newFolderTestDB(t)
			mock.ExpectBegin()
			expectFolderScope(mock, 42, "Child", "private", "actor-a", "", "", nil, true)
			if tc.want != "folder_cycle" {
				expectFolderScope(mock, tc.parentID, tc.parentName, tc.parentKind, tc.parentOwner, "", "", nil, true)
			}
			mock.ExpectRollback()
			_, err := callFolder(t, adapter, http.MethodPatch, "42", trustedFolderQuery("actor-a"), map[string]any{"parent_id": float64(tc.parentID)})
			expectFolderError(t, err, tc.want)
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestEmptyFolderDeleteCommits(t *testing.T) {
	_, mock, adapter := newFolderTestDB(t)
	mock.ExpectBegin()
	expectFolderScope(mock, 42, "Empty", "private", "actor-a", "", "", nil, true)
	mock.ExpectQuery("SELECT id FROM folders WHERE parent_id = \\? LIMIT 1 FOR UPDATE").WithArgs(int64(42)).WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery("SELECT id FROM documents WHERE folder_id = \\? LIMIT 1 FOR UPDATE").WithArgs(int64(42)).WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectExec("DELETE FROM folders WHERE id = \\?").WithArgs(int64(42)).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	result, err := callFolder(t, adapter, http.MethodDelete, "42", trustedFolderQuery("actor-a"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if result["deleted"] != true {
		t.Fatalf("result = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestNonEmptyFolderDeleteRollsBackForChildOrDeletedDocument(t *testing.T) {
	for _, tc := range []struct{ name, query string }{
		{"child folder", "SELECT id FROM folders WHERE parent_id = \\? LIMIT 1 FOR UPDATE"},
		{"recoverable document", "SELECT id FROM documents WHERE folder_id = \\? LIMIT 1 FOR UPDATE"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, mock, adapter := newFolderTestDB(t)
			mock.ExpectBegin()
			expectFolderScope(mock, 42, "Not Empty", "private", "actor-a", "", "", nil, true)
			if tc.name == "child folder" {
				mock.ExpectQuery(tc.query).WithArgs(int64(42)).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(99)))
			} else {
				mock.ExpectQuery("SELECT id FROM folders WHERE parent_id = \\? LIMIT 1 FOR UPDATE").WithArgs(int64(42)).WillReturnRows(sqlmock.NewRows([]string{"id"}))
				mock.ExpectQuery(tc.query).WithArgs(int64(42)).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(100)))
			}
			mock.ExpectRollback()
			_, err := callFolder(t, adapter, http.MethodDelete, "42", trustedFolderQuery("actor-a"), nil)
			expectFolderError(t, err, "folder_not_empty")
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestFolderOperationsRejectMissingTrustedActorBeforeDatabase(t *testing.T) {
	_, mock, adapter := newFolderTestDB(t)
	for _, query := range []url.Values{
		{},
		{"current_user": {"actor-a"}},
		{"hzy_runtime_actor_delegated": {"1"}},
	} {
		_, err := callFolder(t, adapter, http.MethodGet, "42", query, nil)
		if err == nil {
			t.Fatalf("accepted unsigned query %#v", query)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
