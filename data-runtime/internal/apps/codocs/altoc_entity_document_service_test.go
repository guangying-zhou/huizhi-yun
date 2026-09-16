package codocs

import (
	"context"
	"net/http"
	"net/url"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func altocEntityDocumentQuery() url.Values {
	return url.Values{
		"current_user": {"reader-uid"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_actor_purpose": {"service-command"},
	}
}

func altocEntityDocumentBody(uuid, action string) map[string]any {
	isContent := action == "content:read"
	operation, capability, schema := altocEntityDocumentAttachOperation, altocEntityDocumentAttachCapability, altocEntityDocumentAttachSchema
	if isContent {
		operation, capability, schema = altocEntityDocumentContentOperation, altocEntityDocumentContentCapability, altocEntityDocumentContentSchema
	}
	return map[string]any{
		integrationoperation.TrustedServiceCommandTenantKey: "TENANT-1", integrationoperation.TrustedServiceCommandSourceDeploymentKey: "ALTOC-DEPLOYMENT",
		integrationoperation.TrustedServiceCommandTargetDeploymentKey: "CODOCS-DEPLOYMENT", integrationoperation.TrustedServiceCommandSourceAppKey: "altoc",
		integrationoperation.TrustedServiceCommandTargetAppKey: "codocs", integrationoperation.TrustedServiceCommandSourceClientKey: "altoc",
		integrationoperation.ServiceCommandEnvelopeKey: map[string]any{
			"targetApp": "codocs", "operationCode": operation, "requiredCapability": capability, "commandSchemaVersion": schema,
			"command": map[string]any{"actorUid": "reader-uid", "entityType": "contract", "entityId": 42, "documentUuid": uuid, "action": action},
		},
	}
}

func altocEntityDocumentRows(uuid, owner, share string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "uuid", "title", "owner_uid", "doc_type", "readonly_flag", "status", "oss_path", "content_size", "updated_at"}).
		AddRow(19, uuid, "Contract draft", owner, "sale", 0, 1, "codocs/sale/CT-1/draft.md", 42, "2026-07-12 12:00:00")
}

func TestAltocEntityDocumentServiceRejectsInvalidSourceBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	body := altocEntityDocumentBody("doc-1", "content:read")
	body[integrationoperation.TrustedServiceCommandSourceClientKey] = "altoc.worker"
	_, _, err = (&Adapter{db: db}).HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/service/altoc-entity-documents/doc-1/content", altocEntityDocumentQuery(), body)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "altoc_entity_document_service_command_invalid" {
		t.Fatalf("error = %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAltocEntityDocumentContentRequiresCodocsACL(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1")).WithArgs("doc-1").WillReturnRows(altocEntityDocumentRows("doc-1", "owner-uid", ""))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT permission\n      FROM document_shares\n      WHERE document_id = ? AND shared_to_uid = ?\n      LIMIT 1")).WithArgs(int64(19), "reader-uid").WillReturnRows(sqlmock.NewRows([]string{"permission"}))
	mock.ExpectQuery(`(?s)SELECT TABLE_NAME.*FROM information_schema\.TABLES.*TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = \?.*LIMIT 1`).WithArgs("document_relations").WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_relations"))
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*FROM document_relations.*document_id = \? AND related_uid = \? AND status = 1 AND can_read = 1`).WithArgs(int64(19), "reader-uid").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	_, _, err = (&Adapter{db: db}).HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/service/altoc-entity-documents/doc-1/content", altocEntityDocumentQuery(), altocEntityDocumentBody("doc-1", "content:read"))
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "permission_denied" {
		t.Fatalf("error = %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAltocEntityDocumentAttachRequiresWriteShare(t *testing.T) {
	t.Run("read share cannot attach", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1")).WithArgs("doc-1").WillReturnRows(altocEntityDocumentRows("doc-1", "owner-uid", ""))
		mock.ExpectQuery(regexp.QuoteMeta("SELECT permission\n      FROM document_shares\n      WHERE document_id = ? AND shared_to_uid = ?\n      LIMIT 1")).WithArgs(int64(19), "reader-uid").WillReturnRows(sqlmock.NewRows([]string{"permission"}).AddRow("read"))
		_, _, err = (&Adapter{db: db}).HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/service/altoc-entity-documents/doc-1/attach", altocEntityDocumentQuery(), altocEntityDocumentBody("doc-1", "attach:authorize"))
		httpErr, ok := err.(httperror.Error)
		if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "altoc_entity_document_attach_denied" {
			t.Fatalf("error = %#v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("write share can attach", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1")).WithArgs("doc-1").WillReturnRows(altocEntityDocumentRows("doc-1", "owner-uid", ""))
		mock.ExpectQuery(regexp.QuoteMeta("SELECT permission\n      FROM document_shares\n      WHERE document_id = ? AND shared_to_uid = ?\n      LIMIT 1")).WithArgs(int64(19), "reader-uid").WillReturnRows(sqlmock.NewRows([]string{"permission"}).AddRow("write"))
		result, _, err := (&Adapter{db: db}).HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/service/altoc-entity-documents/doc-1/attach", altocEntityDocumentQuery(), altocEntityDocumentBody("doc-1", "attach:authorize"))
		if err != nil {
			t.Fatal(err)
		}
		if result.(map[string]any)["data"].(map[string]any)["uuid"] != "doc-1" {
			t.Fatalf("unexpected result %#v", result)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}
