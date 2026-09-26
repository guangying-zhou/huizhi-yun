package codocs

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func updatePlanIdentity() PersonalFolderCreationIdentity {
	return PersonalFolderCreationIdentity{Tenant: "tenant-1", Deployment: "codocs-dev", Actor: "owner-1", Client: "enterprise.runtime", RequestID: "req-1", Key: "update-key"}
}

func updateSummary(uuid string) string {
	digest, _ := io.ValidateAndDigestCommand(map[string]any{"targetBizType": "document", "targetBizCode": uuid})
	return digest
}

func updatePayload() map[string]any {
	return map[string]any{"title": "Old", "content_sha256": strings.Repeat("a", 64), "content_size": float64(12), "save_mode": "overwrite"}
}

func updateDocRows(owner, title, typ, path string, readonly, status int64) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "owner_uid", "title", "doc_type", "oss_path", "readonly_flag", "status"}).AddRow(7, owner, title, typ, path, readonly, status)
}

func TestPlanPersonalDocumentUpdateWithoutReceiptIsReadOnly(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := updatePlanIdentity()
	mock.ExpectQuery(`SELECT id, owner_uid, title, doc_type, oss_path, readonly_flag, status FROM documents`).WithArgs("doc-1").WillReturnRows(updateDocRows("owner-1", "Old", "private", "codocs/users/owner-1/doc-1.md", 0, 1))
	mock.ExpectQuery(`SELECT operation_id, required_capability.*FROM service_command_receipt`).WithArgs(id.Tenant, id.Deployment, id.Deployment, personalDocumentUpdateOperation, sqlmock.AnyArg()).WillReturnError(sql.ErrNoRows)
	got, err := (&Adapter{db: db}).PlanPersonalDocumentUpdate(context.Background(), id, "doc-1", map[string]any{"title": "Old"})
	if err != nil {
		t.Fatal(err)
	}
	if got["replayed"] != false || got["oss_path"] != "codocs/users/owner-1/doc-1.md" {
		t.Fatalf("unexpected plan: %#v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPlanPersonalDocumentUpdateReplayValidatesReceiptWithoutWriting(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := updatePlanIdentity()
	facts, err := personalDocumentUpdateFactsFor(id, "doc-1", map[string]any{"title": "Old"}, false)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery(`SELECT id, owner_uid, title, doc_type, oss_path, readonly_flag, status FROM documents`).WithArgs("doc-1").WillReturnRows(updateDocRows("owner-1", "Newer", "private", "codocs/users/owner-1/doc-1.md", 0, 1))
	mock.ExpectQuery(`SELECT operation_id, required_capability.*FROM service_command_receipt`).WithArgs(id.Tenant, id.Deployment, id.Deployment, personalDocumentUpdateOperation, facts.ReceiptKey).WillReturnRows(sqlmock.NewRows([]string{"operation_id", "required_capability", "command_schema_version", "command_sha256", "status", "target_biz_type", "target_biz_code", "response_http_status", "response_summary_sha256"}).AddRow(facts.OperationID, personalDocumentUpdateCapability, personalDocumentUpdateSchema, facts.Digest, "succeeded", "document", "doc-1", 200, updateSummary("doc-1")))
	got, err := (&Adapter{db: db}).PlanPersonalDocumentUpdate(context.Background(), id, "doc-1", map[string]any{"title": "Old"})
	if err != nil {
		t.Fatal(err)
	}
	if got["replayed"] != true || got["uuid"] != "doc-1" {
		t.Fatalf("unexpected replay: %#v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPlanPersonalDocumentUpdateRejectsRevokedShareReadonlyAndDatabaseFailure(t *testing.T) {
	for name, setup := range map[string]func(sqlmock.Sqlmock, PersonalFolderCreationIdentity){
		"revoked share": func(mock sqlmock.Sqlmock, id PersonalFolderCreationIdentity) {
			mock.ExpectQuery(`SELECT id, owner_uid, title, doc_type, oss_path, readonly_flag, status FROM documents`).WithArgs("doc-1").WillReturnRows(updateDocRows("owner-2", "Old", "private", "path", 0, 1))
			mock.ExpectQuery(`SELECT permission FROM document_shares`).WithArgs(int64(7), id.Actor).WillReturnError(sql.ErrNoRows)
		},
		"readonly": func(mock sqlmock.Sqlmock, _ PersonalFolderCreationIdentity) {
			mock.ExpectQuery(`SELECT id, owner_uid, title, doc_type, oss_path, readonly_flag, status FROM documents`).WithArgs("doc-1").WillReturnRows(updateDocRows("owner-1", "Old", "private", "path", 1, 1))
		},
		"database failure": func(mock sqlmock.Sqlmock, _ PersonalFolderCreationIdentity) {
			mock.ExpectQuery(`SELECT id, owner_uid, title, doc_type, oss_path, readonly_flag, status FROM documents`).WithArgs("doc-1").WillReturnError(errors.New("db unavailable"))
		},
	} {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			id := updatePlanIdentity()
			setup(mock, id)
			if _, err := (&Adapter{db: db}).PlanPersonalDocumentUpdate(context.Background(), id, "doc-1", map[string]any{"title": "Old"}); err == nil {
				t.Fatal("expected failure")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCommitPersonalDocumentUpdateReplayDoesNotInsertVersion(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := updatePlanIdentity()
	payload := updatePayload()
	payload["oss_version_id"] = "new-storage-version-for-same-content"
	facts, err := personalDocumentUpdateFactsFor(id, "doc-1", payload, true)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id, owner_uid, title, readonly_flag, status FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1 FOR UPDATE`).WithArgs("doc-1").WillReturnRows(sqlmock.NewRows([]string{"id", "owner_uid", "title", "readonly_flag", "status"}).AddRow(7, "owner-1", "Old", 0, 1))
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).WithArgs(id.Tenant, id.Deployment, id.Deployment, "codocs", "codocs", personalDocumentUpdateOperation, facts.ReceiptKey).WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "operation_id", "required_capability", "command_schema_version", "command_sha256", "status", "target_biz_type", "target_biz_code", "response_http_status", "response_summary_sha256", "version_no"}).AddRow("receipt-1", facts.OperationID, personalDocumentUpdateCapability, personalDocumentUpdateSchema, facts.Digest, "succeeded", "document", "doc-1", 200, strings.Repeat("a", 64), 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET last_request_id`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	got, err := (&Adapter{db: db}).CommitPersonalDocumentUpdate(context.Background(), id, "doc-1", payload)
	if err != nil || got["updated"] != true {
		t.Fatalf("result=%#v err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestUpdatePlanCommandMatchesHistoricalCommitDigestAndRejectsStorageInjection(t *testing.T) {
	id := updatePlanIdentity()
	payload := updatePayload()
	plan, err := personalDocumentUpdateFactsFor(id, "doc-1", payload, false)
	if err != nil {
		t.Fatal(err)
	}
	historical, _ := io.ValidateAndDigestCommand(map[string]any{"uuid": "doc-1", "actor": id.Actor, "title": "Old", "content_sha256": strings.Repeat("a", 64), "content_size": int64(12), "save_mode": "overwrite"})
	if plan.Digest != historical {
		t.Fatal("historical command digest drift")
	}
	if _, err := personalDocumentUpdateFactsFor(id, "doc-1", payload, true); err == nil {
		t.Fatal("commit accepted missing storage version")
	}
	for _, version := range []string{"", strings.Repeat("x", 256), "v1", "v2"} {
		payload["oss_version_id"] = version
		commit, err := personalDocumentUpdateFactsFor(id, "doc-1", payload, true)
		if version == "v1" || version == "v2" {
			if err != nil || commit.Digest != plan.Digest || commit.ReceiptKey != plan.ReceiptKey || commit.OperationID != plan.OperationID {
				t.Fatal("plan/commit identity drift")
			}
		} else if err == nil {
			t.Fatal("invalid version accepted")
		}
		if _, err := personalDocumentUpdateFactsFor(id, "doc-1", payload, false); err == nil {
			t.Fatal("plan accepted storage version")
		}
	}
}

func TestUpdatePlanRejectsConflictingAndCorruptReceipts(t *testing.T) {
	facts, _ := personalDocumentUpdateFactsFor(updatePlanIdentity(), "doc-1", updatePayload(), false)
	good := personalDocumentUpdateReceipt{OperationID: facts.OperationID, Capability: personalDocumentUpdateCapability, Schema: personalDocumentUpdateSchema, Digest: facts.Digest, Status: "succeeded", TargetType: "document", TargetCode: "doc-1", HTTPStatus: 200, ResponseSummary: updateSummary("doc-1")}
	for _, tc := range []struct {
		name   string
		status int
		mutate func(*personalDocumentUpdateReceipt)
	}{
		{"digest", 409, func(r *personalDocumentUpdateReceipt) { r.Digest = strings.Repeat("b", 64) }},
		{"operation", 409, func(r *personalDocumentUpdateReceipt) { r.OperationID = "other" }},
		{"capability", 409, func(r *personalDocumentUpdateReceipt) { r.Capability = "codocs:personal-documents:read" }},
		{"schema", 409, func(r *personalDocumentUpdateReceipt) { r.Schema = "other" }},
		{"processing", 503, func(r *personalDocumentUpdateReceipt) { r.Status = "processing" }},
		{"target", 503, func(r *personalDocumentUpdateReceipt) { r.TargetCode = "other" }},
		{"type", 503, func(r *personalDocumentUpdateReceipt) { r.TargetType = "other" }},
		{"http", 503, func(r *personalDocumentUpdateReceipt) { r.HTTPStatus = 500 }},
		{"summary", 503, func(r *personalDocumentUpdateReceipt) { r.ResponseSummary = strings.Repeat("b", 64) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := good
			tc.mutate(&r)
			var he httperror.Error
			if err := validatePersonalDocumentUpdateReceipt(&r, facts, "doc-1"); !errors.As(err, &he) || he.Status != tc.status {
				t.Fatalf("err=%v expected %d", err, tc.status)
			}
		})
	}
}

func TestUpdatePlanProcessingReceiptWithNullableResponseFailsClosed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := updatePlanIdentity()
	payload := updatePayload()
	facts, _ := personalDocumentUpdateFactsFor(id, "doc-1", payload, false)
	mock.ExpectQuery(`SELECT id, owner_uid, title, doc_type, oss_path, readonly_flag, status FROM documents`).WithArgs("doc-1").WillReturnRows(updateDocRows("owner-1", "Old", "private", "codocs/doc-1.md", 0, 1))
	mock.ExpectQuery(`SELECT operation_id, required_capability.*FROM service_command_receipt`).WithArgs(id.Tenant, id.Deployment, id.Deployment, personalDocumentUpdateOperation, facts.ReceiptKey).WillReturnRows(sqlmock.NewRows([]string{"operation_id", "required_capability", "command_schema_version", "command_sha256", "status", "target_biz_type", "target_biz_code", "response_http_status", "response_summary_sha256"}).AddRow(facts.OperationID, personalDocumentUpdateCapability, personalDocumentUpdateSchema, facts.Digest, "processing", nil, nil, nil, nil))
	_, err = (&Adapter{db: db}).PlanPersonalDocumentUpdate(context.Background(), id, "doc-1", payload)
	var he httperror.Error
	if !errors.As(err, &he) || he.Status != 503 {
		t.Fatalf("expected retryable 503, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
