package people

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const peopleDeadLetterOperationID = "550e8400-e29b-41d4-a716-446655440080"

func trustedPeopleIntegrationBody() map[string]any {
	return map[string]any{
		"current_user":                  "people-admin-1",
		"current_user_scopes":           []string{"people:integration_operation:execute"},
		"hzy_runtime_tenant_code":       "TENANT-TRUSTED",
		"hzy_runtime_deployment_code":   "DEPLOYMENT-TRUSTED",
		"hzy_runtime_source_app":        "people",
		"hzy_runtime_service_client_id": "PEOPLE-DISPATCHER",
		"hzy_runtime_request_id":        "REQUEST-DISPATCH",
	}
}

func TestPeopleDeadLetterCandidateUsesSafeAllowlistedDTO(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	now := time.Now().UTC()
	mock.ExpectExec(`(?s)INSERT IGNORE INTO integration_operation_dead_letter_actionable.*FROM integration_operation.*source_app = \?.*status = 'dead_letter'`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", "people").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT.*d.operation_id.*d.publish_object_version.*FROM integration_operation_dead_letter_actionable d.*publish_acked_at IS NULL`).
		WithArgs("TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", "people", 20).
		WillReturnRows(sqlmock.NewRows([]string{"operation_id", "generation_no", "target_app", "operation_code", "source_biz_type", "source_biz_code", "attempt_count", "max_attempts", "last_error_code", "last_error_class", "dead_lettered_at", "original_actor_uid", "source_operation_version", "actionable_key", "publish_object_version"}).
			AddRow(peopleDeadLetterOperationID, 7, "assets", peopleAssetsOffboardingOperationCode, "employee", "u-1", 8, 8, "timeout", "transient", now, "actor-1", 7, "integration-operation:people:"+peopleDeadLetterOperationID+":dead-letter:g7", "dead-letter:g7:operation-v7").
			AddRow("550e8400-e29b-41d4-a716-446655440081", 8, "other", "people.future.unapproved.v1", "other", "O-1", 8, 8, "timeout", "transient", now, "actor-1", 8, "integration-operation:people:future", "dead-letter:g8:operation-v8"))
	result, err := adapter.listPendingPeopleDeadLetterActionables(context.Background(), trustedPeopleIntegrationBody())
	if err != nil {
		t.Fatal(err)
	}
	items := result["items"].([]map[string]any)
	if len(items) != 1 || items[0]["operationId"] != peopleDeadLetterOperationID || items[0]["targetApp"] != "assets" {
		t.Fatalf("unexpected candidates: %#v", items)
	}
	for _, forbidden := range []string{"operationKey", "idempotencyKey", "command", "lastErrorSummary", "recipientUids"} {
		if _, exists := items[0][forbidden]; exists {
			t.Fatalf("candidate leaked %s: %#v", forbidden, items[0])
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPeopleDeadLetterEndpointsRequireExecuteScopeBeforeDatabase(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	body := trustedPeopleIntegrationBody()
	body["current_user_scopes"] = []string{"people:integration_operations:view"}
	_, operation, handled, err := adapter.handlePeopleIntegrationOperationAdminRuntime(context.Background(), http.MethodPost, "/v1/people/integration-operations:pending-dead-letter-actionables", url.Values{}, body)
	httpErr, ok := err.(httperror.Error)
	if !handled || operation != "people.integration_operations.dead_letter_actionables.list" || !ok || httpErr.Status != http.StatusForbidden {
		t.Fatalf("operation=%q handled=%v err=%#v", operation, handled, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPeopleReplayAndAckRejectFutureOperationFamilyBeforeMutation(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	for _, operation := range []string{":replay", ":dead-letter-actionable-published"} {
		mock.ExpectQuery(`SELECT target_app,operation_code,required_capability FROM integration_operation`).
			WithArgs(peopleDeadLetterOperationID, "TENANT-TRUSTED", "DEPLOYMENT-TRUSTED").
			WillReturnRows(sqlmock.NewRows([]string{"target_app", "operation_code", "required_capability"}).AddRow("other", "people.future.unapproved.v1", "other:write"))
		body := trustedPeopleIntegrationBody()
		if operation == ":replay" {
			body["current_user_scopes"] = []string{"people:integration_operations:replay"}
			body["expectedVersion"] = 7
			body["reason"] = "manual review"
		} else {
			body["generation"], body["operationVersion"] = 7, 7
			body["actionableKey"], body["objectVersion"], body["notificationId"] = "actionable-7", "version-7", "notification-7"
			body["recipientUids"] = []string{"recipient-1"}
		}
		_, _, _, err := adapter.handlePeopleIntegrationOperationAdminRuntime(context.Background(), http.MethodPost, "/v1/people/integration-operations/"+peopleDeadLetterOperationID+operation, url.Values{}, body)
		httpErr, ok := err.(httperror.Error)
		if !ok || httpErr.Status != http.StatusNotFound {
			t.Fatalf("operation=%s err=%#v", operation, err)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPeopleDiagnosticPaginationOverfetchesExcludedFamiliesWithoutOmittingAllowedRows(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	columns := []string{
		"operation_id", "operation_key", "correlation_key", "target_app", "operation_code", "required_capability",
		"source_biz_type", "source_biz_code", "target_biz_type", "target_biz_code", "idempotency_key", "command_schema_version",
		"command_sha256", "status", "attempt_count", "max_attempts", "next_attempt_at", "last_attempt_at", "locked_by", "locked_until",
		"version_no", "replay_count", "last_http_status", "last_error_code", "last_error_class", "last_error_summary", "last_error_at", "created_at", "updated_at",
	}
	now := time.Date(2026, time.July, 11, 12, 0, 0, 0, time.UTC)
	firstPage := sqlmock.NewRows(columns)
	for index := 0; index <= integrationoperation.MaxDiagnosticLimit; index++ {
		operationID := fmt.Sprintf("550e8400-e29b-41d4-a716-%012d", index+1)
		targetApp, operationCode, capability := "future", "people.future.unapproved.v1", "future:write"
		if index >= integrationoperation.MaxDiagnosticLimit-1 {
			targetApp, operationCode, capability = "assets", peopleAssetsOffboardingOperationCode, peopleAssetsOffboardingCapability
		}
		at := now.Add(-time.Duration(index) * time.Second)
		firstPage.AddRow(
			operationID, "key-"+operationID, "correlation-"+operationID, targetApp, operationCode, capability,
			"employee", fmt.Sprintf("employee-%d", index), nil, nil, "idempotency-"+operationID, "v1",
			"sha256", "dead_letter", 3, 3, at, nil, nil, nil,
			7, 0, nil, "timeout", "transient", "must not reach browser", at, at, at,
		)
	}
	// The first raw page contains 99 excluded rows and the first allowed row at
	// position 100.  A second raw page contains another allowed row, proving
	// that the response cursor remains reachable even when excluded rows fill a
	// repository page.
	secondOperationID := fmt.Sprintf("550e8400-e29b-41d4-a716-%012d", integrationoperation.MaxDiagnosticLimit+1)
	secondPage := sqlmock.NewRows(columns).AddRow(
		secondOperationID, "key-"+secondOperationID, "correlation-"+secondOperationID, "assets", peopleAssetsOffboardingOperationCode, peopleAssetsOffboardingCapability,
		"employee", "employee-100", nil, nil, "idempotency-"+secondOperationID, "v1",
		"sha256", "dead_letter", 3, 3, now.Add(-100*time.Second), nil, nil, nil,
		7, 0, nil, "timeout", "transient", "must not reach browser", now.Add(-100*time.Second), now.Add(-100*time.Second), now.Add(-100*time.Second),
	)
	mock.ExpectQuery(`(?s)SELECT.*FROM integration_operation.*ORDER BY updated_at DESC, operation_id DESC.*LIMIT \?`).WillReturnRows(firstPage)
	mock.ExpectQuery(`(?s)SELECT.*FROM integration_operation.*ORDER BY updated_at DESC, operation_id DESC.*LIMIT \?`).WillReturnRows(secondPage)

	query := url.Values{
		"current_user":                                {"people-admin-1"},
		"current_user_scopes":                         {"people:integration_operations:view"},
		integrationoperation.TrustedTenantCodeKey:     {"TENANT-TRUSTED"},
		integrationoperation.TrustedDeploymentCodeKey: {"DEPLOYMENT-TRUSTED"},
		integrationoperation.TrustedSourceAppKey:      {"people"},
		"limit":                                       {"1"},
	}
	result, err := adapter.listPeopleIntegrationOperationDiagnostics(context.Background(), query)
	if err != nil {
		t.Fatal(err)
	}
	items := result["items"].([]integrationoperation.DiagnosticOperation)
	if len(items) != 1 || items[0].OperationID != fmt.Sprintf("550e8400-e29b-41d4-a716-%012d", integrationoperation.MaxDiagnosticLimit) {
		t.Fatalf("unexpected allowed page: %#v", items)
	}
	nextCursor, ok := result["nextCursor"].(string)
	if !ok || nextCursor == "" {
		t.Fatalf("expected a continuation cursor, got %#v", result["nextCursor"])
	}
	decoded, err := integrationoperation.DecodeDiagnosticCursor(nextCursor)
	if err != nil || decoded == nil || decoded.OperationID != items[0].OperationID {
		t.Fatalf("cursor must continue from the last returned allowed row: %#v, %v", decoded, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPeopleDeadLetterDetailVerifierRequiresCurrentAllowlistedGeneration(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	query := url.Values{
		"current_user":                {"recipient-1"},
		"hzy_runtime_actor_purpose":   {offboardingNotificationDetailActorPurpose},
		"hzy_runtime_tenant_code":     {"TENANT-TRUSTED"},
		"hzy_runtime_deployment_code": {"DEPLOYMENT-TRUSTED"},
		"hzy_runtime_source_app":      {"people"},
	}
	mock.ExpectQuery(`SELECT target_app,operation_code,required_capability FROM integration_operation`).
		WithArgs(peopleDeadLetterOperationID, "TENANT-TRUSTED", "DEPLOYMENT-TRUSTED").
		WillReturnRows(sqlmock.NewRows([]string{"target_app", "operation_code", "required_capability"}).AddRow("assets", peopleAssetsOffboardingOperationCode, peopleAssetsOffboardingCapability))
	mock.ExpectQuery(`(?s)SELECT d.recipient_uids.*d.closure_state.*i.status.*i.version_no.*d.source_operation_version.*WHERE d.operation_id = \?.*d.notification_id = \?.*d.tenant_code = \?.*d.deployment_code = \?.*d.source_app = \?`).
		WithArgs(peopleDeadLetterOperationID, "notification-1", "TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", "people").
		WillReturnRows(sqlmock.NewRows([]string{"recipient_uids", "closure_state", "status", "version_no", "source_operation_version"}).AddRow(`["recipient-1"]`, nil, "dead_letter", 7, 7))
	data, operation, handled, err := adapter.handleOffboardingNotificationDetailAuthorizationRuntime(context.Background(), http.MethodPost, "/v1/people/notification-details/authorize", query, map[string]any{"notificationId": "notification-1", "descriptor": map[string]any{"resource": "integration_operation", "id": peopleDeadLetterOperationID}})
	if err != nil || !handled || operation != "people.notification_details.authorize" {
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
