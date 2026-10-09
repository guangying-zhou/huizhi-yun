package codocs

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func departmentFolderIdentity() EnterpriseDepartmentFolderIdentity {
	return EnterpriseDepartmentFolderIdentity{Tenant: "tenant-1", SourceDeployment: "enterprise-dev", TargetDeployment: "codocs-dev", Actor: "actor-1", Client: "enterprise.runtime", RequestID: "req-1", Key: "request-key", Department: "D1"}
}

func departmentFolderPayload() map[string]any {
	return map[string]any{"name": "Team", "folder_type": "department", "dept_code": "D1", "parent_id": nil}
}

func TestEnterpriseDepartmentFolderCreateChecksCurrentManagerBeforeReceiptAndWrite(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectRollback()
	checkCalls := 0
	_, err = (&Adapter{db: db}).CreateEnterpriseDepartmentFolder(context.Background(), departmentFolderIdentity(), departmentFolderPayload(), func(_ context.Context, _ *sql.Tx, actor, dept string) error {
		checkCalls++
		if actor != "actor-1" || dept != "D1" {
			t.Fatalf("manager check got %s/%s", actor, dept)
		}
		return errors.New("revoked")
	})
	if err == nil || checkCalls != 1 {
		t.Fatalf("revoked manager was allowed: err=%v checks=%d", err, checkCalls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseDepartmentFolderCreateReceiptAndInsertShareTransaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO folders.*'department'`).WithArgs("Team", "actor-1", "D1", nil).WillReturnResult(sqlmock.NewResult(9, 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT id, name, folder_type, owner_uid, dept_code, project_code, parent_id FROM folders WHERE id = \? FOR UPDATE`).
		WithArgs(int64(9)).WillReturnRows(sqlmock.NewRows([]string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id"}).AddRow(9, "Team", "department", "actor-1", "D1", nil, nil))
	mock.ExpectCommit()
	got, err := (&Adapter{db: db}).CreateEnterpriseDepartmentFolder(context.Background(), departmentFolderIdentity(), departmentFolderPayload(), func(_ context.Context, _ *sql.Tx, _, _ string) error { return nil })
	if err != nil || got["id"] != int64(9) {
		t.Fatalf("result=%v err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseDepartmentFolderCreateRejectsForgedDepartmentAndUnsupportedFields(t *testing.T) {
	for _, payload := range []map[string]any{
		{"name": "Team", "folder_type": "department", "dept_code": "D2"},
		{"name": "Team", "folder_type": "private", "dept_code": "D1"},
		{"name": "Team", "folder_type": "department", "dept_code": "D1", "owner_uid": "victim"},
		{"name": "Team", "folder_type": "department", "dept_code": "D1", "parent_id": float64(-1)},
	} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		_, err = (&Adapter{db: db}).CreateEnterpriseDepartmentFolder(context.Background(), departmentFolderIdentity(), payload, func(context.Context, *sql.Tx, string, string) error { return nil })
		if err == nil {
			t.Fatalf("forged payload accepted: %#v", payload)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}
