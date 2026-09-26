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

func cabinetDeleteIdentity() PersonalFolderCreationIdentity {
	return PersonalFolderCreationIdentity{Tenant: "tenant-1", Deployment: "codocs-test", Actor: "owner-1", Client: "enterprise.runtime", RequestID: "req-1", Key: "delete-key"}
}

func cabinetDeleteReceiptFacts(identity PersonalFolderCreationIdentity, uuid string) (string, string, string) {
	command := map[string]any{"uuid": uuid, "actor": identity.Actor}
	digest, _ := io.ValidateAndDigestCommand(command)
	ns := sha256.Sum256([]byte(strings.Join([]string{"codocs.personal-cabinet.delete.v1", identity.Tenant, identity.Deployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(ns[:])
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	op := fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16])
	return key, op, digest
}

func expectCabinetDeleteRow(mock sqlmock.Sqlmock, uuid, owner string, status int) {
	mock.ExpectQuery(`SELECT status FROM cabinet_files WHERE uuid = \? AND owner_uid = \? AND dept_code IS NULL AND project_code IS NULL LIMIT 1 FOR UPDATE`).
		WithArgs(uuid, owner).WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow(status))
}

func expectCabinetDeleteReceiptMissing(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).WillReturnError(sql.ErrNoRows)
}

func TestDeletePersonalCabinetFileWritesScopedStatusAndReceiptInOneTransaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := cabinetDeleteIdentity()
	mock.ExpectBegin()
	expectCabinetDeleteRow(mock, "file-1", id.Actor, 1)
	expectCabinetDeleteReceiptMissing(mock)
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE cabinet_files SET status = 0, deleted_at = NOW\(\) WHERE uuid = \?`).WithArgs("file-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	got, err := (&Adapter{db: db}).DeletePersonalCabinetFile(context.Background(), id, "file-1")
	if err != nil || got["deleted"] != true || got["uuid"] != "file-1" {
		t.Fatalf("result=%#v err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeletePersonalCabinetFileAlreadyDeletedCreatesReceiptWithoutUpdate(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := cabinetDeleteIdentity()
	mock.ExpectBegin()
	expectCabinetDeleteRow(mock, "file-1", id.Actor, 0)
	expectCabinetDeleteReceiptMissing(mock)
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	if _, err := (&Adapter{db: db}).DeletePersonalCabinetFile(context.Background(), id, "file-1"); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeletePersonalCabinetFileSuccessfulReplayDoesNotUpdateEvenIfRestored(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := cabinetDeleteIdentity()
	key, op, digest := cabinetDeleteReceiptFacts(id, "file-1")
	mock.ExpectBegin()
	expectCabinetDeleteRow(mock, "file-1", id.Actor, 1)
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).WithArgs(id.Tenant, id.Deployment, id.Deployment, "codocs", "codocs", "codocs.personal-cabinet.delete.v1", key).
		WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "operation_id", "required_capability", "command_schema_version", "command_sha256", "status", "target_biz_type", "target_biz_code", "response_http_status", "response_summary_sha256", "version_no"}).AddRow("receipt-1", op, "codocs:personal-cabinet:delete", "codocs-cabinet-delete.v1", digest, "succeeded", "cabinet-file", "file-1", 200, strings.Repeat("a", 64), 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET last_request_id`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	if _, err := (&Adapter{db: db}).DeletePersonalCabinetFile(context.Background(), id, "file-1"); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeletePersonalCabinetFileRejectsSameKeyDifferentUUID(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := cabinetDeleteIdentity()
	key, op, digest := cabinetDeleteReceiptFacts(id, "file-1")
	mock.ExpectBegin()
	expectCabinetDeleteRow(mock, "file-2", id.Actor, 1)
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).WithArgs(id.Tenant, id.Deployment, id.Deployment, "codocs", "codocs", "codocs.personal-cabinet.delete.v1", key).
		WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "operation_id", "required_capability", "command_schema_version", "command_sha256", "status", "target_biz_type", "target_biz_code", "response_http_status", "response_summary_sha256", "version_no"}).AddRow("receipt-1", op, "codocs:personal-cabinet:delete", "codocs-cabinet-delete.v1", digest, "succeeded", "cabinet-file", "file-1", 200, strings.Repeat("a", 64), 1))
	mock.ExpectRollback()
	_, err = (&Adapter{db: db}).DeletePersonalCabinetFile(context.Background(), id, "file-2")
	var he httperror.Error
	if err == nil || !errors.As(err, &he) || he.Status != 409 {
		t.Fatalf("err=%v, want HTTP 409", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeletePersonalCabinetFileRejectsInvisibleOwnerAndInvalidIdentityBeforeDB(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := cabinetDeleteIdentity()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT status FROM cabinet_files WHERE uuid = \? AND owner_uid = \? AND dept_code IS NULL AND project_code IS NULL LIMIT 1 FOR UPDATE`).WithArgs("file-1", id.Actor).WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()
	_, err = (&Adapter{db: db}).DeletePersonalCabinetFile(context.Background(), id, "file-1")
	var he httperror.Error
	if err == nil || !errors.As(err, &he) || he.Status != 404 {
		t.Fatalf("owner visibility err=%v, want HTTP 404", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []PersonalFolderCreationIdentity{{}, {Tenant: "tenant-1", Deployment: "enterprise-test", Actor: "owner-1", Client: "wrong", Key: "k"}, {Tenant: "tenant-1", Deployment: "enterprise-test", Actor: "owner-1", Client: "enterprise.runtime", Key: ""}} {
		if _, err := (&Adapter{db: db}).DeletePersonalCabinetFile(context.Background(), bad, "file-1"); err == nil {
			t.Fatal("invalid identity accepted")
		}
	}
}

func TestDeletePersonalCabinetFileReturnsSelectErrorAndRollsBackBeforeReceiptLookup(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := cabinetDeleteIdentity()
	dbErr := errors.New("cabinet select failed")
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT status FROM cabinet_files WHERE uuid = \? AND owner_uid = \? AND dept_code IS NULL AND project_code IS NULL LIMIT 1 FOR UPDATE`).
		WithArgs("file-1", id.Actor).WillReturnError(dbErr)
	mock.ExpectRollback()
	_, err = (&Adapter{db: db}).DeletePersonalCabinetFile(context.Background(), id, "file-1")
	if !errors.Is(err, dbErr) {
		t.Fatalf("err=%v, want select error", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeletePersonalCabinetFileRollsBackOnUpdateFailure(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := cabinetDeleteIdentity()
	dbErr := errors.New("update failed")
	mock.ExpectBegin()
	expectCabinetDeleteRow(mock, "file-1", id.Actor, 1)
	expectCabinetDeleteReceiptMissing(mock)
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE cabinet_files SET status = 0, deleted_at = NOW\(\) WHERE uuid = \?`).WithArgs("file-1").WillReturnError(dbErr)
	mock.ExpectRollback()
	_, err = (&Adapter{db: db}).DeletePersonalCabinetFile(context.Background(), id, "file-1")
	if !errors.Is(err, dbErr) {
		t.Fatalf("err=%v, want update error", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
