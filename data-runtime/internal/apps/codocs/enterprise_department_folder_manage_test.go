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
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func folderManageRows(id int64, dept string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id"}).AddRow(id, "Old", "department", "author", dept, nil, nil)
}

func TestEnterpriseDepartmentFolderManageRejectsPayloadBeforeTransaction(t *testing.T) {
	for _, tc := range []struct {
		action  string
		payload map[string]any
	}{
		{"update", map[string]any{"dept_code": "D2"}}, {"update", map[string]any{"name": "  "}},
		{"open", map[string]any{"is_open": "true"}}, {"delete", map[string]any{"name": "x"}},
	} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		_, err = (&Adapter{db: db}).ManageEnterpriseDepartmentFolder(context.Background(), departmentFolderIdentity(), tc.action, 7, tc.payload, func(context.Context, *sql.Tx, string, string) error { return nil })
		if err == nil {
			t.Fatalf("accepted %s %#v", tc.action, tc.payload)
		}
		if err = mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}

func TestEnterpriseDepartmentFolderManageRechecksManagerBeforeReceipt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectRollback()
	called := 0
	_, err = (&Adapter{db: db}).ManageEnterpriseDepartmentFolder(context.Background(), departmentFolderIdentity(), "open", 7, map[string]any{"is_open": true}, func(_ context.Context, _ *sql.Tx, actor, dept string) error {
		called++
		if actor != "actor-1" || dept != "D1" {
			t.Fatalf("binding %s/%s", actor, dept)
		}
		return errors.New("revoked")
	})
	if err == nil || called != 1 {
		t.Fatalf("manager revoke not enforced: %v calls=%d", err, called)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseDepartmentFolderManageRejectsOtherDepartmentBeforeReceipt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id,name,folder_type.*FOR UPDATE`).WithArgs(int64(7)).WillReturnRows(folderManageRows(7, "D2"))
	mock.ExpectRollback()
	_, err = (&Adapter{db: db}).ManageEnterpriseDepartmentFolder(context.Background(), departmentFolderIdentity(), "open", 7, map[string]any{"is_open": true}, func(context.Context, *sql.Tx, string, string) error { return nil })
	if err == nil {
		t.Fatal("other department folder accepted")
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseDepartmentFolderOpenReceiptAndMutationShareTransaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id,name,folder_type.*FOR UPDATE`).WithArgs(int64(7)).WillReturnRows(folderManageRows(7, "D1"))
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*FOR UPDATE`).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE folders SET is_open=`).WithArgs(1, int64(7), "D1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT id, name, folder_type.*FOR UPDATE`).WithArgs(int64(7)).WillReturnRows(folderManageRows(7, "D1"))
	mock.ExpectCommit()
	got, err := (&Adapter{db: db}).ManageEnterpriseDepartmentFolder(context.Background(), departmentFolderIdentity(), "open", 7, map[string]any{"is_open": true}, func(context.Context, *sql.Tx, string, string) error { return nil })
	if err != nil || got["id"] != int64(7) {
		t.Fatalf("result=%v err=%v", got, err)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseDepartmentFolderUpdateRejectsCrossDepartmentParent(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id,name,folder_type.*FOR UPDATE`).WithArgs(int64(7)).WillReturnRows(folderManageRows(7, "D1"))
	mock.ExpectQuery(`SELECT id, name, folder_type.*FOR UPDATE`).WithArgs(int64(8)).WillReturnRows(folderManageRows(8, "D2"))
	mock.ExpectRollback()
	_, err = (&Adapter{db: db}).ManageEnterpriseDepartmentFolder(context.Background(), departmentFolderIdentity(), "update", 7, map[string]any{"parent_id": float64(8)}, func(context.Context, *sql.Tx, string, string) error { return nil })
	if err == nil {
		t.Fatal("accepted other department parent")
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseDepartmentFolderDeleteReplayAfterHardDelete(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := departmentFolderIdentity()
	command := map[string]any{"actor": id.Actor, "department": id.Department, "folder_id": int64(7), "action": "delete"}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatal(err)
	}
	namespace := sha256.Sum256([]byte(strings.Join([]string{"codocs.department-folders.delete.v1", id.Tenant, id.SourceDeployment, id.TargetDeployment, id.Actor, id.Key}, "\x00")))
	key := hex.EncodeToString(namespace[:])
	namespace[6] = (namespace[6] & 0x0f) | 0x40
	namespace[8] = (namespace[8] & 0x3f) | 0x80
	op := fmt.Sprintf("%x-%x-%x-%x-%x", namespace[:4], namespace[4:6], namespace[6:8], namespace[8:10], namespace[10:16])
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id,name,folder_type.*FOR UPDATE`).WithArgs(int64(7)).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*FOR UPDATE`).WithArgs(id.Tenant, id.SourceDeployment, id.TargetDeployment, "enterprise", "codocs", "codocs.department-folders.delete.v1", key).
		WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "operation_id", "required_capability", "command_schema_version", "command_sha256", "status", "target_biz_type", "target_biz_code", "response_http_status", "response_summary_sha256", "version_no"}).
			AddRow("receipt-1", op, "codocs:enterprise-host:execute", "codocs-dept-folder-delete.v1", digest, "succeeded", "folder", "7", 200, strings.Repeat("a", 64), 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET last_request_id`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	called := 0
	got, err := (&Adapter{db: db}).ManageEnterpriseDepartmentFolder(context.Background(), id, "delete", 7, nil, func(context.Context, *sql.Tx, string, string) error { called++; return nil })
	if err != nil || got["replayed"] != true || called != 1 {
		t.Fatalf("replay=%v err=%v managerChecks=%d", got, err, called)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
