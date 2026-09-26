package codocs

import (
	"context"
	"database/sql"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-sql-driver/mysql"
	"net/url"
	"testing"
)

func TestMissingPolicyReadDoesNotWrite(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("(?s)SELECT id, document_ref_type.*FROM document_access_policies").WillReturnError(sql.ErrNoRows)
	policy, err := (&Adapter{db: db}).ensurePolicyDefault(context.Background(), "codocs_document", "doc-1", "aims", "P1", "u1", false)
	if err != nil || policy.ID != 0 || policy.DefaultPermission != "none" {
		t.Fatalf("read default: %#v %v", policy, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestImmutableDocumentCreationReplay(t *testing.T) {
	for _, conflict := range []bool{false, true} {
		t.Run(map[bool]string{false: "same input", true: "other owner"}[conflict], func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			adapter := &Adapter{db: db}
			mock.ExpectQuery("SELECT id FROM documents WHERE oss_path").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(7))
			match := mock.ExpectQuery("(?s)SELECT id FROM documents WHERE id=.*owner_uid=")
			if conflict {
				match.WillReturnError(sql.ErrNoRows)
			} else {
				match.WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(7))
			}
			result, err := adapter.createDocument(context.Background(), map[string]any{"uuid": "doc-1", "title": "Spec", "ownerUid": "u1", "docType": "project", "projectCode": "P1", "ossPath": "codocs/document-creations/doc-1/hash.md"})
			if conflict && err == nil {
				t.Fatal("owner conflict accepted")
			}
			if !conflict && (err != nil || result["id"] != int64(7)) {
				t.Fatalf("replay: %#v %v", result, err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCabinetReplayChecksImmutableMetadata(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	mock.ExpectExec("INSERT INTO cabinet_files").WillReturnError(&mysql.MySQLError{Number: 1062})
	mock.ExpectQuery("(?s)SELECT uuid FROM cabinet_files WHERE uuid=.*oss_path=.*owner_uid=").
		WithArgs("file-1", "spec.txt", "spec.txt", "txt", int64(3), "codocs/projects/P1/cabinet/file-1-hash.txt", "u1", nil, "P1", nil).
		WillReturnError(sql.ErrNoRows)
	_, err = adapter.createProjectCabinetFile(context.Background(), url.Values{codocsTrustedProjectCabinetQueryKey: {"P1"}},
		map[string]any{"uuid": "file-1", "filename": "spec.txt", "file_ext": "txt", "file_size": 3, "oss_path": "codocs/projects/P1/cabinet/file-1-hash.txt", "owner_uid": "u1"})
	if err == nil {
		t.Fatal("conflicting upload accepted")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCodocsProjectAccessProxyRequiresSignedServiceActor(t *testing.T) {
	for _, purpose := range []string{"", "user", "service-command"} {
		query := url.Values{"hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"codocs"}, "hzy_runtime_actor_purpose": {purpose}, "codocs_trusted_aims_document_access": {"1"}, aimsTrustedDocumentAccessProjectCodesQuery: {"P1"}}
		projects, _ := trustedAimsDocumentAccessScopeFacts(query)
		if (len(projects) == 1) != (purpose == "service-command") {
			t.Fatalf("purpose=%s projects=%v", purpose, projects)
		}
	}
}
