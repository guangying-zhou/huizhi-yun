package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func personalDocumentIdentity() PersonalFolderCreationIdentity {
	return PersonalFolderCreationIdentity{Tenant: "tenant-1", Deployment: "codocs-dev", Actor: "actor-1", Client: "enterprise.runtime", RequestID: "req-1", Key: "doc-key"}
}

func personalDocumentPayload() map[string]any {
	return map[string]any{"title": "Deck", "doc_type": "slide", "content_sha256": strings.Repeat("a", 64), "content_size": float64(12)}
}

func personalDocumentIdentityAndPath(identity PersonalFolderCreationIdentity, payload map[string]any) (string, string) {
	folder := int64(0)
	if value, ok := payload["folder_id"].(float64); ok {
		folder = int64(value)
	}
	command := map[string]any{"title": strings.TrimSpace(payload["title"].(string)), "doc_type": payload["doc_type"], "folder_id": folder, "content_sha256": payload["content_sha256"], "content_size": payload["content_size"]}
	digest, _ := io.ValidateAndDigestCommand(command)
	ns := sha256.Sum256([]byte(strings.Join([]string{"codocs.personal-document.create.v1", identity.Tenant, identity.Deployment, identity.Actor, identity.Key}, "\x00")))
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	uuid := fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16])
	return uuid, "codocs/document-creations/" + uuid + "/" + digest + ".md"
}

func requirePersonalDocumentHTTPStatus(t *testing.T, err error, status int) {
	t.Helper()
	var httpErr httperror.Error
	if err == nil || !errors.As(err, &httpErr) || httpErr.Status != status {
		t.Fatalf("error = %v, want HTTP %d", err, status)
	}
}

func expectPersonalDocumentCreateSuccess(mock sqlmock.Sqlmock, uuid, path string) {
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents WHERE .*folder_id IS NULL`).
		WithArgs("Deck", "actor-1", uuid, "slide").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectQuery(`SELECT id FROM documents WHERE oss_path = \? AND status != 0 LIMIT 1`).
		WithArgs(path).WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(`SELECT TABLE_NAME\s+FROM information_schema\.TABLES`).
		WithArgs("document_relations").WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_relations"))
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO documents`).
		WithArgs(uuid, "Deck", "slide", path, "actor-1", nil, nil, nil, int64(12)).
		WillReturnResult(sqlmock.NewResult(88, 1))
	mock.ExpectExec(`(?s)INSERT INTO document_relations.*ON DUPLICATE KEY UPDATE`).
		WithArgs(int64(88), uuid, "actor-1", "created_by_me", "document", "88", 1, 1, 0, `{"deptCode":null,"docType":"slide","folderId":null,"projectCode":null,"sourceApp":"","sourceBiz":""}`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
}

