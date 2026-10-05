package codocs

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

var publishExecutionColumns = []string{
	"id", "document_id", "document_uuid", "review_type", "sub_type", "initiator_uid",
	"target_category", "extra", "review_oss_path", "workflow_status", "archive_oss_path",
	"execution_status", "published_document_uuid", "title", "doc_type", "oss_path",
	"content_size", "dept_code", "status",
}

func trustedPublishExecutionQuery(uid string) url.Values {
	return url.Values{
		"current_user":                {uid},
		"hzy_runtime_actor_delegated": {"1"},
	}
}

func workflowPublishExecutionRow(executionStatus any) *sqlmock.Rows {
	return sqlmock.NewRows(publishExecutionColumns).AddRow(
		int64(42),
		int64(7),
		"source-doc-uuid",
		"对外发文",
		"对外发文",
		"initiator",
		"department",
		`{"needsOfficialSeal":true}`,
		"codocs/reviews/42/source.md",
		"approved",
		nullableExecutionValue(executionStatus, "codocs/departments/D1/outsides/Outbound_Notice_42.md"),
		executionStatus,
		nullableExecutionValue(executionStatus, stablePublishedDocumentUUID(42, "source-doc-uuid")),
		"Outbound / Notice",
		"personal",
		"codocs/personal/initiator/source.md",
		int64(128),
		"D1",
		int64(1),
	)
}

func nullableExecutionValue(executionStatus any, value string) any {
	if executionStatus == nil {
		return nil
	}
	return value
}

func expectPublishExecutionRow(mock sqlmock.Sqlmock, executionStatus any) {
	mock.ExpectQuery(`(?s)SELECT pr\.id,pr\.document_id.*FROM document_publish_requests pr.*FOR UPDATE`).
		WithArgs(int64(42)).
		WillReturnRows(workflowPublishExecutionRow(executionStatus))
}

func TestPublishExecutionRoutesRejectUnsignedActorBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	for _, item := range []struct {
		name string
		path string
		body map[string]any
	}{
		{name: "archive-plan", path: "/v1/codocs/reviews/publish-requests/42/archive-plan", body: map[string]any{}},
		{name: "archive", path: "/v1/codocs/reviews/publish-requests/42/archive", body: map[string]any{}},
		{name: "seal", path: "/v1/codocs/reviews/publish-requests/42/seal", body: map[string]any{"sealTypes": []any{"official"}, "pageCount": 1}},
		{name: "send", path: "/v1/codocs/reviews/publish-requests/42/send", body: map[string]any{
			"senderUid": "sender", "receiverName": "Receiver", "receiverPhone": "123",
			"channel": "email", "sentDate": time.Now().Format("2006-01-02"), "targetAccount": "receiver@example.com",
		}},
		{name: "receive", path: "/v1/codocs/reviews/publish-requests/42/receive", body: map[string]any{"receiveDate": time.Now().Format("2006-01-02")}},
	} {
		t.Run(item.name, func(t *testing.T) {
			_, _, err := adapter.HandleRuntime(context.Background(), http.MethodPost, item.path, url.Values{
				"current_user": {"unsigned-user"},
			}, item.body)
			assertReviewHTTPStatus(t, err, http.StatusForbidden)
		})
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unsigned execution command accessed storage: %v", err)
	}
}

