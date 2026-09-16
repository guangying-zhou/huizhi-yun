package aims

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	testAimsIntegrationOperationID = "550e8400-e29b-41d4-a716-446655440010"
	testAimsIntegrationWorker      = "aims:AIMS-DISPATCHER:REQUEST-DISPATCH"
)

func trustedAimsIntegrationOperationBody() map[string]any {
	return map[string]any{
		"current_user":                  "u1",
		"current_user_scopes":           []string{"aims.write", "aims:integration_operation:execute"},
		"hzy_runtime_tenant_code":       "TENANT-TRUSTED",
		"hzy_runtime_deployment_code":   "DEPLOYMENT-TRUSTED",
		"hzy_runtime_source_app":        "aims",
		"hzy_runtime_service_client_id": "AIMS-DISPATCHER",
		"hzy_runtime_request_id":        "REQUEST-DISPATCH",
		"workerId":                      "evil-worker",
		"tenantCode":                    "EVIL-TENANT",
		"targetApp":                     "evil-target",
	}
}

func TestAimsIntegrationOperationRoutesRequireExecuteScope(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	body := trustedAimsIntegrationOperationBody()
	body["current_user_scopes"] = []string{"aims.write"}

	_, operation, err := adapter.HandleRuntime(
		context.Background(), http.MethodPost, "/v1/aims/integration-operations:claim-next", url.Values{}, body,
	)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "insufficient_scope" {
		t.Fatalf("error = %#v, want 403 insufficient_scope", err)
	}
	if operation != "aims.integration_operations.claim_next" {
		t.Fatalf("operation = %q", operation)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("scope must fail before database access: %v", err)
	}
}

func TestAimsIntegrationOperationViewAndReplayScopesAreSeparated(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		path       string
		query      url.Values
		body       map[string]any
		operation  string
		wantStatus int
	}{
		{
			name:   "replay scope cannot view diagnostics",
			method: http.MethodGet,
			path:   "/v1/aims/integration-operations",
			query: url.Values{
				"current_user_scopes":           []string{"aims:integration_operations:replay"},
				"hzy_runtime_tenant_code":       []string{"TENANT-TRUSTED"},
				"hzy_runtime_deployment_code":   []string{"DEPLOYMENT-TRUSTED"},
				"hzy_runtime_source_app":        []string{"aims"},
				"hzy_runtime_service_client_id": []string{"ADMIN-CLIENT"},
			},
			body:       map[string]any{},
			operation:  "aims.integration_operations.diagnostics.list",
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "view scope cannot replay",
			method:     http.MethodPost,
			path:       "/v1/aims/integration-operations/550e8400-e29b-41d4-a716-446655440010:replay",
			query:      url.Values{},
			operation:  "aims.integration_operations.replay",
			wantStatus: http.StatusForbidden,
			body: map[string]any{
				"current_user":                  "admin-1",
				"current_user_scopes":           []string{"aims:integration_operations:view"},
				"hzy_runtime_tenant_code":       "TENANT-TRUSTED",
				"hzy_runtime_deployment_code":   "DEPLOYMENT-TRUSTED",
				"hzy_runtime_source_app":        "aims",
				"hzy_runtime_service_client_id": "ADMIN-CLIENT",
				"expectedVersion":               4,
				"reason":                        "repair complete",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adapter, mock, closeDB := newAimsSQLMockAdapter(t)
			defer closeDB()
			_, operation, err := adapter.HandleRuntime(context.Background(), tt.method, tt.path, tt.query, tt.body)
			httpErr, ok := err.(httperror.Error)
			if !ok || httpErr.Status != tt.wantStatus || httpErr.Code != "insufficient_scope" {
				t.Fatalf("error = %#v, want 403 insufficient_scope", err)
			}
			if operation != tt.operation {
				t.Fatalf("operation = %q, want %q", operation, tt.operation)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("permission separation must fail before database access: %v", err)
			}
		})
	}
}

