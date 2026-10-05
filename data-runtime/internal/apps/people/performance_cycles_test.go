package people

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func expectLockedCycle(mock sqlmock.Sqlmock, status string) {
	mock.ExpectQuery(`(?s)SELECT status.*FROM people_performance_cycles.*WHERE cycle_code = \?.*FOR UPDATE`).
		WithArgs("CYCLE-1").
		WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow(status))
}

func expectCycleRead(mock sqlmock.Sqlmock, status string) {
	mock.ExpectQuery(`(?s)SELECT \*.*FROM people_performance_cycles.*WHERE cycle_code = \?.*LIMIT 1`).
		WithArgs("CYCLE-1").
		WillReturnRows(sqlmock.NewRows([]string{"cycle_code", "status"}).AddRow("CYCLE-1", status))
}

func TestConfirmPerformanceCycleFreezesCycleAndSnapshotsAtomically(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	expectLockedCycle(mock, "collecting")
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*FROM people_contribution_snapshots.*WHERE cycle_code = \?`).
		WithArgs("CYCLE-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectExec(`(?s)UPDATE people_performance_cycles.*status = 'confirmed'.*workflow_instance_id.*WHERE cycle_code = \?.*status = \?`).
		WithArgs("WF-1", "operator-1", "CYCLE-1", "collecting").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE people_contribution_snapshots.*confirmed_at.*WHERE cycle_code = \?`).
		WithArgs("operator-1", "CYCLE-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	expectCycleRead(mock, "confirmed")

	result, err := adapter.confirmPerformanceCycle(
		context.Background(),
		"CYCLE-1",
		url.Values{"current_user": {"operator-1"}},
		map[string]any{"workflow_instance_id": "WF-1"},
	)
	if err != nil {
		t.Fatalf("confirmPerformanceCycle: %v", err)
	}
	if result["changed"] != true || result["status"] != "confirmed" {
		t.Fatalf("unexpected confirmation result %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestConfirmPerformanceCycleRollsBackWhenSnapshotFreezeFails(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	expectLockedCycle(mock, "collecting")
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*FROM people_contribution_snapshots`).
		WithArgs("CYCLE-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectExec(`(?s)UPDATE people_performance_cycles.*status = 'confirmed'`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE people_contribution_snapshots.*confirmed_at`).
		WillReturnError(errors.New("freeze failed"))
	mock.ExpectRollback()

	if _, err := adapter.confirmPerformanceCycle(context.Background(), "CYCLE-1", nil, map[string]any{}); err == nil {
		t.Fatal("expected snapshot freeze failure")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestClosePerformanceCycleUsesSameCycleLock(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	expectLockedCycle(mock, "confirmed")
	mock.ExpectExec(`(?s)UPDATE people_performance_cycles.*status = 'closed'.*WHERE cycle_code = \?.*status = 'confirmed'`).
		WithArgs("operator-1", "CYCLE-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	expectCycleRead(mock, "closed")

	result, err := adapter.closePerformanceCycle(
		context.Background(), "CYCLE-1", url.Values{"current_user": {"operator-1"}}, map[string]any{},
	)
	if err != nil {
		t.Fatalf("closePerformanceCycle: %v", err)
	}
	if result["changed"] != true || result["status"] != "closed" {
		t.Fatalf("unexpected close result %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestWorkflowApprovalUsesAtomicPerformanceCycleConfirmation(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	expectLockedCycle(mock, "collecting")
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*FROM people_contribution_snapshots`).
		WithArgs("CYCLE-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectExec(`(?s)UPDATE people_performance_cycles.*status = 'confirmed'`).
		WithArgs("WF-1", "", "CYCLE-1", "collecting").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE people_contribution_snapshots.*confirmed_at`).
		WithArgs("", "CYCLE-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	expectCycleRead(mock, "confirmed")

	result, err := adapter.workflowCallback(context.Background(), map[string]any{
		"biz_type":             "performance_cycle",
		"biz_id":               "CYCLE-1",
		"status":               "approved",
		"workflow_instance_id": "WF-1",
	})
	if err != nil {
		t.Fatalf("workflowCallback: %v", err)
	}
	if float64FromAny(result["updated"]) != 1 {
		t.Fatalf("unexpected workflow result %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestWorkflowCannotCancelConfirmedPerformanceCycle(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	expectLockedCycle(mock, "confirmed")
	mock.ExpectRollback()

	_, err := adapter.workflowCallback(context.Background(), map[string]any{
		"biz_type": "performance_cycle",
		"biz_id":   "CYCLE-1",
		"status":   "rejected",
	})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "performance_cycle_immutable" {
		t.Fatalf("expected immutable cycle conflict, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
