package aims

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestMilestoneDetailRequiresProjectReadAccessBeforeExpansion(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT m\\.id, m\\.project_id.*FROM milestones m.*WHERE m\\.id = \\?").
		WithArgs("7").
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"project_id",
			"template_key",
			"name",
			"description",
			"mode",
			"pivr_stage",
			"start_date",
			"end_date",
			"status",
			"sort_order",
			"total_weight",
			"completed_weight",
		}).AddRow(
			int64(7),
			int64(42),
			nil,
			"Planning",
			nil,
			"pivr",
			nil,
			nil,
			nil,
			"todo",
			int64(1),
			float64(10),
			float64(5),
		))
	mock.ExpectQuery("SELECT id FROM aims_projects WHERE id = \\? LIMIT 1").
		WithArgs("42").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(42)))
	mock.ExpectQuery("(?s)SELECT p\\.id\\s+FROM aims_projects p\\s+WHERE p\\.id = \\?\\s+AND").
		WithArgs(int64(42), "u1", "u1", "u1", "u1").
		WillReturnError(sql.ErrNoRows)

	data, err := adapter.milestoneDetail(
		context.Background(),
		"7",
		url.Values{"current_user": {"u1"}},
	)
	if data != nil {
		t.Fatalf("data = %#v, want nil", data)
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "project_access_denied" {
		t.Fatalf("err = %#v, want project access 403", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestMilestoneDeliverableStatesKeepsDuplicateRequiredNameBlocked(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT d\\.id, d\\.name.*FROM deliverables d.*ORDER BY").
		WithArgs(int64(257), int64(134), int64(134)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"name",
			"required",
			"status",
			"deliverable_type",
			"quality_status",
		}).
			AddRow(int64(207), "《需求规格说明书》", int64(1), "approved", "document", "passed").
			AddRow(int64(214), "《需求规格说明书》", int64(1), "submitted", "document", "awaiting_review"))
	mock.ExpectQuery("(?s)SELECT title, status.*FROM work_items.*type = 'requirement'").
		WithArgs(int64(257), int64(134)).
		WillReturnRows(sqlmock.NewRows([]string{"title", "status", "required"}))

	states, err := adapter.milestoneDeliverableStates(context.Background(), 257, 134)
	if err != nil {
		t.Fatalf("milestoneDeliverableStates: %v", err)
	}
	if len(states) != 1 {
		t.Fatalf("states length = %d, want 1", len(states))
	}
	state := states[0]
	if !state.Required || state.Completed {
		t.Fatalf("state = %#v, want required and incomplete", state)
	}
	if state.QualityStatus != "awaiting_review" {
		t.Fatalf("qualityStatus = %q, want awaiting_review", state.QualityStatus)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
