package aims

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestListDeliverablesPaginatedCountUsesSameVisibilityAndFilters(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	query := url.Values{"current_user": {"u1"}, "project_id": {"42"}, "status": {"submitted"}, "page": {"2"}, "pageSize": {"2"}}
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM deliverables d JOIN aims_projects p.*WHERE.*d.project_id = \?.*d.status = \?`).
		WithArgs(int64(42), "submitted", "u1", "u1", "u1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"total"}).AddRow(int64(3)))
	mock.ExpectQuery(`(?s)SELECT\s+d.id,.*ORDER BY.*d.id ASC\s+LIMIT \? OFFSET \?`).
		WithArgs(int64(42), "submitted", "u1", "u1", "u1", "u1", int64(2), int64(2)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	result, err := adapter.listDeliverables(context.Background(), query)
	if err != nil {
		t.Fatal(err)
	}
	page, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("paginated shape = %T", result)
	}
	items, ok := page["items"].([]deliverableListItem)
	if !ok || len(items) != 0 || page["total"] != int64(3) || page["page"] != int64(2) || page["pageSize"] != int64(2) {
		t.Fatalf("page = %#v", page)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProjectListPaginationRejectsInvalidParametersBeforeSQL(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	for _, scenario := range []struct {
		query    url.Values
		page     int64
		pageSize int64
	}{
		{query: url.Values{"page": {"2"}}, page: 2, pageSize: 20},
		{query: url.Values{"pageSize": {"5"}}, page: 1, pageSize: 5},
	} {
		page, err := parseOptionalProjectListPage(scenario.query)
		if err != nil || !page.enabled || page.page != scenario.page || page.pageSize != scenario.pageSize {
			t.Fatalf("optional query %v: page = %#v, error = %v", scenario.query, page, err)
		}
	}
	for _, query := range []url.Values{
		{"page": {"0"}}, {"page": {"-1"}}, {"page": {"1.5"}},
		{"page": {"1", "2"}}, {"page": {"0001"}}, {"page": {""}},
		{"pageSize": {"101"}}, {"pageSize": {"1e2"}},
		{"page": {"9223372036854775807"}, "pageSize": {"100"}},
	} {
		_, err := adapter.listDeliverables(context.Background(), query)
		var httpErr httperror.Error
		if !errors.As(err, &httpErr) || httpErr.Status != http.StatusBadRequest || httpErr.Code != "invalid_pagination" {
			t.Fatalf("query %v: error = %v", query, err)
		}
		_, err = adapter.listProjectReleases(context.Background(), "42", query)
		if !errors.As(err, &httpErr) || httpErr.Status != http.StatusBadRequest || httpErr.Code != "invalid_pagination" {
			t.Fatalf("release query %v: error = %v", query, err)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestListDeliverablesPreservesLegacyShapeAndProjectVisibility(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT\\s+d.id,.*FROM deliverables d\\s+JOIN aims_projects p").
		WithArgs(int64(42), "u1", "u1", "u1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"project_owner_id",
			"milestone_owner_id",
			"target_id",
			"matter_id",
			"name",
			"description",
			"acceptance_criteria",
			"deliverable_type",
			"required",
			"sort_order",
			"status",
			"quality_status",
			"current_submission_id",
			"current_review_route",
			"current_completeness_passed",
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
			"project_id",
			"project_code",
			"target_item_key",
			"target_title",
			"matter_item_key",
			"matter_title",
			"created_by",
			"created_at",
			"updated_at",
		}).AddRow(
			int64(7),
			nil,
			nil,
			int64(10),
			nil,
			"成果",
			"说明",
			"标准",
			"document",
			int64(1),
			int64(2),
			"pending",
			"awaiting_review",
			int64(101),
			"pm_completeness_then_director_quality",
			int64(1),
			"doc-uuid",
			"文档",
			"codocs",
			nil,
			nil,
			nil,
			nil,
			nil,
			nil,
			nil,
			int64(42),
			"PRJ-1",
			"WI-1",
			"目标",
			nil,
			nil,
			"u1",
			"2026-06-30 09:00:00",
			"2026-06-30 10:00:00",
		))

	result, err := adapter.listDeliverables(
		context.Background(),
		url.Values{"current_user": {"u1"}, "project_id": {"42"}},
	)
	if err != nil {
		t.Fatalf("expected deliverables list to pass, got %v", err)
	}
	items, ok := result.([]deliverableListItem)
	if !ok {
		t.Fatalf("legacy list shape = %T, want []deliverableListItem", result)
	}
	if len(items) != 1 {
		t.Fatalf("items = %#v, want one item", items)
	}
	item := items[0]
	if item.ID != 7 || item.EntityType != "target" || item.EntityID == nil || *item.EntityID != 10 || !item.Required {
		t.Fatalf("item = %#v", item)
	}
	if item.ProjectCode == nil || *item.ProjectCode != "PRJ-1" || item.TargetItemKey == nil || *item.TargetItemKey != "WI-1" {
		t.Fatalf("item project/target fields = %#v", item)
	}
	if !item.CurrentCompletenessPassed {
		t.Fatalf("item completeness state = %#v, want passed", item)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestUpdateDirectDeliverableUsesTrustedActorAndScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id, status, template_key FROM deliverables WHERE id = \\?").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id", "status", "template_key"}).AddRow(int64(42), "pending", nil))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("(?s)SELECT COALESCE\\(d\\.milestone_owner_id, matter\\.milestone_id, target\\.milestone_id\\).*FROM deliverables d").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"milestone_id"}).AddRow(nil))
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id FROM aims_projects WHERE id = \\? FOR UPDATE").WithArgs(int64(42)).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT target_id,matter_id FROM deliverables WHERE id=\\? AND project_id=\\?").WithArgs(int64(77), int64(42)).WillReturnRows(sqlmock.NewRows([]string{"target_id", "matter_id"}).AddRow(int64(10), nil))
	mock.ExpectExec("UPDATE deliverables SET status = \\?, submitted_by = \\?, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = \\?").
		WithArgs("submitted", "u1", int64(77)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	data, err := adapter.updateDirectDeliverable(
		context.Background(),
		"77",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
		map[string]any{"status": "submitted", "current_user": "spoofed"},
	)
	if err != nil {
		t.Fatalf("expected update to pass, got %v", err)
	}
	if data["id"] != int64(77) || data["updated"] != true {
		t.Fatalf("data = %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestUpdateDirectDeliverableRejectsDuplicateNameForSameTarget(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id, status, template_key FROM deliverables WHERE id = \\?").
		WithArgs(int64(214)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id", "status", "template_key"}).AddRow(int64(257), "pending", nil))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(257), "u1", "HZY").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("(?s)SELECT COALESCE\\(d\\.milestone_owner_id, matter\\.milestone_id, target\\.milestone_id\\).*FROM deliverables d").
		WithArgs(int64(214)).
		WillReturnRows(sqlmock.NewRows([]string{"milestone_id"}).AddRow(nil))
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id FROM aims_projects WHERE id = \\? FOR UPDATE").
		WithArgs(int64(257)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(257)))
	mock.ExpectQuery("SELECT target_id,matter_id FROM deliverables WHERE id=\\? AND project_id=\\?").WithArgs(int64(214), int64(257)).WillReturnRows(sqlmock.NewRows([]string{"target_id", "matter_id"}).AddRow(int64(276), int64(288)))
	mock.ExpectQuery("(?s)SELECT project_owner_id, milestone_owner_id, target_id, matter_id.*FROM deliverables.*FOR UPDATE").
		WithArgs(int64(214), int64(257)).
		WillReturnRows(sqlmock.NewRows([]string{"project_owner_id", "milestone_owner_id", "target_id", "matter_id"}).
			AddRow(nil, nil, int64(276), int64(288)))
	mock.ExpectQuery("(?s)SELECT id.*FROM deliverables.*id <> \\?.*LOWER\\(TRIM\\(name\\)\\) = LOWER\\(\\?\\).*target_id = \\?").
		WithArgs(int64(257), int64(214), "《需求规格说明书》", int64(276)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(207)))
	mock.ExpectRollback()

	_, err := adapter.updateDirectDeliverable(
		context.Background(),
		"214",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"HZY"},
		},
		map[string]any{"name": " 《需求规格说明书》 "},
	)
	if err == nil || !strings.Contains(err.Error(), "deliverable_name_conflict") {
		t.Fatalf("err = %v, want deliverable_name_conflict", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestDeleteDirectDeliverableAllowsUserCreatedRequiredPendingItem(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id, status, template_key FROM deliverables WHERE id = \\?").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id", "status", "template_key"}).AddRow(int64(42), "pending", nil))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("(?s)SELECT COALESCE\\(d\\.milestone_owner_id, matter\\.milestone_id, target\\.milestone_id\\).*FROM deliverables d").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"milestone_id"}).AddRow(nil))
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id FROM aims_projects WHERE id = \\? FOR UPDATE").WithArgs(int64(42)).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT target_id,matter_id FROM deliverables WHERE id=\\? AND project_id=\\?").WithArgs(int64(77), int64(42)).WillReturnRows(sqlmock.NewRows([]string{"target_id", "matter_id"}).AddRow(int64(10), nil))
	mock.ExpectExec("DELETE FROM deliverables WHERE id = \\?").
		WithArgs(int64(77)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	data, err := adapter.deleteDirectDeliverable(
		context.Background(),
		"77",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
	)
	if err != nil {
		t.Fatalf("expected delete to pass, got %v", err)
	}
	if data != nil {
		t.Fatalf("data = %#v, want nil", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestDeleteDirectDeliverableRejectsSystemTemplateItem(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id, status, template_key FROM deliverables WHERE id = \\?").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id", "status", "template_key"}).AddRow(int64(42), "pending", "project_plan"))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("(?s)SELECT COALESCE\\(d\\.milestone_owner_id, matter\\.milestone_id, target\\.milestone_id\\).*FROM deliverables d").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"milestone_id"}).AddRow(nil))

	_, err := adapter.deleteDirectDeliverable(
		context.Background(),
		"77",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
	)
	if err == nil || !strings.Contains(err.Error(), "系统必选交付物不允许删除") {
		t.Fatalf("err = %v, want system template deletion rejection", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
