package aims

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestWorkItemDetailRequiresProjectMemberOrScopedAdminAndKeepsLegacyShape(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id\\s+FROM work_items\\s+WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("(?s)SELECT\\s+wi\\.id,\\s+wi\\.project_id,.*FROM work_items wi").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"project_id",
			"milestone_id",
			"item_number",
			"item_key",
			"type",
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
			"approval_status",
			"workflow_instance_id",
			"created_at",
			"updated_at",
			"milestone_name",
		}).AddRow(
			int64(10),
			int64(42),
			int64(5),
			int64(7),
			"AIMS-7",
			"task",
			"Build detail",
			"desc",
			"2026-06-30",
			"in_progress",
			"P1",
			nil,
			int64(3),
			"u2",
			"u1",
			"2026-07-01",
			12.5,
			nil,
			int64(9),
			"not_required",
			nil,
			"2026-06-30 10:00:00",
			"2026-06-30 11:00:00",
			"Milestone",
		))
	mock.ExpectQuery("(?s)SELECT id, work_item_id, author_uid, content,.*FROM work_item_comments").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "work_item_id", "author_uid", "content", "created_at", "updated_at"}).
			AddRow(int64(1), int64(10), "u1", "comment", "2026-06-30 10:10:00", "2026-06-30 10:10:00"))
	mock.ExpectQuery("(?s)SELECT id, work_item_id, field_name, old_value, new_value, changed_by,.*FROM work_item_changelog").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "work_item_id", "field_name", "old_value", "new_value", "changed_by", "changed_at"}).
			AddRow(int64(2), int64(10), "status", "todo", "in_progress", "u1", "2026-06-30 10:20:00"))
	mock.ExpectQuery("(?s)SELECT id, work_item_id, file_name, oss_key, file_size, content_type, uploaded_by,.*FROM work_item_attachments").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "work_item_id", "file_name", "oss_key", "file_size", "content_type", "uploaded_by", "uploaded_at"}).
			AddRow(int64(3), int64(10), "spec.md", "oss/spec.md", int64(128), "text/markdown", "u1", "2026-06-30 10:30:00"))
	mock.ExpectQuery("(?s)SELECT r\\.id, r\\.source_id, r\\.target_id, r\\.relation_type,.*FROM work_item_relations r").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "source_id", "target_id", "relation_type", "created_at", "target_item_key", "target_title"}).
			AddRow(int64(4), int64(10), int64(11), "relates_to", "2026-06-30 10:40:00", "AIMS-8", "Related"))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\) AS child_count FROM work_items WHERE parent_id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"child_count"}).AddRow(int64(2)))

	data, err := adapter.workItemDetail(
		context.Background(),
		"10",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
	)
	if err != nil {
		t.Fatalf("expected scoped work item admin to read detail, got %v", err)
	}
	if data["itemKey"] != "AIMS-7" || data["childCount"] != int64(2) {
		t.Fatalf("unexpected detail data: %#v", data)
	}
	if comments, ok := data["comments"].([]workItemDetailComment); !ok || len(comments) != 1 || comments[0].Content != "comment" {
		t.Fatalf("unexpected comments: %#v", data["comments"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestWorkItemDetailItemAllowsRoutineWithoutMilestone(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	mock.ExpectQuery("(?s)SELECT\\s+wi\\.id,\\s+wi\\.project_id,.*FROM work_items wi").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "project_id", "milestone_id", "item_number", "item_key", "type", "title", "description",
			"start_date", "status", "priority", "severity", "weight", "assignee_uid", "reporter_uid",
			"due_date", "estimated_hours", "parent_id", "sort_order", "approval_status",
			"workflow_instance_id", "created_at", "updated_at", "milestone_name",
		}).AddRow(
			int64(10), int64(42), nil, int64(1), "TEST-1", "task", "Routine item", nil,
			nil, "todo", "P2", nil, int64(1), nil, "u1",
			nil, nil, nil, int64(1), "not_required",
			nil, "2026-09-25 01:00:00", "2026-09-25 01:00:00", nil,
		))
	item, err := adapter.workItemDetailItem(context.Background(), 10)
	if err != nil {
		t.Fatalf("routine item detail: %v", err)
	}
	if milestone, ok := item["milestoneId"].(*int64); !ok || milestone != nil {
		t.Fatalf("routine item should have no milestone: %#v", item)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("routine detail query: %v", err)
	}
}

func TestWorkItemDetailRouteUsesSpecializedRuntimeBeforeGenericFallback(t *testing.T) {
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
	detailIndex := strings.Index(getSegment, "a.workItemDetail(ctx, workItemID, query)")
	genericIndex := strings.Index(getSegment, "handleProjectScopedGenericRuntime")
	if detailIndex == -1 {
		t.Fatal("missing direct work item detail route")
	}
	if genericIndex != -1 && genericIndex < detailIndex {
		t.Fatal("direct work item detail route must run before generic runtime fallback")
	}
}
