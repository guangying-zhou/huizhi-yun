package finance

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const financeDeadLetterOperationID = "550e8400-e29b-41d4-a716-446655440099"

func financeDeadLetterWorkerBody() jsonBody {
	return jsonBody{
		"current_user_scopes":           []string{"finance:integration_operation:execute"},
		"hzy_runtime_tenant_code":       "tenant-1",
		"hzy_runtime_deployment_code":   "finance-prod",
		"hzy_runtime_source_app":        "finance",
		"hzy_runtime_service_client_id": "finance-worker",
		"hzy_runtime_request_id":        "request-1",
	}
}

func TestFinanceDeadLetterActionableRouteRequiresTrustedWorkerContext(t *testing.T) {
	adapter := &Adapter{}
	_, operation, err := adapter.HandleMutation(context.Background(), http.MethodPost, "/v1/finance/integration-operations:pending-dead-letter-actionables", map[string]any{"limit": 1})
	if operation != "finance.integration_operations.dead_letter_actionables.list" {
		t.Fatalf("operation=%q", operation)
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "insufficient_scope" {
		t.Fatalf("error=%v, want trusted worker scope failure", err)
	}
}

func TestFinanceDeadLetterActionableResponseIsSafeAndFrozen(t *testing.T) {
	adapter, mock, closeDB := newFinanceSQLMockAdapter(t)
	defer closeDB()
	now := time.Date(2026, 7, 11, 12, 0, 0, 0, time.UTC)
	mock.ExpectExec(`(?s)INSERT IGNORE INTO integration_operation_dead_letter_actionable.*FROM integration_operation.*source_app = \?.*status = 'dead_letter'`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "tenant-1", "finance-prod", "finance").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT.*d.operation_id.*d.publish_object_version.*FROM integration_operation_dead_letter_actionable d.*publish_acked_at IS NULL`).
		WithArgs("tenant-1", "finance-prod", "finance", 1).
		WillReturnRows(sqlmock.NewRows([]string{"operation_id", "generation_no", "target_app", "operation_code", "source_biz_type", "source_biz_code", "attempt_count", "max_attempts", "last_error_code", "last_error_class", "dead_lettered_at", "original_actor_uid", "source_operation_version", "actionable_key", "publish_object_version"}).
			AddRow(financeDeadLetterOperationID, 7, "altoc", "finance.reconciliation.altoc-summary.v1", "reconciliation", "REC-1", 8, 8, "timeout", "transient", now, "u-1", 7, "integration-operation:finance:"+financeDeadLetterOperationID+":dead-letter:g7", "dead-letter:g7:operation-v7"))
	body := financeDeadLetterWorkerBody()
	body["limit"] = 1
	result, operation, err := adapter.HandleMutation(context.Background(), http.MethodPost, "/v1/finance/integration-operations:pending-dead-letter-actionables", body)
	if err != nil || operation != "finance.integration_operations.dead_letter_actionables.list" {
		t.Fatalf("operation=%q err=%v", operation, err)
	}
	items, ok := result.Data["items"].([]map[string]any)
	if !ok || len(items) != 1 {
		t.Fatalf("items=%#v", result.Data["items"])
	}
	item := items[0]
	for _, forbidden := range []string{"operationKey", "idempotencyKey", "command", "commandSha256", "lastErrorSummary"} {
		if _, exists := item[forbidden]; exists {
			t.Fatalf("unsafe field %q leaked: %#v", forbidden, item)
		}
	}
	if item["operationId"] != financeDeadLetterOperationID || item["generation"] != uint64(7) || item["objectVersion"] != "dead-letter:g7:operation-v7" {
		t.Fatalf("frozen identity=%#v", item)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestFinanceIntegrationOperationDescriptorRequiresExactLowercaseUUID(t *testing.T) {
	if resource, id, err := exactFinanceNotificationDescriptor(map[string]any{"resource": "integration_operation", "id": financeDeadLetterOperationID}); err != nil || resource != "integration_operation" || id != financeDeadLetterOperationID {
		t.Fatalf("descriptor resource=%q id=%q err=%v", resource, id, err)
	}
	for _, invalid := range []map[string]any{
		{"resource": "integration_operation", "id": "550E8400-E29B-41D4-A716-446655440099"},
		{"resource": "integration_operation", "id": financeDeadLetterOperationID, "extra": true},
		{"resource": "integration_operation", "id": "not-a-uuid"},
	} {
		if _, _, err := exactFinanceNotificationDescriptor(invalid); err == nil {
			t.Fatalf("invalid descriptor accepted: %#v", invalid)
		}
	}
}
