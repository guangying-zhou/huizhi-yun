package aims

import (
	"context"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestMilestoneCompletionWorkflowCallbackIsOnlyFinalizationPath(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT id, request_no, request_version, milestone_owner_id, project_id.*FROM approval_records.*FOR UPDATE`).
		WithArgs(int64(51), "MCR-%").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "request_no", "request_version", "milestone_owner_id", "project_id", "project_code",
			"requested_by", "reviewer_uid", "status", "snapshot_sha256", "workflow_instance_id",
		}).AddRow(int64(51), "MCR-17-V1", int64(1), int64(17), int64(5), "PRJ-1",
			"pm-1", "director-old", "pending", "hash-1", nil))
	mock.ExpectQuery(`(?s)SELECT m\.status, m\.completion_lock_request_id, m\.sort_order, m\.payment_term_id.*FROM milestones m.*FOR UPDATE`).
		WithArgs(int64(17)).
		WillReturnRows(sqlmock.NewRows([]string{
			"status", "completion_lock_request_id", "sort_order", "payment_term_id", "project_code", "contract_code",
		}).AddRow("active", int64(51), int64(3), nil, "PRJ-1", nil))
	mock.ExpectExec(`(?s)UPDATE approval_records.*reviewer_role_code = 'project_director'.*WHERE id = \? AND status = 'pending'`).
		WithArgs("7001", "approved", "director-new", int64(12), "Workflow approved", int64(51)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE milestones SET status = 'completed', completion_lock_request_id = NULL`).
		WithArgs(int64(17), int64(51)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT id.*FROM milestones.*project_id = \?.*ORDER BY sort_order, id.*LIMIT 1`).
		WithArgs(int64(5), int64(3), int64(3), int64(17)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectCommit()

	result, err := adapter.applyMilestoneCompletionWorkflowCallback(
		context.Background(),
		url.Values{"workflow_callback_verified": {"1"}},
		map[string]any{
			"event":         "flow_completed",
			"instance_id":   "7001",
			"app_code":      "aims",
			"resource_code": "milestones",
			"action_code":   "milestone_completion",
			"biz_id":        "17",
			"status":        "approved",
			"initiator_uid": "pm-1",
			"form_data": map[string]any{
				"completionRequestId":     float64(51),
				"requestNo":               "MCR-17-V1",
				"snapshotSha256":          "hash-1",
				"projectDirectorUid":      "director-new",
				"projectDirectorRevision": float64(12),
				"projectDirectorRoleCode": "project_director",
			},
		},
	)
	if err != nil {
		t.Fatalf("applyMilestoneCompletionWorkflowCallback: %v", err)
	}
	if result["status"] != "approved" || result["milestoneId"] != int64(17) {
		t.Fatalf("result = %#v", result)
	}
	operation, ok := result["receivableBillable"].(map[string]any)
	if !ok || operation["linked"] != false {
		t.Fatalf("receivableBillable = %#v", result["receivableBillable"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestMilestoneCompletionWorkflowCallbackRejectsUntrustedCallerBeforeDB(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()

	_, err := adapter.applyMilestoneCompletionWorkflowCallback(
		context.Background(),
		url.Values{},
		map[string]any{"event": "flow_completed"},
	)
	if err == nil {
		t.Fatal("expected untrusted callback to be rejected")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("callback touched the database before trust verification: %v", err)
	}
}

func TestMilestoneCompletionLockRejectsAcceptanceFactMutation(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`SELECT completion_lock_request_id FROM milestones WHERE id = \?`).
		WithArgs(int64(17)).
		WillReturnRows(sqlmock.NewRows([]string{"completion_lock_request_id"}).AddRow(int64(51)))

	if err := adapter.requireMilestoneCompletionUnlocked(context.Background(), 17); err == nil {
		t.Fatal("expected locked milestone to reject mutation")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