func TestPreparePublishArchiveReturnsStableTrustedPlan(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectBegin()
	expectPublishExecutionRow(mock, nil)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT uuid FROM documents WHERE oss_path=? AND status<>0 LIMIT 1")).
		WithArgs("codocs/departments/D1/outsides/Outbound_Notice_42.md").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectCommit()

	result, err := adapter.preparePublishArchive(context.Background(), "42", trustedPublishExecutionQuery("initiator"))
	if err != nil {
		t.Fatalf("preparePublishArchive: %v", err)
	}
	if result["archiveOssPath"] != "codocs/departments/D1/outsides/Outbound_Notice_42.md" {
		t.Fatalf("archiveOssPath = %#v", result["archiveOssPath"])
	}
	if result["publishedDocumentUuid"] != stablePublishedDocumentUUID(42, "source-doc-uuid") {
		t.Fatalf("publishedDocumentUuid = %#v", result["publishedDocumentUuid"])
	}
	if result["initialExecutionStatus"] != "pending_seal" || result["alreadyArchived"] != false {
		t.Fatalf("unexpected plan state: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestPreparePublishArchiveRequiresWorkflowInitiator(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectBegin()
	expectPublishExecutionRow(mock, nil)
	mock.ExpectRollback()

	_, err = adapter.preparePublishArchive(context.Background(), "42", trustedPublishExecutionQuery("other-user"))
	assertReviewHTTPStatus(t, err, http.StatusForbidden)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestCommitPublishArchivePersistsPublishedDocumentAndWorkflowExecution(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	publishedUUID := stablePublishedDocumentUUID(42, "source-doc-uuid")
	archivePath := "codocs/departments/D1/outsides/Outbound_Notice_42.md"
	mock.ExpectBegin()
	expectPublishExecutionRow(mock, nil)
	mock.ExpectQuery(`SELECT id FROM documents WHERE \(uuid=\? OR oss_path=\?\) AND status<>0 LIMIT 1`).
		WithArgs(publishedUUID, archivePath).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`(?s)INSERT INTO documents.*VALUES`).
		WithArgs(
			publishedUUID,
			"Outbound / Notice",
			"department",
			archivePath,
			"initiator",
			"D1",
			int64(128),
			"initiator",
		).
		WillReturnResult(sqlmock.NewResult(77, 1))
	mock.ExpectExec(`(?s)INSERT INTO document_relations.*ON DUPLICATE KEY UPDATE`).
		WithArgs(
			int64(77), publishedUUID, "initiator", "created_by_me", "document", "77",
			1, 1, 0, sqlmock.AnyArg(),
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO document_relations.*ON DUPLICATE KEY UPDATE`).
		WithArgs(
			int64(77), publishedUUID, "initiator", "outside_initiator", "publish_request", "42",
			1, 0, 0, sqlmock.AnyArg(),
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE documents SET publish_info=\?,readonly_flag=1,updated_at=NOW\(\) WHERE id=\? AND uuid=\?`).
		WithArgs(sqlmock.AnyArg(), int64(7), "source-doc-uuid").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE document_publish_requests.*SET archive_oss_path=\?,execution_status=\?,published_document_uuid=\?`).
		WithArgs(archivePath, "pending_seal", publishedUUID, int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := adapter.commitPublishArchive(context.Background(), "42", trustedPublishExecutionQuery("initiator"), map[string]any{
		"archiveOssPath":        archivePath,
		"publishedDocumentUuid": publishedUUID,
	})
	if err != nil {
		t.Fatalf("commitPublishArchive: %v", err)
	}
	if result["publishedDocumentId"] != int64(77) || result["executionStatus"] != "pending_seal" || result["idempotent"] != false {
		t.Fatalf("unexpected archive result: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestConfirmPublishSealAdvancesExecutionAndAddsHandlerRelation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectBegin()
	expectPublishExecutionRow(mock, "pending_seal")
	mock.ExpectExec(`(?s)INSERT INTO document_seal_records`).
		WithArgs(int64(42), stablePublishedDocumentUUID(42, "source-doc-uuid"), `["legal","official"]`, int64(3), "seal-admin", "checked").
		WillReturnResult(sqlmock.NewResult(91, 1))
	mock.ExpectExec(`(?s)UPDATE document_publish_requests.*execution_status='pending_send'`).
		WithArgs(int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT id FROM documents WHERE uuid=\? AND oss_path=\? AND status=2 LIMIT 1 FOR UPDATE`).
		WithArgs(stablePublishedDocumentUUID(42, "source-doc-uuid"), "codocs/departments/D1/outsides/Outbound_Notice_42.md").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(77)))
	mock.ExpectExec(`(?s)INSERT INTO document_relations.*ON DUPLICATE KEY UPDATE`).
		WithArgs(
			int64(77),
			stablePublishedDocumentUUID(42, "source-doc-uuid"),
			"seal-admin",
			"outside_seal_handler",
			"publish_request",
			"42",
			1,
			0,
			0,
			sqlmock.AnyArg(),
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	result, err := adapter.confirmPublishSeal(context.Background(), "42", trustedPublishExecutionQuery("seal-admin"), map[string]any{
		"sealTypes": []any{"official", "legal", "official"},
		"pageCount": float64(3),
		"remark":    "checked",
	})
	if err != nil {
		t.Fatalf("confirmPublishSeal: %v", err)
	}
	if result["executionStatus"] != "pending_send" || result["idempotent"] != false || result["id"] != int64(91) {
		t.Fatalf("unexpected seal result: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestConfirmPublishSendAdvancesExecutionAndDelegatesReceipt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	today := time.Now().Format("2006-01-02")
	mock.ExpectBegin()
	expectPublishExecutionRow(mock, "pending_send")
	mock.ExpectExec(`(?s)INSERT INTO document_send_records`).
		WithArgs(
			int64(42), stablePublishedDocumentUUID(42, "source-doc-uuid"), "sender",
			"Receiver", "123", "email", today, "receiver@example.com", nil,
		).
		WillReturnResult(sqlmock.NewResult(92, 1))
	mock.ExpectExec(`(?s)UPDATE document_publish_requests.*execution_status='pending_receive'`).
		WithArgs(int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT id FROM documents WHERE uuid=\? AND oss_path=\? AND status=2 LIMIT 1 FOR UPDATE`).
		WithArgs(stablePublishedDocumentUUID(42, "source-doc-uuid"), "codocs/departments/D1/outsides/Outbound_Notice_42.md").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(77)))
	mock.ExpectExec(`(?s)INSERT INTO document_relations.*ON DUPLICATE KEY UPDATE`).
		WithArgs(
			int64(77),
			stablePublishedDocumentUUID(42, "source-doc-uuid"),
			"sender",
			"outside_sender",
			"publish_request",
			"42",
			1,
			0,
			0,
			sqlmock.AnyArg(),
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	result, err := adapter.confirmPublishSend(context.Background(), "42", trustedPublishExecutionQuery("initiator"), map[string]any{
		"senderUid": "sender", "receiverName": "Receiver", "receiverPhone": "123",
		"channel": "email", "sentDate": today, "targetAccount": "receiver@example.com",
	})
	if err != nil {
		t.Fatalf("confirmPublishSend: %v", err)
	}
	if result["executionStatus"] != "pending_receive" || result["senderUid"] != "sender" || result["id"] != int64(92) {
		t.Fatalf("unexpected send result: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestConfirmPublishReceiveRequiresDesignatedSenderAndCompletes(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	today := time.Now().Format("2006-01-02")
	mock.ExpectBegin()
	expectPublishExecutionRow(mock, "pending_receive")
	mock.ExpectQuery(`(?s)SELECT id,sender_uid.*FROM document_send_records.*FOR UPDATE`).
		WithArgs(int64(42), stablePublishedDocumentUUID(42, "source-doc-uuid")).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "sender_uid", "receiver_name", "receiver_phone", "channel", "sent_date", "receive_date", "target_account", "remark",
		}).AddRow(int64(92), "sender", "Receiver", "123", "email", today, nil, "receiver@example.com", nil))
	mock.ExpectExec(`(?s)UPDATE document_send_records.*receive_date=\?`).
		WithArgs(today, int64(92)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE document_publish_requests.*execution_status='received'`).
		WithArgs(int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := adapter.confirmPublishReceive(context.Background(), "42", trustedPublishExecutionQuery("sender"), map[string]any{
		"receiveDate": today,
	})
	if err != nil {
		t.Fatalf("confirmPublishReceive: %v", err)
	}
	if result["executionStatus"] != "received" || result["idempotent"] != false {
		t.Fatalf("unexpected receive result: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestStringListJSONValueSupportsMySQLJSONBytes(t *testing.T) {
	values := stringListJSONValue([]byte(`["official","legal"]`))
	if len(values) != 2 || values[0] != "official" || values[1] != "legal" {
		t.Fatalf("values = %#v", values)
	}
}

func TestPositiveIntegerInputRejectsFractionalSealPages(t *testing.T) {
	if _, ok := positiveIntegerInput(float64(1.5)); ok {
		t.Fatal("fractional page count must be rejected")
	}
	if value, ok := positiveIntegerInput(float64(2)); !ok || value != 2 {
		t.Fatalf("integer JSON number = %d, %v", value, ok)
	}
}
