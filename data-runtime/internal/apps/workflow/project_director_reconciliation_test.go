package workflow

import (
	"context"
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
