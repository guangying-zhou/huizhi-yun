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

func TestReviewDetailRejectsMissingCurrentUser(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	_, err = adapter.reviewDetail(context.Background(), "42", url.Values{})
	assertReviewHTTPStatus(t, err, http.StatusUnauthorized)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("runtime queried review data before authenticating: %v", err)
	}
}

func TestReviewByDocumentRejectsMissingCurrentUserBeforeDocumentRead(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	_, err = adapter.reviewByDocument(context.Background(), "doc-1", url.Values{})
	assertReviewHTTPStatus(t, err, http.StatusUnauthorized)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("runtime queried review data before authenticating: %v", err)
	}
}

func TestReviewReadsRejectUnsignedActorBeforeStorage(t *testing.T) {
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
		{"my-reviews", func() error { _, err := adapter.myReviews(context.Background(), query); return err }},
		{"review-detail", func() error { _, err := adapter.reviewDetail(context.Background(), "42", query); return err }},
		{"publish-detail", func() error { _, err := adapter.publishRequestDetail(context.Background(), "42", query); return err }},
		{"publish-list", func() error { _, err := adapter.publishRequestsList(context.Background(), query); return err }},
		{"by-document", func() error { _, err := adapter.reviewByDocument(context.Background(), "doc-1", query); return err }},
		{"by-oss-path", func() error {
			_, err := adapter.reviewByOssPath(context.Background(), url.Values{"current_user": {"untrusted-user"}, "path": {"codocs/archive/private.pdf"}})
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
		t.Fatalf("unsigned review reads must not access storage: %v", err)
	}
}

func TestReviewReadRoutesDispatchToTrustedReadBoundary(t *testing.T) {
	adapter := &Adapter{}
	for _, check := range []struct {
		name      string
		path      string
		query     url.Values
		operation string
	}{
		{"my", "/v1/codocs/reviews/my", url.Values{}, "codocs.reviews.my"},
		{"publish-list", "/v1/codocs/reviews/publish-requests", url.Values{}, "codocs.reviews.publish_requests.list"},
		{"publish-detail", "/v1/codocs/reviews/publish-requests/42", url.Values{}, "codocs.reviews.publish_requests.get"},
		{"by-document", "/v1/codocs/reviews/by-document/doc-1", url.Values{}, "codocs.reviews.by_document"},
		{"by-oss-path", "/v1/codocs/reviews/by-oss-path", url.Values{"path": {"codocs/archive/private.pdf"}}, "codocs.reviews.by_oss_path"},
		{"detail", "/v1/codocs/reviews/42", url.Values{}, "codocs.reviews.get"},
	} {
		t.Run(check.name, func(t *testing.T) {
			_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, check.path, check.query, map[string]any{})
			assertReviewHTTPStatus(t, err, http.StatusUnauthorized)
			if operation != check.operation {
				t.Fatalf("operation = %q, want %q", operation, check.operation)
			}
		})
	}
}

func TestReviewByOssPathRejectsMissingCurrentUserBeforeArchiveLookup(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	_, err = adapter.reviewByOssPath(context.Background(), url.Values{"path": {"codocs/archive/secret.pdf"}})
	assertReviewHTTPStatus(t, err, http.StatusUnauthorized)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("runtime looked up an archive before authenticating: %v", err)
	}
}

func TestGenericReviewAndPublishRequestRoutesFailClosedBeforeStorage(t *testing.T) {
	adapter := &Adapter{}
	for _, check := range []struct {
		name   string
		method string
		path   string
	}{
		{"review-write", http.MethodPost, "/v1/codocs/reviews"},
		{"review-action-list", http.MethodGet, "/v1/codocs/review-actions"},
	} {
		t.Run(check.name, func(t *testing.T) {
			_, operation, err := adapter.HandleRuntime(context.Background(), check.method, check.path, url.Values{}, map[string]any{})
			if err == nil {
				t.Fatal("generic review route must fail closed")
			}
			if operation != "codocs.reviews.contract_required" {
				t.Fatalf("operation = %q, want contract-required audit operation", operation)
			}
		})
	}
}

func TestPublishRequestReadProjectionRejectsMissingCurrentUser(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	for _, call := range []struct {
		name string
		read func() error
	}{
		{name: "detail", read: func() error {
			_, err := adapter.publishRequestDetail(context.Background(), "42", url.Values{})
			return err
		}},
		{name: "list", read: func() error {
			_, err := adapter.publishRequestsList(context.Background(), url.Values{})
			return err
		}},
	} {
		t.Run(call.name, func(t *testing.T) {
			assertReviewHTTPStatus(t, call.read(), http.StatusUnauthorized)
		})
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("publish request projection queried data before authenticating: %v", err)
	}
}

