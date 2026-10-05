package altoc

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
	testIntegrationOperationID  = "550e8400-e29b-41d4-a716-446655440000"
	testIntegrationOperationKey = opsKnowledgeCorrelationKey + ":codocs-link"
	testIntegrationWorker       = "altoc:DISPATCHER-TRUSTED:REQUEST-CLAIM-TRUSTED"
)

func trustedIntegrationOperationRuntimeBody() map[string]any {
	return map[string]any{
		"current_user":                  "dispatcher-user",
		"current_user_scopes":           []string{"altoc.write", "altoc:integration_operation:execute"},
		"hzy_runtime_tenant_code":       "TENANT-TRUSTED",
		"hzy_runtime_deployment_code":   "DEPLOYMENT-TRUSTED",
		"hzy_runtime_source_app":        "altoc",
		"hzy_runtime_service_client_id": "DISPATCHER-TRUSTED",
		"hzy_runtime_request_id":        "REQUEST-CLAIM-TRUSTED",
		"workerId":                      "evil-worker",
		"leaseSeconds":                  99999,

		// These are untrusted business aliases. Claim/failure endpoints must
		// never allow them to select or rewrite an operation.
		"tenantCode":     "EVIL-TENANT",
		"deploymentCode": "EVIL-DEPLOYMENT",
		"sourceApp":      "evil-source",
		"targetApp":      "evil-target",
		"operationCode":  "evil.operation.v999",
		"operationKey":   "evil-operation-key",
		"command":        map[string]any{"documentUuid": "EVIL-DOCUMENT"},
		"payload":        map[string]any{"internalUrl": "https://evil.invalid"},
	}
}

func expectClaimableIntegrationOperationQuery(mock sqlmock.Sqlmock, rows *sqlmock.Rows) {
	mock.ExpectQuery(`(?s)SELECT.*FROM integration_operation o.*WHERE o\.tenant_code = \?.*o\.deployment_code = \?.*o\.source_app = \?.*o\.status IN \('pending', 'retry_wait', 'partial_unknown'\).*o\.next_attempt_at <= \?.*depends_on_operation_key.*succeeded.*ORDER BY.*LIMIT 1.*FOR UPDATE SKIP LOCKED`).
		WithArgs("TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", "altoc", sqlmock.AnyArg()).
		WillReturnRows(rows)
}

func claimableIntegrationOperationRows() *sqlmock.Rows {
	command := map[string]any{"ticketCode": "ST-1", "documentUuid": "DOC-1", "customerCode": "CU-TRUSTED"}
	digest, _ := integrationoperation.ValidateAndDigestCommand(command)
	commandJSON, _ := json.Marshal(command)
	return sqlmock.NewRows([]string{
		"operation_id", "operation_key", "correlation_key", "sequence_no", "depends_on_operation_key",
		"tenant_code", "deployment_code", "source_app", "target_app", "operation_code", "required_capability",
		"source_biz_type", "source_biz_code", "target_biz_type", "target_biz_code", "idempotency_key", "command_schema_version", "command_json", "command_sha256",
		"status", "attempt_count", "max_attempts", "fencing_token", "version_no",
		"original_request_id", "correlation_id", "original_actor_uid", "service_client_id", "replay_count", "created_at",
	}).AddRow(
		testIntegrationOperationID,
		testIntegrationOperationKey,
		opsKnowledgeCorrelationKey,
		int64(1),
		nil,
		"TENANT-TRUSTED",
		"DEPLOYMENT-TRUSTED",
		"altoc",
		"codocs",
		opsKnowledgeCodocsOperationCode,
		"codocs:documents:write",
		"service_ticket",
		"ST-1",
		nil,
		nil,
		opsKnowledgeCorrelationKey,
		"v1",
		commandJSON,
		digest,
		"pending",
		int64(0),
		int64(8),
		int64(7),
		int64(1),
		"REQUEST-ORIGINAL",
		"CORRELATION-ORIGINAL",
		"u1",
		"ALT0C-CLIENT",
		int64(0),
		time.Now().UTC().Add(-time.Hour),
	)
}

