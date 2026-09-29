package codocs

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

const (
	shareDocumentUUID = "doc-share-1"
	shareDocumentID   = int64(10)
	shareOwnerUID     = "owner-uid"
	shareTargetUID    = "viewer-uid"
	shareID           = int64(17)
)

func expectShareDocument(mock sqlmock.Sqlmock) {
	mock.ExpectQuery("SELECT \\* FROM documents WHERE uuid = \\? AND status <> 0 LIMIT 1").
		WithArgs(shareDocumentUUID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "owner_uid", "readonly_flag", "status"}).
			AddRow(shareDocumentID, shareOwnerUID, 0, 1))
}

func expectShareRelationUpsert(mock sqlmock.Sqlmock, permission string) *sqlmock.ExpectedExec {
	return mock.ExpectExec("(?s)INSERT INTO document_relations.*ON DUPLICATE KEY UPDATE").
		WithArgs(
			shareDocumentID,
			shareDocumentUUID,
			shareTargetUID,
			"17",
			boolInt(permission == "write"),
			sqlmock.AnyArg(),
		)
}

func ownerShareBody(permission string) map[string]any {
	return map[string]any{
		"current_user": shareOwnerUID,
		"permission":   permission,
	}
}

func TestCreateDocumentShareCommitsShareAndRelationTogether(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	expectShareDocument(mock)
	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT id.*FROM document_shares.*WHERE document_id = \\? AND shared_to_uid = \\?.*LIMIT 1").
		WithArgs(shareDocumentID, shareTargetUID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec("(?s)INSERT INTO document_shares.*VALUES").
		WithArgs(shareDocumentID, shareOwnerUID, shareTargetUID, "write", nil).
		WillReturnResult(sqlmock.NewResult(shareID, 1))
	expectShareRelationUpsert(mock, "write").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	result, err := adapter.createDocumentShare(context.Background(), shareDocumentUUID, map[string]any{
		"current_user":  shareOwnerUID,
		"shared_to_uid": shareTargetUID,
		"permission":    "write",
	})
	if err != nil {
		t.Fatalf("createDocumentShare: %v", err)
	}
	if got := int64Value(result["shareId"]); got != shareID {
		t.Fatalf("shareId = %d, want %d", got, shareID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestCreateDocumentShareRollsBackWhenRelationWriteFails(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	expectShareDocument(mock)
	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT id.*FROM document_shares.*WHERE document_id = \\? AND shared_to_uid = \\?.*LIMIT 1").
		WithArgs(shareDocumentID, shareTargetUID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec("(?s)INSERT INTO document_shares.*VALUES").
		WithArgs(shareDocumentID, shareOwnerUID, shareTargetUID, "read", nil).
		WillReturnResult(sqlmock.NewResult(shareID, 1))
	expectShareRelationUpsert(mock, "read").WillReturnError(errors.New("relation write failed"))
	mock.ExpectRollback()

	_, err = adapter.createDocumentShare(context.Background(), shareDocumentUUID, map[string]any{
		"current_user":  shareOwnerUID,
		"shared_to_uid": shareTargetUID,
	})
	if err == nil {
		t.Fatal("createDocumentShare should return the relation write failure")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("share insert must be rolled back with relation failure: %v", err)
	}
}

func TestUpdateDocumentShareCommitsShareAndRelationTogether(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	expectShareDocument(mock)
	mock.ExpectBegin()
	mock.ExpectExec("(?s)UPDATE document_shares.*WHERE id = \\? AND document_id = \\?").
		WithArgs("write", "17", shareDocumentID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT shared_to_uid FROM document_shares WHERE id = \\? AND document_id = \\? LIMIT 1").
		WithArgs("17", shareDocumentID).
		WillReturnRows(sqlmock.NewRows([]string{"shared_to_uid"}).AddRow(shareTargetUID))
	expectShareRelationUpsert(mock, "write").WillReturnResult(sqlmock.NewResult(1, 1))
	expectCollaborationInvalidated(mock)
	mock.ExpectCommit()

	result, err := adapter.updateDocumentShare(context.Background(), shareDocumentUUID, "17", ownerShareBody("write"))
	if err != nil {
		t.Fatalf("updateDocumentShare: %v", err)
	}
	if result["updated"] != true {
		t.Fatalf("result = %#v, want updated", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestUpdateDocumentShareRollsBackWhenRelationWriteFails(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	expectShareDocument(mock)
	mock.ExpectBegin()
	mock.ExpectExec("(?s)UPDATE document_shares.*WHERE id = \\? AND document_id = \\?").
		WithArgs("read", "17", shareDocumentID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT shared_to_uid FROM document_shares WHERE id = \\? AND document_id = \\? LIMIT 1").
		WithArgs("17", shareDocumentID).
		WillReturnRows(sqlmock.NewRows([]string{"shared_to_uid"}).AddRow(shareTargetUID))
	expectShareRelationUpsert(mock, "read").WillReturnError(errors.New("relation write failed"))
	mock.ExpectRollback()

	_, err = adapter.updateDocumentShare(context.Background(), shareDocumentUUID, "17", ownerShareBody("read"))
	if err == nil {
		t.Fatal("updateDocumentShare should return the relation write failure")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("share permission update must be rolled back with relation failure: %v", err)
	}
}

func TestDeleteDocumentShareCommitsShareDeleteAndRelationRevocationTogether(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	expectShareDocument(mock)
	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM document_shares WHERE id = \\? AND document_id = \\?").
		WithArgs("17", shareDocumentID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE document_relations SET status = 0, updated_at = NOW\\(\\) WHERE source_type = \\? AND source_id = \\?").
		WithArgs("document_share", "17").
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectCollaborationInvalidated(mock)
	mock.ExpectCommit()

	result, err := adapter.deleteDocumentShare(context.Background(), shareDocumentUUID, "17", ownerShareBody("read"))
	if err != nil {
		t.Fatalf("deleteDocumentShare: %v", err)
	}
	if result["deleted"] != true {
		t.Fatalf("result = %#v, want deleted", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestDeleteDocumentShareRollsBackWhenRelationRevocationFails(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	expectShareDocument(mock)
	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM document_shares WHERE id = \\? AND document_id = \\?").
		WithArgs("17", shareDocumentID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE document_relations SET status = 0, updated_at = NOW\\(\\) WHERE source_type = \\? AND source_id = \\?").
		WithArgs("document_share", "17").
		WillReturnError(errors.New("relation revocation failed"))
	mock.ExpectRollback()

	_, err = adapter.deleteDocumentShare(context.Background(), shareDocumentUUID, "17", ownerShareBody("read"))
	if err == nil {
		t.Fatal("deleteDocumentShare should return the relation revocation failure")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("share delete must roll back so stale relation cannot retain access: %v", err)
	}
}

// expectCollaborationInvalidated scripts the v2 collaboration invalidation that
// every share change performs (document_snapshot_guard / collaboration_session).
func expectCollaborationInvalidated(mock sqlmock.Sqlmock) {
	mock.ExpectExec(`UPDATE document_snapshot_heads SET collaboration_epoch = collaboration_epoch \+ 1 WHERE document_uuid = \?`).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`UPDATE document_collaboration_sessions SET status = 'revoked' WHERE document_uuid = \? AND status = 'active'`).WillReturnResult(sqlmock.NewResult(0, 0))
}

