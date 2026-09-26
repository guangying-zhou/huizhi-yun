package codocs

import (
	"context"
	"net/url"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestDocumentsListRetainsTrustedActorPaginationFiltersAndArgumentOrder(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	query := trustedDocumentListQuery("viewer")
	query.Set("page", "3")
	query.Set("limit", "10")
	query.Set("type", "private")
	query.Set("owner", "owner-1")
	query.Set("search", "architecture")
	query.Set("last_editor", "editor-1")
	query.Set("uuid", "doc-1")
	query.Set("dept_code", "D1")
	query.Set("project_code", "P1")
	query.Set("oss_path", "codocs/private/doc-1.md")
	query.Set("folder_id", "42")
	query.Set("published_mode", "published")
	query.Set("starred", "1")
	query.Set("home", "true")
	query.Set("exclude_worklogs", "1")
	query.Set("exclude_weekly_reports", "true")

	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM documents d WHERE .*d\.doc_type = \?.*d\.owner_uid = \?.*d\.title LIKE \? ESCAPE '!'.*d\.last_editor_uid = \?.*d\.uuid = \?.*d\.dept_code = \?.*d\.project_code = \?.*d\.oss_path = \?.*d\.star_flag = 1.*d\.home_flag = 1.*d\.folder_id = \?.*d\.publish_info IS NOT NULL.*worklogs.*weekly-reports`).
		WithArgs("viewer", "viewer", "viewer", "private", "owner-1", "%architecture%", "editor-1", "doc-1", "D1", "P1", "codocs/private/doc-1.md", "42").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectQuery(`(?s)SELECT .* FROM documents d.*LIMIT \? OFFSET \?`).
		WithArgs("viewer", "viewer", "viewer", "private", "owner-1", "%architecture%", "editor-1", "doc-1", "D1", "P1", "codocs/private/doc-1.md", "42", 10, 20).WillReturnRows(emptyDocumentListRows())

	result, err := adapter.documentsList(context.Background(), query)
	if err != nil {
		t.Fatalf("documentsList: %v", err)
	}
	if result["page"] != 3 || result["pageSize"] != 10 {
		t.Fatalf("pagination = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("list query did not preserve predicate/filter argument order: %v", err)
	}
}

func TestDocumentsListSearchTreatsWildcardsAndBackslashLiterally(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	query := trustedDocumentListQuery("viewer")
	query.Set("search", `50%_\`)
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM documents d WHERE .*d\.title LIKE \? ESCAPE '!'`).
		WithArgs("viewer", "viewer", "viewer", `%50!%!_!\%`).WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectQuery(`(?s)SELECT .* FROM documents d.*d\.title LIKE \? ESCAPE '!'.*LIMIT \? OFFSET \?`).
		WithArgs("viewer", "viewer", "viewer", `%50!%!_!\%`, 5000, 0).WillReturnRows(emptyDocumentListRows())
	if _, err := adapter.documentsList(context.Background(), query); err != nil {
		t.Fatalf("documentsList: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("literal search: %v", err)
	}
	query.Set("search", strings.Repeat("字", 101))
	if _, err := adapter.documentsList(context.Background(), query); err == nil {
		t.Fatal("overlong title search accepted")
	}
}

func TestDocumentsSearchCapsPageAndUsesStableFilterArguments(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	query := url.Values{
		"page":         {"2"},
		"limit":        {"999"},
		"keyword":      {"architecture"},
		"doc_type":     {"project"},
		"project_code": {"P1"},
		"dept_code":    {"D1"},
		"owner_uid":    {"owner-1"},
	}
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM documents d WHERE d\.status != 0 AND d\.title LIKE \? AND d\.doc_type = \? AND d\.project_code = \? AND d\.dept_code = \? AND d\.owner_uid = \?`).
		WithArgs("%architecture%", "project", "P1", "D1", "owner-1").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectQuery(`(?s)SELECT d\.uuid.*FROM documents d.*LIMIT \? OFFSET \?`).
		WithArgs("%architecture%", "project", "P1", "D1", "owner-1", 100, 100).WillReturnRows(sqlmock.NewRows([]string{"uuid", "title", "doc_type", "owner_uid", "dept_code", "project_code", "content_size", "ai_abstract", "updated_at"}))

	result, err := adapter.documentsSearch(context.Background(), query)
	if err != nil {
		t.Fatalf("documentsSearch: %v", err)
	}
	if result["page"] != 2 || result["pageSize"] != 100 {
		t.Fatalf("search pagination cap = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("search query expectations: %v", err)
	}
}

func TestDocumentsBatchSummaryRejectsInvalidInputAndPreservesCallerOrder(t *testing.T) {
	adapter := &Adapter{}
	if _, err := adapter.documentsBatchSummary(context.Background(), map[string]any{}); err == nil {
		t.Fatal("empty uuid batch was accepted")
	}
	overLimit := make([]string, 51)
	for index := range overLimit {
		overLimit[index] = "doc"
	}
	if _, err := adapter.documentsBatchSummary(context.Background(), map[string]any{"uuids": overLimit}); err == nil {
		t.Fatal("over-limit uuid batch was accepted")
	}

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter.db = db
	mock.ExpectQuery(`(?s)SELECT uuid, title, doc_type, owner_uid, status, content_size, ai_abstract, updated_at.*WHERE uuid IN \(\?,\?\) AND status != 0`).
		WithArgs("doc-a", "doc-b").
		WillReturnRows(sqlmock.NewRows([]string{"uuid", "title", "doc_type", "owner_uid", "status", "content_size", "ai_abstract", "updated_at"}).
			AddRow("doc-b", "B", "private", "owner", 1, 2, nil, "2026-07-11"))

	items, err := adapter.documentsBatchSummary(context.Background(), map[string]any{"uuids": []string{"doc-a", "doc-b", "doc-a"}})
	if err != nil {
		t.Fatalf("documentsBatchSummary: %v", err)
	}
	if len(items) != 3 || stringValue(items[0]["uuid"]) != "doc-a" || stringValue(items[1]["uuid"]) != "doc-b" || stringValue(items[2]["uuid"]) != "doc-a" {
		t.Fatalf("batch output did not retain caller order and duplicate placeholders: %#v", items)
	}
	if items[0]["error"] != "not_found" || items[2]["error"] != "not_found" {
		t.Fatalf("missing entries = %#v, want explicit not_found", items)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("batch query did not deduplicate SQL arguments: %v", err)
	}
}

func TestMyDocumentStatsRequiresActorAndHandlesZeroDenominator(t *testing.T) {
	adapter := &Adapter{}
	if _, err := adapter.myDocumentStats(context.Background(), url.Values{}); err == nil {
		t.Fatal("stats accepted a missing actor")
	}

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter.db = db
	mock.ExpectQuery(`(?s)SELECT.*COUNT\(\*\) AS all_count.*owner_uid = \?.*doc_type <> 'git-project'`).
		WithArgs("viewer", "viewer").
		WillReturnRows(sqlmock.NewRows([]string{"all_count", "all_size", "my_count", "my_size"}).AddRow(0, 0, 0, 0))
	mock.ExpectQuery(`(?s)SELECT.*doc_type.*GROUP BY doc_type.*ORDER BY count DESC, doc_type ASC`).
		WithArgs("viewer").WillReturnRows(sqlmock.NewRows([]string{"doc_type", "count", "size"}))

	result, err := adapter.myDocumentStats(context.Background(), url.Values{"current_user": {"viewer"}})
	if err != nil {
		t.Fatalf("myDocumentStats: %v", err)
	}
	if result["countRatio"] != float64(0) || result["sizeRatio"] != float64(0) {
		t.Fatalf("zero denominator ratios = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("stats query expectations: %v", err)
	}
}

func TestDocumentNameExistsUsesNullFolderAndExcludeUUID(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	query := url.Values{
		"title":        {"Architecture"},
		"doc_type":     {"private"},
		"owner_uid":    {"owner-1"},
		"folder_id":    {"null"},
		"dept_code":    {"D1"},
		"project_code": {"P1"},
		"exclude_uuid": {"doc-current"},
	}
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents WHERE status = 1 AND title = \? AND doc_type = \? AND owner_uid = \? AND folder_id IS NULL AND dept_code = \? AND project_code = \? AND uuid != \?`).
		WithArgs("Architecture", "private", "owner-1", "D1", "P1", "doc-current").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(1))

	result, err := adapter.documentNameExists(context.Background(), query)
	if err != nil {
		t.Fatalf("documentNameExists: %v", err)
	}
	if result["exists"] != true {
		t.Fatalf("exists = %#v, want true", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("name check query expectations: %v", err)
	}
}

func TestDocumentsTrashSelectsCompleteTrashProjection(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	mock.ExpectQuery(`(?s)SELECT d\.id, d\.uuid, d\.title, d\.doc_type, d\.oss_path, d\.owner_uid,.*d\.last_editor_uid, d\.created_at, d\.updated_at, d\.deleted_at,.*f\.name AS folder_name.*FROM documents d.*LEFT JOIN folders f ON d\.folder_id = f\.id.*ORDER BY d\.deleted_at DESC`).
		WithArgs("viewer", "viewer", "viewer").
		WillReturnRows(sqlmock.NewRows([]string{"id", "uuid", "title", "doc_type", "oss_path", "owner_uid", "dept_code", "project_code", "folder_id", "content_size", "last_editor_uid", "created_at", "updated_at", "deleted_at", "folder_name"}))

	result, err := adapter.documentsTrash(context.Background(), trustedDocumentListQuery("viewer"))
	if err != nil {
		t.Fatalf("documentsTrash: %v", err)
	}
	if result["total"] != 0 || result["pageSize"] != 0 {
		t.Fatalf("trash empty result = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("trash projection query expectations: %v", err)
	}
}
