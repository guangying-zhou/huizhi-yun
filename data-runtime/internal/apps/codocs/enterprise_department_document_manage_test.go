package codocs

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func departmentManageDocumentRows(department string, status int) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "uuid", "doc_type", "dept_code", "project_code", "status", "readonly_flag"}).
		AddRow(17, "00000000-0000-4000-8000-000000000017", "department", department, nil, status, 0)
}

func TestEnterpriseDepartmentDocumentManageRejectsForgedFieldsBeforeDB(t *testing.T) {
	for _, item := range []struct {
		action string
		body   map[string]any
	}{
		{"readonly", map[string]any{"readonly_flag": 1}},
		{"readonly", map[string]any{"readonly_flag": true, "owner_uid": "victim"}},
		{"recycle", map[string]any{"dept_code": "D2"}},
		{"other", map[string]any{}},
	} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		_, err = (&Adapter{db: db}).ManageEnterpriseDepartmentDocument(context.Background(), departmentFolderIdentity(), item.action, "00000000-0000-4000-8000-000000000017", item.body, func(context.Context, *sql.Tx, string, string) error { return nil })
		if err == nil {
			t.Fatalf("accepted %s %#v", item.action, item.body)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}

func TestEnterpriseDepartmentDocumentManageRechecksManagerBeforeReceipt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectRollback()
	_, err = (&Adapter{db: db}).ManageEnterpriseDepartmentDocument(context.Background(), departmentFolderIdentity(), "recycle", "00000000-0000-4000-8000-000000000017", map[string]any{}, func(context.Context, *sql.Tx, string, string) error { return errors.New("manager revoked") })
	if err == nil {
		t.Fatal("revoked manager was allowed")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseDepartmentDocumentManageRejectsOtherDepartmentBeforeReceipt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? LIMIT 1 FOR UPDATE`).WillReturnRows(departmentManageDocumentRows("D2", 1))
	mock.ExpectRollback()
	_, err = (&Adapter{db: db}).ManageEnterpriseDepartmentDocument(context.Background(), departmentFolderIdentity(), "readonly", "00000000-0000-4000-8000-000000000017", map[string]any{"readonly_flag": true}, func(context.Context, *sql.Tx, string, string) error { return nil })
	if err == nil {
		t.Fatal("cross-department document was allowed")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseDepartmentDocumentManageRecycleAndReceiptShareTransaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? LIMIT 1 FOR UPDATE`).WillReturnRows(departmentManageDocumentRows("D1", 1))
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE documents SET status=0,deleted_at=NOW\(\),updated_at=NOW\(\)`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE document_snapshot_heads SET collaboration_epoch = collaboration_epoch \+ 1 WHERE document_uuid = \?`).WithArgs("00000000-0000-4000-8000-000000000017").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`UPDATE document_collaboration_sessions SET status = 'revoked' WHERE document_uuid = \? AND status = 'active'`).WithArgs("00000000-0000-4000-8000-000000000017").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	got, err := (&Adapter{db: db}).ManageEnterpriseDepartmentDocument(context.Background(), departmentFolderIdentity(), "recycle", "00000000-0000-4000-8000-000000000017", map[string]any{}, func(context.Context, *sql.Tx, string, string) error { return nil })
	if err != nil || got["deleted"] != true {
		t.Fatalf("result=%v err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseDepartmentDocumentManageReadonlyAndReceiptShareTransaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? LIMIT 1 FOR UPDATE`).WillReturnRows(departmentManageDocumentRows("D1", 1))
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE documents SET readonly_flag=\?,updated_at=NOW\(\)`).WithArgs(1, "00000000-0000-4000-8000-000000000017", "D1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE document_snapshot_heads SET collaboration_epoch = collaboration_epoch \+ 1 WHERE document_uuid = \?`).WithArgs("00000000-0000-4000-8000-000000000017").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`UPDATE document_collaboration_sessions SET status = 'revoked' WHERE document_uuid = \? AND status = 'active'`).WithArgs("00000000-0000-4000-8000-000000000017").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	got, err := (&Adapter{db: db}).ManageEnterpriseDepartmentDocument(context.Background(), departmentFolderIdentity(), "readonly", "00000000-0000-4000-8000-000000000017", map[string]any{"readonly_flag": true}, func(context.Context, *sql.Tx, string, string) error { return nil })
	if err != nil || got["readonly_flag"] != true {
		t.Fatalf("result=%v err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
