package aims

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"strconv"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func projectInitiationCallbackBody(status string) map[string]any {
	return map[string]any{
		"event":         "flow_completed",
		"instance_id":   "WF-100",
		"app_code":      "aims",
		"resource_code": "projects",
		"action_code":   "initiation",
		"biz_id":        "42",
		"status":        status,
		"form_data": map[string]any{
			"projectId": float64(42),
		},
	}
}

func expectFirstProjectMilestoneActivation(mock sqlmock.Sqlmock, projectID, milestoneID int64) {
	mock.ExpectQuery("(?s)SELECT id\\s+FROM milestones\\s+WHERE project_id = \\? AND status = 'active'").
		WithArgs(projectID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec("(?s)UPDATE milestones\\s+SET status = 'todo'\\s+WHERE project_id = \\? AND status = 'planning'").
		WithArgs(projectID).
		WillReturnResult(sqlmock.NewResult(0, 3))
	mock.ExpectExec("(?s)UPDATE milestones\\s+SET status = 'active'\\s+WHERE id = \\(").
		WithArgs(projectID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("(?s)SELECT id\\s+FROM milestones\\s+WHERE project_id = \\? AND status = 'active'.*ORDER BY sort_order ASC, start_date ASC, id ASC").
		WithArgs(projectID).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(milestoneID))
}

func expectProjectLifecycleEvent(mock sqlmock.Sqlmock, projectID int64, status string) {
	projectKey := strconv.FormatInt(projectID, 10)
	mock.ExpectQuery("(?s)SELECT to_status\\s+FROM project_lifecycle_events.*FOR UPDATE").
		WithArgs(projectKey).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec("(?s)INSERT INTO project_lifecycle_events").
		WithArgs(projectKey, nil, status, "workflow").
		WillReturnResult(sqlmock.NewResult(1, 1))
}

func TestProjectInitiationWorkflowApprovalActivatesFirstMilestone(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT lifecycle_status, category\\s+FROM aims_projects\\s+WHERE id = \\?.*FOR UPDATE").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"lifecycle_status", "category"}).AddRow("approval_pending", "custom_dev"))
	mock.ExpectExec("UPDATE aims_projects SET lifecycle_status = 'active' WHERE id = \\?").
		WithArgs(int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectProjectLifecycleEvent(mock, 42, "active")
	expectFirstProjectMilestoneActivation(mock, 42, 101)
	mock.ExpectCommit()

	result, operation, err := adapter.applyAimsWorkflowCallback(
		context.Background(),
		url.Values{"workflow_callback_verified": {"1"}},
		projectInitiationCallbackBody("approved"),
	)
	if err != nil {
		t.Fatalf("applyAimsWorkflowCallback: %v", err)
	}
	if operation != "aims.projects.initiation.workflow_callback" {
		t.Fatalf("operation = %q", operation)
	}
	if result["lifecycleStatus"] != "active" || result["activatedMilestoneId"] != int64(101) {
		t.Fatalf("result = %#v", result)
	}
	if result["alreadyApplied"] != false {
		t.Fatalf("expected a new approval application, got %#v", result["alreadyApplied"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestProjectInitiationWorkflowApprovalRepairsActiveProjectWithoutMilestone(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT lifecycle_status, category\\s+FROM aims_projects\\s+WHERE id = \\?.*FOR UPDATE").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"lifecycle_status", "category"}).AddRow("active", "custom_dev"))
	expectFirstProjectMilestoneActivation(mock, 42, 101)
	mock.ExpectCommit()

	result, err := adapter.applyProjectInitiationWorkflowCallback(
		context.Background(),
		url.Values{"workflow_callback_verified": {"1"}},
		projectInitiationCallbackBody("approved"),
	)
	if err != nil {
		t.Fatalf("applyProjectInitiationWorkflowCallback: %v", err)
	}
	if result["alreadyApplied"] != true || result["activatedMilestoneId"] != int64(101) {
		t.Fatalf("result = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestProjectInitiationWorkflowRejectionReturnsProjectToDraft(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT lifecycle_status, category\\s+FROM aims_projects\\s+WHERE id = \\?.*FOR UPDATE").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"lifecycle_status", "category"}).AddRow("approval_pending", "custom_dev"))
	mock.ExpectExec("UPDATE aims_projects SET lifecycle_status = 'draft' WHERE id = \\?").
		WithArgs(int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectProjectLifecycleEvent(mock, 42, "draft")
	mock.ExpectCommit()

	result, err := adapter.applyProjectInitiationWorkflowCallback(
		context.Background(),
		url.Values{"workflow_callback_verified": {"1"}},
		projectInitiationCallbackBody("rejected"),
	)
	if err != nil {
		t.Fatalf("applyProjectInitiationWorkflowCallback: %v", err)
	}
	if result["lifecycleStatus"] != "draft" {
		t.Fatalf("result = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestProjectInitiationWorkflowCallbackRejectsUntrustedCallerBeforeDB(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	_, err := adapter.applyProjectInitiationWorkflowCallback(
		context.Background(),
		url.Values{},
		projectInitiationCallbackBody("approved"),
	)
	if err == nil {
		t.Fatal("expected untrusted callback to be rejected")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("callback touched the database before trust verification: %v", err)
	}
}

func TestProjectInitiationWorkflowCallbackRejectsRoutineContainer(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT lifecycle_status, category\\s+FROM aims_projects\\s+WHERE id = \\?.*FOR UPDATE").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"lifecycle_status", "category"}).AddRow("approval_pending", "routine"))
	mock.ExpectRollback()

	_, err := adapter.applyProjectInitiationWorkflowCallback(
		context.Background(),
		url.Values{"workflow_callback_verified": {"1"}},
		projectInitiationCallbackBody("approved"),
	)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "routine_initiation_not_applicable" {
		t.Fatalf("error = %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