func expectExpiredLeaseRecovery(mock sqlmock.Sqlmock) {
	mock.ExpectExec(`(?s)UPDATE integration_operation_attempt attempt.*INNER JOIN integration_operation operation.*SET attempt\.result_status = 'partial_unknown'.*attempt\.error_code = 'lease_expired'.*WHERE operation\.tenant_code = \?.*operation\.deployment_code = \?.*operation\.source_app = \?.*operation\.status = 'processing'.*operation\.locked_until <= \?.*attempt\.result_status = 'processing'.*attempt\.finished_at IS NULL`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", "altoc", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`(?s)UPDATE integration_operation.*status = 'partial_unknown'.*WHERE tenant_code = \?.*deployment_code = \?.*source_app = \?.*status = 'processing'.*locked_until <= \?`).
		WithArgs(sqlmock.AnyArg(), testIntegrationWorker, sqlmock.AnyArg(), "TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", "altoc", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 0))
}

func expectExpiredLeaseRecoveryByOperationKey(mock sqlmock.Sqlmock, operationKey string) {
	mock.ExpectExec(`(?s)UPDATE integration_operation_attempt attempt.*INNER JOIN integration_operation operation.*SET attempt\.result_status = 'partial_unknown'.*WHERE operation\.tenant_code = \?.*operation\.deployment_code = \?.*operation\.source_app = \?.*operation\.operation_key = \?.*operation\.status = 'processing'.*operation\.locked_until <= \?`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", "altoc", operationKey, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`(?s)UPDATE integration_operation.*status = 'partial_unknown'.*WHERE tenant_code = \?.*deployment_code = \?.*source_app = \?.*operation_key = \?.*status = 'processing'.*locked_until <= \?`).
		WithArgs(sqlmock.AnyArg(), testIntegrationWorker, sqlmock.AnyArg(), "TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", "altoc", operationKey, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 0))
}

