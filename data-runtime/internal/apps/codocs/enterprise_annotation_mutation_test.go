package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func annotationIdentity() PersonalFolderCreationIdentity {
	return PersonalFolderCreationIdentity{Tenant: "tenant-1", Deployment: "codocs-test", Actor: "owner-1", Client: "enterprise.runtime", RequestID: "req-1", Key: "annotation-key"}
}

func annotationReceiptFacts(identity PersonalFolderCreationIdentity, command map[string]any) (string, string, string) {
	digest, _ := io.ValidateAndDigestCommand(command)
	ns := sha256.Sum256([]byte(strings.Join([]string{enterpriseAnnotationMutationOperation, identity.Tenant, identity.Deployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(ns[:])
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	op := fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16])
	return key, op, digest
}

func expectAnnotationOwnerDocument(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1 FOR UPDATE`).
		WithArgs("doc-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "uuid", "owner_uid", "status", "readonly_flag"}).AddRow(12, "doc-1", "owner-1", 1, 0))
}

func TestMutateEnterpriseAnnotationCreateAndReplayAreStable(t *testing.T) {
	payload := map[string]any{"selected_text": "selected", "content": "comment", "mentioned_users": []any{"u2"}}
	identity := annotationIdentity()
	command := map[string]any{"action": "create", "uuid": "doc-1", "annotation_id": "", "reply_id": "", "payload": payload, "actor": identity.Actor}
	key, op, digest := annotationReceiptFacts(identity, command)

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	expectAnnotationOwnerDocument(mock)
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*FOR UPDATE`).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO document_annotations`).
		WithArgs("doc-1", "selected", "", "", int64(0), "comment", `["u2"]`, "owner-1", "owner-1").
		WillReturnResult(sqlmock.NewResult(55, 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	got, err := (&Adapter{db: db}).MutateEnterpriseAnnotation(context.Background(), identity, "create", "doc-1", "", "", payload)
	if err != nil || got["id"] != int64(55) {
		t.Fatalf("result=%#v err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}

	db2, mock2, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db2.Close()
	mock2.ExpectBegin()
	expectAnnotationOwnerDocument(mock2)
	mock2.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*FOR UPDATE`).
		WithArgs(identity.Tenant, identity.Deployment, identity.Deployment, "codocs", "codocs", enterpriseAnnotationMutationOperation, key).
		WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "operation_id", "required_capability", "command_schema_version", "command_sha256", "status", "target_biz_type", "target_biz_code", "response_http_status", "response_summary_sha256", "version_no"}).
			AddRow("receipt-1", op, "codocs:document-annotations:create", "codocs-annotation-mutation.v1", digest, "succeeded", "annotation", "55", 200, strings.Repeat("a", 64), 1))
	mock2.ExpectExec(`UPDATE service_command_receipt.*SET last_request_id`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock2.ExpectCommit()
	got, err = (&Adapter{db: db2}).MutateEnterpriseAnnotation(context.Background(), identity, "create", "doc-1", "", "", payload)
	if err != nil || got["id"] != int64(55) {
		t.Fatalf("replay=%#v err=%v", got, err)
	}
	if err := mock2.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestMutateEnterpriseAnnotationRejectsMissingIdentityBeforeDatabase(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	identity := annotationIdentity()
	identity.Key = ""
	if _, err = (&Adapter{db: db}).MutateEnterpriseAnnotation(context.Background(), identity, "create", "doc-1", "", "", map[string]any{"selected_text": "a", "content": "b"}); err == nil {
		t.Fatal("missing idempotency identity accepted")
	}
}
