package aims

import (
	"context"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestWorkItemExecutionContextRequiresProjectMemberOrScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT\\s+wi\\.id, wi\\.project_id, p\\.project_code, wi\\.milestone_id, m\\.name AS milestone_name,.*FROM work_items wi\\s+JOIN aims_projects p.*LEFT JOIN milestones m").
		WithArgs("77").
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"project_id",
			"project_code",
			"milestone_id",
			"milestone_name",
			"item_number",
			"item_key",
			"tier",
			"type",
			"title",
			"description",
			"start_date",
			"due_date",
			"status",
			"priority",
			"severity",
			"assignee_uid",
			"reporter_uid",
			"estimated_hours",
			"parent_id",
			"approval_status",
			"created_at",
			"updated_at",
			"parent_item_key",
			"parent_title",
			"template_key",
			"requirement_category",
			"decomposition_source_id",
			"decomposition_source_key",
		}).AddRow(
			int64(77),
			int64(42),
			"PRJ-1",
			nil,
			nil,
			int64(77),
			"PRJ-1-77",
			"matter",
			"task",
			"执行任务",
			"desc",
			"2026-06-30",
			"2026-07-01",
			"in_progress",
			"P1",
			nil,
			"u2",
			"u1",
			1.5,
			nil,
			"not_required",
			"2026-06-30 10:00:00",
			"2026-06-30 11:00:00",
			nil,
			nil,
			nil,
			nil,
			nil,
			nil,
		))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("(?s)SELECT id, target_id, matter_id, name, description, acceptance_criteria, deliverable_type,.*FROM deliverables").
		WithArgs("77", "77").
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"target_id",
			"matter_id",
			"name",
			"description",
			"acceptance_criteria",
			"deliverable_type",
			"required",
			"status",
			"document_uuid",
			"document_title",
			"document_source",
			"repo_project_code",
			"repo_file_path",
			"repo_commit_id",
			"evidence_url",
			"evidence_note",
			"submitted_by",
			"submitted_at",
			"created_at",
			"updated_at",
		}).AddRow(
			int64(9),
			nil,
			int64(77),
			"交付物",
			nil,
			nil,
			"document",
			int64(1),
			"pending",
			"doc-1",
			"说明文档",
			"codocs",
			nil,
			nil,
			nil,
			nil,
			nil,
			nil,
			nil,
			"2026-06-30 10:10:00",
			"2026-06-30 10:10:00",
		))
	mock.ExpectQuery("(?s)SELECT id, repo_project_code, commit_sha, message, author_name, author_email, committed_at,.*FROM gitlab_commits").
		WithArgs("77").
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"repo_project_code",
			"commit_sha",
			"message",
			"author_name",
			"author_email",
			"committed_at",
			"additions",
			"deletions",
			"files_changed",
		}).AddRow(int64(11), "group/repo", "abc", "commit", "dev", "dev@example.com", "2026-06-30 10:20:00", int64(1), int64(0), int64(1)))
	mock.ExpectQuery("(?s)SELECT id, uid, entry_date, hours, description, created_at\\s+FROM time_entries").
		WithArgs("77").
		WillReturnRows(sqlmock.NewRows([]string{"id", "uid", "entry_date", "hours", "description", "created_at"}).
			AddRow(int64(12), "u1", "2026-06-30", 1.5, "执行", "2026-06-30 10:30:00"))

	data, err := adapter.workItemExecutionContext(
		context.Background(),
		"77",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
	)
	if err != nil {
		t.Fatalf("workItemExecutionContext returned error: %v", err)
	}
	item, ok := data["item"].(*executionItem)
	if !ok || item.ProjectID != int64(42) || item.MilestoneID != nil || item.MilestoneName != nil {
		t.Fatalf("unexpected item: %#v", data["item"])
	}
	deliverables, ok := data["deliverables"].([]executionDeliverable)
	if !ok || len(deliverables) != 1 || deliverables[0].ID != int64(9) {
		t.Fatalf("unexpected deliverables: %#v", data["deliverables"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
