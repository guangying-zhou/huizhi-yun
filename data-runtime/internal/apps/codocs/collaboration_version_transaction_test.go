package codocs

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

const collaborationVersionDocumentID = int64(41)

func newCollaborationVersionAdapter(t *testing.T) (*Adapter, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	return &Adapter{db: db}, mock, func() { _ = db.Close() }
}

func collaborationVersionBody() map[string]any {
	return map[string]any{
		"docId":         collaborationVersionDocumentID,
		"current_user":  "editor-uid",
		"editorUid":     "spoofed-editor",
		"ossVersionId":  "oss-version-8",
		"contentSize":   int64(2048),
		"contentSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	}
}

func expectCollaborationVersionDocumentLock(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`(?s)SELECT id, uuid, owner_uid, readonly_flag, status.*FROM documents.*WHERE id = \? AND status <> 0.*LIMIT 1.*FOR UPDATE`).
		WithArgs(collaborationVersionDocumentID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "uuid", "owner_uid", "readonly_flag", "status"}).AddRow(collaborationVersionDocumentID, "doc-41", "editor-uid", 0, 1))
}

func expectCollaborationVersionMax(mock sqlmock.Sqlmock, maxVersion any) {
	mock.ExpectQuery(`SELECT MAX\(version_num\) FROM document_versions WHERE document_id = \?`).
		WithArgs(collaborationVersionDocumentID).
		WillReturnRows(sqlmock.NewRows([]string{"max_version"}).AddRow(maxVersion))
}

func expectCollaborationVersionInsert(mock sqlmock.Sqlmock, version int64) *sqlmock.ExpectedExec {
	return mock.ExpectExec(`(?s)INSERT INTO document_versions.*VALUES \(\?, \?, \?, \?, \?, \?\)`).
		WithArgs(
			collaborationVersionDocumentID,
			version,
			"oss-version-8",
			"editor-uid",
			int64(2048),
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		)
}