func expectIntegrationOperationClaimWrite(mock sqlmock.Sqlmock) {
	mock.ExpectExec(`(?s)UPDATE integration_operation.*SET status = 'processing'.*attempt_count = \?.*last_attempt_at = \?.*locked_by = \?.*locked_until = \?.*fencing_token = \?.*version_no = \?.*updated_by = \?.*WHERE operation_id = \?.*version_no = \?.*status = \?`).
		WithArgs(
			int64(1),
			sqlmock.AnyArg(),
			testIntegrationWorker,
			sqlmock.AnyArg(),
			int64(8),
			int64(2),
			testIntegrationWorker,
			sqlmock.AnyArg(),
			testIntegrationOperationID,
			int64(1),
			"pending",
		).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO integration_operation_attempt.*VALUES.*'processing'`).
		WithArgs(sqlmock.AnyArg(), testIntegrationOperationID, opsKnowledgeCodocsOperationCode, int64(1), "immediate", "REQUEST-ORIGINAL", "CORRELATION-ORIGINAL", testIntegrationWorker, int64(8), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
}

func TestClaimNextIntegrationOperationUsesTrustedScopeAndReturnsFrozenCommand(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	expectExpiredLeaseRecovery(mock)
	expectClaimableIntegrationOperationQuery(mock, claimableIntegrationOperationRows())
	expectIntegrationOperationClaimWrite(mock)
	mock.ExpectCommit()

	response, operation, err := adapter.HandleRuntime(
		context.Background(),
		http.MethodPost,
		"/v1/altoc/integration-operations:claim-next",
		url.Values{},
		trustedIntegrationOperationRuntimeBody(),
	)
	if err != nil {
		t.Errorf("claim-next returned error: %v", err)
	}
	if operation != "altoc.integration_operations.claim_next" {
		t.Errorf("operation = %q, want claim-next runtime operation", operation)
	}
	data := integrationOperationRuntimeData(t, response)
	assertRuntimeText(t, data, "operationId", testIntegrationOperationID)
	assertRuntimeText(t, data, "operationKey", testIntegrationOperationKey)
	assertRuntimeText(t, data, "tenantCode", "TENANT-TRUSTED")
	assertRuntimeText(t, data, "deploymentCode", "DEPLOYMENT-TRUSTED")
	assertRuntimeText(t, data, "sourceApp", "altoc")
	assertRuntimeText(t, data, "targetApp", "codocs")
	assertRuntimeText(t, data, "operationCode", opsKnowledgeCodocsOperationCode)
	assertRuntimeText(t, data, "requiredCapability", "codocs:documents:write")
	assertRuntimeText(t, data, "commandSchemaVersion", "v1")
	assertRuntimeText(t, data, "lockedBy", testIntegrationWorker)
	assertRuntimeText(t, data, "fencingToken", "8")

	command, ok := data["command"].(map[string]any)
	if !ok {
		t.Errorf("command = %#v, want decoded frozen command", data["command"])
	} else if command["documentUuid"] != "DOC-1" || command["ticketCode"] != "ST-1" {
		t.Errorf("command = %#v, want database-frozen command", command)
	}
	encoded, _ := json.Marshal(data)
	for _, forbidden := range []string{"EVIL-TENANT", "EVIL-DEPLOYMENT", "evil-source", "evil-target", "evil.operation.v999", "EVIL-DOCUMENT", "evil.invalid", "evil-worker", "99999"} {
		if containsText(string(encoded), forbidden) {
			t.Errorf("claim response leaked body-controlled identity/payload %q: %s", forbidden, encoded)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("claim-next SQL contract: %v", err)
	}
}

func TestAltocIntegrationOperationViewAndReplayScopesAreSeparated(t *testing.T) {
	tests := []struct {
		name      string
		method    string
		path      string
		query     url.Values
		body      map[string]any
		operation string
	}{
		{
			name:   "replay scope cannot view diagnostics",
			method: http.MethodGet,
			path:   "/v1/altoc/integration-operations",
			query: url.Values{
				"current_user":        []string{"admin-1"},
				"current_user_scopes": []string{"altoc:integration_operations:replay"},
			},
			body:      map[string]any{},
			operation: "altoc.integration_operations.diagnostics.list",
		},
		{
			name:      "view scope cannot replay",
			method:    http.MethodPost,
			path:      "/v1/altoc/integration-operations/550e8400-e29b-41d4-a716-446655440000:replay",
			query:     url.Values{},
			operation: "altoc.integration_operations.replay",
			body: map[string]any{
				"current_user":                  "admin-1",
				"current_user_scopes":           []string{"altoc:integration_operations:view"},
				"hzy_runtime_tenant_code":       "TENANT-TRUSTED",
				"hzy_runtime_deployment_code":   "DEPLOYMENT-TRUSTED",
				"hzy_runtime_source_app":        "altoc",
				"hzy_runtime_service_client_id": "ADMIN-CLIENT",
				"expectedVersion":               4,
				"reason":                        "repair complete",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
			defer closeDB()
			_, operation, err := adapter.HandleRuntime(context.Background(), tt.method, tt.path, tt.query, tt.body)
			httpErr, ok := err.(httperror.Error)
			if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "permission_scope_required" {
				t.Fatalf("error = %#v, want 403 permission_scope_required", err)
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

func TestClaimIntegrationOperationByKeyCannotSelectAnotherOperation(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	expectExpiredLeaseRecoveryByOperationKey(mock, testIntegrationOperationKey)
	mock.ExpectQuery(`(?s)SELECT.*FROM integration_operation o.*WHERE o\.tenant_code = \?.*o\.deployment_code = \?.*o\.source_app = \?.*o\.status IN \('pending', 'retry_wait', 'partial_unknown'\).*o\.next_attempt_at <= \?.*o\.operation_key = \?.*ORDER BY.*LIMIT 1.*FOR UPDATE SKIP LOCKED`).
		WithArgs("TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", "altoc", sqlmock.AnyArg(), testIntegrationOperationKey).
		WillReturnRows(claimableIntegrationOperationRows())
	expectIntegrationOperationClaimWrite(mock)
	mock.ExpectCommit()

	response, operation, err := adapter.HandleRuntime(
		context.Background(),
		http.MethodPost,
		"/v1/altoc/integration-operations/"+testIntegrationOperationKey+":claim",
		url.Values{},
		trustedIntegrationOperationRuntimeBody(),
	)
	if err != nil {
		t.Fatalf("claim by key returned error: %v", err)
	}
	if operation != "altoc.integration_operations.claim" {
		t.Errorf("operation = %q, want claim runtime operation", operation)
	}
	data := integrationOperationRuntimeData(t, response)
	assertRuntimeText(t, data, "operationKey", testIntegrationOperationKey)
	assertRuntimeText(t, data, "lockedBy", testIntegrationWorker)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("claim-by-key SQL contract must bind the requested key: %v", err)
	}
}

func TestClaimNextIntegrationOperationRejectsMissingOrWrongTrustedContext(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{
			name: "missing trusted tenant",
			mutate: func(body map[string]any) {
				delete(body, "hzy_runtime_tenant_code")
			},
		},
		{
			name: "missing trusted deployment",
			mutate: func(body map[string]any) {
				delete(body, "hzy_runtime_deployment_code")
			},
		},
		{
			name: "wrong trusted source",
			mutate: func(body map[string]any) {
				body["hzy_runtime_source_app"] = "evil-source"
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
			defer closeDB()
			body := trustedIntegrationOperationRuntimeBody()
			tt.mutate(body)

			_, operation, err := adapter.HandleRuntime(
				context.Background(),
				http.MethodPost,
				"/v1/altoc/integration-operations:claim-next",
				url.Values{},
				body,
			)
			httpErr, ok := err.(httperror.Error)
			if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "integration_operation_context_invalid" {
				t.Errorf("error = %#v, want 403 integration_operation_context_invalid", err)
			}
			if operation != "altoc.integration_operations.claim_next" {
				t.Errorf("operation = %q, want claim-next runtime operation", operation)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("invalid trusted context must be rejected before database access: %v", err)
			}
		})
	}
}

func TestClaimNextIntegrationOperationDoesNotRunBlockedDependency(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	expectExpiredLeaseRecovery(mock)
	expectClaimableIntegrationOperationQuery(mock, sqlmock.NewRows([]string{"operation_id"}))
	mock.ExpectCommit()

	response, operation, err := adapter.HandleRuntime(
		context.Background(),
		http.MethodPost,
		"/v1/altoc/integration-operations:claim-next",
		url.Values{},
		trustedIntegrationOperationRuntimeBody(),
	)
	if err != nil {
		t.Errorf("claim-next with only blocked dependents returned error: %v", err)
	}
	if operation != "altoc.integration_operations.claim_next" {
		t.Errorf("operation = %q, want claim-next runtime operation", operation)
	}
	if data := integrationOperationRuntimeData(t, response); data != nil {
		t.Errorf("data = %#v, want no claim while predecessor is not succeeded", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("blocked dependency must not be claimed or updated: %v", err)
	}
}

func TestFailIntegrationOperationCheckpointUsesWorkerFenceAndTrustedIdentity(t *testing.T) {
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
			adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
			defer closeDB()

			body := trustedIntegrationOperationRuntimeBody()
			body["operationId"] = testIntegrationOperationID
			body["fencingToken"] = int64(8)
			body["httpStatus"] = tt.httpStatus
			body["timedOut"] = tt.timedOut
			body["deliveryUncertain"] = tt.deliveryUncertain
			body["errorCode"] = tt.errorCode
			body["errorSummary"] = "safe downstream failure"
			body["status"] = "succeeded"
			body["nextAttemptAt"] = "2099-01-01T00:00:00Z"

			mock.ExpectQuery(`(?s)SELECT target_app, operation_code, command_json.*FROM integration_operation.*WHERE operation_id = \?.*operation_key = \?.*tenant_code = \?.*deployment_code = \?.*source_app = 'altoc'.*status = 'processing'.*locked_by = \?.*fencing_token = \?.*LIMIT 1`).
				WithArgs(
					testIntegrationOperationID,
					testIntegrationOperationKey,
					"TENANT-TRUSTED",
					"DEPLOYMENT-TRUSTED",
					testIntegrationWorker,
					int64(8),
				).
				WillReturnRows(sqlmock.NewRows([]string{"target_app", "operation_code", "command_json"}).AddRow("codocs", opsKnowledgeCodocsOperationCode, `{"ticketCode":"ST-1","documentUuid":"DOC-1"}`))
			mock.ExpectBegin()
			lastAttemptAt := time.Now().UTC().Add(-time.Second)
			mock.ExpectQuery(`(?s)SELECT.*status.*locked_by.*locked_until.*fencing_token.*attempt_count.*max_attempts.*version_no.*created_at.*last_attempt_at.*FROM integration_operation.*WHERE operation_id = \?.*FOR UPDATE`).
				WithArgs(testIntegrationOperationID).
				WillReturnRows(sqlmock.NewRows([]string{
					"status", "locked_by", "locked_until", "fencing_token", "attempt_count", "max_attempts", "version_no", "created_at", "last_attempt_at",
				}).AddRow("processing", testIntegrationWorker, time.Now().UTC().Add(time.Minute), int64(8), int64(1), int64(8), int64(2), time.Now().UTC().Add(-time.Hour), lastAttemptAt))

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
					testIntegrationOperationID,
					int64(1),
					testIntegrationWorker,
					int64(8),
				).
				WillReturnResult(sqlmock.NewResult(0, 1))

			// next_attempt_at 是 NOT NULL 列：终态也必须写入合法时间。
			// 旧断言曾期望终态写 NULL，把生产缺陷固化成了"预期行为"。
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
					testIntegrationWorker,
					sqlmock.AnyArg(),
					testIntegrationOperationID,
					testIntegrationWorker,
					int64(8),
					int64(2),
				).
				WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectCommit()

			response, operation, err := adapter.HandleRuntime(
				context.Background(),
				http.MethodPost,
				"/v1/altoc/integration-operations/"+testIntegrationOperationKey+":fail",
				url.Values{},
				body,
			)
			if err != nil {
				t.Errorf("failure checkpoint returned error: %v", err)
			}
			if operation != "altoc.integration_operations.fail" {
				t.Errorf("operation = %q, want failure checkpoint runtime operation", operation)
			}
			data := integrationOperationRuntimeData(t, response)
			assertRuntimeText(t, data, "operationKey", testIntegrationOperationKey)
			assertRuntimeText(t, data, "status", tt.wantStatus)
			assertRuntimeText(t, data, "tenantCode", "TENANT-TRUSTED")
			assertRuntimeText(t, data, "deploymentCode", "DEPLOYMENT-TRUSTED")
			assertRuntimeText(t, data, "targetApp", "codocs")
			assertRuntimeText(t, data, "operationCode", opsKnowledgeCodocsOperationCode)
			if !tt.terminal && data != nil && data["nextAttemptAt"] == nil {
				t.Errorf("可重试状态必须返回 nextAttemptAt，got nil")
			}
			encoded, _ := json.Marshal(data)
			if containsText(string(encoded), "evil-") || containsText(string(encoded), "EVIL-") {
				t.Errorf("failure response leaked body-controlled immutable fields: %s", encoded)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("failure checkpoint SQL contract: %v", err)
			}
		})
	}
}

func TestSucceedIntegrationOperationCheckpointFinalizesAttemptWithWorkerFence(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	body := trustedIntegrationOperationRuntimeBody()
	body["operationId"] = testIntegrationOperationID
	body["fencingToken"] = int64(8)
	body["httpStatus"] = http.StatusOK
	command := map[string]any{"ticketCode": "ST-1", "documentUuid": "DOC-1"}
	commandSHA256, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatalf("command digest: %v", err)
	}
	targetReceiptID := "660e8400-e29b-41d4-a716-446655440020"
	responseSummarySHA256 := strings.Repeat("b", 64)
	body["targetReceiptId"] = targetReceiptID
	body["receiptOperationId"] = testIntegrationOperationID
	body["receiptOperationCode"] = opsKnowledgeCodocsOperationCode
	body["receiptIdempotencyKey"] = testIntegrationOperationKey
	body["receiptCommandSchemaVersion"] = "v1"
	body["receiptCommandSha256"] = commandSHA256
	body["targetBizType"] = "document"
	body["targetBizCode"] = "DOC-1"
	body["responseSummarySha256"] = responseSummarySHA256

	mock.ExpectQuery(`(?s)SELECT target_app, operation_code, command_json.*FROM integration_operation.*WHERE operation_id = \?.*operation_key = \?.*tenant_code = \?.*deployment_code = \?.*source_app = 'altoc'.*status = 'processing'.*locked_by = \?.*fencing_token = \?.*LIMIT 1`).
		WithArgs(testIntegrationOperationID, testIntegrationOperationKey, "TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", testIntegrationWorker, int64(8)).
		WillReturnRows(sqlmock.NewRows([]string{"target_app", "operation_code", "command_json"}).
			AddRow("codocs", opsKnowledgeCodocsOperationCode, `{"ticketCode":"ST-1","documentUuid":"DOC-1"}`))
	mock.ExpectBegin()
	lastAttemptAt := time.Now().UTC().Add(-time.Second)
	mock.ExpectQuery(`(?s)SELECT.*status.*locked_by.*locked_until.*fencing_token.*attempt_count.*max_attempts.*version_no.*created_at.*last_attempt_at.*FROM integration_operation.*WHERE operation_id = \?.*FOR UPDATE`).
		WithArgs(testIntegrationOperationID).
		WillReturnRows(sqlmock.NewRows([]string{
			"status", "locked_by", "locked_until", "fencing_token", "attempt_count", "max_attempts", "version_no", "created_at", "last_attempt_at",
		}).AddRow("processing", testIntegrationWorker, time.Now().UTC().Add(time.Minute), int64(8), int64(1), int64(8), int64(2), time.Now().UTC().Add(-time.Hour), lastAttemptAt))
	mock.ExpectExec(`(?s)UPDATE integration_operation_attempt.*SET result_status = 'succeeded'.*http_status = \?.*target_biz_type = \?.*target_biz_code = \?.*finished_at = \?.*duration_ms = \?.*WHERE operation_id = \?.*attempt_no = \?.*locked_by = \?.*fencing_token = \?.*finished_at IS NULL`).
		WithArgs(int64(http.StatusOK), "document", "DOC-1", responseSummarySHA256, sqlmock.AnyArg(), sqlmock.AnyArg(), testIntegrationOperationID, int64(1), testIntegrationWorker, int64(8)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE integration_operation.*SET status = 'succeeded'.*target_receipt_id = \?.*target_biz_type = \?.*target_biz_code = \?.*locked_by = NULL.*locked_until = NULL.*last_http_status = \?.*succeeded_at = \?.*version_no = \?.*updated_by = \?.*updated_at = \?.*WHERE operation_id = \?.*status = 'processing'.*locked_by = \?.*fencing_token = \?.*version_no = \?`).
		WithArgs(targetReceiptID, "document", "DOC-1", int64(http.StatusOK), responseSummarySHA256, sqlmock.AnyArg(), int64(3), testIntegrationWorker, sqlmock.AnyArg(), testIntegrationOperationID, testIntegrationWorker, int64(8), int64(2)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE integration_operation_dead_letter_actionable.*SET closure_state = \?.*WHERE operation_id = \?.*source_operation_version <= \?.*closure_state IS NULL`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	response, operation, err := adapter.HandleRuntime(
		context.Background(),
		http.MethodPost,
		"/v1/altoc/integration-operations/"+testIntegrationOperationKey+":succeed",
		url.Values{},
		body,
	)
	if err != nil {
		t.Fatalf("success checkpoint returned error: %v", err)
	}
	if operation != "altoc.integration_operations.succeed" {
		t.Errorf("operation = %q, want succeed runtime operation", operation)
	}
	data := integrationOperationRuntimeData(t, response)
	assertRuntimeText(t, data, "status", "succeeded")
	assertRuntimeText(t, data, "version", "3")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("success checkpoint SQL contract: %v", err)
	}
}

func integrationOperationRuntimeData(t *testing.T, response any) map[string]any {
	t.Helper()
	if response == nil {
		t.Errorf("runtime response is nil")
		return nil
	}
	envelope, ok := response.(map[string]any)
	if !ok {
		t.Errorf("runtime response = %T, want map envelope", response)
		return nil
	}
	if envelope["data"] == nil {
		return nil
	}
	data, ok := envelope["data"].(map[string]any)
	if !ok {
		t.Errorf("runtime data = %T, want operation map", envelope["data"])
		return nil
	}
	return data
}

func assertRuntimeText(t *testing.T, data map[string]any, key string, want string) {
	t.Helper()
	if got := fmt.Sprint(data[key]); got != want {
		t.Errorf("%s = %q, want %q", key, got, want)
	}
}

func containsText(value string, part string) bool {
	for index := 0; index+len(part) <= len(value); index++ {
		if value[index:index+len(part)] == part {
			return true
		}
	}
	return false
}