func TestReviewByDocumentRejectsRevokedRelationBeforeSensitiveEnrichment(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectQuery(`(?s)SELECT .*FROM document_publish_requests pr.*WHERE pr\.document_uuid = \?`).
		WithArgs("doc-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(`(?s)SELECT r\.\*.*FROM document_reviews r.*WHERE r\.document_uuid = \?`).
		WithArgs("doc-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "document_id", "initiator_uid", "current_node", "flow_snapshot", "document_owner_uid", "document_status",
		}).AddRow(int64(42), int64(7), "initiator", int64(0), `[{"reviewers":["current-reviewer"]}]`, "owner", int64(1)))
	mock.ExpectQuery(`(?s)SELECT 1\s+FROM review_actions\s+WHERE review_id = \? AND actor_uid = \?\s+LIMIT 1`).
		WithArgs("42", "revoked-user").
		WillReturnRows(sqlmock.NewRows([]string{"1"}))
	mock.ExpectQuery(`(?s)SELECT permission\s+FROM document_shares\s+WHERE document_id = \? AND shared_to_uid = \?\s+LIMIT 1`).
		WithArgs(int64(7), "revoked-user").
		WillReturnRows(sqlmock.NewRows([]string{"permission"}))
	mock.ExpectQuery(`(?s)SELECT TABLE_NAME\s+FROM information_schema\.TABLES`).
		WithArgs("document_relations").
		WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_relations"))
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\)\s+FROM document_relations\s+WHERE document_id = \? AND related_uid = \? AND status = 1 AND can_read = 1`).
		WithArgs(int64(7), "revoked-user").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))

	_, err = adapter.reviewByDocument(context.Background(), "doc-1", url.Values{
		"current_user":                {"revoked-user"},
		"hzy_runtime_actor_delegated": {"1"},
	})
	assertReviewHTTPStatus(t, err, http.StatusForbidden)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("revoked relation must fail before actions, seal records, or receiver phone enrichment: %v", err)
	}
}

func TestReviewDetailFailsClosedWhenPublishAndLegacyIDsCollide(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectQuery(`(?s)SELECT pr\.id.*FROM document_publish_requests pr.*WHERE pr\.id = \?`).
		WithArgs("42").
		WillReturnRows(sqlmock.NewRows([]string{"id", "initiator_uid"}).AddRow(int64(42), "actor"))
	mock.ExpectQuery(`(?s)SELECT r\.\*.*FROM document_reviews r.*WHERE r\.id = \?`).
		WithArgs("42").
		WillReturnRows(sqlmock.NewRows([]string{"id", "initiator_uid"}).AddRow(int64(42), "actor"))

	_, err = adapter.reviewDetail(context.Background(), "42", url.Values{
		"current_user":                {"actor"},
		"hzy_runtime_actor_delegated": {"1"},
	})
	assertReviewHTTPStatus(t, err, http.StatusConflict)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("id collision must fail before either review source is enriched: %v", err)
	}
}

func TestReviewDetailAllowsInitiatorAndCurrentReviewer(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	initiated := map[string]any{"initiator_uid": "initiator"}
	if err := adapter.requireReviewDetailAccess(context.Background(), initiated, "initiator", true); err != nil {
		t.Fatalf("initiator should be allowed: %v", err)
	}

	pending := map[string]any{
		"initiator_uid": "initiator",
		"current_node":  int64(1),
		"flow_snapshot": `[{"reviewers":["past-reviewer"]},{"reviewers":["current-reviewer"]}]`,
	}
	if err := adapter.requireReviewDetailAccess(context.Background(), pending, "current-reviewer", true); err != nil {
		t.Fatalf("current reviewer should be allowed: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("participant authorization should not query document ACLs: %v", err)
	}
}

func TestReviewDetailAllowsHistoricalReviewer(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectQuery("(?s)SELECT 1\\s+FROM review_actions\\s+WHERE review_id = \\? AND actor_uid = \\?\\s+LIMIT 1").
		WithArgs("42", "past-reviewer").
		WillReturnRows(sqlmock.NewRows([]string{"1"}).AddRow(1))

	review := map[string]any{
		"id":            "42",
		"initiator_uid": "initiator",
		"current_node":  int64(0),
		"flow_snapshot": `[{"reviewers":["current-reviewer"]}]`,
	}
	if err := adapter.requireReviewDetailAccess(context.Background(), review, "past-reviewer", true); err != nil {
		t.Fatalf("historical reviewer should be allowed: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestPublishRequestDetailRecognizesExecutionParticipantOnPublishedDocument(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectQuery(`(?s)SELECT TABLE_NAME\s+FROM information_schema\.TABLES`).
		WithArgs("document_seal_records").
		WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_seal_records"))
	mock.ExpectQuery(`SELECT 1 FROM document_seal_records WHERE review_id = \? AND document_uuid = \? AND operator_uid = \? LIMIT 1`).
		WithArgs("42", "published-doc-uuid", "seal-admin").
		WillReturnRows(sqlmock.NewRows([]string{"1"}).AddRow(1))

	err = adapter.requirePublishRequestReadAccess(context.Background(), map[string]any{
		"id":                      "42",
		"document_uuid":           "source-doc-uuid",
		"published_document_uuid": "published-doc-uuid",
		"initiator_uid":           "initiator",
		"document_id":             int64(7),
		"document_status":         int64(1),
	}, "seal-admin")
	if err != nil {
		t.Fatalf("execution participant should be allowed: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestReviewDetailAllowsCurrentDocumentShare(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectQuery("(?s)SELECT 1\\s+FROM review_actions\\s+WHERE review_id = \\? AND actor_uid = \\?\\s+LIMIT 1").
		WithArgs("42", "shared-user").
		WillReturnRows(sqlmock.NewRows([]string{"1"}))
	mock.ExpectQuery("(?s)SELECT permission\\s+FROM document_shares\\s+WHERE document_id = \\? AND shared_to_uid = \\?\\s+LIMIT 1").
		WithArgs(int64(7), "shared-user").
		WillReturnRows(sqlmock.NewRows([]string{"permission"}).AddRow("read"))

	review := reviewWithDocumentAccess("42", int64(7))
	if err := adapter.requireReviewDetailAccess(context.Background(), review, "shared-user", true); err != nil {
		t.Fatalf("active document share should allow review detail: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestReviewDetailAllowsActiveDocumentRelation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectQuery("(?s)SELECT 1\\s+FROM review_actions\\s+WHERE review_id = \\? AND actor_uid = \\?\\s+LIMIT 1").
		WithArgs("42", "related-user").
		WillReturnRows(sqlmock.NewRows([]string{"1"}))
	mock.ExpectQuery("(?s)SELECT permission\\s+FROM document_shares\\s+WHERE document_id = \\? AND shared_to_uid = \\?\\s+LIMIT 1").
		WithArgs(int64(7), "related-user").
		WillReturnRows(sqlmock.NewRows([]string{"permission"}))
	mock.ExpectQuery("(?s)SELECT TABLE_NAME\\s+FROM information_schema.TABLES").
		WithArgs("document_relations").
		WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_relations"))
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\)\\s+FROM document_relations\\s+WHERE document_id = \\? AND related_uid = \\? AND status = 1 AND can_read = 1").
		WithArgs(int64(7), "related-user").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(1))

	review := reviewWithDocumentAccess("42", int64(7))
	if err := adapter.requireReviewDetailAccess(context.Background(), review, "related-user", true); err != nil {
		t.Fatalf("active document relation should allow review detail: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestReviewDetailRejectsUnrelatedUserAfterDocumentAccessRevocation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectQuery("(?s)SELECT 1\\s+FROM review_actions\\s+WHERE review_id = \\? AND actor_uid = \\?\\s+LIMIT 1").
		WithArgs("42", "revoked-user").
		WillReturnRows(sqlmock.NewRows([]string{"1"}))
	mock.ExpectQuery("(?s)SELECT permission\\s+FROM document_shares\\s+WHERE document_id = \\? AND shared_to_uid = \\?\\s+LIMIT 1").
		WithArgs(int64(7), "revoked-user").
		WillReturnRows(sqlmock.NewRows([]string{"permission"}))
	mock.ExpectQuery("(?s)SELECT TABLE_NAME\\s+FROM information_schema.TABLES").
		WithArgs("document_relations").
		WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_relations"))
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\)\\s+FROM document_relations\\s+WHERE document_id = \\? AND related_uid = \\? AND status = 1 AND can_read = 1").
		WithArgs(int64(7), "revoked-user").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))

	review := reviewWithDocumentAccess("42", int64(7))
	err = adapter.requireReviewDetailAccess(context.Background(), review, "revoked-user", true)
	assertReviewHTTPStatus(t, err, http.StatusForbidden)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func reviewWithDocumentAccess(reviewID string, documentID int64) map[string]any {
	return map[string]any{
		"id":                 reviewID,
		"initiator_uid":      "initiator",
		"current_node":       int64(0),
		"flow_snapshot":      `[{"reviewers":["current-reviewer"]}]`,
		"document_id":        documentID,
		"document_owner_uid": "owner",
		"document_status":    int64(1),
	}
}

func assertReviewHTTPStatus(t *testing.T, err error, expected int) {
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
