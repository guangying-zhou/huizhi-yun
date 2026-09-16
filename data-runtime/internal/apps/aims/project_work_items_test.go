package aims

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestProjectWorkItemsUsesProjectReadGuardAndKeepsLegacyListShape(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT id FROM aims_projects WHERE id = \\? LIMIT 1").
		WithArgs("42").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(42)))
	mock.ExpectQuery("(?s)SELECT p\\.id\\s+FROM aims_projects p\\s+WHERE p\\.id = \\?").
		WithArgs(int64(42), "u1", "u1", "u1", "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\) AS total FROM work_items wi LEFT JOIN work_item_service_ext wse ON wse\\.work_item_id = wi\\.id WHERE wi\\.project_id = \\? AND wi\\.tier = 'target'").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"total"}).AddRow(int64(1)))
	mock.ExpectQuery("(?s)SELECT\\s+wi\\.id,\\s+wi\\.project_id,.*FROM work_items wi").
		WithArgs(int64(42), 20, 0).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"project_id",
			"milestone_id",
			"item_number",
			"item_key",
			"type",
			"tier",
			"title",
			"description",
			"start_date",
			"status",
			"priority",
			"severity",
			"weight",
			"assignee_uid",
			"reporter_uid",
			"due_date",
			"estimated_hours",
			"parent_id",
			"sort_order",
			"required",
			"template_key",
			"routine_scope",
			"beneficiary_dept_code",
			"is_unplanned",
			"carryover_origin_item_key",
			"carryover_origin_milestone_id",
			"carryover_count",
			"carryover_governance_abnormal",
			"approval_status",
			"created_at",
			"updated_at",
			"milestone_name",
			"child_count",
			"source_ticket_code",
			"service_customer_code",
			"service_environment_code",
			"response_due_at",
			"resolution_due_at",
			"sla_status_snapshot",
			"first_responded_at",
			"resolved_at",
			"service_ext_last_synced_at",
		}).AddRow(
			int64(10),
			int64(42),
			int64(5),
			int64(7),
			"AIMS-7",
			"task",
			"target",
			"Build list",
			"desc",
			"2026-06-30",
			"todo",
			"P2",
			nil,
			int64(1),
			"u2",
			"u1",
			"2026-07-01",
			8.5,
			nil,
			int64(0),
			int64(1),
			"tpl",
			nil,
			nil,
			int64(0),
			nil,
			nil,
			int64(0),
			int64(0),
			"not_required",
			"2026-06-30 10:00:00",
			"2026-06-30 11:00:00",
			"Milestone",
			int64(3),
			nil,
			nil,
			nil,
			nil,
			nil,
			nil,
			nil,
			nil,
			nil,
		))

	data, err := adapter.projectWorkItems(
		context.Background(),
		"42",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
	)
	if err != nil {
		t.Fatalf("expected scoped project admin to list work items, got %v", err)
	}
	page, ok := data.(map[string]any)
	if !ok {
		t.Fatalf("data shape = %#v", data)
	}
	items, ok := page["items"].([]map[string]any)
	if !ok || len(items) != 1 {
		t.Fatalf("items shape = %#v", page["items"])
	}
	if items[0]["itemKey"] != "AIMS-7" || items[0]["tier"] != "target" || items[0]["required"] != true || items[0]["childCount"] != int64(3) {
		t.Fatalf("unexpected item: %#v", items[0])
	}
	if page["total"] != int64(1) || page["page"] != 1 || page["pageSize"] != 20 {
		t.Fatalf("unexpected page: %#v", page)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestProjectWorkItemsServiceDeskFilterSkipsTargetDefault(t *testing.T) {
	where, args, err := projectWorkItemsWhere(int64(42), url.Values{
		"serviceDesk":     {"1"},
		"customerCode":    {"CUS-1"},
		"environmentCode": {"ENV-1"},
	})
	if err != nil {
		t.Fatalf("projectWorkItemsWhere: %v", err)
	}
	joined := strings.Join(where, " AND ")
	for _, want := range []string{
		"wse.source_ticket_code IS NOT NULL",
		"wse.customer_code = ?",
		"wse.environment_code = ?",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("where = %q, missing %q", joined, want)
		}
	}
	if strings.Contains(joined, "wi.tier = 'target'") {
		t.Fatalf("service desk query should not force target tier: %q", joined)
	}
	if len(args) != 3 || args[0] != int64(42) || args[1] != "CUS-1" || args[2] != "ENV-1" {
		t.Fatalf("args = %#v", args)
	}
}

func TestProjectWorkItemsRouteUsesDedicatedRuntimeBeforeGenericFallback(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)
	getIndex := strings.Index(content, "if method == http.MethodGet {")
	if getIndex == -1 {
		t.Fatal("missing GET branch")
	}
	getSegment := content[getIndex:]
	listIndex := strings.Index(getSegment, "a.projectWorkItems(ctx, projectID, query)")
	genericIndex := strings.Index(getSegment, "handleProjectScopedGenericRuntime")
	if listIndex == -1 {
		t.Fatal("missing dedicated project work item list route")
	}
	if genericIndex != -1 && genericIndex < listIndex {
		t.Fatal("project work item list route must run before generic runtime fallback")
	}
}