func TestAimsIntegrationOperationDiagnosticsUseTrustedScopeAndOmitCommand(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	query := url.Values{
		"current_user_scopes":           []string{"aims:integration_operations:view"},
		"hzy_runtime_tenant_code":       []string{"TENANT-TRUSTED"},
		"hzy_runtime_deployment_code":   []string{"DEPLOYMENT-TRUSTED"},
		"hzy_runtime_source_app":        []string{"aims"},
		"hzy_runtime_service_client_id": []string{"ADMIN-CLIENT"},
		"status":                        []string{"failed_permanent"},
		"limit":                         []string{"2"},
		"tenantCode":                    []string{"EVIL-TENANT"},
		"deploymentCode":                []string{"EVIL-DEPLOYMENT"},
		"sourceApp":                     []string{"evil-source"},
	}

	mock.ExpectQuery(`(?s)SELECT.*operation_id.*command_sha256.*FROM integration_operation.*WHERE tenant_code = \?.*deployment_code = \?.*source_app = \?.*status IN \(\?\).*ORDER BY updated_at DESC, operation_id DESC.*LIMIT \?`).
		WithArgs("TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", "aims", "failed_permanent", 3).
		WillReturnRows(sqlmock.NewRows([]string{"operation_id"}))

	response, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/aims/integration-operations", query, map[string]any{})
	if err != nil {
		t.Fatalf("list diagnostics: %v", err)
	}
	if operation != "aims.integration_operations.diagnostics.list" {
		t.Fatalf("operation = %q", operation)
	}
	encoded, _ := json.Marshal(response)
	for _, forbidden := range []string{"commandJson", "command_json", "EVIL-TENANT", "EVIL-DEPLOYMENT", "evil-source"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Errorf("diagnostic response exposed forbidden value %q: %s", forbidden, encoded)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("diagnostic SQL must use trusted scope and safe projection: %v", err)
	}
}

