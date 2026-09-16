package codocs

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestPublishRequestWritesRequireDelegatedActorBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}

	for _, call := range []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/v1/codocs/reviews/publish-requests"},
		{http.MethodPatch, "/v1/codocs/reviews/publish-requests/9"},
	} {
		_, _, err := adapter.HandleRuntime(context.Background(), call.method, call.path, url.Values{}, map[string]any{})
		httpErr, ok := err.(httperror.Error)
		if !ok || httpErr.Status != http.StatusUnauthorized {
			t.Fatalf("%s %s error = %#v", call.method, call.path, err)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unauthenticated publish request write touched storage: %v", err)
	}
}

func TestCreatePublishRequestUsesTrustedInitiatorAndDraftState(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	query := url.Values{"current_user": {"u-1"}, "hzy_runtime_actor_delegated": {"1"}}

	mock.ExpectQuery(`SELECT status FROM documents WHERE id=\? AND uuid=\? LIMIT 1`).
		WithArgs(int64(8), "doc-8").
		WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow(1))
	mock.ExpectExec(`(?s)INSERT INTO document_publish_requests.*VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, 'draft'\)`).
		WithArgs(int64(8), "doc-8", "公司发文", "公司制度", "u-1", "company", sqlmock.AnyArg(), nil).
		WillReturnResult(sqlmock.NewResult(12, 1))

	result, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/reviews/publish-requests", query, map[string]any{
		"document_id": 8, "document_uuid": "doc-8", "review_type": "公司发文", "sub_type": "公司制度",
		"initiator_uid": "u-1", "target_category": "company", "extra": map[string]any{"committeeMode": nil}, "workflow_status": "draft",
	})
	if err != nil {
		t.Fatalf("HandleRuntime: %v", err)
	}
	if operation != "codocs.reviews.publish_requests.create" {
		t.Fatalf("operation = %q", operation)
	}
	data := result.(map[string]any)["data"].(map[string]any)
	if data["id"] != int64(12) || data["workflow_status"] != "draft" || data["initiator_uid"] != "u-1" {
		t.Fatalf("data = %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}
