package aims

import (
	"context"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestBatchUpdateWorkItemsUsesRuntimeRulesAndChangelog(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT\\s+wi\\.id,\\s+wi\\.project_id,\\s+p\\.project_code,\\s+p\\.lifecycle_status").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"project_id",
			"project_code",
			"lifecycle_status",
			"tier",
			"type",
			"status",
			"priority",
			"assignee_uid",
			"milestone_id",
			"source_ticket_code",
		}).AddRow(int64(77), int64(42), "PRJ-1", "active", "matter", "task", "todo", "P2", nil, nil, nil))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT id\\s+FROM workflow_transitions\\s+WHERE project_id = \\? AND entity_type = \\? AND from_status = \\? AND to_status = \\?").
		WithArgs(int64(42), "matter", "todo", "in_progress").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(9)))
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE work_items SET status = \\?\\s+WHERE id IN \\(\\?\\)").
		WithArgs("in_progress", int64(77)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO work_item_changelog").
		WithArgs(int64(77), "status", "todo", "in_progress", "u1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	data, err := adapter.batchUpdateWorkItems(
		context.Background(),
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
		map[string]any{
			"ids": []any{float64(77)},
			"changes": map[string]any{
				"status": "in_progress",
			},
			"current_user": "spoofed",
		},
	)
	if err != nil {
		t.Fatalf("batchUpdateWorkItems returned error: %v", err)
	}
	if data["updated"] != 1 {
		t.Fatalf("updated = %#v, want 1", data["updated"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestBatchUpdateWorkItemsEnqueuesServiceTicketDeliveryInSameTransaction(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT\\s+wi\\.id,\\s+wi\\.project_id,\\s+p\\.project_code,\\s+p\\.lifecycle_status").
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "project_id", "project_code", "lifecycle_status", "tier", "type", "status", "priority", "assignee_uid", "milestone_id", "source_ticket_code",
		}).AddRow(int64(7), int64(42), "PRJ-TRUSTED", "active", "task", "task", "todo", "P2", nil, nil, "ST-1"))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-TRUSTED").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT id\\s+FROM workflow_transitions\\s+WHERE project_id = \\? AND entity_type = \\? AND from_status = \\? AND to_status = \\?").
		WithArgs(int64(42), "task", "todo", "completed").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(9)))
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE work_items SET status = \\?\\s+WHERE id IN \\(\\?\\)").
		WithArgs("completed", int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO work_item_changelog").
		WithArgs(int64(7), "status", "todo", "completed", "u1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectUpdatedServiceTicketWorkItemSnapshot(mock)
	expectNoExistingServiceTicketDeliveryOperation(mock)
	expectNewServiceTicketDeliveryCommandSnapshot(mock)
	expectServiceTicketDeliveryOperationInsert(mock, nil)
	mock.ExpectCommit()

	body := serviceTicketDeliveryOperationBody()
	body["status"] = "browser-spoofed-status"
	body["ids"] = []any{float64(7)}
	body["changes"] = map[string]any{"status": "completed"}

	data, err := adapter.batchUpdateWorkItems(context.Background(), url.Values{
		"current_user": {"u1"},
		"current_user_project_admin_project_codes": {"PRJ-TRUSTED"},
	}, body)
	if err != nil {
		t.Fatalf("batchUpdateWorkItems returned error: %v", err)
	}
	if data["updated"] != 1 {
		t.Fatalf("updated = %#v, want 1", data["updated"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("service ticket batch delivery expectations: %v", err)
	}
}

func TestBatchUpdateWorkItemsDoesNotEnqueueServiceTicketWithoutStatusChange(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT\\s+wi\\.id,\\s+wi\\.project_id,\\s+p\\.project_code,\\s+p\\.lifecycle_status").
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "project_id", "project_code", "lifecycle_status", "tier", "type", "status", "priority", "assignee_uid", "milestone_id", "source_ticket_code",
		}).AddRow(int64(7), int64(42), "PRJ-TRUSTED", "active", "task", "task", "todo", "P2", nil, nil, "ST-1"))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-TRUSTED").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE work_items SET priority = \\?\\s+WHERE id IN \\(\\?\\)").
		WithArgs("P0", int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO work_item_changelog").
		WithArgs(int64(7), "priority", "P2", "P0", "u1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	data, err := adapter.batchUpdateWorkItems(context.Background(), url.Values{
		"current_user": {"u1"},
		"current_user_project_admin_project_codes": {"PRJ-TRUSTED"},
	}, map[string]any{
		"ids":     []any{float64(7)},
		"changes": map[string]any{"priority": "P0"},
	})
	if err != nil {
		t.Fatalf("batchUpdateWorkItems returned error: %v", err)
	}
	if data["updated"] != 1 {
		t.Fatalf("updated = %#v, want 1", data["updated"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("non-status service ticket batch must not enqueue an operation: %v", err)
	}
}

func TestBatchUpdateWorkItemsRollsBackWhenServiceTicketOperationCannotBeEnqueued(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT\\s+wi\\.id,\\s+wi\\.project_id,\\s+p\\.project_code,\\s+p\\.lifecycle_status").
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "project_id", "project_code", "lifecycle_status", "tier", "type", "status", "priority", "assignee_uid", "milestone_id", "source_ticket_code",
		}).AddRow(int64(7), int64(42), "PRJ-TRUSTED", "active", "task", "task", "todo", "P2", nil, nil, "ST-1"))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-TRUSTED").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT id\\s+FROM workflow_transitions\\s+WHERE project_id = \\? AND entity_type = \\? AND from_status = \\? AND to_status = \\?").
		WithArgs(int64(42), "task", "todo", "completed").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(9)))
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE work_items SET status = \\?\\s+WHERE id IN \\(\\?\\)").
		WithArgs("completed", int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO work_item_changelog").
		WithArgs(int64(7), "status", "todo", "completed", "u1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectUpdatedServiceTicketWorkItemSnapshot(mock)
	expectNoExistingServiceTicketDeliveryOperation(mock)
	expectNewServiceTicketDeliveryCommandSnapshot(mock)
	expectServiceTicketDeliveryOperationInsert(mock, errors.New("outbox unavailable"))
	mock.ExpectRollback()

	body := serviceTicketDeliveryOperationBody()
	body["ids"] = []any{float64(7)}
	body["changes"] = map[string]any{"status": "completed"}

	if _, err := adapter.batchUpdateWorkItems(context.Background(), url.Values{
		"current_user": {"u1"},
		"current_user_project_admin_project_codes": {"PRJ-TRUSTED"},
	}, body); err == nil {
		t.Fatal("batchUpdateWorkItems unexpectedly succeeded")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("outbox failure must roll back the full batch: %v", err)
	}
}

func TestWorkItemBatchUpdateRouteUsesDedicatedRuntimeBeforeDirectItemUpdate(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)
	patchIndex := strings.Index(content, "if method == http.MethodPatch || method == http.MethodPut {")
	if patchIndex == -1 {
		t.Fatal("missing PATCH/PUT branch")
	}
	patchSegment := content[patchIndex:]
	batchIndex := strings.Index(patchSegment, "a.batchUpdateWorkItems(ctx, query, body)")
	directIndex := strings.Index(patchSegment, `directPathParam(path, "/v1/aims/work-items/")`)
	if batchIndex == -1 {
		t.Fatal("missing work item batch update runtime route")
	}
	if directIndex == -1 {
		t.Fatal("missing direct work item update route")
	}
	if batchIndex > directIndex {
		t.Fatal("work item batch update route must run before direct work item update")
	}
}

func TestBatchUpdateWorkItemsGuardBeforeWrites(t *testing.T) {
	contentBytes, err := os.ReadFile("work_item_batch.go")
	if err != nil {
		t.Fatalf("read work_item_batch.go: %v", err)
	}
	content := string(contentBytes)
	guardIndex := strings.Index(content, "a.requireProjectMemberOrScopedAdmin")
	updateIndex := strings.Index(content, "UPDATE work_items SET")
	changelogIndex := strings.Index(content, "INSERT INTO work_item_changelog")
	if guardIndex == -1 {
		t.Fatal("missing project access guard")
	}
	if updateIndex == -1 || changelogIndex == -1 {
		t.Fatal("missing protected writes")
	}
	if guardIndex > updateIndex || guardIndex > changelogIndex {
		t.Fatal("project access guard must run before batch writes")
	}
}
