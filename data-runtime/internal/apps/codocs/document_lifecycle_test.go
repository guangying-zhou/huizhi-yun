package codocs

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestDocumentLifecycleCreateRouteUsesQueryActorInsteadOfSpoofedOwner(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectQuery("SELECT id FROM documents WHERE oss_path = \\? AND status != 0 LIMIT 1").
		WithArgs("codocs/users/trusted-owner/docs/Scoped.md").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery("SELECT TABLE_NAME\\s+FROM information_schema\\.TABLES").
		WithArgs("document_relations").
		WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_relations"))
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO documents").
		WithArgs("doc-lifecycle", "Scoped", "private", "codocs/users/trusted-owner/docs/Scoped.md", "trusted-owner", nil, nil, nil, int64(0)).
		WillReturnResult(sqlmock.NewResult(88, 1))
	mock.ExpectExec("INSERT INTO document_relations").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	response, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/documents", url.Values{
		"current_user": {"trusted-owner"},
	}, map[string]any{
		"uuid":     "doc-lifecycle",
		"title":    "Scoped",
		"docType":  "private",
		"ownerUid": "spoofed-owner",
	})
	if err != nil {
		t.Fatalf("HandleRuntime create: %v", err)
	}
	if operation != "codocs.documents.create" {
		t.Fatalf("operation = %q", operation)
	}
	envelope, ok := response.(map[string]any)
	if !ok || envelope["success"] != true {
		t.Fatalf("response = %#v, want compatibility success envelope", response)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("query actor must own created document and relation: %v", err)
	}
}

func TestDocumentLifecycleUpdateRouteRejectsSpoofedOwnerBeforeMutation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectQuery("SELECT \\* FROM documents WHERE uuid = \\? AND status <> 0 LIMIT 1").
		WithArgs("doc-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "uuid", "title", "owner_uid", "status", "readonly_flag"}).
			AddRow(7, "doc-1", "Original", "real-owner", 1, 0))
	mock.ExpectQuery("SELECT permission\\s+FROM document_shares").
		WithArgs(int64(7), "trusted-non-owner").
		WillReturnError(sql.ErrNoRows)

	_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPatch, "/v1/codocs/documents/doc-1", url.Values{
		"current_user": {"trusted-non-owner"},
	}, map[string]any{
		"actorUid": "real-owner",
		"title":    "Escalated",
	})
	if err == nil {
		t.Fatal("spoofed body actor must not update another owner's document")
	}
	if operation != "codocs.documents.update" {
		t.Fatalf("operation = %q", operation)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("denied update must not issue a mutation: %v", err)
	}
}

func TestDocumentLifecycleUpdateRouteAllowsOwnerToUnlockReadonlyDocument(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectQuery("SELECT \\* FROM documents WHERE uuid = \\? AND status <> 0 LIMIT 1").
		WithArgs("doc-readonly").
		WillReturnRows(sqlmock.NewRows([]string{"id", "uuid", "title", "owner_uid", "status", "readonly_flag"}).
			AddRow(8, "doc-readonly", "Readonly", "owner-uid", 1, 1))
	mock.ExpectExec("UPDATE documents SET `readonly_flag` = \\?, updated_at = NOW\\(\\) WHERE uuid = \\?").
		WithArgs(int64(0), "doc-readonly").
		WillReturnResult(sqlmock.NewResult(0, 1))

	response, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPatch, "/v1/codocs/documents/doc-readonly", url.Values{
		"current_user": {"owner-uid"},
	}, map[string]any{
		"readonly_flag":                false,
		"current_user_scopes":          []string{"tenant-runtime:codocs:write"},
		"current_user_dept_code":       "GMO",
		"current_user_dept_codes":      "GMO",
		"current_user_department_code": "GMO",
	})
	if err != nil {
		t.Fatalf("owner unlock readonly document: %v", err)
	}
	if operation != "codocs.documents.update" {
		t.Fatalf("operation = %q", operation)
	}
	envelope, ok := response.(map[string]any)
	if !ok || envelope["success"] != true {
		t.Fatalf("response = %#v, want compatibility success envelope", response)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unlock mutation: %v", err)
	}
}

func TestDocumentLifecycleUpdateRouteKeepsReadonlyWriteProtection(t *testing.T) {
	tests := []struct {
		name         string
		status       int64
		readonlyFlag int64
		body         map[string]any
	}{
		{
			name:         "unlock cannot include another mutation",
			status:       1,
			readonlyFlag: 1,
			body: map[string]any{
				"readonly_flag": false,
				"title":         "Changed while locked",
			},
		},
		{
			name:         "published document cannot be unlocked",
			status:       2,
			readonlyFlag: 1,
			body: map[string]any{
				"readonly_flag": false,
			},
		},
		{
			name:         "readonly document cannot be locked again through the exception",
			status:       1,
			readonlyFlag: 1,
			body: map[string]any{
				"readonly_flag": true,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New: %v", err)
			}
			defer db.Close()

			adapter := &Adapter{db: db}
			mock.ExpectQuery("SELECT \\* FROM documents WHERE uuid = \\? AND status <> 0 LIMIT 1").
				WithArgs("doc-protected").
				WillReturnRows(sqlmock.NewRows([]string{"id", "uuid", "title", "owner_uid", "status", "readonly_flag"}).
					AddRow(9, "doc-protected", "Protected", "owner-uid", tt.status, tt.readonlyFlag))

			_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPatch, "/v1/codocs/documents/doc-protected", url.Values{
				"current_user": {"owner-uid"},
			}, tt.body)
			if err == nil {
				t.Fatal("protected document mutation must be rejected")
			}
			if operation != "codocs.documents.update" {
				t.Fatalf("operation = %q", operation)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("rejected mutation must not write: %v", err)
			}
		})
	}
}
