package aims

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestProjectRequirementCreateUsesDedicatedHandlerBeforeGenericRuntime(t *testing.T) {
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
	routeIndex := strings.Index(postBlock, `pathParam(path, "/v1/aims/projects/", "/requirements")`)
	if routeIndex == -1 {
		t.Fatal("missing project requirement create dedicated route")
	}
	genericIndex := strings.Index(postBlock, "a.handleProjectScopedGenericRuntime(ctx, method, path, query, body)")
	if genericIndex == -1 {
		t.Fatal("missing project scoped generic runtime")
	}
	if routeIndex > genericIndex {
		t.Fatal("project requirement create must use dedicated handler before generic runtime")
	}
	if !strings.Contains(postBlock[routeIndex:], "a.createProjectRequirement(ctx, projectID, query, body)") {
		t.Fatal("project requirement create route must call dedicated handler")
	}
}

func TestCreateProjectRequirementLinksExistingContentsAndMarksSpecDirty(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT lifecycle_status FROM aims_projects WHERE id = \\?").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"lifecycle_status"}).AddRow("active"))
	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\) AS cnt\\s+FROM requirement_item_contents ric.*WHERE c.id IN \\(\\?,\\?\\)").
		WithArgs(int64(201), int64(202)).
		WillReturnRows(sqlmock.NewRows([]string{"cnt"}).AddRow(int64(0)))
	mock.ExpectQuery("SELECT project_code FROM aims_projects WHERE id = \\?").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"project_code"}).AddRow("PRJ"))
	mock.ExpectQuery("SELECT COALESCE\\(MAX\\(req_number\\), 0\\) FROM requirement_items WHERE project_id = \\?").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"max_number"}).AddRow(int64(7)))
	mock.ExpectExec("(?s)INSERT INTO requirement_items").
		WithArgs(int64(42), int64(8), "PRJ-REQ-008", "结算规则", "functional", "财务", "P1", "customer", nil, int64(77), "覆盖线上结算", "u1").
		WillReturnResult(sqlmock.NewResult(88, 1))
	mock.ExpectExec("(?s)INSERT IGNORE INTO requirement_item_contents").
		WithArgs(int64(88), int64(201), 0, "u1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("(?s)INSERT IGNORE INTO requirement_item_contents").
		WithArgs(int64(88), int64(202), 1, "u1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("(?s)UPDATE project_documents\\s+SET import_status = 'imported_dirty'.*WHERE project_id = \\?").
		WithArgs(int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	data, err := adapter.createProjectRequirement(
		context.Background(),
		"42",
		url.Values{
			"current_user":                  {"u1"},
			"current_user_is_project_admin": {"1"},
		},
		map[string]any{
			"title":      " 结算规则 ",
			"type":       "functional",
			"category":   "财务",
			"priority":   "P1",
			"source":     "customer",
			"workItemId": int64(77),
			"scopeNote":  "覆盖线上结算",
			"contentIds": []any{int64(201), int64(202)},
		},
	)
	if err != nil {
		t.Fatalf("expected requirement create to pass, got %v", err)
	}
	if data["id"] != int64(88) || data["reqNumber"] != int64(8) || data["reqCode"] != "PRJ-REQ-008" {
		t.Fatalf("unexpected create result: %#v", data)
	}
	if data["title"] != "结算规则" || data["priority"] != "P1" || data["source"] != "customer" || data["status"] != "draft" {
		t.Fatalf("unexpected requirement payload: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
