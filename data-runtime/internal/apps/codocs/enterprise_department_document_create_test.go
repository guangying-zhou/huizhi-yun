package codocs

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func departmentDocumentPayload() map[string]any {
	return map[string]any{"title": "Team note", "doc_type": "department", "dept_code": "D1", "folder_id": nil, "content_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "content_size": float64(12)}
}

func TestEnterpriseDepartmentDocumentCreateRejectsUntrustedFieldsBeforeDB(t *testing.T) {
	for _, changed := range []map[string]any{
		{"owner_uid": "someone-else"}, {"oss_path": "forged.md"}, {"dept_code": "D2"}, {"doc_type": "private"}, {"folder_id": float64(-1)}, {"content_size": float64(0.5)}, {"source_uuid": "../private"},
	} {
		payload := departmentDocumentPayload()
		for key, value := range changed {
			payload[key] = value
		}
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		_, err = (&Adapter{db: db}).CreateEnterpriseDepartmentDocument(context.Background(), departmentFolderIdentity(), payload, func(context.Context, *sql.Tx, string, string) error { return nil })
		if err == nil {
			t.Fatalf("accepted payload %#v", payload)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}

func TestEnterpriseDepartmentDocumentCreateRechecksWriterBeforeReceipt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectRollback()
	checks := 0
	_, err = (&Adapter{db: db}).CreateEnterpriseDepartmentDocument(context.Background(), departmentFolderIdentity(), departmentDocumentPayload(), func(_ context.Context, _ *sql.Tx, actor, dept string) error {
		checks++
		if actor != "actor-1" || dept != "D1" {
			t.Fatalf("writer check actor=%q dept=%q", actor, dept)
		}
		return errors.New("revoked")
	})
	if err == nil || checks != 1 {
		t.Fatalf("revocation bypassed: %v checks=%d", err, checks)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseDepartmentDocumentCreateWritesReceiptRowAndOwnerRelationTogether(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectExec(`(?s)INSERT INTO documents`).WillReturnResult(sqlmock.NewResult(91, 1))
	mock.ExpectExec(`(?s)INSERT INTO document_relations`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT id FROM documents WHERE uuid=\? AND doc_type='department'`).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(91))
	mock.ExpectCommit()
	got, err := (&Adapter{db: db}).CreateEnterpriseDepartmentDocument(context.Background(), departmentFolderIdentity(), departmentDocumentPayload(), func(context.Context, *sql.Tx, string, string) error { return nil })
	if err != nil || got["id"] != int64(91) {
		t.Fatalf("result=%v err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
