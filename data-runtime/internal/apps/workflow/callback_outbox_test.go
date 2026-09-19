package workflow

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

type completionCallbackPayloadMatcher struct{}

func (completionCallbackPayloadMatcher) Match(value driver.Value) bool {
	raw, ok := value.(string)
	if !ok {
		return false
	}
	var payload map[string]any
	return json.Unmarshal([]byte(raw), &payload) == nil && payload["idempotencyKey"] == "workflow:callback:17:flow_completed:approved"
}

func TestCompletionCallbackPersistsSameIdempotencyKeyItDispatches(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	tx, err := adapter.db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectExec(`(?s)INSERT INTO flow_callback_logs.*ON DUPLICATE KEY UPDATE`).WithArgs(int64(17), aimsCompletionWorkflowCallback, "flow_completed", completionCallbackPayloadMatcher{}, "workflow:callback:17:flow_completed:approved").WillReturnResult(sqlmock.NewResult(41, 1))
	effects := &WorkflowEffects{Callbacks: []WorkflowCallback{{URL: aimsCompletionWorkflowCallback, Payload: map[string]any{"event": "flow_completed", "status": "approved", "idempotencyKey": "caller-controlled"}}}}
	if err := persistWorkflowCallbacks(context.Background(), tx, int64(17), effects); err != nil {
		t.Fatal(err)
	}
	if effects.Callbacks[0].Payload["idempotencyKey"] != "workflow:callback:17:flow_completed:approved" {
		t.Fatal("dispatch key differs from stored key")
	}
	mock.ExpectRollback()
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPersistWorkflowCallbacksFreezesTerminalCallbackInTransaction(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT INTO flow_callback_logs.*idempotency_key.*ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID\(id\)`).
		WithArgs(
			int64(17),
			"/api/v1/service/workflow/callback",
			"flow_completed",
			sqlmock.AnyArg(),
			"workflow:callback:17:flow_completed:approved",
		).
		WillReturnResult(sqlmock.NewResult(41, 1))
	mock.ExpectCommit()

	tx, err := adapter.db.BeginTx(context.Background(), &sql.TxOptions{})
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	effects := &WorkflowEffects{Callbacks: []WorkflowCallback{{
		URL: "/api/v1/service/workflow/callback",
		Payload: map[string]any{
			"event": "flow_completed", "status": "approved", "app_code": "aims",
		},
	}}}
	if err := persistWorkflowCallbacks(context.Background(), tx, int64(17), effects); err != nil {
		t.Fatalf("persistWorkflowCallbacks: %v", err)
	}
	if effects.Callbacks[0].EffectID != 41 {
		t.Fatalf("effect id = %d, want 41", effects.Callbacks[0].EffectID)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestPendingWorkflowCallbacksIncludesRetryableFailures(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT id, callback_url, payload.*status IN \('pending', 'failed'\).*attempts < 20`).
		WithArgs(100).
		WillReturnRows(sqlmock.NewRows([]string{"id", "callback_url", "payload"}).
			AddRow(int64(41), "/api/v1/service/workflow/callback", `{"event":"flow_completed","status":"approved","app_code":"aims"}`))

	response, _, err := adapter.pendingWorkflowCallbacks(context.Background(), 100)
	if err != nil {
		t.Fatalf("pendingWorkflowCallbacks: %v", err)
	}
	callbacks, ok := response.Data.([]WorkflowCallback)
	if !ok || len(callbacks) != 1 || callbacks[0].EffectID != 41 {
		t.Fatalf("callbacks = %#v", response.Data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