func TestCreatePersonalDocumentSuccessUsesImmutableOwnerRelationTransaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	identity := personalDocumentIdentity()
	payload := personalDocumentPayload()
	uuid, path := personalDocumentIdentityAndPath(identity, payload)
	expectPersonalDocumentCreateSuccess(mock, uuid, path)
	got, err := (&Adapter{db: db}).CreatePersonalDocument(context.Background(), identity, payload)
	if err != nil || got["uuid"] != uuid || got["oss_path"] != path {
		t.Fatalf("created = %#v, err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreatePersonalDocumentIdentityChangesProduceDifferentUUID(t *testing.T) {
	payload := personalDocumentPayload()
	identity := personalDocumentIdentity()
	uuid, _ := personalDocumentIdentityAndPath(identity, payload)
	for name, mutate := range map[string]func(*PersonalFolderCreationIdentity){
		"tenant":     func(id *PersonalFolderCreationIdentity) { id.Tenant = "tenant-2" },
		"deployment": func(id *PersonalFolderCreationIdentity) { id.Deployment = "codocs-other" },
		"actor":      func(id *PersonalFolderCreationIdentity) { id.Actor = "actor-2" },
	} {
		t.Run(name, func(t *testing.T) {
			changed := identity
			mutate(&changed)
			other, _ := personalDocumentIdentityAndPath(changed, payload)
			if other == uuid {
				t.Fatalf("identity change reused UUID %q", uuid)
			}
		})
	}
}

func TestCreatePersonalDocumentSameKeyReplayDoesNotInsert(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	identity := personalDocumentIdentity()
	payload := personalDocumentPayload()
	uuid, path := personalDocumentIdentityAndPath(identity, payload)
	expectPersonalDocumentCreateSuccess(mock, uuid, path)
	if _, err := (&Adapter{db: db}).CreatePersonalDocument(context.Background(), identity, payload); err != nil {
		t.Fatalf("initial creation: %v", err)
	}
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents WHERE .*folder_id IS NULL`).
		WithArgs("Deck", "actor-1", uuid, "slide").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectQuery(`SELECT id FROM documents WHERE oss_path = \? AND status != 0 LIMIT 1`).
		WithArgs(path).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(88))
	mock.ExpectQuery(`SELECT id FROM documents WHERE id=.*owner_uid=`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(88))
	got, err := (&Adapter{db: db}).CreatePersonalDocument(context.Background(), identity, payload)
	if err != nil || got["id"] != int64(88) {
		t.Fatalf("replay = %#v, err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreatePersonalDocumentRejectsInvalidIdentityAndPayloadBeforeDB(t *testing.T) {
	cases := []struct {
		name string
		id   PersonalFolderCreationIdentity
		body map[string]any
	}{
		{"missing actor", PersonalFolderCreationIdentity{Tenant: "t", Deployment: "d", Client: "enterprise.runtime", Key: "k"}, personalDocumentPayload()},
		{"wrong client", PersonalFolderCreationIdentity{Tenant: "t", Deployment: "d", Actor: "a", Client: "codocs", Key: "k"}, personalDocumentPayload()},
		{"owner injection", personalDocumentIdentity(), map[string]any{"title": "x", "doc_type": "private", "content_sha256": strings.Repeat("a", 64), "content_size": float64(1), "owner_uid": "victim"}},
		{"path injection", personalDocumentIdentity(), map[string]any{"title": "x", "doc_type": "private", "content_sha256": strings.Repeat("a", 64), "content_size": float64(1), "oss_path": "codocs/users/victim/x"}},
		{"uuid injection", personalDocumentIdentity(), map[string]any{"title": "x", "doc_type": "private", "content_sha256": strings.Repeat("a", 64), "content_size": float64(1), "uuid": "spoof"}},
		{"bad kind", personalDocumentIdentity(), map[string]any{"title": "x", "doc_type": "department", "content_sha256": strings.Repeat("a", 64), "content_size": float64(1)}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, _, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			_, err = (&Adapter{db: db}).CreatePersonalDocument(context.Background(), tc.id, tc.body)
			if tc.name == "missing actor" || tc.name == "wrong client" {
				requirePersonalDocumentHTTPStatus(t, err, 403)
			} else {
				requirePersonalDocumentHTTPStatus(t, err, 400)
			}
		})
	}
}

func TestCreatePersonalDocumentRejectsCrossOwnerFolderBeforeWrite(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(`SELECT id, name, folder_type, owner_uid, dept_code, project_code, parent_id FROM folders WHERE id = \?`).
		WithArgs(int64(7)).WillReturnRows(sqlmock.NewRows([]string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id"}).AddRow(7, "Other", "slide", "other", nil, nil, nil))
	payload := personalDocumentPayload()
	payload["folder_id"] = float64(7)
	_, err = (&Adapter{db: db}).CreatePersonalDocument(context.Background(), personalDocumentIdentity(), payload)
	requirePersonalDocumentHTTPStatus(t, err, 403)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreatePersonalDocumentSameKeyChangedContentConflictsWithoutReplay(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	identity := personalDocumentIdentity()
	payload := personalDocumentPayload()
	payload["content_sha256"] = strings.Repeat("b", 64)
	uuid, path := personalDocumentIdentityAndPath(identity, payload)
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents WHERE .*folder_id IS NULL`).WithArgs("Deck", "actor-1", uuid, "slide").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectQuery(`SELECT id FROM documents WHERE oss_path = \? AND status != 0 LIMIT 1`).WithArgs(path).WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(`SELECT TABLE_NAME\s+FROM information_schema\.TABLES`).WithArgs("document_relations").WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_relations"))
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO documents`).WillReturnError(&mysql.MySQLError{Number: 1062, Message: "duplicate uuid"})
	mock.ExpectRollback()
	mock.ExpectQuery(`SELECT id FROM documents WHERE uuid=\? AND oss_path=\?`).WillReturnError(sql.ErrNoRows)
	_, err = (&Adapter{db: db}).CreatePersonalDocument(context.Background(), identity, payload)
	requirePersonalDocumentHTTPStatus(t, err, 409)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreatePersonalDocumentSameKeyChangedTitleConflicts(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	identity := personalDocumentIdentity()
	payload := personalDocumentPayload()
	payload["title"] = "Renamed"
	uuid, path := personalDocumentIdentityAndPath(identity, payload)
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents WHERE .*folder_id IS NULL`).WithArgs("Renamed", "actor-1", uuid, "slide").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectQuery(`SELECT id FROM documents WHERE oss_path = \? AND status != 0 LIMIT 1`).WithArgs(path).WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(`SELECT TABLE_NAME\s+FROM information_schema\.TABLES`).WithArgs("document_relations").WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_relations"))
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO documents`).WillReturnError(&mysql.MySQLError{Number: 1062, Message: "duplicate uuid"})
	mock.ExpectRollback()
	mock.ExpectQuery(`SELECT id FROM documents WHERE uuid=\? AND oss_path=\?`).WillReturnError(sql.ErrNoRows)
	_, err = (&Adapter{db: db}).CreatePersonalDocument(context.Background(), identity, payload)
	requirePersonalDocumentHTTPStatus(t, err, 409)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreatePersonalDocumentTitleConflictStopsBeforeInsert(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	identity := personalDocumentIdentity()
	payload := personalDocumentPayload()
	uuid, _ := personalDocumentIdentityAndPath(identity, payload)
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents WHERE .*folder_id IS NULL`).WithArgs("Deck", "actor-1", uuid, "slide").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(1))
	_, err = (&Adapter{db: db}).CreatePersonalDocument(context.Background(), identity, payload)
	requirePersonalDocumentHTTPStatus(t, err, 409)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreatePersonalDocumentRelationFailureRollsBackDocument(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	identity := personalDocumentIdentity()
	payload := personalDocumentPayload()
	uuid, path := personalDocumentIdentityAndPath(identity, payload)
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents WHERE .*folder_id IS NULL`).WithArgs("Deck", "actor-1", uuid, "slide").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectQuery(`SELECT id FROM documents WHERE oss_path = \? AND status != 0 LIMIT 1`).WithArgs(path).WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(`SELECT TABLE_NAME\s+FROM information_schema\.TABLES`).WithArgs("document_relations").WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_relations"))
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO documents`).WithArgs(uuid, "Deck", "slide", path, "actor-1", nil, nil, nil, int64(12)).WillReturnResult(sqlmock.NewResult(88, 1))
	mock.ExpectExec(`INSERT INTO document_relations`).WillReturnError(errors.New("relation write failed"))
	mock.ExpectRollback()
	if _, err := (&Adapter{db: db}).CreatePersonalDocument(context.Background(), identity, payload); err == nil {
		t.Fatal("relation failure swallowed")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreatePersonalDocumentFolderLockRejectsChangedScope(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	identity := personalDocumentIdentity()
	payload := personalDocumentPayload()
	payload["folder_id"] = float64(7)
	_, path := personalDocumentIdentityAndPath(identity, payload)
	parent := sqlmock.NewRows([]string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id"}).AddRow(7, "Owned", "slide", "actor-1", nil, nil, nil)
	mock.ExpectQuery(`SELECT id, name, folder_type, owner_uid, dept_code, project_code, parent_id FROM folders WHERE id = \?`).WithArgs(int64(7)).WillReturnRows(parent)
	uuid, _ := personalDocumentIdentityAndPath(identity, payload)
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents WHERE .*folder_id = \?`).WithArgs("Deck", "actor-1", uuid, "slide", int64(7)).WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectQuery(`SELECT id FROM documents WHERE oss_path = \? AND status != 0 LIMIT 1`).WithArgs(path).WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(`SELECT TABLE_NAME\s+FROM information_schema\.TABLES`).WithArgs("document_relations").WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_relations"))
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id, name, folder_type, owner_uid, dept_code, project_code, parent_id FROM folders WHERE id = \? FOR UPDATE`).WithArgs(int64(7)).WillReturnRows(sqlmock.NewRows([]string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id"}).AddRow(7, "Changed", "slide", "other", nil, nil, nil))
	mock.ExpectRollback()
	_, err = (&Adapter{db: db}).CreatePersonalDocument(context.Background(), identity, payload)
	requirePersonalDocumentHTTPStatus(t, err, 403)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
