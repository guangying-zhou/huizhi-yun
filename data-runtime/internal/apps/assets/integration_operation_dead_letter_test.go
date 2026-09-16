package assets

import (
	"context"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const assetsDeadLetterOperationID = "550e8400-e29b-41d4-a716-446655440070"

func trustedAssetsIntegrationBody() map[string]any {
	return map[string]any{
		"current_user":                  "admin-1",
		"current_user_scopes":           []string{"assets:integration_operation:execute"},
		"hzy_runtime_tenant_code":       "TENANT-TRUSTED",
		"hzy_runtime_deployment_code":   "DEPLOYMENT-TRUSTED",
		"hzy_runtime_source_app":        "assets",
		"hzy_runtime_service_client_id": "ASSETS-DISPATCHER",
		"hzy_runtime_request_id":        "REQUEST-DISPATCH",
	}
}

func TestAssetsDeadLetterActionablesUseTrustedBindingAndSafeProjection(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	now := time.Now().UTC()
	mock.ExpectExec(`(?s)INSERT IGNORE INTO integration_operation_dead_letter_actionable.*FROM integration_operation.*tenant_code = \?.*deployment_code = \?.*source_app = \?.*status = 'dead_letter'`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", "assets").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT.*d.operation_id.*d.generation_no.*d.publish_object_version.*FROM integration_operation_dead_letter_actionable d.*publish_acked_at IS NULL.*LIMIT \?`).
		WithArgs("TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", "assets", 20).
		WillReturnRows(sqlmock.NewRows([]string{"operation_id", "generation_no", "target_app", "operation_code", "source_biz_type", "source_biz_code", "attempt_count", "max_attempts", "last_error_code", "last_error_class", "dead_lettered_at", "original_actor_uid", "source_operation_version", "actionable_key", "publish_object_version"}).
			AddRow(assetsDeadLetterOperationID, 7, "altoc", "assets.delivery-asset.status-sync.v1", "customer_delivery_asset", "CDA-1", 8, 8, "timeout", "transient", now, "actor-1", 7, "integration-operation:assets:"+assetsDeadLetterOperationID+":dead-letter:g7", "dead-letter:g7:operation-v7"))
	body := trustedAssetsIntegrationBody()
	body["tenantCode"] = "EVIL-TENANT"
	result, err := adapter.listPendingAssetsDeadLetterActionables(context.Background(), body)
	if err != nil {
		t.Fatal(err)
	}
	item := result["items"].([]map[string]any)[0]
	if item["tenantCode"] != "TENANT-TRUSTED" || item["sourceApp"] != "assets" || item["operationId"] != assetsDeadLetterOperationID {
		t.Fatalf("unexpected actionable: %#v", item)
	}
	for _, forbidden := range []string{"operationKey", "idempotencyKey", "command", "lastErrorSummary"} {
		if _, exists := item[forbidden]; exists {
			t.Fatalf("actionable leaked %s: %#v", forbidden, item)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAssetsDeadLetterEndpointsRequireWorkerScopeBeforeDatabase(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	body := trustedAssetsIntegrationBody()
	body["current_user_scopes"] = []string{"assets:integration_operations:view"}
	_, operation, handled, err := adapter.handleAssetsIntegrationOperation(context.Background(), http.MethodPost, "/v1/assets/integration-operations:pending-dead-letter-actionables", body)
	httpErr, ok := err.(httperror.Error)
	if !handled || operation != "assets.integration_operations.dead_letter_actionables.list" || !ok || httpErr.Status != http.StatusForbidden {
		t.Fatalf("operation=%q handled=%v err=%#v", operation, handled, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAssetsIntegrationOperationViewAndReplayScopesAreSeparated(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	query := url.Values{
		"current_user_scopes":         []string{"assets:integration_operations:replay"},
		"hzy_runtime_tenant_code":     []string{"TENANT-TRUSTED"},
		"hzy_runtime_deployment_code": []string{"DEPLOYMENT-TRUSTED"},
		"hzy_runtime_source_app":      []string{"assets"},
	}
	_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/assets/integration-operations", query, map[string]any{})
	httpErr, ok := err.(httperror.Error)
	if operation != "assets.integration_operations.diagnostics.list" || !ok || httpErr.Status != http.StatusForbidden {
		t.Fatalf("operation=%q err=%#v", operation, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAssetsNotificationDetailAuthorizationSupportsExactDeadLetterGeneration(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	query := url.Values{
		"current_user":                []string{"recipient-1"},
		"hzy_runtime_actor_purpose":   []string{assetsNotificationDetailActorPurpose},
		"hzy_runtime_tenant_code":     []string{"TENANT-TRUSTED"},
		"hzy_runtime_deployment_code": []string{"DEPLOYMENT-TRUSTED"},
		"hzy_runtime_source_app":      []string{"assets"},
	}
	mock.ExpectQuery(`(?s)SELECT d.recipient_uids.*d.closure_state.*i.status.*i.version_no.*d.source_operation_version.*WHERE d.operation_id = \?.*d.notification_id = \?.*d.tenant_code = \?.*d.deployment_code = \?.*d.source_app = \?`).
		WithArgs(assetsDeadLetterOperationID, "notification-1", "TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", "assets").
		WillReturnRows(sqlmock.NewRows([]string{"recipient_uids", "closure_state", "status", "version_no", "source_operation_version"}).AddRow(`["recipient-1"]`, nil, "dead_letter", 7, 7))
	data, operation, handled, err := adapter.handleNotificationDetailAuthorizationRuntime(context.Background(), http.MethodPost, "/v1/assets/notification-details/authorize", query, map[string]any{"notificationId": "notification-1", "descriptor": map[string]any{"resource": "integration_operation", "id": assetsDeadLetterOperationID}})
	if err != nil || !handled || operation != "assets.notification_details.authorize" {
		t.Fatalf("handled=%v operation=%q err=%v", handled, operation, err)
	}
	result := data.(map[string]any)
	if len(result) != 4 || result["authorized"] != true || result["reasonCode"] != "allowed" {
		t.Fatalf("result=%#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
