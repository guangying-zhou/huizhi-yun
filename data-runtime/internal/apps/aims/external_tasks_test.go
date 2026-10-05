package aims

import (
	"context"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestExternalTasksReturnsCursorPageAndGitlabLink(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()

	columns := []string{
		"id", "item_key", "project_id", "project_code", "project_name",
		"milestone_id", "milestone_name", "parent_id", "tier", "type",
		"title", "description", "status", "priority", "severity",
		"assignee_uid", "reporter_uid", "start_date", "due_date", "estimated_hours",
		"created_at", "updated_at", "cursor_value",
		"repo_project_code", "issue_iid", "issue_url", "issue_state",
	}
	rows := sqlmock.NewRows(columns).
		AddRow(11, "AIMS-11", 2, "AIMS", "Aims", 4, "M1", nil, "matter", "task", "First", "Body", "todo", "P1", nil, "u1", "u2", nil, "2026-08-30", 3.5, "2026-08-01T00:00:00.000000Z", "2026-08-23T10:00:00.000000Z", "2026-08-23 10:00:00.000000", "huizhi-yun/huizhiyun", 1, "https://gitlab.example/issues/1", "opened").
		AddRow(12, "AIMS-12", 2, "AIMS", "Aims", 4, "M1", nil, "matter", "task", "Second", nil, "todo", "P2", nil, nil, "u2", nil, nil, nil, "2026-08-01T00:00:00.000000Z", "2026-08-23T11:00:00.000000Z", "2026-08-23 11:00:00.000000", nil, nil, nil, nil)
	mock.ExpectQuery(`(?s)FROM work_items wi.*p\.project_code IN \(\?\).*wi\.status IN \(\?\).*ORDER BY wi\.updated_at ASC, wi\.id ASC.*LIMIT \?`).
		WithArgs("AIMS", "todo", 2).
		WillReturnRows(rows)

	result, err := adapter.externalTasks(context.Background(), url.Values{
		"projectCodes": {"AIMS"}, "statuses": {"todo"}, "limit": {"1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	items := result["items"].([]map[string]any)
	if len(items) != 1 || items[0]["key"] != "AIMS-11" || result["hasMore"] != true {
		t.Fatalf("unexpected task page: %#v", result)
	}
	issue := items[0]["gitlabIssue"].(map[string]any)
	if issue["iid"] != int64(1) || issue["url"] != "https://gitlab.example/issues/1" {
		t.Fatalf("unexpected issue projection: %#v", issue)
	}
	if _, id, err := decodeExternalTaskCursor(result["nextCursor"].(string)); err != nil || id != 11 {
		t.Fatalf("invalid next cursor id=%d err=%v", id, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestExternalTaskCursorRejectsTampering(t *testing.T) {
	if _, _, err := decodeExternalTaskCursor("not-a-cursor"); err == nil {
		t.Fatal("tampered cursor must be rejected")
	}
}

func TestExternalTasksRejectsUnsupportedStatusBeforeQuery(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	if _, err := adapter.externalTasks(context.Background(), url.Values{"status": {"deleted"}}); err == nil {
		t.Fatal("unsupported status must be rejected")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
