package codocs

import (
	"context"
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func departmentMetadataRows(owner, dept string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "uuid", "title", "owner_uid", "doc_type", "dept_code", "project_code", "folder_id", "readonly_flag", "status"}).
		AddRow(17, "00000000-0000-4000-8000-000000000017", "Original", owner, "department", dept, nil, nil, 0, 1)
}

func TestEnterpriseDepartmentDocumentMetadataRejectsOwnershipAndDepartmentSpoofing(t *testing.T) {
	for _, payload := range []map[string]any{
		{"title": "Renamed", "owner_uid": "victim"},
		{"title": "Renamed", "dept_code": "D2"},
		{"title": "Renamed", "oss_path": "other"},
		{"folder_id": float64(-1)},
		{"readonly_flag": true},
	} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		_, err = (&Adapter{db: db}).EditEnterpriseDepartmentDocumentMetadata(context.Background(), departmentFolderIdentity(), "00000000-0000-4000-8000-000000000017", payload, func(context.Context, *sql.Tx, string, string) (bool, bool, error) { return true, false, nil })
		if err == nil {
			t.Fatalf("accepted %#v", payload)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}

func TestEnterpriseDepartmentDocumentMetadataMemberNeedsOwnerOrWriteShareBeforeReceipt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1 FOR UPDATE`).WillReturnRows(departmentMetadataRows("another", "D1"))
	mock.ExpectQuery(`(?s)SELECT permission.*FROM document_shares`).WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()
	_, err = (&Adapter{db: db}).EditEnterpriseDepartmentDocumentMetadata(context.Background(), departmentFolderIdentity(), "00000000-0000-4000-8000-000000000017", map[string]any{"title": "Renamed"}, func(context.Context, *sql.Tx, string, string) (bool, bool, error) { return true, false, nil })
	if err == nil {
		t.Fatal("member edited another person's unshared document")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseDepartmentDocumentMetadataOwnerWritesWithReceipt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1 FOR UPDATE`).WillReturnRows(departmentMetadataRows("actor-1", "D1"))
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectExec(`UPDATE documents SET title=\?,folder_id=\?,updated_at=NOW\(\)`).WithArgs("Renamed", nil, "00000000-0000-4000-8000-000000000017", "D1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	got, err := (&Adapter{db: db}).EditEnterpriseDepartmentDocumentMetadata(context.Background(), departmentFolderIdentity(), "00000000-0000-4000-8000-000000000017", map[string]any{"title": "Renamed"}, func(context.Context, *sql.Tx, string, string) (bool, bool, error) { return true, false, nil })
	if err != nil || got["title"] != "Renamed" {
		t.Fatalf("result=%v err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseDepartmentDocumentMetadataManagerCannotMoveToAnotherDepartment(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1 FOR UPDATE`).WillReturnRows(departmentMetadataRows("another", "D1"))
	mock.ExpectQuery(`SELECT id, name, folder_type, owner_uid, dept_code, project_code, parent_id FROM folders WHERE id = \? FOR UPDATE`).WithArgs(int64(9)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id"}).AddRow(9, "Other", "department", "another", "D2", nil, nil))
	mock.ExpectRollback()
	_, err = (&Adapter{db: db}).EditEnterpriseDepartmentDocumentMetadata(context.Background(), departmentFolderIdentity(), "00000000-0000-4000-8000-000000000017", map[string]any{"folder_id": float64(9)}, func(context.Context, *sql.Tx, string, string) (bool, bool, error) { return true, true, nil })
	if err == nil {
		t.Fatal("manager moved document to another department")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseDepartmentDocumentMetadataShareWriterCanRenameButCannotMove(t *testing.T) {
	for _, move := range []bool{false, true} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		mock.ExpectBegin()
		mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1 FOR UPDATE`).WillReturnRows(departmentMetadataRows("another", "D1"))
		mock.ExpectQuery(`(?s)SELECT permission.*FROM document_shares`).WillReturnRows(sqlmock.NewRows([]string{"permission"}).AddRow("write"))
		payload := map[string]any{"title": "Renamed"}
		if move {
			payload = map[string]any{"folder_id": float64(9)}
			mock.ExpectRollback()
		} else {
			mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).WillReturnError(sql.ErrNoRows)
			mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
			mock.ExpectExec(`UPDATE documents SET title=\?,folder_id=\?,updated_at=NOW\(\)`).WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectExec(`UPDATE service_command_receipt.*SET status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectCommit()
		}
		_, err = (&Adapter{db: db}).EditEnterpriseDepartmentDocumentMetadata(context.Background(), departmentFolderIdentity(), "00000000-0000-4000-8000-000000000017", payload, func(context.Context, *sql.Tx, string, string) (bool, bool, error) { return true, false, nil })
		if move && err == nil || !move && err != nil {
			t.Fatalf("move=%v err=%v", move, err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}

func TestEnterpriseDepartmentDocumentMetadataOwnerMemberMayMoveWithinDepartment(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1 FOR UPDATE`).WillReturnRows(departmentMetadataRows("actor-1", "D1"))
	mock.ExpectQuery(`SELECT id, name, folder_type, owner_uid, dept_code, project_code, parent_id FROM folders WHERE id = \? FOR UPDATE`).WithArgs(int64(9)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id"}).AddRow(9, "Team", "department", "actor-1", "D1", nil, nil))
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectExec(`UPDATE documents SET title=\?,folder_id=\?,updated_at=NOW\(\)`).WithArgs("Original", int64(9), "00000000-0000-4000-8000-000000000017", "D1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	_, err = (&Adapter{db: db}).EditEnterpriseDepartmentDocumentMetadata(context.Background(), departmentFolderIdentity(), "00000000-0000-4000-8000-000000000017", map[string]any{"folder_id": float64(9)}, func(context.Context, *sql.Tx, string, string) (bool, bool, error) { return true, false, nil })
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseDepartmentDocumentMetadataFormerOwnerCannotEdit(t *testing.T) {
	for _, payload := range []map[string]any{{"title": "Renamed"}, {"folder_id": float64(9)}} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		mock.ExpectBegin()
		mock.ExpectRollback()
		_, err = (&Adapter{db: db}).EditEnterpriseDepartmentDocumentMetadata(context.Background(), departmentFolderIdentity(), "00000000-0000-4000-8000-000000000017", payload, func(context.Context, *sql.Tx, string, string) (bool, bool, error) { return false, false, nil })
		if err == nil {
			t.Fatalf("former owner edited department document: %#v", payload)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}
