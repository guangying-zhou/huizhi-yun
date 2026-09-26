package workflow

import (
	"context"
	"reflect"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestActionableLifecycleEffectsGroupOnlyExactTaskGeneration(t *testing.T) {
	tasks := []map[string]any{
		{"assignee_uid": "u2", "actionable_key": "workflow:tasks:g1", "actionable_version": "flow_tasks:g1"},
		{"assignee_uid": "u1", "actionable_key": "workflow:tasks:g1", "actionable_version": "flow_tasks:g1"},
		{"assignee_uid": "u3", "actionable_key": "workflow:task:3:delegate:9", "actionable_version": "flow_actions:9"},
	}

	effects := actionableLifecycleEffectsForTasks(tasks, "flow_actions:10", "cancelled")
	if len(effects) != 2 {
		t.Fatalf("expected exact generation groups, got %#v", effects)
	}
	if effects[0].ActionableKey != "workflow:task:3:delegate:9" || !reflect.DeepEqual(effects[0].Recipients, []string{"u3"}) {
		t.Fatalf("unexpected delegated generation: %#v", effects[0])
	}
	if effects[1].ActionableKey != "workflow:tasks:g1" || !reflect.DeepEqual(effects[1].Recipients, []string{"u1", "u2"}) {
		t.Fatalf("unexpected node generation: %#v", effects[1])
	}
}

func TestLifecycleForTaskClosesOnlyCurrentParallelApprover(t *testing.T) {
	task := map[string]any{
		"actionable_key":     "workflow:tasks:parallel",
		"actionable_version": "flow_tasks:parallel",
	}
	effect := lifecycleForTask(task, "flow_actions:11", "resolved", "u2")
	if !reflect.DeepEqual(effect.Recipients, []string{"u2"}) || effect.State != "resolved" {
		t.Fatalf("unexpected current approver lifecycle: %#v", effect)
	}
}

func TestActionablePrerequisitesKeepOnlyNewPendingProjectionNotifications(t *testing.T) {
	base := WorkflowNotification{EventType: "workflow.instance.approved"}
	created := WorkflowNotification{EventType: "workflow.task.created"}
	returned := WorkflowNotification{EventType: "workflow.instance.rejected", Metadata: map[string]any{"rejectStrategy": "to_previous"}}
	rejected := WorkflowNotification{EventType: "workflow.instance.rejected", Metadata: map[string]any{"rejectStrategy": "to_initiator"}}
	result := actionablePrerequisiteNotifications([]WorkflowNotification{base, created, returned, rejected})
	if !reflect.DeepEqual(result, []WorkflowNotification{created, returned}) {
		t.Fatalf("unexpected prerequisite notification set: %#v", result)
	}
}

func TestPendingActionableLifecycleOutboxBacksOffFailuresWithoutBlockingNewEffects(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)FROM flow_actionable_outbox.*delivery_status = 'pending'.*attempt_count = 0 OR last_attempt_at IS NULL.*TIMESTAMPDIFF\(SECOND, last_attempt_at, NOW\(\)\).*attempt_count = 1 THEN 600.*attempt_count = 2 THEN 1200.*attempt_count = 3 THEN 2400.*ELSE 3600.*ORDER BY id.*LIMIT \?`).
		WithArgs(100).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "actionable_key", "expected_version", "next_version", "next_state", "recipients", "prerequisite_notifications",
		}).AddRow(int64(42), "workflow:tasks:g1", "flow_tasks:g1", "flow_actions:10", "resolved", `["u1"]`, `[]`))

	response, _, err := adapter.pendingActionableLifecycleOutbox(context.Background(), 100)
	if err != nil {
		t.Fatalf("pendingActionableLifecycleOutbox: %v", err)
	}
	effects, ok := response.Data.([]WorkflowActionableLifecycle)
	if !ok || len(effects) != 1 || effects[0].EffectID != 42 || effects[0].ActionableKey != "workflow:tasks:g1" {
		t.Fatalf("effects = %#v", response.Data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestFailedActionableLifecycleRemainsPendingWithRetryClock(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectExec(`(?s)UPDATE flow_actionable_outbox.*attempt_count = attempt_count \+ 1, last_attempt_at = NOW\(\).*WHERE id = \? AND delivery_status = 'pending'`).
		WithArgs("42").
		WillReturnResult(sqlmock.NewResult(0, 1))

	response, _, err := adapter.failActionableLifecycleOutbox(context.Background(), "42")
	if err != nil {
		t.Fatalf("failActionableLifecycleOutbox: %v", err)
	}
	data, ok := response.Data.(map[string]any)
	if !ok || data["pending"] != true {
		t.Fatalf("response = %#v", response.Data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