func TestCreateCollaborationVersionLocksDocumentBeforeAllocatingVersion(t *testing.T) {
	adapter, mock, closeDB := newCollaborationVersionAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	expectCollaborationVersionDocumentLock(mock)
	expectCollaborationVersionMax(mock, int64(7))
	expectCollaborationVersionInsert(mock, 8).WillReturnResult(sqlmock.NewResult(73, 1))
	mock.ExpectCommit()

	result, err := adapter.createCollaborationVersion(context.Background(), collaborationVersionBody())
	if err != nil {
		t.Fatalf("createCollaborationVersion: %v", err)
	}
	if got := int64Value(result["id"]); got != 73 {
		t.Fatalf("id = %d, want 73", got)
	}
	if got := int64Value(result["documentId"]); got != collaborationVersionDocumentID {
		t.Fatalf("documentId = %d, want %d", got, collaborationVersionDocumentID)
	}
	if got := stringValue(result["documentUuid"]); got != "doc-41" {
		t.Fatalf("documentUuid = %q, want doc-41", got)
	}
	if got := int64Value(result["versionNum"]); got != 8 {
		t.Fatalf("versionNum = %d, want 8", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("version allocation must lock parent before max query and insert: %v", err)
	}
}

func TestCreateCollaborationVersionRejectsMissingActorBeforeTransaction(t *testing.T) {
	adapter, mock, closeDB := newCollaborationVersionAdapter(t)
	defer closeDB()

	body := collaborationVersionBody()
	delete(body, "current_user")
	delete(body, "editorUid")

	_, err := adapter.createCollaborationVersion(context.Background(), body)
	if err == nil {
		t.Fatal("missing actor must be rejected")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("missing actor must not begin or query a transaction: %v", err)
	}
}

func TestCreateCollaborationVersionRejectsMissingContentHashBeforeTransaction(t *testing.T) {
	adapter, mock, closeDB := newCollaborationVersionAdapter(t)
	defer closeDB()

	body := collaborationVersionBody()
	delete(body, "contentSha256")

	_, err := adapter.createCollaborationVersion(context.Background(), body)
	if err == nil {
		t.Fatal("missing content hash must be rejected")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("missing content hash must not begin or query a transaction: %v", err)
	}
}

func TestCreateCollaborationVersionRejectsReadOnlyShareBeforeVersionQuery(t *testing.T) {
	adapter, mock, closeDB := newCollaborationVersionAdapter(t)
	defer closeDB()

	body := collaborationVersionBody()
	body["current_user"] = "reader-uid"
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT id, uuid, owner_uid, readonly_flag, status.*FROM documents.*WHERE id = \? AND status <> 0.*LIMIT 1.*FOR UPDATE`).
		WithArgs(collaborationVersionDocumentID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "uuid", "owner_uid", "readonly_flag", "status"}).AddRow(collaborationVersionDocumentID, "doc-41", "owner-uid", 0, 1))
	mock.ExpectQuery(`(?s)SELECT permission.*FROM document_shares.*WHERE document_id = \? AND shared_to_uid = \?.*LIMIT 1`).
		WithArgs(collaborationVersionDocumentID, "reader-uid").
		WillReturnRows(sqlmock.NewRows([]string{"permission"}).AddRow("read"))
	mock.ExpectRollback()

	_, err := adapter.createCollaborationVersion(context.Background(), body)
	if err == nil {
		t.Fatal("read share must not create a version")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("read share must stop before max version query and insert: %v", err)
	}
}

func TestCreateCollaborationVersionAcceptsUUIDWithSameOwnerAuthorization(t *testing.T) {
	adapter, mock, closeDB := newCollaborationVersionAdapter(t)
	defer closeDB()

	body := collaborationVersionBody()
	delete(body, "docId")
	body["uuid"] = "doc-uuid-41"
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT id, uuid, owner_uid, readonly_flag, status.*FROM documents.*WHERE uuid = \? AND status <> 0.*LIMIT 1.*FOR UPDATE`).
		WithArgs("doc-uuid-41").
		WillReturnRows(sqlmock.NewRows([]string{"id", "uuid", "owner_uid", "readonly_flag", "status"}).AddRow(collaborationVersionDocumentID, "doc-uuid-41", "editor-uid", 0, 1))
	expectCollaborationVersionMax(mock, int64(0))
	expectCollaborationVersionInsert(mock, 1).WillReturnResult(sqlmock.NewResult(74, 1))
	mock.ExpectCommit()

	result, err := adapter.createCollaborationVersion(context.Background(), body)
	if err != nil {
		t.Fatalf("createCollaborationVersion: %v", err)
	}
	if got := stringValue(result["documentUuid"]); got != "doc-uuid-41" {
		t.Fatalf("documentUuid = %q, want doc-uuid-41", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("uuid version write must use the same parent lock and owner check: %v", err)
	}
}

func TestCreateCollaborationVersionRollsBackWhenMaxQueryFails(t *testing.T) {
	adapter, mock, closeDB := newCollaborationVersionAdapter(t)
	defer closeDB()

	maxErr := errors.New("version lookup failed")
	mock.ExpectBegin()
	expectCollaborationVersionDocumentLock(mock)
	mock.ExpectQuery(`SELECT MAX\(version_num\) FROM document_versions WHERE document_id = \?`).
		WithArgs(collaborationVersionDocumentID).
		WillReturnError(maxErr)
	mock.ExpectRollback()

	_, err := adapter.createCollaborationVersion(context.Background(), collaborationVersionBody())
	if !errors.Is(err, maxErr) {
		t.Fatalf("error = %v, want %v", err, maxErr)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("max query failure must roll back document lock transaction: %v", err)
	}
}

func TestCreateCollaborationVersionRollsBackWhenInsertFails(t *testing.T) {
	adapter, mock, closeDB := newCollaborationVersionAdapter(t)
	defer closeDB()

	insertErr := errors.New("version insert failed")
	mock.ExpectBegin()
	expectCollaborationVersionDocumentLock(mock)
	expectCollaborationVersionMax(mock, int64(7))
	expectCollaborationVersionInsert(mock, 8).WillReturnError(insertErr)
	mock.ExpectRollback()

	_, err := adapter.createCollaborationVersion(context.Background(), collaborationVersionBody())
	if !errors.Is(err, insertErr) {
		t.Fatalf("error = %v, want %v", err, insertErr)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("insert failure must roll back document lock transaction: %v", err)
	}
}

func TestCreateCollaborationVersionReturnsCommitError(t *testing.T) {
	adapter, mock, closeDB := newCollaborationVersionAdapter(t)
	defer closeDB()

	commitErr := errors.New("commit failed")
	mock.ExpectBegin()
	expectCollaborationVersionDocumentLock(mock)
	expectCollaborationVersionMax(mock, int64(7))
	expectCollaborationVersionInsert(mock, 8).WillReturnResult(sqlmock.NewResult(73, 1))
	mock.ExpectCommit().WillReturnError(commitErr)

	_, err := adapter.createCollaborationVersion(context.Background(), collaborationVersionBody())
	if !errors.Is(err, commitErr) {
		t.Fatalf("error = %v, want %v", err, commitErr)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("commit error must be returned without a success envelope: %v", err)
	}
}
