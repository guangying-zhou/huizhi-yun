package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func recycleIdentity() PersonalFolderCreationIdentity {
	return PersonalFolderCreationIdentity{Tenant: "tenant-1", Deployment: "codocs-dev", Actor: "owner-1", Client: "enterprise.runtime", RequestID: "req-1", Key: "recycle-key"}
}

func recycleDocRows(kind, owner string, status, readonly int64) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "uuid", "doc_type", "owner_uid", "status", "readonly_flag", "oss_path"}).AddRow(51, "doc-recycle", kind, owner, status, readonly, "codocs/document-creations/doc-recycle/body.md")
}

func expectRecycleDoc(mock sqlmock.Sqlmock, kind, owner string, status, readonly int64) {
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? LIMIT 1 FOR UPDATE`).WithArgs("doc-recycle").WillReturnRows(recycleDocRows(kind, owner, status, readonly))
}

func recycleReceiptKey(identity PersonalFolderCreationIdentity) (string, string, string) {
	command := map[string]any{"uuid": "doc-recycle", "actor": identity.Actor}
	raw, _ := json.Marshal(command)
	digest, _ := io.ValidateAndDigestCommand(command)
	ns := sha256.Sum256([]byte(strings.Join([]string{"codocs.personal-documents.recycle.v1", identity.Tenant, identity.Deployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(ns[:])
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	op := fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16])
	_ = raw
	return key, op, digest
}

func expectRecycleReceiptMissing(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).WillReturnError(sql.ErrNoRows)
}

func TestRecyclePersonalDocumentWritesReceiptAndOnlyStatusFields(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := recycleIdentity()
	key, op, digest := recycleReceiptKey(id)
	mock.ExpectBegin()
	expectRecycleDoc(mock, "private", "owner-1", 1, 0)
	expectRecycleReceiptMissing(mock)
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE documents SET status = 0, deleted_at = NOW\(\), updated_at = NOW\(\) WHERE uuid = \?`).WithArgs("doc-recycle").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	got, err := (&Adapter{db: db}).RecyclePersonalDocument(context.Background(), id, "doc-recycle")
	if err != nil || got["deleted"] != true {
		t.Fatalf("result=%#v err=%v", got, err)
	}
	_ = key
	_ = op
	_ = digest
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRecyclePersonalDocumentReplayRechecksACLAndDoesNotUpdate(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := recycleIdentity()
	key, op, digest := recycleReceiptKey(id)
	mock.ExpectBegin()
	expectRecycleDoc(mock, "slide", "owner-1", 1, 0)
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).WithArgs("tenant-1", "codocs-dev", "codocs-dev", "codocs", "codocs", "codocs.personal-documents.recycle.v1", key).WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "operation_id", "required_capability", "command_schema_version", "command_sha256", "status", "target_biz_type", "target_biz_code", "response_http_status", "response_summary_sha256", "version_no"}).AddRow("receipt-1", op, "codocs:personal-documents:delete", "codocs-personal-recycle.v1", digest, "succeeded", "document", "doc-recycle", 200, strings.Repeat("a", 64), 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET last_request_id`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	if _, err := (&Adapter{db: db}).RecyclePersonalDocument(context.Background(), id, "doc-recycle"); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRecyclePersonalDocumentRejectsACLReadonlyAndScopeWithRollback(t *testing.T) {
	cases := []struct {
		name, kind, owner string
		status, readonly  int64
		actor             string
		want              int
	}{
		{"other owner", "private", "other", 1, 0, "owner-1", 403}, {"readonly", "private", "owner-1", 1, 1, "owner-1", 403}, {"nonpersonal", "department", "owner-1", 1, 0, "owner-1", 403},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			id := recycleIdentity()
			id.Actor = tc.actor
			mock.ExpectBegin()
			expectRecycleDoc(mock, tc.kind, tc.owner, tc.status, tc.readonly)
			if tc.name == "other owner" {
				mock.ExpectQuery(`SELECT permission\s+FROM document_shares.*FOR UPDATE`).WithArgs(int64(51), tc.actor).WillReturnError(sql.ErrNoRows)
			}
			mock.ExpectRollback()
			_, err = (&Adapter{db: db}).RecyclePersonalDocument(context.Background(), id, "doc-recycle")
			var he httperror.Error
			if err == nil || !errors.As(err, &he) || he.Status != tc.want {
				t.Fatalf("err=%v", err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
