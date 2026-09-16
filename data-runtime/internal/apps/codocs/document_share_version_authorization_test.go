package codocs

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestDocumentShareVersionAndReadRejectUnsignedActorBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	query := url.Values{"current_user": {"untrusted-user"}}

	checks := []struct {
		name string
		call func() error
	}{
		{"share-list", func() error { _, err := adapter.documentShares(context.Background(), "doc-1", query); return err }},
		{"version-list", func() error { _, err := adapter.documentVersions(context.Background(), "doc-1", query); return err }},
		{"mark-read", func() error {
			_, err := adapter.markDocumentRead(context.Background(), "doc-1", query, map[string]any{"uid": "victim"})
			return err
		}},
		{"version-delete", func() error {
			_, err := adapter.deleteDocumentVersion(context.Background(), "doc-1", "7", query, map[string]any{"actorUid": "victim"})
			return err
		}},
	}

	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			if err := check.call(); err == nil {
				t.Fatal("unsigned actor must be rejected")
			}
		})
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unsigned reads and writes must not query or mutate storage: %v", err)
	}
}

func TestDocumentShareVersionAndReadRoutesRejectUndelegatedActorBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	query := url.Values{"current_user": {"untrusted-user"}}
	checks := []struct {
		name      string
		method    string
		path      string
		body      map[string]any
		operation string
	}{
		{"share-list", http.MethodGet, "/v1/codocs/documents/doc-1/shares", nil, "codocs.documents.shares.list"},
		{"version-list", http.MethodGet, "/v1/codocs/documents/doc-1/versions", nil, "codocs.documents.versions.list"},
		{"mark-read", http.MethodPost, "/v1/codocs/documents/doc-1/read", map[string]any{"uid": "victim"}, "codocs.documents.read"},
		{"version-delete", http.MethodDelete, "/v1/codocs/documents/doc-1/versions/7", nil, "codocs.documents.versions.delete"},
	}

	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			response, operation, err := adapter.HandleRuntime(context.Background(), check.method, check.path, query, check.body)
			assertDocumentShareHTTPStatus(t, err, http.StatusForbidden)
			if operation != check.operation {
				t.Fatalf("operation = %q, want %q", operation, check.operation)
			}
			envelope, ok := response.(map[string]any)
			if !ok || envelope["success"] != true {
				t.Fatalf("response = %#v, want success/data envelope", response)
			}
		})
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("undelegated share/version routes must not query or mutate storage: %v", err)
	}
}

func assertDocumentShareHTTPStatus(t *testing.T, err error, expected int) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected HTTP status %d, got nil error", expected)
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) {
		t.Fatalf("expected httperror.Error, got %T: %v", err, err)
	}
	if httpErr.Status != expected {
		t.Fatalf("HTTP status = %d, want %d", httpErr.Status, expected)
	}
}

func TestMarkDocumentReadRouteReturnsCompatibilityEnvelope(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectQuery("SELECT id FROM documents WHERE uuid = \\? AND status <> 0 LIMIT 1").
		WithArgs("doc-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(9)))
	mock.ExpectExec("(?s)UPDATE document_shares.*SET is_opened = 1.*WHERE document_id = \\? AND shared_to_uid = \\? AND is_opened = 0").
		WithArgs(int64(9), "trusted-user").
		WillReturnResult(sqlmock.NewResult(0, 1))

	response, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/documents/doc-1/read", url.Values{
		"current_user":                {"trusted-user"},
		"hzy_runtime_actor_delegated": {"1"},
	}, map[string]any{"actorUid": "spoofed-user"})
	if err != nil {
		t.Fatalf("HandleRuntime mark read: %v", err)
	}
	if operation != "codocs.documents.read" {
		t.Fatalf("operation = %q, want codocs.documents.read", operation)
	}
	envelope, ok := response.(map[string]any)
	if !ok || envelope["success"] != true {
		t.Fatalf("response = %#v, want success/data envelope", response)
	}
	data, ok := envelope["data"].(map[string]any)
	if !ok || data["read"] != true || data["firstRead"] != true {
		t.Fatalf("response data = %#v, want first read result", envelope["data"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("mark-read route SQL expectations: %v", err)
	}
}
