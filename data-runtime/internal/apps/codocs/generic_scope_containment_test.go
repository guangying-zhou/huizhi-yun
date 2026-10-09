package codocs

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestGenericNestedResourceCRUDPathsFailClosedBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	for _, resource := range []string{
		"document-shares",
		"document-versions",
		"annotations",
		"annotation-replies",
		"issue-comments",
	} {
		for _, request := range []struct {
			name   string
			method string
			path   string
		}{
			{"list", http.MethodGet, "/v1/codocs/" + resource},
			{"detail", http.MethodGet, "/v1/codocs/" + resource + "/7"},
			{"create", http.MethodPost, "/v1/codocs/" + resource},
			{"put", http.MethodPut, "/v1/codocs/" + resource + "/7"},
			{"patch", http.MethodPatch, "/v1/codocs/" + resource + "/7"},
			{"delete", http.MethodDelete, "/v1/codocs/" + resource + "/7"},
		} {
			t.Run(resource+"/"+request.name, func(t *testing.T) {
				_, operation, err := adapter.HandleRuntime(context.Background(), request.method, request.path, url.Values{}, map[string]any{})
				if operation != "codocs.scoped_resources.contract_required" {
					t.Fatalf("operation = %q", operation)
				}
				httpErr, ok := err.(httperror.Error)
				if !ok || httpErr.Status != http.StatusServiceUnavailable || httpErr.Code != "scoped_resource_contract_required" {
					t.Fatalf("error = %#v", err)
				}
			})
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("generic nested resource paths must not access storage: %v", err)
	}
}

func TestGenericDocumentServiceReadsFailClosedBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	for _, request := range []struct {
		name   string
		method string
		path   string
		query  url.Values
		body   map[string]any
	}{
		{"search-empty", http.MethodGet, "/v1/codocs/documents/search", url.Values{}, nil},
		{"search-cross-project", http.MethodGet, "/v1/codocs/documents/search", url.Values{"project_code": {"OTHER"}, "owner_uid": {"victim"}}, nil},
		{"batch-summary", http.MethodPost, "/v1/codocs/documents/batch-summary", url.Values{}, map[string]any{"uuids": []any{"victim-doc"}}},
		{"batch-summary-get", http.MethodGet, "/v1/codocs/documents/batch-summary", url.Values{}, nil},
	} {
		t.Run(request.name, func(t *testing.T) {
			_, operation, err := adapter.HandleRuntime(context.Background(), request.method, request.path, request.query, request.body)
			if operation != "codocs.documents.service_contract_required" {
				t.Fatalf("operation = %q", operation)
			}
			httpErr, ok := err.(httperror.Error)
			if !ok || httpErr.Status != http.StatusServiceUnavailable || httpErr.Code != "scoped_document_service_contract_required" {
				t.Fatalf("error = %#v", err)
			}
		})
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("generic document service reads must not access storage: %v", err)
	}
}
