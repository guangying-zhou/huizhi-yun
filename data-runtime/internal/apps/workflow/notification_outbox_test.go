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
	mock.ExpectExec(`(?s)INSERT INTO flow_notification_outbox.*VALUES \(\?, NULLIF\(\?, 0\), \?, \?, \?, 'pending', 0, NOW\(\), NOW\(\)\).*ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID\(id\)`).
		WithArgs(int64(7), int64(0), "workflow:tasks:abc", created.IdempotencyKey, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT instance_id FROM flow_notification_outbox WHERE id = \? FOR UPDATE`).
		WithArgs(int64(1)).WillReturnRows(sqlmock.NewRows([]string{"instance_id"}).AddRow(int64(7)))
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

func TestLifecyclePersistsFrozenNotificationDependency(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()
	created := WorkflowNotification{
		EventType: "workflow.task.created", IdempotencyKey: "workflow:task:created:8",
		ToUser: []string{"approver"}, Metadata: map[string]any{"actionableKey": "workflow:tasks:old"},
	}
	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT INTO flow_notification_outbox.*ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID\(id\)`).
		WithArgs(int64(8), int64(9), "workflow:tasks:old", created.IdempotencyKey, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(51, 1))
	mock.ExpectQuery(`SELECT instance_id FROM flow_notification_outbox WHERE id = \? FOR UPDATE`).
		WithArgs(int64(51)).WillReturnRows(sqlmock.NewRows([]string{"instance_id"}).AddRow(int64(8)))
	mock.ExpectExec(`(?s)INSERT INTO flow_actionable_outbox.*depends_on_notification_outbox_id.*NULLIF\(\?, 0\), 'pending'`).
		WithArgs(int64(8), int64(9), "workflow:tasks:old", "flow_tasks:old", "flow_actions:9", "resolved", `["approver"]`, sqlmock.AnyArg(), int64(51)).
		WillReturnResult(sqlmock.NewResult(52, 1))
	mock.ExpectQuery(`SELECT version_no FROM flow_actionable_outbox WHERE id=\? FOR UPDATE`).WithArgs(int64(52)).WillReturnRows(sqlmock.NewRows([]string{"version_no"}).AddRow(int64(1)))
	mock.ExpectCommit()
	tx, err := adapter.db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	effects := &WorkflowEffects{
		Notifications: []WorkflowNotification{created},
		ActionableLifecycles: []WorkflowActionableLifecycle{{
			ActionableKey: "workflow:tasks:old", ExpectedVersion: "flow_tasks:old", NextVersion: "flow_actions:9",
			State: "resolved", Recipients: []string{"approver"},
		}},
	}
	if err := persistActionableLifecycleEffects(context.Background(), tx, int64(8), 9, effects); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestLifecycleDependenciesMatchEachActionableKey(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()
	first := WorkflowNotification{EventType: "workflow.task.created", IdempotencyKey: "first", Metadata: map[string]any{"actionableKey": "workflow:tasks:first"}}
	second := WorkflowNotification{EventType: "workflow.task.created", IdempotencyKey: "second", Metadata: map[string]any{"actionableKey": "workflow:tasks:second"}}
	mock.ExpectBegin()
	for _, item := range []struct {
		notification WorkflowNotification
		id           int64
	}{{first, 51}, {second, 52}} {
		mock.ExpectExec(`(?s)INSERT INTO flow_notification_outbox.*ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID\(id\)`).
			WithArgs(int64(8), int64(9), item.notification.Metadata["actionableKey"], item.notification.IdempotencyKey, sqlmock.AnyArg()).
			WillReturnResult(sqlmock.NewResult(item.id, 1))
		mock.ExpectQuery(`SELECT instance_id FROM flow_notification_outbox WHERE id = \? FOR UPDATE`).
			WithArgs(item.id).WillReturnRows(sqlmock.NewRows([]string{"instance_id"}).AddRow(int64(8)))
	}
	for _, item := range []struct {
		key string
		id  int64
	}{{"workflow:tasks:first", 51}, {"workflow:tasks:second", 52}, {"workflow:tasks:unrelated", 0}} {
		mock.ExpectExec(`(?s)INSERT INTO flow_actionable_outbox.*depends_on_notification_outbox_id.*NULLIF\(\?, 0\), 'pending'`).
			WithArgs(int64(8), int64(9), item.key, "old", "new", "resolved", `["approver"]`, sqlmock.AnyArg(), item.id).
			WillReturnResult(sqlmock.NewResult(item.id+100, 1))
		mock.ExpectQuery(`SELECT version_no FROM flow_actionable_outbox WHERE id=\? FOR UPDATE`).WithArgs(item.id + 100).WillReturnRows(sqlmock.NewRows([]string{"version_no"}).AddRow(int64(1)))
	}
	mock.ExpectCommit()
	tx, err := adapter.db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	effects := &WorkflowEffects{Notifications: []WorkflowNotification{first, second}}
	for _, key := range []string{"workflow:tasks:first", "workflow:tasks:second", "workflow:tasks:unrelated"} {
		effects.ActionableLifecycles = append(effects.ActionableLifecycles, WorkflowActionableLifecycle{
			ActionableKey: key, ExpectedVersion: "old", NextVersion: "new", State: "resolved", Recipients: []string{"approver"},
		})
	}
	if err := persistActionableLifecycleEffects(context.Background(), tx, int64(8), 9, effects); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreationNotificationReplayFromAnotherInstanceRejectsBeforeLifecycleWrite(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()
	created := WorkflowNotification{
		EventType: "workflow.task.created", IdempotencyKey: "workflow:task:created:reused",
		Metadata: map[string]any{"actionableKey": "workflow:tasks:next"},
	}
	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT INTO flow_notification_outbox.*ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID\(id\)`).
		WithArgs(int64(8), int64(9), "workflow:tasks:next", created.IdempotencyKey, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(51, 0))
	mock.ExpectQuery(`SELECT instance_id FROM flow_notification_outbox WHERE id = \? FOR UPDATE`).
		WithArgs(int64(51)).WillReturnRows(sqlmock.NewRows([]string{"instance_id"}).AddRow(int64(7)))
	mock.ExpectRollback()
	tx, err := adapter.db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := persistActionableLifecycleEffects(context.Background(), tx, int64(8), 9, &WorkflowEffects{Notifications: []WorkflowNotification{created}}); err == nil {
		t.Fatal("replayed notification from another instance must fail before lifecycle persistence")
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPendingLifecycleWaitsForItsCreationNotification(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectQuery(`(?s)FROM flow_actionable_outbox o.*dependency\.id = o\.depends_on_notification_outbox_id.*dependency\.instance_id = o\.instance_id.*NOT EXISTS \(.*FROM flow_notification_outbox n.*n\.instance_id = o\.instance_id.*n\.actionable_key = o\.actionable_key OR \(o\.action_id IS NOT NULL AND n\.action_id = o\.action_id\).*n\.delivery_status <> 'delivered'.*\).*ORDER BY id`).
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
		WillReturnRows(sqlmock.NewRows([]string{"id", "version_no", "notification"}).AddRow(int64(5), int64(3), string(stored)))
	response, operation, err := adapter.pendingWorkflowNotificationOutbox(context.Background(), 0)
	if err != nil || operation != "workflow.notification_effect.pending" {
		t.Fatalf("pending notifications: %v %s", err, operation)
	}
	effects, ok := response.Data.([]WorkflowNotificationEffect)
	if !ok || len(effects) != 1 || effects[0].EffectID != 5 || effects[0].VersionNo != 3 || effects[0].Notification.IdempotencyKey != "k1" {
		t.Fatalf("effects = %#v", response.Data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestNotificationOutboxAckIsIdempotentAndFailKeepsPending(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT delivery_status, attempt_count, version_no FROM flow_notification_outbox WHERE id = \? FOR UPDATE`).
		WithArgs(int64(5)).WillReturnRows(sqlmock.NewRows([]string{"delivery_status", "attempt_count", "version_no"}).AddRow("delivered", 0, 2))
	mock.ExpectCommit()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT delivery_status, attempt_count, version_no FROM flow_notification_outbox WHERE id = \? FOR UPDATE`).
		WithArgs(int64(6)).WillReturnRows(sqlmock.NewRows([]string{"delivery_status", "attempt_count", "version_no"}).AddRow("pending", 0, 1))
	mock.ExpectExec(`(?s)UPDATE flow_notification_outbox SET delivery_status = \?, attempt_count = \?, version_no = version_no \+ 1`).
		WithArgs("pending", int64(1), "notification_delivery_failed", nil, "pending", int64(6), "pending", int64(1)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO flow_delivery_audit`).
		WithArgs("notification", int64(6), "retry", "pending", "pending", int64(1), int64(2), int64(1), "workflow.runtime", "notification_delivery_failed", "C000001", "local-workflow").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	trusted := map[string]any{"hzy_runtime_tenant_code": "C000001", "hzy_runtime_deployment_code": "local-workflow", "hzy_runtime_service_client_id": "workflow.runtime", "expectedEffectVersion": int64(1)}
	if _, _, err := adapter.acknowledgeWorkflowNotificationOutbox(context.Background(), "5", trusted); err != nil {
		t.Fatalf("replayed ack must succeed: %v", err)
	}
	response, _, err := adapter.failWorkflowNotificationOutbox(context.Background(), "6", map[string]any{
		"code": "notification_delivery_failed", "hzy_runtime_tenant_code": "C000001", "hzy_runtime_deployment_code": "local-workflow", "hzy_runtime_service_client_id": "workflow.runtime", "expectedEffectVersion": int64(1),
	})
	if err != nil || response.Data.(map[string]any)["pending"] != true {
		t.Fatalf("fail: %v %#v", err, response.Data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
