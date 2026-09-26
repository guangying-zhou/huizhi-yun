package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func enterpriseAccessDocumentRows(owner string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "uuid", "owner_uid", "oss_path", "status", "readonly_flag"}).
		AddRow(31, "550e8400-e29b-41d4-a716-446655440000", owner, "codocs/company/rules/test.md", 1, 0)
}

func TestRecordEnterpriseDocumentAccessRechecksACLAndBindsCurrentPath(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &Adapter{db: db}
	path := "codocs/company/rules/test.md"
	hash := sha256.Sum256([]byte(path))
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000").WillReturnRows(enterpriseAccessDocumentRows("actor-1"))

	got, err := a.RecordEnterpriseDocumentAccess(context.Background(), "550e8400-e29b-41d4-a716-446655440000", "actor-1", "550e8400-e29b-41d4-a716-446655440000", "")
	if err == nil {
		t.Fatal("missing expected hash unexpectedly accepted")
	}
	// Re-run with the exact current path hash; the first ACL query must not be reused.
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000").WillReturnRows(enterpriseAccessDocumentRows("actor-1"))
	mock.ExpectExec(`(?s)INSERT INTO company_asset_access_records.*UTC_TIMESTAMP\(3\).*ON DUPLICATE KEY UPDATE id = id`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000", hash[:], path, "actor-1").WillReturnResult(sqlmock.NewResult(0, 1))
	got, err = a.RecordEnterpriseDocumentAccess(context.Background(), "550e8400-e29b-41d4-a716-446655440000", "actor-1", "550e8400-e29b-41d4-a716-446655440000", hex.EncodeToString(hash[:]))
	if err != nil || got["recorded"] != true {
		t.Fatalf("record = %#v, err=%v", got, err)
	}
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000").WillReturnRows(enterpriseAccessDocumentRows("actor-1"))
	mock.ExpectExec(`(?s)INSERT INTO company_asset_access_records.*UTC_TIMESTAMP\(3\).*ON DUPLICATE KEY UPDATE id = id`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000", hash[:], path, "actor-1").WillReturnResult(sqlmock.NewResult(0, 0))
	got, err = a.RecordEnterpriseDocumentAccess(context.Background(), "550e8400-e29b-41d4-a716-446655440000", "actor-1", "550e8400-e29b-41d4-a716-446655440000", hex.EncodeToString(hash[:]))
	if err != nil || got["recorded"] != true {
		t.Fatalf("idempotent retry = %#v, err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRecordEnterpriseDocumentAccessRejectsACLAndPathChangesWithoutWrite(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &Adapter{db: db}
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000").WillReturnRows(enterpriseAccessDocumentRows("owner"))
	mock.ExpectQuery(`SELECT permission\s+FROM document_shares`).
		WithArgs(int64(31), "viewer").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`SELECT TABLE_NAME\s+FROM information_schema\.TABLES`).
		WithArgs("document_relations").WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_relations"))
	mock.ExpectQuery(`SELECT COUNT\(\*\).*FROM document_relations`).
		WithArgs(int64(31), "viewer").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	_, err = a.RecordEnterpriseDocumentAccess(context.Background(), "550e8400-e29b-41d4-a716-446655440000", "viewer", "550e8400-e29b-41d4-a716-446655440000", "")
	var httpErr httperror.Error
	if err == nil || !errors.As(err, &httpErr) || httpErr.Status != 403 {
		t.Fatal("unauthorized actor accepted")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRecordEnterpriseDocumentAccessRejectsStorageHashMismatchWithoutWrite(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &Adapter{db: db}
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000").WillReturnRows(enterpriseAccessDocumentRows("actor-1"))
	_, err = a.RecordEnterpriseDocumentAccess(context.Background(), "550e8400-e29b-41d4-a716-446655440000", "actor-1", "550e8400-e29b-41d4-a716-446655440000", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	var httpErr httperror.Error
	if err == nil || !errors.As(err, &httpErr) || httpErr.Status != 409 {
		t.Fatal("stale storage hash accepted")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRecordEnterpriseDocumentAccessRejectsNonCompanyPathWithoutWrite(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &Adapter{db: db}
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000").WillReturnRows(sqlmock.NewRows([]string{"id", "uuid", "owner_uid", "oss_path", "status", "readonly_flag"}).
		AddRow(31, "550e8400-e29b-41d4-a716-446655440000", "actor-1", "codocs/users/actor-1/private.md", 1, 0))
	_, err = a.RecordEnterpriseDocumentAccess(context.Background(), "550e8400-e29b-41d4-a716-446655440000", "actor-1", "550e8400-e29b-41d4-a716-446655440000", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	var httpErr httperror.Error
	if err == nil || !errors.As(err, &httpErr) || httpErr.Status != 400 {
		t.Fatalf("invalid company path error = %v, want HTTP 400", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
