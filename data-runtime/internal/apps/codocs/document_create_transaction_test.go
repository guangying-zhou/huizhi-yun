package codocs

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestCreateDocumentRollsBackWhenOwnerRelationCannotBeWritten(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectQuery("SELECT id FROM documents WHERE oss_path = \\? AND status != 0 LIMIT 1").
		WithArgs("codocs/users/owner/docs/Atomic.md").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery("SELECT TABLE_NAME\\s+FROM information_schema\\.TABLES").
		WithArgs("document_relations").
		WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_relations"))
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO documents").
		WithArgs("doc-atomic", "Atomic", "private", "codocs/users/owner/docs/Atomic.md", "owner", nil, nil, nil, int64(0)).
		WillReturnResult(sqlmock.NewResult(73, 1))
	mock.ExpectExec("INSERT INTO document_relations").
		WillReturnError(errors.New("relation write failed"))
	mock.ExpectRollback()

	_, err = adapter.createDocument(context.Background(), map[string]any{
		"uuid":     "doc-atomic",
		"title":    "Atomic",
		"docType":  "private",
		"ownerUid": "owner",
	})
	if err == nil {
		t.Fatal("owner-relation failure must abort document creation")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("document create must rollback with its owner relation: %v", err)
	}
}
