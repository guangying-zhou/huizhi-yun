package aims

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestProjectRequirementContentCreateUsesDedicatedHandlerBeforeGenericRuntime(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)

	postBlockIndex := strings.Index(content, "if method == http.MethodPost {")
	if postBlockIndex == -1 {
		t.Fatal("missing post block")
	}
	postBlock := content[postBlockIndex:]
	routeIndex := strings.Index(postBlock, `pathParam(path, "/v1/aims/projects/", "/requirement-contents")`)
	if routeIndex == -1 {
		t.Fatal("missing project requirement content create dedicated route")
	}
	genericIndex := strings.Index(postBlock, "a.handleProjectScopedGenericRuntime(ctx, method, path, query, body)")
	if genericIndex == -1 {
		t.Fatal("missing project scoped generic runtime")
	}
	if routeIndex > genericIndex {
		t.Fatal("project requirement content create must use dedicated handler before generic runtime")
	}
	if !strings.Contains(postBlock[routeIndex:], "a.createProjectRequirementContent(ctx, projectID, query, body)") {
		t.Fatal("project requirement content create route must call dedicated handler")
	}
}

func TestParseRequirementContentTitlePrefixSupportsMultiDigitDecimalSegments(t *testing.T) {
	parsed, ok := parseRequirementContentTitlePrefix("1.10 复杂场景")
	if !ok {
		t.Fatal("expected decimal prefix to parse")
	}
	if parsed.style != "decimal" || len(parsed.segments) != 2 || parsed.segments[0] != 1 || parsed.segments[1] != 10 {
		t.Fatalf("unexpected parsed prefix: %#v", parsed)
	}
}

func TestCreateProjectRequirementContentSplitsModuleMarkdownAndMarksSpecDirty(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT lifecycle_status FROM aims_projects WHERE id = \\?").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"lifecycle_status"}).AddRow("active"))
	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT id, parent_id, heading_depth, title, sort_order\\s+FROM requirement_contents\\s+WHERE project_id = \\? AND heading_depth = \\?.*parent_id IS NULL").
		WithArgs(int64(42), int64(2)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "parent_id", "heading_depth", "title", "sort_order"}))
	mock.ExpectQuery("SELECT COALESCE\\(MAX\\(sort_order\\), -1\\) AS max_sort FROM requirement_contents WHERE project_id = \\? AND parent_id IS NULL").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"max_sort"}).AddRow(int64(-1)))
	mock.ExpectExec("(?s)INSERT INTO requirement_contents").
		WithArgs(int64(42), nil, int64(2), "一、订单管理", "模块介绍", int64(0), "u1", "u1").
		WillReturnResult(sqlmock.NewResult(101, 1))
	mock.ExpectExec("UPDATE requirement_contents SET content_original_id = \\? WHERE id = \\?").
		WithArgs(int64(101), int64(101)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("(?s)SELECT id, parent_id, heading_depth, title, sort_order\\s+FROM requirement_contents\\s+WHERE project_id = \\? AND heading_depth = \\?.*parent_id = \\?").
		WithArgs(int64(42), int64(3), int64(101)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "parent_id", "heading_depth", "title", "sort_order"}))
	mock.ExpectQuery("SELECT title FROM requirement_contents WHERE id = \\? LIMIT 1").
		WithArgs(int64(101)).
		WillReturnRows(sqlmock.NewRows([]string{"title"}).AddRow("一、订单管理"))
	mock.ExpectExec("(?s)INSERT INTO requirement_contents").
		WithArgs(int64(42), int64(101), int64(3), "1.1 创建订单", "创建正文", int64(0), "u1", "u1").
		WillReturnResult(sqlmock.NewResult(102, 1))
	mock.ExpectExec("UPDATE requirement_contents SET content_original_id = \\? WHERE id = \\?").
		WithArgs(int64(102), int64(102)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("(?s)UPDATE project_documents\\s+SET import_status = 'imported_dirty'.*WHERE project_id = \\?").
		WithArgs(int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	data, err := adapter.createProjectRequirementContent(
		context.Background(),
		"42",
		url.Values{
			"current_user":                  {"u1"},
			"current_user_is_project_admin": {"1"},
		},
		map[string]any{
			"kind":         "module",
			"title":        "订单管理",
			"headingDepth": int64(2),
			"contentMd":    "模块介绍\n\n### 创建订单\n创建正文",
		},
	)
	if err != nil {
		t.Fatalf("expected requirement content create to pass, got %v", err)
	}
	if data["id"] != int64(101) || data["title"] != "一、订单管理" {
		t.Fatalf("unexpected create result: %#v", data)
	}
	childIDs, ok := data["childContentIds"].([]any)
	if !ok || len(childIDs) != 1 || childIDs[0] != int64(102) {
		t.Fatalf("unexpected child ids: %#v", data["childContentIds"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
