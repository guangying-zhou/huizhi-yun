package codocs

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func snapshotReadTestDB(t *testing.T) (*Adapter, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return &Adapter{db: db}, mock
}

func expectSnapshotDocument(mock sqlmock.Sqlmock, owner string) {
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id, owner_uid, doc_type").WithArgs(snapshotTestUUID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "owner_uid", "doc_type", "oss_path", "status"}).AddRow(7, owner, "private", "legacy/body.md", 1))
}

func TestReadDocumentSnapshotLegacyAndPublished(t *testing.T) {
	id := validSnapshotIdentity()
	t.Run("legacy reference", func(t *testing.T) {
		a, mock := snapshotReadTestDB(t)
		expectSnapshotDocument(mock, id.Actor)
		mock.ExpectQuery("SELECT generation, collaboration_epoch, published_candidate, objects_json FROM document_snapshot_heads").WithArgs(id.Tenant, id.Deployment, snapshotTestUUID).WillReturnError(sql.ErrNoRows)
		mock.ExpectCommit()
		read, err := a.ReadDocumentSnapshot(context.Background(), id, snapshotTestUUID)
		if err != nil || read.Generation != 0 || read.LegacyPath != "legacy/body.md" || read.Objects != nil {
			t.Fatalf("read=%+v err=%v", read, err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("published pair", func(t *testing.T) {
		a, mock := snapshotReadTestDB(t)
		cmd := validSnapshotCommand()
		cmd.YjsSHA256, cmd.YjsSize = strings.Repeat("b", 64), 12
		key, _, prefix, err := snapshotFacts(id, cmd)
		if err != nil {
			t.Fatal(err)
		}
		objects := SnapshotObjects{Markdown: SnapshotObject{Key: prefix + strings.Repeat("a", 32) + "/body.md", Version: "version-md"}, Yjs: &SnapshotObject{Key: prefix + strings.Repeat("a", 32) + "/state.yjs", Version: "version-yjs"}}
		commandJSON, _ := json.Marshal(cmd)
		objectsJSON, _ := json.Marshal(objects)
		expectSnapshotDocument(mock, id.Actor)
		mock.ExpectQuery("SELECT generation, collaboration_epoch, published_candidate, objects_json FROM document_snapshot_heads").WithArgs(id.Tenant, id.Deployment, snapshotTestUUID).
			WillReturnRows(sqlmock.NewRows([]string{"generation", "collaboration_epoch", "published_candidate", "objects_json"}).AddRow(8, 3, key, objectsJSON))
		mock.ExpectQuery("SELECT state, published_generation, command_sha256, expected_generation, expected_epoch, command_json, objects_json FROM document_snapshot_candidates").WithArgs(id.Tenant, id.Deployment, key, snapshotTestUUID).
			WillReturnRows(sqlmock.NewRows([]string{"state", "published_generation", "command_sha256", "expected_generation", "expected_epoch", "command_json", "objects_json"}).AddRow("published", 8, snapshotReadCommandDigest(cmd), cmd.Generation, cmd.Epoch, commandJSON, objectsJSON))
		mock.ExpectCommit()
		read, err := a.ReadDocumentSnapshot(context.Background(), id, snapshotTestUUID)
		if err != nil || read.Generation != 8 || read.Epoch != 3 || read.MarkdownSize != cmd.MarkdownSize || read.MarkdownSHA256 != cmd.MarkdownSHA256 || read.LegacyPath != "" || read.Objects == nil || read.Objects.Markdown.Version != "version-md" || read.Objects.Yjs.Version != "version-yjs" {
			t.Fatalf("read=%+v err=%v", read, err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}

func TestReadDocumentSnapshotRejectsUnauthorizedAndBrokenReference(t *testing.T) {
	id := validSnapshotIdentity()
	t.Run("wrong client before database", func(t *testing.T) {
		a, mock := snapshotReadTestDB(t)
		id.Client = "browser"
		_, err := a.ReadDocumentSnapshot(context.Background(), id, snapshotTestUUID)
		snapshotValidationError(t, err, http.StatusForbidden, "snapshot_identity_invalid")
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	id = validSnapshotIdentity()
	t.Run("no share", func(t *testing.T) {
		a, mock := snapshotReadTestDB(t)
		expectSnapshotDocument(mock, "another-owner")
		mock.ExpectQuery("SELECT permission FROM document_shares").WithArgs(int64(7), id.Actor).WillReturnError(sql.ErrNoRows)
		mock.ExpectRollback()
		_, err := a.ReadDocumentSnapshot(context.Background(), id, snapshotTestUUID)
		snapshotValidationError(t, err, http.StatusNotFound, "document_not_found")
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("missing published candidate never falls back to legacy", func(t *testing.T) {
		a, mock := snapshotReadTestDB(t)
		key := strings.Repeat("a", 64)
		expectSnapshotDocument(mock, id.Actor)
		mock.ExpectQuery("SELECT generation, collaboration_epoch, published_candidate, objects_json FROM document_snapshot_heads").WithArgs(id.Tenant, id.Deployment, snapshotTestUUID).
			WillReturnRows(sqlmock.NewRows([]string{"generation", "collaboration_epoch", "published_candidate", "objects_json"}).AddRow(1, 0, key, []byte(`{"Markdown":{}}`)))
		mock.ExpectQuery("SELECT state, published_generation, command_sha256, expected_generation, expected_epoch, command_json, objects_json FROM document_snapshot_candidates").WithArgs(id.Tenant, id.Deployment, key, snapshotTestUUID).WillReturnError(sql.ErrNoRows)
		mock.ExpectRollback()
		_, err := a.ReadDocumentSnapshot(context.Background(), id, snapshotTestUUID)
		snapshotValidationError(t, err, http.StatusServiceUnavailable, "snapshot_reference_invalid")
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}
