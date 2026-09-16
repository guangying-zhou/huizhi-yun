package aims

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestRequirementMetadataUpdateUsesDedicatedHandlerBeforeGenericRuntime(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)

	updateBlockIndex := strings.Index(content, "if method == http.MethodPatch || method == http.MethodPut {")
	if updateBlockIndex == -1 {
		t.Fatal("missing update block")
	}
	updateBlock := content[updateBlockIndex:]
	routeIndex := strings.Index(updateBlock, `directPathParam(path, "/v1/aims/requirements/")`)
	if routeIndex == -1 {
		t.Fatal("missing requirement metadata update dedicated route")
	}
	genericIndex := strings.Index(updateBlock, "directProjectManagedObjectPath(path)")
	if genericIndex == -1 {
		t.Fatal("missing direct project managed object generic route")
	}
	if routeIndex > genericIndex {
		t.Fatal("requirement metadata updates must use dedicated handler before generic direct object update")
	}
	if !strings.Contains(updateBlock[routeIndex:], "a.updateRequirementMetadata(ctx, requirementID, query, body)") {
		t.Fatal("requirement metadata update route must call dedicated handler")
	}
}

func TestRequirementDeleteUsesDedicatedHandlerBeforeGenericRuntime(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)

	deleteBlockIndex := strings.Index(content, "if method == http.MethodDelete {")
	if deleteBlockIndex == -1 {
		t.Fatal("missing delete block")
	}
	deleteBlock := content[deleteBlockIndex:]
	routeIndex := strings.Index(deleteBlock, `directPathParam(path, "/v1/aims/requirements/")`)
	if routeIndex == -1 {
		t.Fatal("missing requirement delete dedicated route")
	}
	genericIndex := strings.Index(deleteBlock, "directProjectManagedObjectPath(path)")
	if genericIndex == -1 {
		t.Fatal("missing direct project managed object generic delete route")
	}
	if routeIndex > genericIndex {
		t.Fatal("requirement delete must use dedicated handler before generic direct object delete")
	}
	if !strings.Contains(deleteBlock[routeIndex:], "a.deleteRequirement(ctx, requirementID, query)") {
		t.Fatal("requirement delete route must call dedicated handler")
	}
}

func TestRequirementContentUpdateUsesDedicatedHandlerBeforeGenericRuntime(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)

	updateBlockIndex := strings.Index(content, "if method == http.MethodPatch || method == http.MethodPut {")
	if updateBlockIndex == -1 {
		t.Fatal("missing update block")
	}
	updateBlock := content[updateBlockIndex:]
	routeIndex := strings.Index(updateBlock, `directPathParam(path, "/v1/aims/requirement-contents/")`)
	if routeIndex == -1 {
		t.Fatal("missing requirement content update dedicated route")
	}
	genericIndex := strings.Index(updateBlock, "directProjectManagedObjectPath(path)")
	if genericIndex == -1 {
		t.Fatal("missing direct project managed object generic route")
	}
	if routeIndex > genericIndex {
		t.Fatal("requirement content updates must use dedicated handler before generic direct object update")
	}
	if !strings.Contains(updateBlock[routeIndex:], "a.updateRequirementContent(ctx, contentID, query, body)") {
		t.Fatal("requirement content update route must call dedicated handler")
	}
}

func TestRequirementContentDeleteUsesDedicatedHandlerBeforeGenericRuntime(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)

	deleteBlockIndex := strings.Index(content, "if method == http.MethodDelete {")
	if deleteBlockIndex == -1 {
		t.Fatal("missing delete block")
	}
	deleteBlock := content[deleteBlockIndex:]
	routeIndex := strings.Index(deleteBlock, `directPathParam(path, "/v1/aims/requirement-contents/")`)
	if routeIndex == -1 {
		t.Fatal("missing requirement content delete dedicated route")
	}
	genericIndex := strings.Index(deleteBlock, "directProjectManagedObjectPath(path)")
	if genericIndex == -1 {
		t.Fatal("missing direct project managed object generic delete route")
	}
	if routeIndex > genericIndex {
		t.Fatal("requirement content delete must use dedicated handler before generic direct object delete")
	}
	if !strings.Contains(deleteBlock[routeIndex:], "a.deleteRequirementContent(ctx, contentID, query)") {
		t.Fatal("requirement content delete route must call dedicated handler")
	}
}

