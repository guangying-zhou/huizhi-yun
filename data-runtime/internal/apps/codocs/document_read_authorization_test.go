package codocs

import (
	"context"
	"net/http"
	"net/url"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func documentReadRows(id int64, uuid, ownerUID, docType, deptCode string, readonlyFlag, status int64) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"uuid",
		"owner_uid",
		"doc_type",
		"dept_code",
		"readonly_flag",
		"status",
	}).AddRow(id, uuid, ownerUID, docType, deptCode, readonlyFlag, status)
}

func expectDocumentRead(mock sqlmock.Sqlmock, id int64, uuid, ownerUID, docType, deptCode string, readonlyFlag, status int64) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1")).
		WithArgs(uuid).
		WillReturnRows(documentReadRows(id, uuid, ownerUID, docType, deptCode, readonlyFlag, status))
}

func expectDocumentReadRelationTable(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`(?s)SELECT TABLE_NAME.*FROM information_schema\.TABLES.*TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = \?.*LIMIT 1`).
		WithArgs("document_relations").
		WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_relations"))
}

func TestHandleRuntimeDocumentGetRejectsMissingActorBeforeDatabaseRead(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/codocs/documents/doc-1", url.Values{}, map[string]any{})
	if operation != "codocs.documents.get" {
		t.Fatalf("operation = %q, want codocs.documents.get", operation)
	}
	httpErr, ok := err.(httperror.Error)
	if !ok {
		t.Fatalf("error = %T %v, want httperror.Error", err, err)
	}
	if httpErr.Status != http.StatusUnauthorized || httpErr.Code != "current_user_required" {
		t.Fatalf("error = %#v, want 401 current_user_required", httpErr)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("missing actor unexpectedly reached database: %v", err)
	}
}

func TestHandleRuntimeDocumentGetOwnerPreservesEnvelopeAndWritableProjection(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	expectDocumentRead(mock, 11, "doc-owner", "owner-uid", "private", "", 0, 1)

	response, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/codocs/documents/doc-owner", url.Values{
		"current_user": {"owner-uid"},
	}, map[string]any{})
	if err != nil {
		t.Fatalf("HandleRuntime: %v", err)
	}
	if operation != "codocs.documents.get" {
		t.Fatalf("operation = %q, want codocs.documents.get", operation)
	}
	payload := response.(map[string]any)
	data := payload["data"].(map[string]any)
	if data["readonly"] != false || data["sharePermission"] != nil {
		t.Fatalf("owner projection = %#v, want writable owner without share permission", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestHandleRuntimeDocumentGetShareAndRelationMaintainReadACL(t *testing.T) {
	t.Run("write share is writable", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer db.Close()

		adapter := &Adapter{db: db}
		expectDocumentRead(mock, 12, "doc-share", "owner-uid", "private", "", 0, 1)
		mock.ExpectQuery(regexp.QuoteMeta("SELECT permission\n      FROM document_shares\n      WHERE document_id = ? AND shared_to_uid = ?\n      LIMIT 1")).
			WithArgs(int64(12), "viewer-uid").
			WillReturnRows(sqlmock.NewRows([]string{"permission"}).AddRow("write"))

		response, _, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/codocs/documents/doc-share", url.Values{
			"current_user": {"viewer-uid"},
		}, map[string]any{})
		if err != nil {
			t.Fatalf("HandleRuntime: %v", err)
		}
		data := response.(map[string]any)["data"].(map[string]any)
		if data["readonly"] != false || data["sharePermission"] != "write" {
			t.Fatalf("share projection = %#v, want writable write-share", data)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("active relation is readonly", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer db.Close()

		adapter := &Adapter{db: db}
		expectDocumentRead(mock, 13, "doc-relation", "owner-uid", "private", "", 0, 1)
		mock.ExpectQuery(regexp.QuoteMeta("SELECT permission\n      FROM document_shares\n      WHERE document_id = ? AND shared_to_uid = ?\n      LIMIT 1")).
			WithArgs(int64(13), "viewer-uid").
			WillReturnRows(sqlmock.NewRows([]string{"permission"}))
		expectDocumentReadRelationTable(mock)
		mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*FROM document_relations.*document_id = \? AND related_uid = \? AND status = 1 AND can_read = 1.*source_type <> 'project_preview_access'.*updated_at >= DATE_SUB\(NOW\(\), INTERVAL 12 HOUR\)`).
			WithArgs(int64(13), "viewer-uid").
			WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(1))

		response, _, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/codocs/documents/doc-relation", url.Values{
			"current_user": {"viewer-uid"},
		}, map[string]any{})
		if err != nil {
			t.Fatalf("HandleRuntime: %v", err)
		}
		data := response.(map[string]any)["data"].(map[string]any)
		if data["readonly"] != true || data["sharePermission"] != nil {
			t.Fatalf("relation projection = %#v, want readonly relation access", data)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}

func TestHandleRuntimeDocumentGetDepartmentOnlyAllowsExactTrustedDepartment(t *testing.T) {
	for _, test := range []struct {
		name        string
		trustedDept string
		wantStatus  int
	}{
		{name: "exact department allows readonly read", trustedDept: "D1", wantStatus: 0},
		{name: "other department is denied", trustedDept: "D2", wantStatus: http.StatusForbidden},
	} {
		t.Run(test.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New: %v", err)
			}
			defer db.Close()

			adapter := &Adapter{db: db}
			expectDocumentRead(mock, 14, "doc-department", "owner-uid", "department", "D1", 0, 1)
			mock.ExpectQuery(regexp.QuoteMeta("SELECT permission\n      FROM document_shares\n      WHERE document_id = ? AND shared_to_uid = ?\n      LIMIT 1")).
				WithArgs(int64(14), "viewer-uid").
				WillReturnRows(sqlmock.NewRows([]string{"permission"}))
			expectDocumentReadRelationTable(mock)
			mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*FROM document_relations.*source_type <> 'project_preview_access'.*INTERVAL 12 HOUR`).
				WithArgs(int64(14), "viewer-uid").
				WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))

			response, _, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/codocs/documents/doc-department", url.Values{
				"current_user":                      {"viewer-uid"},
				"trusted_department_read_dept_code": {test.trustedDept},
			}, map[string]any{})
			if test.wantStatus == 0 {
				if err != nil {
					t.Fatalf("HandleRuntime: %v", err)
				}
				data := response.(map[string]any)["data"].(map[string]any)
				if data["readonly"] != true || data["sharePermission"] != nil {
					t.Fatalf("department projection = %#v, want readonly department read", data)
				}
			} else {
				httpErr, ok := err.(httperror.Error)
				if !ok || httpErr.Status != test.wantStatus || httpErr.Code != "permission_denied" {
					t.Fatalf("error = %#v, want %d permission_denied", err, test.wantStatus)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
