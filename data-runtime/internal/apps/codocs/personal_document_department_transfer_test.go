package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func departmentTransferIdentity() PersonalFolderCreationIdentity {
	return PersonalFolderCreationIdentity{Tenant: "tenant-1", Deployment: "codocs-test", Actor: "owner-1", Client: "enterprise.runtime", RequestID: "req-1", Key: "transfer-key"}
}

func departmentTransferReceiptFacts(identity PersonalFolderCreationIdentity, uuid, deptCode, message string) (string, string, string) {
	command := map[string]any{"uuid": uuid, "actor": identity.Actor, "dept_code": deptCode, "message": message}
	digest, _ := io.ValidateAndDigestCommand(command)
	ns := sha256.Sum256([]byte(strings.Join([]string{personalDocumentDepartmentTransferOperation, identity.Tenant, identity.Deployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(ns[:])
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	op := fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16])
	return key, op, digest
}

func expectDepartmentTransferDocument(mock sqlmock.Sqlmock, uuid, owner, kind string, readonly int, dept any) {
	mock.ExpectQuery(`(?s)SELECT id, owner_uid, doc_type, readonly_flag, dept_code.*FROM documents.*WHERE uuid = \? AND status <> 0.*FOR UPDATE`).
		WithArgs(uuid).
		WillReturnRows(sqlmock.NewRows([]string{"id", "owner_uid", "doc_type", "readonly_flag", "dept_code"}).AddRow(88, owner, kind, readonly, dept))
}

func expectDepartmentTransferReceiptMissing(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).WillReturnError(sql.ErrNoRows)
}

func TestCreatePersonalDocumentDepartmentTransferWritesShareAndReceiptInOneTransaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := departmentTransferIdentity()
	key, op, digest := departmentTransferReceiptFacts(id, "doc-1", "dept-a", "please receive")
	mock.ExpectBegin()
	expectDepartmentTransferDocument(mock, "doc-1", "owner-1", "private", 0, nil)
	expectDepartmentTransferReceiptMissing(mock)
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT id FROM department_shares.*WHERE document_id = \? AND dept_code = \? AND status = 'pending'.*FOR UPDATE`).
		WithArgs(int64(88), "dept-a").WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`(?s)INSERT INTO department_shares.*\(document_id, from_dept_code, dept_code, shared_by, status, message\)`).
		WithArgs(int64(88), "", "dept-a", "owner-1", "please receive").WillReturnResult(sqlmock.NewResult(77, 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	got, err := (&Adapter{db: db}).CreatePersonalDocumentDepartmentTransfer(context.Background(), id, "doc-1", "dept-a", "please receive")
	if err != nil || got["shareId"] != "77" || got["status"] != "pending" {
		t.Fatalf("result=%#v err=%v", got, err)
	}
	_ = key
	_ = op
	_ = digest
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreatePersonalDocumentDepartmentTransferReplayReturnsStableShareID(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := departmentTransferIdentity()
	key, op, digest := departmentTransferReceiptFacts(id, "doc-1", "dept-a", "please receive")
	mock.ExpectBegin()
	expectDepartmentTransferDocument(mock, "doc-1", "owner-1", "private", 0, "source-dept")
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).
		WithArgs(id.Tenant, id.Deployment, id.Deployment, "codocs", "codocs", personalDocumentDepartmentTransferOperation, key).
		WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "operation_id", "required_capability", "command_schema_version", "command_sha256", "status", "target_biz_type", "target_biz_code", "response_http_status", "response_summary_sha256", "version_no"}).
			AddRow("receipt-1", op, "codocs:document-transfer:department", "codocs-dept-transfer.v1", digest, "succeeded", "department-share", "77", 200, strings.Repeat("a", 64), 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET last_request_id`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	got, err := (&Adapter{db: db}).CreatePersonalDocumentDepartmentTransfer(context.Background(), id, "doc-1", "dept-a", "please receive")
	if err != nil || got["shareId"] != "77" {
		t.Fatalf("result=%#v err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreatePersonalDocumentDepartmentTransferRejectsExistingPending(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := departmentTransferIdentity()
	mock.ExpectBegin()
	expectDepartmentTransferDocument(mock, "doc-1", "owner-1", "private", 0, nil)
	expectDepartmentTransferReceiptMissing(mock)
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT id FROM department_shares.*WHERE document_id = \? AND dept_code = \? AND status = 'pending'.*FOR UPDATE`).
		WithArgs(int64(88), "dept-a").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(66))
	mock.ExpectRollback()

	_, err = (&Adapter{db: db}).CreatePersonalDocumentDepartmentTransfer(context.Background(), id, "doc-1", "dept-a", "another")
	var he httperror.Error
	if err == nil || !errors.As(err, &he) || he.Status != 409 {
		t.Fatalf("err=%v, want HTTP 409", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreatePersonalDocumentDepartmentTransferRejectsInvalidDocumentBeforeReceipt(t *testing.T) {
	cases := []struct {
		name, owner, kind string
		readonly, want    int
	}{
		{name: "other owner", owner: "other", kind: "private", want: 403},
		{name: "non private", owner: "owner-1", kind: "department", want: 400},
		{name: "readonly", owner: "owner-1", kind: "private", readonly: 1, want: 403},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			expectDepartmentTransferDocument(mock, "doc-1", tc.owner, tc.kind, tc.readonly, nil)
			mock.ExpectRollback()
			_, err = (&Adapter{db: db}).CreatePersonalDocumentDepartmentTransfer(context.Background(), departmentTransferIdentity(), "doc-1", "dept-a", "")
			var he httperror.Error
			if err == nil || !errors.As(err, &he) || he.Status != tc.want {
				t.Fatalf("err=%v, want HTTP %d", err, tc.want)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCreatePersonalDocumentDepartmentTransferRejectsInvalidInputBeforeDB(t *testing.T) {
	bad := []struct {
		name, uuid, dept string
	}{
		{name: "missing uuid", dept: "dept-a"},
		{name: "missing department", uuid: "doc-1"},
		{name: "control department", uuid: "doc-1", dept: "dept\n-a"},
	}
	for _, tc := range bad {
		t.Run(tc.name, func(t *testing.T) {
			db, _, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			_, err = (&Adapter{db: db}).CreatePersonalDocumentDepartmentTransfer(context.Background(), departmentTransferIdentity(), tc.uuid, tc.dept, "")
			var he httperror.Error
			if err == nil || !errors.As(err, &he) || he.Status != 400 {
				t.Fatalf("err=%v, want HTTP 400", err)
			}
		})
	}
}
