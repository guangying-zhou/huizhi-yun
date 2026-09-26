package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func personalFolderIdentity() PersonalFolderCreationIdentity {
	return PersonalFolderCreationIdentity{Tenant: "tenant-1", Deployment: "codocs-dev", Actor: "actor-1", Client: "enterprise.runtime", RequestID: "req-1", Key: "request-key"}
}

func personalFolderPayload() map[string]any {
	return map[string]any{"name": "My folder", "folder_type": "private", "parent_id": nil}
}

func expectPersonalFolderParent(mock sqlmock.Sqlmock, owner string) {
	mock.ExpectQuery(`SELECT id, name, folder_type, owner_uid, dept_code, project_code, parent_id FROM folders WHERE id = \? FOR UPDATE`).
		WithArgs(int64(7)).WillReturnRows(sqlmock.NewRows([]string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id"}).AddRow(7, "Parent", "private", owner, nil, nil, nil))
}

func expectPersonalFolderReceiptMissing(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).
		WillReturnError(sql.ErrNoRows)
}

func TestCreatePersonalFolderWritesReceiptAndFolderInOneTransaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &Adapter{db: db}
	mock.ExpectBegin()
	expectPersonalFolderReceiptMissing(mock)
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO folders \(name, folder_type, owner_uid, dept_code, project_code, parent_id, sort_order\) VALUES`).
		WithArgs("My folder", "private", "actor-1", nil).WillReturnResult(sqlmock.NewResult(9, 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT id, name, folder_type, owner_uid, dept_code, project_code, parent_id FROM folders WHERE id = \? FOR UPDATE`).
		WithArgs(int64(9)).WillReturnRows(sqlmock.NewRows([]string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id"}).AddRow(9, "My folder", "private", "actor-1", nil, nil, nil))
	mock.ExpectCommit()

	got, err := a.CreatePersonalFolder(context.Background(), personalFolderIdentity(), personalFolderPayload())
	if err != nil {
		t.Fatal(err)
	}
	if got["id"] != int64(9) || got["owner_uid"] != "actor-1" {
		t.Fatalf("result = %#v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreatePersonalFolderReplayRevalidatesOwnerAndParentWithoutInsert(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &Adapter{db: db}
	identity := personalFolderIdentity()
	payload := map[string]any{"name": "Nested", "folder_type": "private", "parent_id": float64(7)}
	command := map[string]any{"actor": identity.Actor, "name": "Nested", "folder_type": "private", "parent_id": int64(7)}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatal(err)
	}
	ns := sha256.Sum256([]byte(identity.Tenant + "\x00" + identity.Deployment + "\x00" + identity.Actor + "\x00" + identity.Key))
	key := hex.EncodeToString(ns[:])
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	opID := fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16])
	summary := sha256.Sum256([]byte(`{"targetBizCode":"12","targetBizType":"folder"}`))

	mock.ExpectBegin()
	expectPersonalFolderParent(mock, "actor-1")
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).
		WithArgs("tenant-1", "codocs-dev", "codocs-dev", "codocs", "codocs", "codocs.personal-folders.create.v1", key).
		WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "operation_id", "required_capability", "command_schema_version", "command_sha256", "status", "target_biz_type", "target_biz_code", "response_http_status", "response_summary_sha256", "version_no"}).
			AddRow("receipt-1", opID, "codocs:personal-folders:create", "codocs-personal-folder.v1", digest, "succeeded", "folder", "12", 200, hex.EncodeToString(summary[:]), 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET last_request_id`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT id, name, folder_type, owner_uid, dept_code, project_code, parent_id FROM folders WHERE id = \? FOR UPDATE`).
		WithArgs(int64(12)).WillReturnRows(sqlmock.NewRows([]string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id"}).AddRow(12, "Nested", "private", "actor-1", nil, nil, 7))
	mock.ExpectCommit()

	got, err := a.CreatePersonalFolder(context.Background(), identity, payload)
	if err != nil {
		t.Fatal(err)
	}
	if got["id"] != int64(12) {
		t.Fatalf("replay result = %#v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreatePersonalFolderRejectsDifferentPayloadForSameKey(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &Adapter{db: db}
	identity := personalFolderIdentity()
	command := map[string]any{"actor": identity.Actor, "name": "Other name", "folder_type": "private", "parent_id": int64(0)}
	_, err = io.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatal(err)
	}
	ns := sha256.Sum256([]byte(identity.Tenant + "\x00" + identity.Deployment + "\x00" + identity.Actor + "\x00" + identity.Key))
	key := hex.EncodeToString(ns[:])
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	opID := fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16])
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).
		WithArgs("tenant-1", "codocs-dev", "codocs-dev", "codocs", "codocs", "codocs.personal-folders.create.v1", key).
		WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "operation_id", "required_capability", "command_schema_version", "command_sha256", "status", "target_biz_type", "target_biz_code", "response_http_status", "response_summary_sha256", "version_no"}).
			AddRow("receipt-1", opID, "codocs:personal-folders:create", "codocs-personal-folder.v1", "different-payload", "succeeded", "folder", "12", 200, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 1))
	mock.ExpectRollback()

	if _, err := a.CreatePersonalFolder(context.Background(), identity, map[string]any{"name": "Other name", "folder_type": "private"}); err == nil {
		t.Fatal("different payload under the same key must be rejected")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreatePersonalFolderRejectsCrossOwnerParentBeforeReceiptOrInsert(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &Adapter{db: db}
	mock.ExpectBegin()
	expectPersonalFolderParent(mock, "other-actor")
	mock.ExpectRollback()
	payload := map[string]any{"name": "Nested", "folder_type": "private", "parent_id": float64(7)}
	if _, err := a.CreatePersonalFolder(context.Background(), personalFolderIdentity(), payload); err == nil {
		t.Fatal("cross-owner parent must be rejected")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreatePersonalFolderRejectsInvalidIdentityAndPayloadBeforeDB(t *testing.T) {
	cases := []struct {
		name     string
		identity PersonalFolderCreationIdentity
		payload  map[string]any
	}{
		{"missing actor", PersonalFolderCreationIdentity{Tenant: "t", Deployment: "d", Client: "enterprise.runtime", Key: "k"}, personalFolderPayload()},
		{"wrong client", PersonalFolderCreationIdentity{Tenant: "t", Deployment: "d", Actor: "a", Client: "codocs", Key: "k"}, personalFolderPayload()},
		{"missing key", PersonalFolderCreationIdentity{Tenant: "t", Deployment: "d", Actor: "a", Client: "enterprise.runtime"}, personalFolderPayload()},
		{"invalid kind", personalFolderIdentity(), map[string]any{"name": "x", "folder_type": "department"}},
		{"unsupported field", personalFolderIdentity(), map[string]any{"name": "x", "folder_type": "private", "owner_uid": "spoof"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, _, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			if _, err := (&Adapter{db: db}).CreatePersonalFolder(context.Background(), tc.identity, tc.payload); err == nil {
				t.Fatal("invalid request accepted")
			}
		})
	}
}
