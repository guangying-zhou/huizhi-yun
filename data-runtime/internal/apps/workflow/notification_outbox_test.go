package workflow

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestInstanceStartPersistsCreationNotificationInSameTransaction(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()
	created := WorkflowNotification{
		EventType: "workflow.task.created", IdempotencyKey: "workflow:workflow.task.created:flow_tasks:abc",
		ToUser: []string{"approver"}, Metadata: map[string]any{"actionableKey": "workflow:tasks:abc"},
	}
	approved := WorkflowNotification{EventType: "workflow.instance.approved", IdempotencyKey: "workflow:approved:1"}

	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT INTO flow_notification_outbox.*VALUES \(\?, NULLIF\(\?, 0\), \?, \?, \?, 'pending', 0, NOW\(\), NOW\(\)\).*ON DUPLICATE KEY UPDATE id = id`).
		WithArgs(int64(7), int64(0), "workflow:tasks:abc", created.IdempotencyKey, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	tx, err := adapter.db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := persistActionableLifecycleEffects(context.Background(), tx, int64(7), 0, &WorkflowEffects{Notifications: []WorkflowNotification{created, approved}}); err != nil {
		t.Fatalf("persist: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestCreationNotificationWithoutActionableKeyFailsTheWorkflowWrite(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	tx, err := adapter.db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	invalid := WorkflowNotification{EventType: "workflow.task.created", IdempotencyKey: "k", Metadata: map[string]any{}}
	if err := persistActionableLifecycleEffects(context.Background(), tx, int64(7), 0, &WorkflowEffects{Notifications: []WorkflowNotification{invalid}}); err == nil {
		t.Fatal("a creation notification without actionableKey must not be persisted silently")
	}
}

func TestPendingLifecycleWaitsForItsCreationNotification(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectQuery(`(?s)FROM flow_actionable_outbox o.*NOT EXISTS \(.*FROM flow_notification_outbox n.*n\.actionable_key = o\.actionable_key AND n\.delivery_status <> 'delivered'.*\).*ORDER BY id`).
		WithArgs(100).
		WillReturnRows(sqlmock.NewRows([]string{"id", "actionable_key", "expected_version", "next_version", "next_state", "recipients", "prerequisite_notifications"}))
	if _, _, err := adapter.pendingActionableLifecycleOutbox(context.Background(), 100); err != nil {
		t.Fatalf("pending lifecycle: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestPendingNotificationOutboxReturnsStoredNotificationWithBackoff(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()
	stored, _ := json.Marshal(WorkflowNotification{EventType: "workflow.task.created", IdempotencyKey: "k1", ToUser: []string{"approver"}})
	mock.ExpectQuery(`(?s)FROM flow_notification_outbox.*delivery_status = 'pending'.*attempt_count = 1 THEN 60.*attempt_count = 2 THEN 300.*attempt_count = 3 THEN 900.*ELSE 3600.*ORDER BY id.*LIMIT \?`).
		WithArgs(100).
		WillReturnRows(sqlmock.NewRows([]string{"id", "notification"}).AddRow(int64(5), string(stored)))
	response, operation, err := adapter.pendingWorkflowNotificationOutbox(context.Background(), 0)
	if err != nil || operation != "workflow.notification_effect.pending" {
		t.Fatalf("pending notifications: %v %s", err, operation)
	}
	effects, ok := response.Data.([]WorkflowNotificationEffect)
	if !ok || len(effects) != 1 || effects[0].EffectID != 5 || effects[0].Notification.IdempotencyKey != "k1" {
		t.Fatalf("effects = %#v", response.Data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestNotificationOutboxAckIsIdempotentAndFailKeepsPending(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectExec(`(?s)UPDATE flow_notification_outbox.*delivery_status = 'delivered'.*WHERE id = \? AND delivery_status = 'pending'`).
		WithArgs("5").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`SELECT id FROM flow_notification_outbox WHERE id = \? AND delivery_status = 'delivered'`).
		WithArgs("5").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(5)))
	mock.ExpectExec(`(?s)UPDATE flow_notification_outbox.*attempt_count = attempt_count \+ 1, last_attempt_at = NOW\(\).*WHERE id = \? AND delivery_status = 'pending'`).
		WithArgs("6").WillReturnResult(sqlmock.NewResult(0, 1))
	if _, _, err := adapter.acknowledgeWorkflowNotificationOutbox(context.Background(), "5"); err != nil {
		t.Fatalf("replayed ack must succeed: %v", err)
	}
	response, _, err := adapter.failWorkflowNotificationOutbox(context.Background(), "6")
	if err != nil || response.Data.(map[string]any)["pending"] != true {
		t.Fatalf("fail: %v %#v", err, response.Data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