func TestDirectWorkItemsWhereUsesProjectVisibility(t *testing.T) {
	where, args, err := directWorkItemsWhere(url.Values{
		"current_user_dept_codes":                  {"dept-sales"},
		"current_user_project_admin_project_codes": {"PRJ-1"},
		"projectCode":                              {"PRJ-1"},
		"status":                                   {"todo"},
		"search":                                   {"Build"},
	}, "u1")
	if err != nil {
		t.Fatalf("directWorkItemsWhere returned error: %v", err)
	}
	whereSQL := strings.Join(where, " AND ")
	for _, expected := range []string{
		"p.project_code = ?",
		"wi.status = ?",
		"(wi.title LIKE ? OR wi.item_key LIKE ? OR wi.type LIKE ? OR wi.status LIKE ? OR wi.assignee_uid LIKE ? OR wi.reporter_uid LIKE ? OR wse.source_ticket_code LIKE ? OR wse.customer_code LIKE ? OR wse.environment_code LIKE ?)",
		"wi.tier = 'target'",
		"p.project_code IN (?)",
		"p.dept_code IN (?)",
	} {
		if !strings.Contains(whereSQL, expected) {
			t.Fatalf("where missing %q: %s", expected, whereSQL)
		}
	}
	if len(args) < 12 {
		t.Fatalf("expected filters and visibility args, got %#v", args)
	}
}

func TestDirectWorkItemsRouteUsesDedicatedRuntimeBeforeGenericFallback(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)
	getIndex := strings.Index(content, "if method == http.MethodGet {")
	if getIndex == -1 {
		t.Fatal("missing GET branch")
	}
	getSegment := content[getIndex:]
	listIndex := strings.Index(getSegment, "a.directWorkItems(ctx, query)")
	detailIndex := strings.Index(getSegment, "a.workItemDetail(ctx, workItemID, query)")
	genericIndex := strings.Index(getSegment, "handleProjectScopedGenericRuntime")
	if listIndex == -1 {
		t.Fatal("missing dedicated direct work item list route")
	}
	if detailIndex != -1 && detailIndex < listIndex {
		t.Fatal("direct work item list route must run before direct work item detail route")
	}
	if genericIndex != -1 && genericIndex < listIndex {
		t.Fatal("direct work item list route must run before generic runtime fallback")
	}
}

func TestCreateProjectWorkItemUsesTrustedActorAndLegacyDefaults(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT id, project_code, lifecycle_status, category\\s+FROM aims_projects\\s+WHERE id = \\?").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_code", "lifecycle_status", "category"}).AddRow(int64(42), "PRJ-1", "active", "delivery"))
	mock.ExpectQuery("SELECT completion_lock_request_id FROM milestones WHERE id = \\?").
		WithArgs(int64(5)).
		WillReturnRows(sqlmock.NewRows([]string{"completion_lock_request_id"}).AddRow(nil))
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE project_counters SET counter = LAST_INSERT_ID\\(counter \\+ 1\\) WHERE project_id = \\?").
		WithArgs(int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT LAST_INSERT_ID\\(\\) AS next_number").
		WillReturnRows(sqlmock.NewRows([]string{"next_number"}).AddRow(int64(8)))
	mock.ExpectExec("INSERT INTO work_items").
		WithArgs(
			int64(42),
			int64(5),
			int64(8),
			"PRJ-1-8",
			"task",
			"matter",
			"执行任务",
			"desc",
			"2026-07-01",
			"todo",
			"P2",
			nil,
			int64(1),
			"u2",
			"u1",
			"2026-07-08",
			8.5,
			nil,
			int64(3),
			1,
			"tpl-1",
			nil,
			nil,
			0,
		).
		WillReturnResult(sqlmock.NewResult(99, 1))
	mock.ExpectExec("INSERT INTO work_item_changelog").
		WithArgs(int64(99), "PRJ-1-8", "u1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	data, err := adapter.createProjectWorkItem(
		context.Background(),
		"42",
		url.Values{
			"current_user":                  {"u1"},
			"current_user_is_project_admin": {"1"},
		},
		map[string]any{
			"type":           "task",
			"title":          "执行任务",
			"description":    "desc",
			"milestoneId":    5,
			"assigneeUid":    "u2",
			"startDate":      "2026-07-01",
			"dueDate":        "2026-07-08",
			"estimatedHours": 8.5,
			"reviewLevel":    2.6,
			"required":       true,
			"templateKey":    "tpl-1",
			"current_user":   "spoofed",
		},
	)
	if err != nil {
		t.Fatalf("createProjectWorkItem returned error: %v", err)
	}
	if data["id"] != int64(99) || data["itemNumber"] != int64(8) || data["itemKey"] != "PRJ-1-8" {
		t.Fatalf("unexpected data: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestProjectWorkItemCreateRouteUsesDedicatedRuntimeBeforeGenericFallback(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)
	postIndex := strings.Index(content, "if method == http.MethodPost {")
	if postIndex == -1 {
		t.Fatal("missing POST branch")
	}
	postSegment := content[postIndex:]
	createIndex := strings.Index(postSegment, "a.createProjectWorkItem(ctx, projectID, query, body)")
	genericIndex := strings.Index(postSegment, "handleProjectScopedGenericRuntime")
	if createIndex == -1 {
		t.Fatal("missing dedicated project work item create route")
	}
	if genericIndex != -1 && genericIndex < createIndex {
		t.Fatal("project work item create route must run before generic runtime fallback")
	}
}
