package codocs

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func completeOpsKnowledgeBody() map[string]any {
	return map[string]any{
		"documentUuid":            "DOC-1",
		"sourceApp":               "altoc",
		"artifactType":            "ops_knowledge",
		"customerCode":            "CU-1",
		"contractCode":            "CT-1",
		"maintenanceContractCode": "MC-1",
		"projectCode":             "PRJ-1",
		"deliveryCode":            "DLV-1",
		"deliveryAssetCode":       "CDA-1",
		"environmentCode":         "ENV-1",
		"ticketCode":              "ST-1",
		"current_user":            "untrusted-operator",
	}
}

func expectOpsKnowledgeDocument(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`(?s)SELECT id, uuid, title, doc_type.*FROM documents.*WHERE uuid = \? AND status <> 0.*FOR UPDATE`).
		WithArgs("DOC-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "uuid", "title", "doc_type", "owner_uid"}).
			AddRow(int64(10), "DOC-1", "故障复盘", "knowledge", "owner"))
}

func TestLinkOpsKnowledgeWritesCompleteContextAtomically(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}

	mock.ExpectBegin()
	expectOpsKnowledgeDocument(mock)
	for _, source := range []struct{ sourceType, sourceID string }{
		{"altoc_service_ticket", "ST-1"},
		{"assets_delivery_asset", "CDA-1"},
		{"assets_environment", "ENV-1"},
		{"altoc_contract", "CT-1"},
		{"aims_project", "PRJ-1"},
		{"altoc_customer", "CU-1"},
	} {
		mock.ExpectExec(`(?s)INSERT INTO document_relations.*ON DUPLICATE KEY UPDATE`).
			WithArgs(int64(10), "DOC-1", opsKnowledgeContextPrincipal, "ops_knowledge", source.sourceType, source.sourceID, 0, 0, 0, sqlmock.AnyArg()).
			WillReturnResult(sqlmock.NewResult(1, 1))
	}
	mock.ExpectCommit()

	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	result, err := adapter.linkOpsKnowledgeTx(context.Background(), tx, completeOpsKnowledgeBody())
	if err != nil {
		t.Fatalf("linkOpsKnowledge: %v", err)
	}
	if result["linkedCount"] != 6 {
		t.Fatalf("result = %#v, want six complete context relations", result)
	}
	if _, ok := result["relatedUid"]; ok {
		t.Fatalf("result = %#v, must not expose an ACL-related user", result)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestLinkOpsKnowledgeRollsBackPartialRelationFailure(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}

	mock.ExpectBegin()
	expectOpsKnowledgeDocument(mock)
	mock.ExpectExec(`(?s)INSERT INTO document_relations`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO document_relations`).WillReturnError(errors.New("write failed"))
	mock.ExpectRollback()

	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	if _, err := adapter.linkOpsKnowledgeTx(context.Background(), tx, completeOpsKnowledgeBody()); err == nil {
		t.Fatal("expected relation failure")
	}
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestLinkOpsKnowledgeRejectsMissingFormalEnvironment(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	mock.ExpectBegin()
	expectOpsKnowledgeDocument(mock)
	mock.ExpectRollback()

	body := completeOpsKnowledgeBody()
	delete(body, "environmentCode")
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	_, err = adapter.linkOpsKnowledgeTx(context.Background(), tx, body)
	_ = tx.Rollback()
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "ops_knowledge_context_incomplete" {
		t.Fatalf("error = %#v, want 400 ops_knowledge_context_incomplete", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
