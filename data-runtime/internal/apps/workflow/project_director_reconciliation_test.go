package workflow

import (
	"context"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestReconcileAimsMilestoneProjectDirectorTransfersPendingTaskAndActionable(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT t\.id, t\.instance_id, t\.assignee_uid, t\.actionable_key, t\.actionable_version.*i\.action_code = 'milestone_completion'.*FOR UPDATE`).
		WithArgs("director-new", int64(12)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "instance_id", "assignee_uid", "actionable_key", "actionable_version",
		}).AddRow(int64(31), int64(17), "director-old", "workflow:tasks:g1", "flow_tasks:g1"))
	mock.ExpectExec(`(?s)UPDATE flow_tasks.*SET assignee_uid = \?, actionable_version = \?, updated_at = NOW\(\).*WHERE id = \?`).
		WithArgs("director-new", "flow_tasks:project_director:12:task:31", "31").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE flow_instances.*projectDirectorUid.*projectDirectorRevision.*resolved_assignees`).
		WithArgs("director-new", int64(12), "director-new", "新项目总监", "17").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO flow_actionable_outbox`).
		WithArgs("17", "workflow:tasks:g1", "flow_tasks:g1", "flow_tasks:project_director:12:task:31", `["director-new"]`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	err := adapter.reconcileAimsMilestoneProjectDirector(context.Background(), url.Values{
		"current_project_director_uid":          {"director-new"},
		"current_project_director_revision":     {"12"},
		"current_project_director_display_name": {"新项目总监"},
	})
	if err != nil {
		t.Fatalf("reconcileAimsMilestoneProjectDirector: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestReconcileAimsMilestoneProjectDirectorRejectsPartialTrustedBinding(t *testing.T) {
	adapter, _, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()

	err := adapter.reconcileAimsMilestoneProjectDirector(context.Background(), url.Values{
		"current_project_director_uid": {"director-new"},
	})
	if err == nil {
		t.Fatal("expected partial project director binding to fail closed")
	}
}

func TestProjectDirectorMissingNeverUsesFrozenAssignee(t *testing.T) {
	director := map[string]any{"app_code": "aims", "resource_code": "milestones", "action_code": "milestone_completion", "form_data": `{"projectDirectorRoleCode":"project_director"}`}
	task := map[string]any{"status": "pending", "assignee_uid": "old-director"}
	ctx := withProjectDirectorFacts(context.Background(), nil)
	if projectDirectorTaskAllowed(ctx, director, task) || requireProjectDirectorTask(ctx, director, task) == nil {
		t.Fatal("missing role used frozen assignee")
	}
	ordinary := map[string]any{"app_code": "aims", "resource_code": "tasks", "action_code": "complete"}
	if !projectDirectorTaskAllowed(ctx, ordinary, task) || requireProjectDirectorTask(ctx, ordinary, task) != nil {
		t.Fatal("ordinary task blocked")
	}
	ctx = withProjectDirectorFacts(context.Background(), url.Values{"current_project_director_uid": {"new-director"}})
	if projectDirectorTaskAllowed(ctx, director, task) {
		t.Fatal("old director retained role")
	}
	task["assignee_uid"] = "new-director"
	if !projectDirectorTaskAllowed(ctx, director, task) {
		t.Fatal("resolved director denied")
	}
}

func TestProjectDirectorMissingDecisionFailsBeforeMutation(t *testing.T) {
	for _, action := range []string{"approve", "reject", "delegate"} {
		t.Run(action, func(t *testing.T) {
			adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
			defer closeDB()
			mock.ExpectBegin()
			mock.ExpectQuery(`SELECT \* FROM flow_tasks WHERE id = \? FOR UPDATE`).WithArgs("31").WillReturnRows(sqlmock.NewRows([]string{"id", "instance_id", "assignee_uid", "status"}).AddRow(31, 17, "old-director", "pending"))
			mock.ExpectQuery(`SELECT .* FROM flow_instances WHERE id = \? FOR UPDATE`).WithArgs(int64(17)).WillReturnRows(sqlmock.NewRows([]string{"id", "status", "app_code", "resource_code", "action_code", "form_data"}).AddRow(17, "running", "aims", "milestones", "milestone_completion", `{"projectDirectorRoleCode":"project_director"}`))
			mock.ExpectRollback()
			_, _, err := adapter.HandleRuntime(context.Background(), "POST", "/v1/workflow/tasks/31/"+action, url.Values{"current_user": {"old-director"}}, map[string]any{"comment": "reason", "delegate_to": "another", "current_project_director_uid": "forged"})
			var failure httperror.Error
			if !errors.As(err, &failure) || failure.Status != 409 || failure.Code != "role_holder_missing" {
				t.Fatalf("expected missing role before mutation: %v", err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
