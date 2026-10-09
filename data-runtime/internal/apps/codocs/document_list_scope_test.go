package codocs

import (
	"context"
	"net/url"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func trustedDocumentListQuery(actor string) url.Values {
	return url.Values{
		"current_user":                      {actor},
		"hzy_runtime_actor_delegated":       {"1"},
		codocsTrustedDepartmentReadQueryKey: {""},
	}
}

func emptyDocumentListRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "uuid", "title", "doc_type", "oss_path", "owner_uid",
		"dept_code", "project_code", "folder_id", "content_size",
		"last_editor_uid", "created_at", "updated_at", "star_flag",
		"home_flag", "readonly_flag", "publish_info", "folder_name",
	})
}

func TestDocumentsListFailsClosedWithoutTrustedDelegatedActor(t *testing.T) {
	adapter := &Adapter{}
	for _, query := range []url.Values{
		{},
		{"current_user": {"viewer"}},
		{"hzy_runtime_actor_delegated": {"1"}},
	} {
		if _, err := adapter.documentsList(context.Background(), query); err == nil {
			t.Fatalf("documentsList accepted untrusted query %#v", query)
		}
	}
}

func TestDocumentsListUsesOwnerShareAndRelationVisibilityPredicate(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	query := trustedDocumentListQuery("viewer")
	visibility := `d\.owner_uid = \?.*document_shares visible_share.*visible_share\.shared_to_uid = \?.*document_relations visible_relation.*visible_relation\.related_uid = \?.*visible_relation\.can_read = 1.*project_preview_access.*INTERVAL 12 HOUR`
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM documents d WHERE d\.status = 1 AND \(\s*`+visibility+`\)`).
		WithArgs("viewer", "viewer", "viewer").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectQuery(`(?s)SELECT .*FROM documents d.*WHERE d\.status = 1 AND \(\s*`+visibility+`\).*LIMIT \? OFFSET \?`).
		WithArgs("viewer", "viewer", "viewer", 5000, 0).
		WillReturnRows(emptyDocumentListRows())

	result, err := adapter.documentsList(context.Background(), query)
	if err != nil {
		t.Fatalf("documentsList: %v", err)
	}
	if result["total"] != int64(0) {
		t.Fatalf("result total = %#v, want 0", result["total"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL visibility expectations: %v", err)
	}
}

func TestDocumentsListSharedViewUsesTrustedActorNotCallerOwner(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	query := trustedDocumentListQuery("viewer")
	query.Set("type", "shared")
	query.Set("owner", "victim")

	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM documents d WHERE .*document_id FROM document_shares WHERE shared_to_uid = \?`).
		WithArgs("viewer", "viewer", "viewer", "viewer").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectQuery(`(?s)SELECT .*document_shares ds.*shared_to_uid = \?.*WHERE d\.status = 1.*document_id FROM document_shares WHERE shared_to_uid = \?.*LIMIT \? OFFSET \?`).
		WithArgs("viewer", "viewer", "viewer", "viewer", "viewer", "viewer", "viewer", 5000, 0).
		WillReturnRows(emptyDocumentListRows())

	if _, err := adapter.documentsList(context.Background(), query); err != nil {
		t.Fatalf("documentsList: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("caller owner selected another user's share state: %v", err)
	}
}

func TestDocumentsTrashUsesSameVisibilityPredicateAndTrustedDepartmentOnly(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	query := trustedDocumentListQuery("viewer")
	query.Set(codocsTrustedDepartmentReadQueryKey, "D1")
	visibility := `d\.owner_uid = \?.*document_shares visible_share.*document_relations visible_relation.*d\.doc_type = 'department' AND d\.dept_code = \?.*ORDER BY d\.deleted_at DESC`
	mock.ExpectQuery(`(?s)SELECT d\.id, d\.uuid.*FROM documents d.*WHERE d\.status = 0 AND d\.deleted_at IS NOT NULL.*`+visibility).
		WithArgs("viewer", "viewer", "viewer", "D1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "uuid", "title", "doc_type", "oss_path", "owner_uid", "dept_code", "project_code", "folder_id", "content_size", "last_editor_uid", "created_at", "updated_at", "deleted_at", "folder_name",
		}))

	if _, err := adapter.documentsTrash(context.Background(), query); err != nil {
		t.Fatalf("documentsTrash: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet trash visibility expectations: %v", err)
	}
}

func TestDocumentAccessRejectsMissingActorBeforeDocumentRead(t *testing.T) {
	adapter := &Adapter{}
	_, err := adapter.documentAccess(context.Background(), "doc-1", url.Values{})
	if err == nil {
		t.Fatal("documentAccess accepted a missing actor")
	}
	if !strings.Contains(err.Error(), "Current user is required") {
		t.Fatalf("documentAccess error = %v", err)
	}
}

func TestDocumentReadVisibilityPredicateKeepsProjectCodeOutOfAuthorization(t *testing.T) {
	predicate, args := documentReadVisibilityPredicate("viewer", "")
	if strings.Contains(predicate, "project_code") {
		t.Fatalf("project_code must not grant document read access: %s", predicate)
	}
	if len(args) != 3 || args[0] != "viewer" || args[1] != "viewer" || args[2] != "viewer" {
		t.Fatalf("visibility args = %#v", args)
	}
	if _, _, err := requireTrustedDocumentListActor(url.Values{"current_user": {"viewer"}, "hzy_runtime_actor_delegated": {"0"}}); err == nil {
		t.Fatal("non-delegated user actor was accepted")
	}
	if _, _, err := requireTrustedDocumentListActor(url.Values{"current_user": {"viewer"}, "hzy_runtime_actor_delegated": {"1"}}); err != nil {
		t.Fatalf("trusted user actor rejected: %v", err)
	}
}