func TestUpdateRequirementMetadataTransitionsBaselinedAndMarksSpecDirty(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM requirement_items WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT id, project_id, status\\s+FROM requirement_items\\s+WHERE id = \\?\\s+FOR UPDATE").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "status"}).AddRow(int64(10), int64(42), "baselined"))
	mock.ExpectExec("(?s)UPDATE requirement_items\\s+SET title = \\?, type = \\?, category = \\?, priority = \\?, source = \\?, milestone_id = \\?, updated_by = \\?, status = 'change_pending'\\s+WHERE id = \\?").
		WithArgs("新标题", "non_functional", "业务", "P1", "customer", int64(7), "u1", int64(10)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("(?s)UPDATE project_documents\\s+SET import_status = 'imported_dirty'.*WHERE project_id = \\?").
		WithArgs(int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	data, err := adapter.updateRequirementMetadata(
		context.Background(),
		"10",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
		map[string]any{
			"title":       " 新标题 ",
			"type":        "non_functional",
			"category":    "业务",
			"priority":    "P1",
			"source":      "customer",
			"milestoneId": float64(7),
		},
	)
	if err != nil {
		t.Fatalf("expected requirement metadata update to pass, got %v", err)
	}
	if data["changed"] != true || data["newStatus"] != "change_pending" {
		t.Fatalf("unexpected update result: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestUpdateRequirementContentUpdatesTitleAndBodyAndMarksSpecDirty(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM requirement_contents WHERE id = \\?").
		WithArgs(int64(11)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT id, project_id, status\\s+FROM requirement_contents\\s+WHERE id = \\?\\s+FOR UPDATE").
		WithArgs(int64(11)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "status"}).AddRow(int64(11), int64(42), "draft"))
	mock.ExpectQuery("(?s)WITH RECURSIVE descendants AS.*WHERE r.status IN").
		WithArgs(int64(11), int64(11)).
		WillReturnRows(sqlmock.NewRows([]string{"cnt"}).AddRow(int64(0)))
	mock.ExpectExec("(?s)UPDATE requirement_contents\\s+SET title = \\?, content_md = \\?, status = 'modified', updated_by = \\?\\s+WHERE id = \\?").
		WithArgs("新章节", "正文", "u1", int64(11)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("(?s)UPDATE project_documents\\s+SET import_status = 'imported_dirty'.*WHERE project_id = \\?").
		WithArgs(int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	data, err := adapter.updateRequirementContent(
		context.Background(),
		"11",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
		map[string]any{
			"title":     " 新章节 ",
			"contentMd": "正文",
		},
	)
	if err != nil {
		t.Fatalf("expected requirement content update to pass, got %v", err)
	}
	if data["changed"] != true {
		t.Fatalf("unexpected update result: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestDeleteRequirementDraftChangeRemovesChangeContentsAndHardDeletes(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM requirement_items WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT id, project_id, status, item_kind, parent_requirement_id\\s+FROM requirement_items\\s+WHERE id = \\?\\s+FOR UPDATE").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "status", "item_kind", "parent_requirement_id"}).
			AddRow(int64(10), int64(42), "draft", "change", int64(3)))
	mock.ExpectExec("(?s)DELETE c\\s+FROM requirement_contents c\\s+INNER JOIN requirement_item_contents ric").
		WithArgs(int64(10), int64(3)).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectExec("(?s)DELETE FROM requirement_item_contents\\s+WHERE requirement_id = \\?").
		WithArgs(int64(10)).
		WillReturnResult(sqlmock.NewResult(0, 3))
	mock.ExpectExec("(?s)DELETE FROM requirement_items\\s+WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("(?s)UPDATE project_documents\\s+SET import_status = 'imported_dirty'.*WHERE project_id = \\?").
		WithArgs(int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	data, err := adapter.deleteRequirement(
		context.Background(),
		"10",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
	)
	if err != nil {
		t.Fatalf("expected requirement delete to pass, got %v", err)
	}
	if data["deleted"] != true || data["deprecated"] != false {
		t.Fatalf("unexpected delete result: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestDeleteRequirementContentMarksSubtreeDeprecatedAndSpecDirty(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM requirement_contents WHERE id = \\?").
		WithArgs(int64(11)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT id, project_id, status, version_status\\s+FROM requirement_contents\\s+WHERE id = \\?\\s+FOR UPDATE").
		WithArgs(int64(11)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "status", "version_status"}).AddRow(int64(11), int64(42), "active", "draft"))
	mock.ExpectQuery("SELECT lifecycle_status FROM aims_projects WHERE id = \\?").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"lifecycle_status"}).AddRow("active"))
	mock.ExpectQuery("(?s)WITH RECURSIVE subtree AS.*SELECT COUNT\\(\\*\\) AS cnt").
		WithArgs(int64(11), int64(42), int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"cnt"}).AddRow(int64(0)))
	mock.ExpectExec("(?s)WITH RECURSIVE subtree AS.*UPDATE requirement_contents c").
		WithArgs(int64(11), int64(42), int64(42), "u1").
		WillReturnResult(sqlmock.NewResult(0, 3))
	mock.ExpectExec("(?s)UPDATE project_documents\\s+SET import_status = 'imported_dirty'.*WHERE project_id = \\?").
		WithArgs(int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	data, err := adapter.deleteRequirementContent(
		context.Background(),
		"11",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
	)
	if err != nil {
		t.Fatalf("expected requirement content delete to pass, got %v", err)
	}
	if data["changed"] != true || data["markedCount"] != int64(3) {
		t.Fatalf("unexpected delete result: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestDeleteRequirementBaselinedRejectsBeforeMutation(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM requirement_items WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT id, project_id, status, item_kind, parent_requirement_id\\s+FROM requirement_items\\s+WHERE id = \\?\\s+FOR UPDATE").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "status", "item_kind", "parent_requirement_id"}).
			AddRow(int64(10), int64(42), "baselined", "baseline", nil))
	mock.ExpectRollback()

	_, err := adapter.deleteRequirement(
		context.Background(),
		"10",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
	)
	if err == nil {
		t.Fatal("expected baselined requirement delete to fail")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestUpdateRequirementMetadataRejectsLockedStatus(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM requirement_items WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT id, project_id, status\\s+FROM requirement_items\\s+WHERE id = \\?\\s+FOR UPDATE").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "status"}).AddRow(int64(10), int64(42), "in_review"))
	mock.ExpectRollback()

	_, err := adapter.updateRequirementMetadata(
		context.Background(),
		"10",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
		map[string]any{"title": "新标题"},
	)
	if err == nil {
		t.Fatal("expected locked requirement update to fail")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