func TestAimsIntegrationOperationReplayUsesTrustedScopeAndActor(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	operationID := "550e8400-e29b-41d4-a716-446655440010"
	body := map[string]any{
		"current_user":                  "admin-trusted",
		"current_user_scopes":           []string{"aims:integration_operations:replay"},
		"hzy_runtime_tenant_code":       "TENANT-TRUSTED",
		"hzy_runtime_deployment_code":   "DEPLOYMENT-TRUSTED",
		"hzy_runtime_source_app":        "aims",
		"hzy_runtime_service_client_id": "ADMIN-CLIENT",
		"expectedVersion":               4,
		"reason":                        "authorization repaired",
		"tenantCode":                    "EVIL-TENANT",
		"deploymentCode":                "EVIL-DEPLOYMENT",
		"sourceApp":                     "evil-source",
		"operatorUid":                   "evil-actor",
		"actorUid":                      "evil-actor",
	}
	mock.ExpectBegin()
	mock.ExpectExec(`(?s)UPDATE integration_operation_dead_letter_actionable.*SET closure_state = \?.*WHERE operation_id = \?.*source_operation_version <= \?.*closure_state IS NULL`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE integration_operation.*SET status = 'pending'.*last_replay_actor_uid = \?.*WHERE operation_id = \?.*tenant_code = \?.*deployment_code = \?.*source_app = \?.*version_no = \?.*status IN \('failed_permanent', 'dead_letter'\)`).
		WithArgs(
			sqlmock.AnyArg(), "admin-trusted", "authorization repaired", sqlmock.AnyArg(), "admin-trusted", sqlmock.AnyArg(),
			operationID, "TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", "aims", int64(4),
		).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	response, operation, err := adapter.HandleRuntime(
		context.Background(), http.MethodPost, "/v1/aims/integration-operations/"+operationID+":replay", url.Values{}, body,
	)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if operation != "aims.integration_operations.replay" {
		t.Fatalf("operation = %q", operation)
	}
	encoded, _ := json.Marshal(response)
	for _, forbidden := range []string{"EVIL-TENANT", "EVIL-DEPLOYMENT", "evil-source", "evil-actor"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Errorf("replay response exposed browser alias %q: %s", forbidden, encoded)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("replay SQL must use trusted scope and actor: %v", err)
	}
}

func TestAimsIntegrationOperationReplayRejectsProcessingAndSucceeded(t *testing.T) {
	for _, status := range []string{"processing", "succeeded"} {
		t.Run(status, func(t *testing.T) {
			adapter, mock, closeDB := newAimsSQLMockAdapter(t)
			defer closeDB()
			operationID := "550e8400-e29b-41d4-a716-446655440010"
			body := map[string]any{
				"current_user":                  "admin-trusted",
				"current_user_scopes":           []string{"aims:integration_operations:replay"},
				"hzy_runtime_tenant_code":       "TENANT-TRUSTED",
				"hzy_runtime_deployment_code":   "DEPLOYMENT-TRUSTED",
				"hzy_runtime_source_app":        "aims",
				"hzy_runtime_service_client_id": "ADMIN-CLIENT",
				"expectedVersion":               4,
				"reason":                        "manual retry",
			}
			mock.ExpectBegin()
			mock.ExpectExec(`(?s)UPDATE integration_operation_dead_letter_actionable.*SET closure_state = \?.*WHERE operation_id = \?.*source_operation_version <= \?.*closure_state IS NULL`).
				WillReturnResult(sqlmock.NewResult(0, 0))
			mock.ExpectExec(`(?s)UPDATE integration_operation.*WHERE operation_id = \?.*tenant_code = \?.*deployment_code = \?.*source_app = \?.*version_no = \?.*status IN \('failed_permanent', 'dead_letter'\)`).
				WillReturnResult(sqlmock.NewResult(0, 0))
			mock.ExpectRollback()

			_, operation, err := adapter.HandleRuntime(
				context.Background(), http.MethodPost, "/v1/aims/integration-operations/"+operationID+":replay", url.Values{}, body,
			)
			httpErr, ok := err.(httperror.Error)
			if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "integration_operation_replay_rejected" {
				t.Fatalf("error = %#v, want replay conflict for %s", err, status)
			}
			if operation != "aims.integration_operations.replay" {
				t.Fatalf("operation = %q", operation)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("non-replayable status must not update: %v", err)
			}
		})
	}
}

func TestFailAimsIntegrationOperationCheckpointUsesWorkerFenceAndTrustedIdentity(t *testing.T) {
	tests := []struct {
		name              string
		httpStatus        int
		timedOut          bool
		deliveryUncertain bool
		errorCode         string
		errorClass        string
		wantStatus        string
		terminal          bool
	}{
		{"401_is_permanent", http.StatusUnauthorized, false, false, "downstream_unauthorized", "authentication", "failed_permanent", true},
		{"403_is_permanent", http.StatusForbidden, false, false, "downstream_forbidden", "authorization", "failed_permanent", true},
		{"503_waits_for_retry", http.StatusServiceUnavailable, false, false, "downstream_unavailable", "transient", "retry_wait", false},
		{"timeout_is_partial_unknown", 0, true, true, "downstream_timeout", "transient", "partial_unknown", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adapter, mock, closeDB := newAimsSQLMockAdapter(t)
			defer closeDB()

			body := trustedAimsIntegrationOperationBody()
			body["operationId"] = testAimsIntegrationOperationID
			body["fencingToken"] = int64(8)
			body["fencing_token"] = int64(999)
			body["httpStatus"] = tt.httpStatus
			body["timedOut"] = tt.timedOut
			body["deliveryUncertain"] = tt.deliveryUncertain
			body["errorCode"] = tt.errorCode
			body["errorSummary"] = "safe downstream failure"
			body["deploymentCode"] = "EVIL-DEPLOYMENT"
			body["sourceApp"] = "evil-source"
			body["lockedBy"] = "evil-worker"
			body["status"] = "succeeded"
			body["nextAttemptAt"] = "2099-01-01T00:00:00Z"

			mock.ExpectQuery(`(?s)SELECT target_app, operation_code, command_json.*FROM integration_operation.*WHERE operation_id = \?.*operation_key = \?.*tenant_code = \?.*deployment_code = \?.*source_app = 'aims'.*status = 'processing'.*locked_by = \?.*fencing_token = \?.*LIMIT 1`).
				WithArgs(
					testAimsIntegrationOperationID,
					testServiceTicketDeliveryOperationKey,
					"TENANT-TRUSTED",
					"DEPLOYMENT-TRUSTED",
					testAimsIntegrationWorker,
					int64(8),
				).
				WillReturnRows(sqlmock.NewRows([]string{"target_app", "operation_code", "command_json"}).AddRow(
					"altoc",
					serviceTicketDeliveryOperationCode,
					`{"ticketCode":"ST-1","workItemKey":"WI-1","deliveryStatus":"closed","idempotencyKey":"aims:work-item:WI-1:ticket-result:g1:v1"}`,
				))

			mock.ExpectBegin()
			lastAttemptAt := time.Now().UTC().Add(-time.Second)
			mock.ExpectQuery(`(?s)SELECT.*status.*locked_by.*locked_until.*fencing_token.*attempt_count.*max_attempts.*version_no.*created_at.*last_attempt_at.*FROM integration_operation.*WHERE operation_id = \?.*FOR UPDATE`).
				WithArgs(testAimsIntegrationOperationID).
				WillReturnRows(sqlmock.NewRows([]string{
					"status", "locked_by", "locked_until", "fencing_token", "attempt_count", "max_attempts", "version_no", "created_at", "last_attempt_at",
				}).AddRow(
					"processing", testAimsIntegrationWorker, time.Now().UTC().Add(time.Minute), int64(8),
					int64(1), int64(8), int64(2), time.Now().UTC().Add(-time.Hour), lastAttemptAt,
				))

			var persistedHTTPStatus any = int64(tt.httpStatus)
			if tt.httpStatus == 0 {
				persistedHTTPStatus = nil
			}
			mock.ExpectExec(`(?s)UPDATE integration_operation_attempt.*SET result_status = \?.*http_status = \?.*error_code = \?.*error_class = \?.*error_summary = \?.*finished_at = \?.*WHERE operation_id = \?.*attempt_no = \?.*locked_by = \?.*fencing_token = \?.*finished_at IS NULL`).
				WithArgs(
					tt.wantStatus,
					persistedHTTPStatus,
					tt.errorCode,
					tt.errorClass,
					"safe downstream failure",
					nil,
					sqlmock.AnyArg(),
					sqlmock.AnyArg(),
					testAimsIntegrationOperationID,
					int64(1),
					testAimsIntegrationWorker,
					int64(8),
				).
				WillReturnResult(sqlmock.NewResult(0, 1))

			// next_attempt_at 是 NOT NULL 列：终态也必须写入合法时间。
			// 旧断言曾期望终态写 NULL，把生产缺陷固化成了"预期行为"
			// （生产报 Error 1048，导致 operation 永远无法进入终态）。
			nextAttempt := sqlmock.AnyArg()
			var failedPermanentAt any
			if tt.wantStatus == "failed_permanent" {
				failedPermanentAt = sqlmock.AnyArg()
			}
			mock.ExpectExec(`(?s)UPDATE integration_operation.*SET status = \?.*next_attempt_at = \?.*locked_by = NULL.*locked_until = NULL.*last_http_status = \?.*last_error_code = \?.*last_error_class = \?.*last_error_summary = \?.*last_error_at = \?.*failed_permanent_at = \?.*dead_lettered_at = \?.*succeeded_at = \?.*version_no = \?.*updated_by = \?.*WHERE operation_id = \?.*status = 'processing'.*locked_by = \?.*fencing_token = \?.*version_no = \?`).
				WithArgs(
					tt.wantStatus,
					nextAttempt,
					persistedHTTPStatus,
					tt.errorCode,
					tt.errorClass,
					"safe downstream failure",
					sqlmock.AnyArg(),
					nil,
					failedPermanentAt,
					nil,
					nil,
					int64(3),
					testAimsIntegrationWorker,
					sqlmock.AnyArg(),
					testAimsIntegrationOperationID,
					testAimsIntegrationWorker,
					int64(8),
					int64(2),
				).
				WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectCommit()

			response, operation, err := adapter.HandleRuntime(
				context.Background(),
				http.MethodPost,
				"/v1/aims/integration-operations/"+testServiceTicketDeliveryOperationKey+":fail",
				url.Values{},
				body,
			)
			if err != nil {
				t.Fatalf("failure checkpoint: %v", err)
			}
			if operation != "aims.integration_operations.fail" {
				t.Fatalf("operation = %q", operation)
			}
			envelope := response.(map[string]any)
			data := envelope["data"].(map[string]any)
			for key, want := range map[string]string{
				"operationId":    testAimsIntegrationOperationID,
				"operationKey":   testServiceTicketDeliveryOperationKey,
				"tenantCode":     "TENANT-TRUSTED",
				"deploymentCode": "DEPLOYMENT-TRUSTED",
				"sourceApp":      "aims",
				"targetApp":      "altoc",
				"operationCode":  serviceTicketDeliveryOperationCode,
				"status":         tt.wantStatus,
			} {
				if got := strings.TrimSpace(fmt.Sprint(data[key])); got != want {
					t.Errorf("%s = %q, want %q", key, got, want)
				}
			}
			// 终态响应不返回 nextAttemptAt 是合理的（对调用方无意义）。
			// 真正要保证的是**数据库写入**为非空——由上面的 ExpectExec 断言，
			// 它现在对所有状态都要求一个具体值而非 NULL。
			if !tt.terminal && data["nextAttemptAt"] == nil {
				t.Errorf("可重试状态必须返回 nextAttemptAt，got nil")
			}
			if data["nextAttemptAt"] == "2099-01-01T00:00:00Z" {
				t.Errorf("nextAttemptAt used browser-forged value: %#v", data["nextAttemptAt"])
			}
			encoded, _ := json.Marshal(data)
			for _, forged := range []string{"EVIL-TENANT", "EVIL-DEPLOYMENT", "evil-source", "evil-target", "evil-worker", "2099-01-01"} {
				if strings.Contains(string(encoded), forged) {
					t.Errorf("failure response leaked browser-forged value %q: %s", forged, encoded)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("failure checkpoint SQL contract: %v", err)
			}
		})
	}
}

func TestSucceedAimsIntegrationOperationUsesTrustedWorkerFenceAndFrozenTarget(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	body := trustedAimsIntegrationOperationBody()
	body["operationId"] = testAimsIntegrationOperationID
	body["fencingToken"] = int64(8)
	body["httpStatus"] = http.StatusOK
	command := map[string]any{"ticketCode": "ST-1", "workItemKey": "WI-1", "deliveryStatus": "closed", "idempotencyKey": testServiceTicketDeliveryOperationKey}
	commandSHA256, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatalf("command digest: %v", err)
	}
	targetReceiptID := "660e8400-e29b-41d4-a716-446655440010"
	responseSummarySHA256 := strings.Repeat("b", 64)
	body["targetReceiptId"] = targetReceiptID
	body["receiptOperationId"] = testAimsIntegrationOperationID
	body["receiptOperationCode"] = serviceTicketDeliveryOperationCode
	body["receiptIdempotencyKey"] = testServiceTicketDeliveryOperationKey
	body["receiptCommandSchemaVersion"] = "v1"
	body["receiptCommandSha256"] = commandSHA256
	body["targetBizType"] = "service_ticket"
	body["targetBizCode"] = "ST-1"
	body["responseSummarySha256"] = responseSummarySHA256

	mock.ExpectQuery(`(?s)SELECT target_app, operation_code, command_json.*FROM integration_operation.*WHERE operation_id = \?.*operation_key = \?.*tenant_code = \?.*deployment_code = \?.*source_app = 'aims'.*status = 'processing'.*locked_by = \?.*fencing_token = \?.*LIMIT 1`).
		WithArgs(testAimsIntegrationOperationID, testServiceTicketDeliveryOperationKey, "TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", testAimsIntegrationWorker, int64(8)).
		WillReturnRows(sqlmock.NewRows([]string{"target_app", "operation_code", "command_json"}).
			AddRow("altoc", serviceTicketDeliveryOperationCode, `{"ticketCode":"ST-1","workItemKey":"WI-1","deliveryStatus":"closed","idempotencyKey":"aims:work-item:WI-1:ticket-result:g1:v1"}`))
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*status.*locked_by.*locked_until.*fencing_token.*attempt_count.*max_attempts.*version_no.*created_at.*last_attempt_at.*FROM integration_operation.*WHERE operation_id = \?.*FOR UPDATE`).
		WithArgs(testAimsIntegrationOperationID).
		WillReturnRows(sqlmock.NewRows([]string{
			"status", "locked_by", "locked_until", "fencing_token", "attempt_count", "max_attempts", "version_no", "created_at", "last_attempt_at",
		}).AddRow("processing", testAimsIntegrationWorker, time.Now().UTC().Add(time.Minute), int64(8), int64(1), int64(8), int64(2), time.Now().UTC().Add(-time.Hour), time.Now().UTC().Add(-time.Second)))
	mock.ExpectExec(`(?s)UPDATE integration_operation_attempt.*SET result_status = 'succeeded'.*http_status = \?.*target_biz_type = \?.*target_biz_code = \?.*finished_at = \?.*WHERE operation_id = \?.*attempt_no = \?.*locked_by = \?.*fencing_token = \?.*finished_at IS NULL`).
		WithArgs(int64(http.StatusOK), "service_ticket", "ST-1", responseSummarySHA256, sqlmock.AnyArg(), sqlmock.AnyArg(), testAimsIntegrationOperationID, int64(1), testAimsIntegrationWorker, int64(8)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE integration_operation.*SET status = 'succeeded'.*target_receipt_id = \?.*target_biz_type = \?.*target_biz_code = \?.*locked_by = NULL.*locked_until = NULL.*last_http_status = \?.*succeeded_at = \?.*version_no = \?.*updated_by = \?.*updated_at = \?.*WHERE operation_id = \?.*status = 'processing'.*locked_by = \?.*fencing_token = \?.*version_no = \?`).
		WithArgs(targetReceiptID, "service_ticket", "ST-1", int64(http.StatusOK), responseSummarySHA256, sqlmock.AnyArg(), int64(3), testAimsIntegrationWorker, sqlmock.AnyArg(), testAimsIntegrationOperationID, testAimsIntegrationWorker, int64(8), int64(2)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE integration_operation_dead_letter_actionable.*SET closure_state = \?.*WHERE operation_id = \?.*source_operation_version <= \?.*closure_state IS NULL`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	response, operation, err := adapter.HandleRuntime(
		context.Background(),
		http.MethodPost,
		"/v1/aims/integration-operations/"+testServiceTicketDeliveryOperationKey+":succeed",
		url.Values{},
		body,
	)
	if err != nil {
		t.Fatalf("succeed operation: %v", err)
	}
	if operation != "aims.integration_operations.succeed" {
		t.Fatalf("operation = %q", operation)
	}
	envelope := response.(map[string]any)
	data := envelope["data"].(map[string]any)
	if fmt.Sprint(data["status"]) != "succeeded" || fmt.Sprint(data["targetApp"]) != "altoc" {
		t.Fatalf("response data = %#v", data)
	}
	if fmt.Sprint(data["tenantCode"]) != "TENANT-TRUSTED" || fmt.Sprint(data["deploymentCode"]) != "DEPLOYMENT-TRUSTED" {
		t.Fatalf("response leaked untrusted scope: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("success checkpoint SQL contract: %v", err)
	}
}

func TestSucceedProductDocumentOperationUsesFrozenDocumentAndSchema(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	body := trustedAimsIntegrationOperationBody()
	body["operationId"] = testAimsIntegrationOperationID
	body["fencingToken"] = int64(8)
	body["httpStatus"] = http.StatusOK
	command := map[string]any{"actorUid": "user", "productCode": "PRODUCT", "title": "Spec", "action": "create", "documentUuid": "00000000-0000-4000-8000-000000000001", "templateUuid": "00000000-0000-4000-8000-000000000002"}
	commandJSON, _ := json.Marshal(command)
	commandSHA256, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatalf("command digest: %v", err)
	}
	targetReceiptID := "660e8400-e29b-41d4-a716-446655440010"
	responseSummarySHA256 := strings.Repeat("b", 64)
	body["targetReceiptId"] = targetReceiptID
	body["receiptOperationId"] = testAimsIntegrationOperationID
	body["receiptOperationCode"] = productDocumentCreateOperationCode
	body["receiptIdempotencyKey"] = testServiceTicketDeliveryOperationKey
	body["receiptCommandSchemaVersion"] = "product-document-create.v1"
	body["receiptCommandSha256"] = commandSHA256
	body["targetBizType"] = "product_document"
	body["targetBizCode"] = "00000000-0000-4000-8000-000000000001"
	body["responseSummarySha256"] = responseSummarySHA256

	mock.ExpectQuery(`(?s)SELECT target_app, operation_code, command_json.*FROM integration_operation.*WHERE operation_id = \?.*operation_key = \?.*tenant_code = \?.*deployment_code = \?.*source_app = 'aims'.*status = 'processing'.*locked_by = \?.*fencing_token = \?.*LIMIT 1`).
		WithArgs(testAimsIntegrationOperationID, testServiceTicketDeliveryOperationKey, "TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", testAimsIntegrationWorker, int64(8)).
		WillReturnRows(sqlmock.NewRows([]string{"target_app", "operation_code", "command_json"}).
			AddRow("codocs", productDocumentCreateOperationCode, string(commandJSON)))
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*status.*locked_by.*locked_until.*fencing_token.*attempt_count.*max_attempts.*version_no.*created_at.*last_attempt_at.*FROM integration_operation.*WHERE operation_id = \?.*FOR UPDATE`).
		WithArgs(testAimsIntegrationOperationID).
		WillReturnRows(sqlmock.NewRows([]string{
			"status", "locked_by", "locked_until", "fencing_token", "attempt_count", "max_attempts", "version_no", "created_at", "last_attempt_at",
		}).AddRow("processing", testAimsIntegrationWorker, time.Now().UTC().Add(time.Minute), int64(8), int64(1), int64(8), int64(2), time.Now().UTC().Add(-time.Hour), time.Now().UTC().Add(-time.Second)))
	mock.ExpectExec(`(?s)UPDATE integration_operation_attempt.*SET result_status = 'succeeded'.*http_status = \?.*target_biz_type = \?.*target_biz_code = \?.*finished_at = \?.*WHERE operation_id = \?.*attempt_no = \?.*locked_by = \?.*fencing_token = \?.*finished_at IS NULL`).
		WithArgs(int64(http.StatusOK), "product_document", "00000000-0000-4000-8000-000000000001", responseSummarySHA256, sqlmock.AnyArg(), sqlmock.AnyArg(), testAimsIntegrationOperationID, int64(1), testAimsIntegrationWorker, int64(8)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE integration_operation.*SET status = 'succeeded'.*target_receipt_id = \?.*target_biz_type = \?.*target_biz_code = \?.*locked_by = NULL.*locked_until = NULL.*last_http_status = \?.*succeeded_at = \?.*version_no = \?.*updated_by = \?.*updated_at = \?.*WHERE operation_id = \?.*status = 'processing'.*locked_by = \?.*fencing_token = \?.*version_no = \?`).
		WithArgs(targetReceiptID, "product_document", "00000000-0000-4000-8000-000000000001", int64(http.StatusOK), responseSummarySHA256, sqlmock.AnyArg(), int64(3), testAimsIntegrationWorker, sqlmock.AnyArg(), testAimsIntegrationOperationID, testAimsIntegrationWorker, int64(8), int64(2)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE integration_operation_dead_letter_actionable.*SET closure_state = \?.*WHERE operation_id = \?.*source_operation_version <= \?.*closure_state IS NULL`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	response, operation, err := adapter.HandleRuntime(
		context.Background(),
		http.MethodPost,
		"/v1/aims/integration-operations/"+testServiceTicketDeliveryOperationKey+":succeed",
		url.Values{},
		body,
	)
	if err != nil {
		t.Fatalf("succeed operation: %v", err)
	}
	if operation != "aims.integration_operations.succeed" {
		t.Fatalf("operation = %q", operation)
	}
	envelope := response.(map[string]any)
	data := envelope["data"].(map[string]any)
	if fmt.Sprint(data["status"]) != "succeeded" || fmt.Sprint(data["targetApp"]) != "codocs" {
		t.Fatalf("response data = %#v", data)
	}
	if fmt.Sprint(data["tenantCode"]) != "TENANT-TRUSTED" || fmt.Sprint(data["deploymentCode"]) != "DEPLOYMENT-TRUSTED" {
		t.Fatalf("response leaked untrusted scope: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("success checkpoint SQL contract: %v", err)
	}
}

func TestAimsIntegrationOperationRejectsWildcardExecutionScope(t *testing.T) {
	for _, scope := range []string{"*", "aims.*", "aims.write", "aims:integration_operations:replay", "aims:integration_operations:view"} {
		for _, suffix := range []string{":claim-next", "/key:claim", "/key:fail", "/key:succeed"} {
			t.Run(scope+suffix, func(t *testing.T) {
				adapter, mock, closeDB := newAimsSQLMockAdapter(t)
				defer closeDB()
				body := trustedAimsIntegrationOperationBody()
				body["current_user_scopes"] = []string{scope}
				_, _, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/aims/integration-operations"+suffix, url.Values{}, body)
				e, ok := err.(httperror.Error)
				if !ok || e.Status != http.StatusForbidden || e.Code != "insufficient_scope" {
					t.Fatalf("expected exact scope rejection: %v", err)
				}
				if err := mock.ExpectationsWereMet(); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}
