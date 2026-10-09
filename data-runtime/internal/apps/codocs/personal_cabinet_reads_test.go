package codocs

import (
	"context"
	"errors"
	"net/url"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func personalCabinetReadRows(converted string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "uuid", "filename", "original_name", "file_ext", "file_size", "oss_path",
		"owner_uid", "dept_code", "project_code", "folder_id", "converted_doc_uuid", "created_at", "updated_at",
	}).AddRow(int64(1), "file-1", "source.docx", "source.docx", "docx", int64(10), "codocs/users/owner/cabinet/file-1.docx", "owner", nil, nil, nil, converted, "2026-01-01", "2026-01-01")
}

func expectPersonalCabinetRead(mock sqlmock.Sqlmock, converted string) {
	mock.ExpectQuery(`(?s)SELECT id, uuid, filename, original_name.*FROM cabinet_files.*uuid = \?.*owner_uid = \?.*dept_code IS NULL.*project_code IS NULL.*LIMIT 1`).
		WithArgs("file-1", "owner").WillReturnRows(personalCabinetReadRows(converted))
}

func TestPersonalCabinetConvertedInfoReturnsNilWithoutConvertedDocument(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	expectPersonalCabinetRead(mock, "")
	result, err := (&Adapter{db: db}).PersonalCabinetConvertedInfo(context.Background(), "file-1", url.Values{"current_user": {"owner"}, "hzy_runtime_actor_delegated": {"1"}})
	if err != nil || result != nil {
		t.Fatalf("result=%#v err=%v, want nil result", result, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPersonalCabinetConvertedInfoRechecksCurrentDocumentACLAndProjectsThreeFields(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	expectPersonalCabinetRead(mock, "doc-1")
	mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1")).
		WithArgs("doc-1").WillReturnRows(sqlmock.NewRows([]string{"id", "uuid", "title", "owner_uid", "status", "readonly_flag"}).AddRow(int64(9), "doc-1", "Converted", "owner", 1, 0))
	result, err := (&Adapter{db: db}).PersonalCabinetConvertedInfo(context.Background(), "file-1", url.Values{"current_user": {"owner"}, "hzy_runtime_actor_delegated": {"1"}})
	if err != nil {
		t.Fatalf("converted info: %v", err)
	}
	if len(result) != 3 || result["doc_uuid"] != "doc-1" || result["doc_title"] != "Converted" || result["doc_path"] != "我的文档/Converted.md" {
		t.Fatalf("projection=%#v, want exactly uuid/title/path", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPersonalCabinetConvertedInfoTreatsDeletedTargetAsNil(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	expectPersonalCabinetRead(mock, "doc-1")
	mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1")).
		WithArgs("doc-1").WillReturnRows(sqlmock.NewRows([]string{"uuid"}))
	result, err := (&Adapter{db: db}).PersonalCabinetConvertedInfo(context.Background(), "file-1", url.Values{"current_user": {"owner"}, "hzy_runtime_actor_delegated": {"1"}})
	if err != nil || result != nil {
		t.Fatalf("result=%#v err=%v, want deleted target to be nil", result, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPersonalCabinetConvertedInfoPropagatesCabinetDBError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	dbErr := errors.New("cabinet db unavailable")
	mock.ExpectQuery(`(?s)SELECT id, uuid, filename, original_name.*FROM cabinet_files`).WillReturnError(dbErr)
	result, err := (&Adapter{db: db}).PersonalCabinetConvertedInfo(context.Background(), "file-1", url.Values{"current_user": {"owner"}, "hzy_runtime_actor_delegated": {"1"}})
	if !errors.Is(err, dbErr) || result != nil {
		t.Fatalf("result=%#v err=%v, want original DB error", result, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPersonalCabinetConvertedInfoRejectsRevokedShareOnConvertedDocument(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(`(?s)SELECT id, uuid, filename, original_name.*FROM cabinet_files.*uuid = \?.*owner_uid = \?.*dept_code IS NULL.*project_code IS NULL.*LIMIT 1`).
		WithArgs("file-1", "viewer").WillReturnRows(sqlmock.NewRows([]string{
		"id", "uuid", "filename", "original_name", "file_ext", "file_size", "oss_path",
		"owner_uid", "dept_code", "project_code", "folder_id", "converted_doc_uuid", "created_at", "updated_at",
	}).AddRow(int64(1), "file-1", "source.docx", "source.docx", "docx", int64(10), "codocs/users/viewer/cabinet/file-1.docx", "viewer", nil, nil, nil, "doc-1", "2026-01-01", "2026-01-01"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1")).
		WithArgs("doc-1").WillReturnRows(sqlmock.NewRows([]string{"id", "uuid", "owner_uid", "doc_type", "readonly_flag", "status"}).AddRow(int64(9), "doc-1", "document-owner", "private", 0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT permission
      FROM document_shares
      WHERE document_id = ? AND shared_to_uid = ?
      LIMIT 1`)).WithArgs(int64(9), "viewer").WillReturnRows(sqlmock.NewRows([]string{"permission"}))
	mock.ExpectQuery(`(?s)SELECT TABLE_NAME.*FROM information_schema\.TABLES.*TABLE_NAME = \?.*LIMIT 1`).WithArgs("document_relations").WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_relations"))
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*FROM document_relations.*document_id = \? AND related_uid = \?`).WithArgs(int64(9), "viewer").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	result, err := (&Adapter{db: db}).PersonalCabinetConvertedInfo(context.Background(), "file-1", url.Values{"current_user": {"viewer"}, "hzy_runtime_actor_delegated": {"1"}})
	var he httperror.Error
	if result != nil || !errors.As(err, &he) || he.Status != 403 {
		t.Fatalf("result=%#v err=%v, want current ACL 403", result, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
