package aims

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestResolveProjectDocumentBindingAcceptsLegacyDocumentID(t *testing.T) {
	binding, err := resolveProjectDocumentBinding(map[string]any{
		"documentId": "12be6109-19ea-4ff3-87e7-a185a0100791",
		"title":      "项目立项书",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if binding.Source != "codocs" {
		t.Fatalf("unexpected source: %q", binding.Source)
	}
	if !binding.CodocsUUID.Valid || binding.CodocsUUID.String != "12be6109-19ea-4ff3-87e7-a185a0100791" {
		t.Fatalf("unexpected codocs uuid: %#v", binding.CodocsUUID)
	}
	if binding.Title != "项目立项书" {
		t.Fatalf("unexpected title: %q", binding.Title)
	}
}

func TestResolveProjectDocumentBindingRequiresCodocsUUID(t *testing.T) {
	_, err := resolveProjectDocumentBinding(map[string]any{
		"title": "项目立项书",
	})
	if err == nil {
		t.Fatal("expected missing codocs uuid error")
	}
}

func TestMapProjectDocumentResponseUsesSettingsPageShape(t *testing.T) {
	item := mapProjectDocumentResponse(map[string]any{
		"id":              int64(7),
		"uuid":            "aims-doc-uuid",
		"title":           "项目立项书",
		"doc_category":    "project_proposal",
		"codocs_uuid":     "codocs-doc-uuid",
		"document_source": nil,
		"created_by":      "u1",
		"created_at":      "2026-06-15 10:00:00",
	})

	if item["docCategory"] != "project_proposal" {
		t.Fatalf("unexpected docCategory: %#v", item["docCategory"])
	}
	if item["codocsUuid"] != "codocs-doc-uuid" {
		t.Fatalf("unexpected codocsUuid: %#v", item["codocsUuid"])
	}
	if item["documentSource"] != "codocs" {
		t.Fatalf("unexpected documentSource: %#v", item["documentSource"])
	}
}

func TestProjectDocumentRuntimePreservesBindingSemantics(t *testing.T) {
	contentBytes, err := os.ReadFile("project_documents.go")
	if err != nil {
		t.Fatalf("read project_documents.go: %v", err)
	}
	content := string(contentBytes)

	requiredTokens := []string{
		"func (a *Adapter) handleProjectDocumentRuntime",
		`path == "/v1/aims/documents"`,
		"func (a *Adapter) listDirectDocuments",
		"projectVisibilityWhere(query, \"p\", currentUser)",
		`pathParam(path, "/v1/aims/projects/", "/documents")`,
		"func (a *Adapter) listProjectDocuments",
		"func (a *Adapter) createProjectDocumentBinding",
		"func (a *Adapter) replaceProjectDocumentBinding",
		"a.requireProjectReadAccess(ctx, projectIDText, query)",
		`a.requireProjectUpdateAccess(ctx, "/v1/aims/projects/"+strings.TrimSpace(projectIDText)+"/documents", query, body, projectIDText)`,
		"resolveProjectDocumentBinding",
		"ensureProjectDocumentNotDuplicated",
		"document_source = 'codocs'",
		"document_source = 'repo'",
		"codocs_uuid = ? OR uuid = ?",
		"repo_project_code = ?",
		"repo_file_path = ?",
		"DELETE FROM project_documents",
		"INSERT INTO project_documents",
		"mapProjectDocumentResponse",
	}
	for _, token := range requiredTokens {
		if !strings.Contains(content, token) {
			t.Fatalf("expected project document runtime to include %q", token)
		}
	}

	workspaceBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	workspace := string(workspaceBytes)
	documentIndex := strings.Index(workspace, "a.handleProjectDocumentRuntime(ctx, method, path, query, body)")
	genericIndex := strings.Index(workspace, "a.handleProjectScopedGenericRuntime(ctx, method, path, query, body)")
	if documentIndex < 0 || genericIndex < 0 || documentIndex > genericIndex {
		t.Fatalf("project document runtime must be dispatched before generic project scoped runtime")
	}
}

func TestListDirectDocumentsAppliesProjectVisibility(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT d\\.id, d\\.uuid, d\\.portfolio_id, d\\.project_id, d\\.project_code").
		WithArgs(int64(42), "u1", "u1", "u1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"uuid",
			"portfolio_id",
			"project_id",
			"project_code",
			"milestone_id",
			"work_item_id",
			"parent_id",
			"title",
			"doc_category",
			"is_folder",
			"oss_path",
			"codocs_uuid",
			"document_source",
			"repo_project_code",
			"repo_file_path",
			"repo_commit_id",
			"content_size",
			"sort_order",
			"created_by",
			"updated_by",
			"created_at",
			"updated_at",
		}).
			AddRow(int64(1), "folder-uuid", nil, int64(42), "PRJ-1", nil, nil, nil, "设计文档", nil, int64(1), nil, nil, nil, nil, nil, nil, int64(0), int64(1), "u1", "u1", "2026-06-30 10:00:00", "2026-06-30 10:00:00").
			AddRow(int64(2), "doc-uuid", nil, int64(42), "PRJ-1", nil, nil, int64(1), "概要设计", "design", int64(0), nil, nil, "repo", "huizhi-yun/huizhiyun", "docs/design.md", "abc123", int64(120), int64(2), "u1", "u2", "2026-06-30 10:01:00", "2026-06-30 10:02:00"))

	items, err := adapter.listDirectDocuments(
		context.Background(),
		url.Values{
			"current_user": {"u1"},
			"project_id":   {"42"},
		},
	)
	if err != nil {
		t.Fatalf("expected document list, got %v", err)
	}
	if len(items) != 1 || items[0].ID != int64(1) || len(items[0].Children) != 1 || items[0].Children[0].ID != int64(2) {
		t.Fatalf("unexpected document tree: %#v", items)
	}
	if items[0].Children[0].DocCategory == nil || *items[0].Children[0].DocCategory != "design" {
		t.Fatalf("unexpected child doc category: %#v", items[0].Children[0].DocCategory)
	}
	child := items[0].Children[0]
	if child.DocumentSource == nil || *child.DocumentSource != "repo" ||
		child.RepoProjectCode == nil || *child.RepoProjectCode != "huizhi-yun/huizhiyun" ||
		child.RepoFilePath == nil || *child.RepoFilePath != "docs/design.md" ||
		child.RepoCommitID == nil || *child.RepoCommitID != "abc123" {
		t.Fatalf("repository document metadata was not preserved: %#v", child)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestCreateDirectDocumentUsesTrustedActorAndDerivedProjectCode(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT id, project_code\\s+FROM aims_projects\\s+WHERE id = \\?").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_code"}).AddRow(int64(42), "PRJ-1"))
	mock.ExpectExec("INSERT INTO project_documents").
		WithArgs(
			"doc-uuid",
			nil,
			int64(42),
			"PRJ-1",
			nil,
			nil,
			nil,
			"设计文档",
			"design",
			1,
			nil,
			nil,
			nil,
			nil,
			nil,
			nil,
			int64(0),
			"u1",
			"u1",
		).
		WillReturnResult(sqlmock.NewResult(88, 1))

	data, err := adapter.createDirectDocument(
		context.Background(),
		url.Values{
			"current_user":                  {"u1"},
			"current_user_is_project_admin": {"1"},
		},
		map[string]any{
			"uuid":         "doc-uuid",
			"projectId":    42,
			"projectCode":  "SPOOFED",
			"title":        "设计文档",
			"docCategory":  "design",
			"isFolder":     true,
			"current_user": "spoofed",
		},
	)
	if err != nil {
		t.Fatalf("createDirectDocument returned error: %v", err)
	}
	if data["id"] != int64(88) || data["projectCode"] != "PRJ-1" {
		t.Fatalf("unexpected data: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestCreateDirectDocumentInheritsParentOwnerAndFolderPath(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT is_folder, portfolio_id, project_id, project_code, milestone_id, work_item_id\\s+FROM project_documents\\s+WHERE id = \\?").
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"is_folder", "portfolio_id", "project_id", "project_code", "milestone_id", "work_item_id"}).
			AddRow(int64(1), nil, int64(42), "PRJ-1", nil, nil))
	mock.ExpectExec("INSERT INTO project_documents").
		WithArgs(
			"child-uuid",
			nil,
			int64(42),
			"PRJ-1",
			nil,
			nil,
			int64(7),
			"概要设计",
			nil,
			0,
			nil,
			"codocs-1",
			"codocs",
			nil,
			nil,
			nil,
			int64(120),
			"u1",
			"u1",
		).
		WillReturnResult(sqlmock.NewResult(89, 1))
	mock.ExpectQuery("(?s)SELECT title, parent_id\\s+FROM project_documents\\s+WHERE id = \\? AND is_folder = 1").
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"title", "parent_id"}).AddRow("需求文档", nil))

	data, err := adapter.createDirectDocument(
		context.Background(),
		url.Values{
			"current_user":                  {"u1"},
			"current_user_is_project_admin": {"1"},
		},
		map[string]any{
			"uuid":        "child-uuid",
			"parentId":    7,
			"title":       "概要设计",
			"codocsUuid":  "codocs-1",
			"contentSize": 120,
		},
	)
	if err != nil {
		t.Fatalf("createDirectDocument returned error: %v", err)
	}
	if data["folderPath"] != "需求文档" || data["projectId"] != int64(42) {
		t.Fatalf("unexpected data: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
