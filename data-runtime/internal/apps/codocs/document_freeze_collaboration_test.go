package codocs

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func freezeDocumentRows(uuid string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "uuid", "title", "owner_uid", "status", "readonly_flag"}).AddRow(8, uuid, "Draft", "owner-uid", 1, 0)
}

// Q6: the publish-request freeze makes the document readonly AND revokes its
// collaboration sessions in one transaction, before the body is copied.
func TestReadonlyFreezeRevokesCollaborationInTheSameTransaction(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1`).WithArgs("doc-freeze").WillReturnRows(freezeDocumentRows("doc-freeze"))
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE documents SET `readonly_flag` = \\?, updated_at = NOW\\(\\) WHERE uuid = \\?").WithArgs(int64(1), "doc-freeze").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE document_snapshot_heads SET collaboration_epoch = collaboration_epoch \+ 1 WHERE document_uuid = \?`).WithArgs("doc-freeze").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE document_collaboration_sessions SET status = 'revoked' WHERE document_uuid = \? AND status = 'active'`).WithArgs("doc-freeze").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	_, _, err := (&Adapter{db: db}).HandleRuntime(context.Background(), http.MethodPatch, "/v1/codocs/documents/doc-freeze", url.Values{"current_user": {"owner-uid"}}, map[string]any{"readonly_flag": true})
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A failed session revocation must not leave the document frozen with live
// sessions: the readonly write rolls back with it.
func TestReadonlyFreezeRollsBackWhenRevocationFails(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? AND status <> 0 LIMIT 1`).WithArgs("doc-freeze").WillReturnRows(freezeDocumentRows("doc-freeze"))
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE documents SET `readonly_flag`").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE document_snapshot_heads SET collaboration_epoch").WillReturnError(context.DeadlineExceeded)
	mock.ExpectRollback()
	_, _, err := (&Adapter{db: db}).HandleRuntime(context.Background(), http.MethodPatch, "/v1/codocs/documents/doc-freeze", url.Values{"current_user": {"owner-uid"}}, map[string]any{"readonly_flag": true})
	if err == nil {
		t.Fatal("freeze must fail when sessions cannot be revoked")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
