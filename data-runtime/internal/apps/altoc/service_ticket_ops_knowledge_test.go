package altoc

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func opsKnowledgeBindingBody(documentUUID string) map[string]any {
	return map[string]any{
		"current_user":                  "u1",
		"current_user_scopes":           []string{"altoc.write", "altoc:service_ticket:edit"},
		"documentUuid":                  documentUUID,
		"idempotencyKey":                "altoc:ticket:ST-1:ops-knowledge:" + documentUUID,
		"hzy_runtime_tenant_code":       "TENANT-TRUSTED",
		"hzy_runtime_deployment_code":   "DEPLOYMENT-TRUSTED",
		"hzy_runtime_source_app":        "altoc",
		"hzy_runtime_service_client_id": "SERVICE-CLIENT-TRUSTED",
		"hzy_runtime_request_id":        "REQUEST-TRUSTED",
	}
}

const opsKnowledgeCorrelationKey = "altoc:ticket:ST-1:ops-knowledge:DOC-1"

const (
	opsKnowledgeAssetsOperationID = "550e8400-e29b-41d4-a716-446655440001"
	opsKnowledgeCompletionWorker  = "altoc:SERVICE-CLIENT-TRUSTED:REQUEST-TRUSTED"
	opsKnowledgeCompletionFence   = int64(9)
)

type trustedOpsKnowledgeSnapshotMatcher struct{}

func (trustedOpsKnowledgeSnapshotMatcher) Match(value driver.Value) bool {
	var encoded []byte
	switch typed := value.(type) {
	case string:
		encoded = []byte(typed)
	case []byte:
		encoded = typed
	default:
		return false
	}
	var snapshot map[string]any
	if err := json.Unmarshal(encoded, &snapshot); err != nil {
		return false
	}
	expected := map[string]string{
		"ticketCode":              "ST-1",
		"documentUuid":            "DOC-1",
		"customerCode":            "CU-TRUSTED",
		"contractCode":            "CT-TRUSTED",
		"maintenanceContractCode": "MC-TRUSTED",
		"projectCode":             "PRJ-TRUSTED",
		"deliveryCode":            "DLV-TRUSTED",
		"deliveryAssetCode":       "CDA-TRUSTED",
		"environmentCode":         "ENV-TRUSTED",
	}
	for key, want := range expected {
		if got := opsKnowledgeTestText(snapshot[key]); got != want {
			return false
		}
	}
	for _, value := range snapshot {
		if text := opsKnowledgeTestText(value); text == "EVIL" || text == "EVIL-TENANT" || text == "EVIL-DEPLOYMENT" {
			return false
		}
	}
	return true
}

func opsKnowledgeTestText(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

type sha256HexMatcher struct{}

func (sha256HexMatcher) Match(value driver.Value) bool {
	text, ok := value.(string)
	if !ok || len(text) != 64 {
		return false
	}
	for _, char := range text {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

type uuidV4Matcher struct{}

func (uuidV4Matcher) Match(value driver.Value) bool {
	text, ok := value.(string)
	return ok && integrationoperation.IsValidOperationID(text)
}

func expectTrustedOpsKnowledgeSnapshot(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`(?s)SELECT.*cu\.code AS customer_code.*ct\.code AS contract_code.*mc\.code AS maintenance_contract_code.*resolved_delivery_code.*FROM service_ticket st.*WHERE st\.id = \?.*LIMIT 1`).
		WithArgs(int64(1)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "code", "customer_code", "contract_code", "maintenance_contract_code",
			"project_code", "aims_project_code", "delivery_code", "resolved_delivery_code",
			"delivery_asset_code", "environment_code",
		}).AddRow(
			int64(1), "ST-1", "CU-TRUSTED", "CT-TRUSTED", "MC-TRUSTED",
			"PRJ-TRUSTED", "PRJ-TRUSTED", "DLV-TRUSTED", "DLV-TRUSTED",
			"CDA-TRUSTED", "ENV-TRUSTED",
		))
}

func expectOpsKnowledgeIntegrationOperation(
	mock sqlmock.Sqlmock,
	suffix string,
	sequence int64,
	dependsOn any,
	targetApp string,
	operationCode string,
	requiredCapability string,
	failure error,
) {
	expectation := mock.ExpectExec(`(?s)INSERT INTO integration_operation\s*\(.*operation_id.*operation_key.*correlation_key.*sequence_no.*depends_on_operation_key.*tenant_code.*deployment_code.*source_app.*target_app.*operation_code.*required_capability.*source_biz_type.*source_biz_code.*idempotency_key.*command_schema_version.*command_json.*command_sha256.*status.*original_request_id.*original_actor_uid.*service_client_id.*created_by.*updated_by.*\).*VALUES`).
		WithArgs(
			uuidV4Matcher{},
			opsKnowledgeCorrelationKey+suffix,
			opsKnowledgeCorrelationKey,
			sequence,
			dependsOn,
			"TENANT-TRUSTED",
			"DEPLOYMENT-TRUSTED",
			"altoc",
			targetApp,
			operationCode,
			requiredCapability,
			"service_ticket",
			"ST-1",
			opsKnowledgeCorrelationKey,
			"v1",
			trustedOpsKnowledgeSnapshotMatcher{},
			sha256HexMatcher{},
			"pending",
			"REQUEST-TRUSTED",
			"u1",
			"SERVICE-CLIENT-TRUSTED",
			"u1",
			"u1",
		)
	if failure != nil {
		expectation.WillReturnError(failure)
		return
	}
	expectation.WillReturnResult(sqlmock.NewResult(1, 1))
}

func expectOpsKnowledgeIntegrationOperationSequence(mock sqlmock.Sqlmock, failAt int) {
	steps := []struct {
		suffix        string
		sequence      int64
		dependsOn     any
		targetApp     string
		operationCode string
		capability    string
	}{
		{":codocs-link", 1, nil, "codocs", "altoc.ops-knowledge.codocs-link.v1", "codocs:documents:write"},
		{":assets-link", 2, opsKnowledgeCorrelationKey + ":codocs-link", "assets", "altoc.ops-knowledge.assets-link.v1", "assets:write"},
	}
	for index, step := range steps {
		var failure error
		if failAt == index+1 {
			failure = errors.New("outbox unavailable")
		}
		expectOpsKnowledgeIntegrationOperation(
			mock,
			step.suffix,
			step.sequence,
			step.dependsOn,
			step.targetApp,
			step.operationCode,
			step.capability,
			failure,
		)
		if failure != nil {
			return
		}
	}
}

func forgedOpsKnowledgeBindingBody() map[string]any {
	body := opsKnowledgeBindingBody("DOC-1")
	body["customerCode"] = "EVIL"
	body["contractCode"] = "EVIL"
	body["maintenanceContractCode"] = "EVIL"
	body["projectCode"] = "EVIL"
	body["deliveryCode"] = "EVIL"
	body["deliveryAssetCode"] = "EVIL"
	body["environmentCode"] = "EVIL"
	body["tenantCode"] = "EVIL-TENANT"
	body["deploymentCode"] = "EVIL-DEPLOYMENT"
	body["sourceApp"] = "EVIL"
	body["serviceClientId"] = "EVIL"
	body["requestId"] = "EVIL"
	return body
}

func leasedOpsKnowledgeCompletionBody() map[string]any {
	body := opsKnowledgeBindingBody("DOC-1")
	body["operationId"] = opsKnowledgeAssetsOperationID
	body["fencingToken"] = opsKnowledgeCompletionFence
	body["targetReceiptId"] = "660e8400-e29b-41d4-a716-446655440030"
	body["receiptOperationId"] = opsKnowledgeAssetsOperationID
	body["receiptOperationCode"] = opsKnowledgeAssetsOperationCode
	body["receiptIdempotencyKey"] = opsKnowledgeCorrelationKey
	body["receiptCommandSchemaVersion"] = "v1"
	body["receiptCommandSha256"] = strings.Repeat("a", 64)
	body["targetBizType"] = "delivery_document"
	body["targetBizCode"] = "DOC-1"
	body["responseSummarySha256"] = strings.Repeat("b", 64)
	return body
}

func expectAssetsOpsKnowledgeOperationAcknowledged(mock sqlmock.Sqlmock) {
	lastAttemptAt := time.Now().UTC().Add(-time.Second)
	mock.ExpectQuery(`(?s)SELECT attempt_count, version_no, last_attempt_at, locked_until, command_schema_version, command_sha256.*FROM integration_operation.*WHERE operation_id = \?.*operation_key = \?.*correlation_key = \?.*tenant_code = \?.*deployment_code = \?.*source_app = 'altoc'.*target_app = 'assets'.*operation_code = 'altoc\.ops-knowledge\.assets-link\.v1'.*status = 'processing'.*locked_by = \?.*fencing_token = \?.*FOR UPDATE`).
		WithArgs(
			opsKnowledgeAssetsOperationID,
			opsKnowledgeCorrelationKey+":assets-link",
			opsKnowledgeCorrelationKey,
			"TENANT-TRUSTED",
			"DEPLOYMENT-TRUSTED",
			opsKnowledgeCompletionWorker,
			opsKnowledgeCompletionFence,
		).
		WillReturnRows(sqlmock.NewRows([]string{"attempt_count", "version_no", "last_attempt_at", "locked_until", "command_schema_version", "command_sha256"}).
			AddRow(int64(2), int64(4), lastAttemptAt, time.Now().UTC().Add(time.Minute), "v1", strings.Repeat("a", 64)))
	mock.ExpectExec(`(?s)UPDATE integration_operation_attempt.*SET result_status = 'succeeded'.*http_status = 200.*target_biz_type = 'delivery_document'.*target_biz_code = \?.*finished_at = \?.*duration_ms = \?.*WHERE operation_id = \?.*attempt_no = \?.*locked_by = \?.*fencing_token = \?.*result_status = 'processing'.*finished_at IS NULL`).
		WithArgs("DOC-1", sqlmock.AnyArg(), sqlmock.AnyArg(), opsKnowledgeAssetsOperationID, int64(2), opsKnowledgeCompletionWorker, opsKnowledgeCompletionFence).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE integration_operation.*SET status = 'succeeded'.*target_receipt_id = \?.*target_biz_type = 'delivery_document'.*target_biz_code = \?.*response_summary_sha256 = \?.*succeeded_at = \?.*locked_by = NULL.*locked_until = NULL.*last_http_status = 200.*version_no = \?.*updated_by = \?.*updated_at = \?.*WHERE operation_id = \?.*operation_key = \?.*correlation_key = \?.*tenant_code = \?.*deployment_code = \?.*source_app = 'altoc'.*target_app = 'assets'.*operation_code = 'altoc\.ops-knowledge\.assets-link\.v1'.*status = 'processing'.*locked_by = \?.*fencing_token = \?.*version_no = \?`).
		WithArgs(
			"660e8400-e29b-41d4-a716-446655440030",
			"DOC-1",
			strings.Repeat("b", 64),
			sqlmock.AnyArg(),
			int64(5),
			opsKnowledgeCompletionWorker,
			sqlmock.AnyArg(),
			opsKnowledgeAssetsOperationID,
			opsKnowledgeCorrelationKey+":assets-link",
			opsKnowledgeCorrelationKey,
			"TENANT-TRUSTED",
			"DEPLOYMENT-TRUSTED",
			opsKnowledgeCompletionWorker,
			opsKnowledgeCompletionFence,
			int64(4),
		).
		WillReturnResult(sqlmock.NewResult(0, 1))
}

func TestAckServiceTicketOpsKnowledgeMarksCodocsOperationSucceeded(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	body := opsKnowledgeBindingBody("DOC-1")
	body["targetApp"] = "codocs"
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT \*.*FROM service_ticket.*WHERE code = \?.*FOR UPDATE`).
		WithArgs("ST-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "codocs_document_uuid", "ops_knowledge_pending_uuid"}).AddRow(int64(1), "ST-1", nil, "DOC-1"))
	mock.ExpectExec(`(?s)UPDATE integration_operation.*status = 'succeeded'.*target_app = 'codocs'.*operation_code = 'altoc\.ops-knowledge\.codocs-link\.v1'`).
		WithArgs("u1", opsKnowledgeCorrelationKey+":codocs-link", opsKnowledgeCorrelationKey, "TENANT-TRUSTED", "DEPLOYMENT-TRUSTED").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := adapter.ackServiceTicketOpsKnowledge(context.Background(), "ST-1", body)
	if err != nil || result["status"] != "succeeded" || result["targetApp"] != "codocs" {
		t.Fatalf("ack result=%#v err=%v", result, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestReserveServiceTicketOpsKnowledgeDerivesCanonicalCorrelationKey(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	body := forgedOpsKnowledgeBindingBody()
	body["idempotencyKey"] = "browser-controlled-key"

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT \*.*FROM service_ticket.*WHERE code = \?.*FOR UPDATE`).
		WithArgs("ST-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "codocs_document_uuid", "ops_knowledge_pending_uuid"}).AddRow(int64(1), "ST-1", nil, nil))
	mock.ExpectExec(`(?s)UPDATE service_ticket.*ops_knowledge_pending_uuid = \?.*ops_knowledge_status = 'pending'`).
		WithArgs("DOC-1", opsKnowledgeCorrelationKey, "u1", int64(1)).
		WillReturnError(errors.New("stop after canonical-key assertion"))
	mock.ExpectRollback()

	if _, err := adapter.reserveServiceTicketOpsKnowledge(context.Background(), "ST-1", body); err == nil {
		t.Fatal("expected injected stop after canonical key assertion")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("reserve must ignore the browser idempotency key and derive the canonical correlation key: %v", err)
	}
}

func TestCompleteServiceTicketOpsKnowledgeIsIdempotent(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT \*.*FROM service_ticket.*WHERE code = \?.*FOR UPDATE`).
		WithArgs("ST-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "codocs_document_uuid", "ops_knowledge_pending_uuid", "ops_knowledge_status"}).AddRow(int64(1), "ST-1", "DOC-1", nil, "linked"))
	mock.ExpectCommit()

	result, err := adapter.completeServiceTicketOpsKnowledge(context.Background(), "ST-1", opsKnowledgeBindingBody("DOC-1"))
	if err != nil {
		t.Fatalf("completeServiceTicketOpsKnowledge: %v", err)
	}
	if result["updated"] != false || result["idempotent"] != true {
		t.Fatalf("result = %#v, want idempotent replay", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestReserveServiceTicketOpsKnowledgeRejectsBindingChange(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT \*.*FROM service_ticket.*WHERE code = \?.*FOR UPDATE`).
		WithArgs("ST-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "codocs_document_uuid"}).AddRow(int64(1), "ST-1", "DOC-OLD"))
	mock.ExpectRollback()

	_, err := adapter.reserveServiceTicketOpsKnowledge(context.Background(), "ST-1", opsKnowledgeBindingBody("DOC-NEW"))
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "service_ticket_ops_knowledge_conflict" {
		t.Fatalf("error = %#v, want 409 service_ticket_ops_knowledge_conflict", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestReserveThenCompleteServiceTicketOpsKnowledge(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT \*.*FROM service_ticket.*WHERE code = \?.*FOR UPDATE`).
		WithArgs("ST-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "codocs_document_uuid", "ops_knowledge_pending_uuid"}).AddRow(int64(1), "ST-1", nil, nil))
	mock.ExpectExec(`(?s)UPDATE service_ticket.*ops_knowledge_pending_uuid = \?.*ops_knowledge_status = 'pending'`).
		WithArgs("DOC-1", opsKnowledgeCorrelationKey, "u1", int64(1)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectTrustedOpsKnowledgeSnapshot(mock)
	expectOpsKnowledgeIntegrationOperationSequence(mock, 0)
	mock.ExpectQuery(`SELECT \* FROM service_ticket WHERE id = \? LIMIT 1`).
		WithArgs(int64(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "ops_knowledge_pending_uuid", "ops_knowledge_status"}).AddRow(int64(1), "ST-1", "DOC-1", "pending"))
	mock.ExpectCommit()

	reserved, err := adapter.reserveServiceTicketOpsKnowledge(context.Background(), "ST-1", forgedOpsKnowledgeBindingBody())
	if err != nil || reserved["status"] != "pending" {
		t.Fatalf("reserve result=%#v err=%v", reserved, err)
	}

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT \*.*FROM service_ticket.*WHERE code = \?.*FOR UPDATE`).
		WithArgs("ST-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "codocs_document_uuid", "ops_knowledge_pending_uuid"}).AddRow(int64(1), "ST-1", nil, "DOC-1"))
	expectAssetsOpsKnowledgeOperationAcknowledged(mock)
	mock.ExpectExec(`(?s)UPDATE service_ticket.*codocs_document_uuid = \?.*ops_knowledge_pending_uuid = NULL.*ops_knowledge_status = 'linked'`).
		WithArgs("DOC-1", "u1", int64(1)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT \* FROM service_ticket WHERE id = \? LIMIT 1`).
		WithArgs(int64(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "codocs_document_uuid", "ops_knowledge_pending_uuid", "ops_knowledge_status"}).AddRow(int64(1), "ST-1", "DOC-1", nil, "linked"))
	mock.ExpectCommit()

	completed, err := adapter.completeServiceTicketOpsKnowledge(context.Background(), "ST-1", leasedOpsKnowledgeCompletionBody())
	if err != nil || completed["status"] != "linked" {
		t.Fatalf("complete result=%#v err=%v", completed, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestCompleteServiceTicketOpsKnowledgeRollsBackAssetsAckWhenTicketLinkFails(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT \*.*FROM service_ticket.*WHERE code = \?.*FOR UPDATE`).
		WithArgs("ST-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "codocs_document_uuid", "ops_knowledge_pending_uuid"}).AddRow(int64(1), "ST-1", nil, "DOC-1"))
	expectAssetsOpsKnowledgeOperationAcknowledged(mock)
	mock.ExpectExec(`(?s)UPDATE service_ticket.*codocs_document_uuid = \?.*ops_knowledge_pending_uuid = NULL.*ops_knowledge_status = 'linked'`).
		WithArgs("DOC-1", "u1", int64(1)).
		WillReturnError(errors.New("ticket link unavailable"))
	mock.ExpectRollback()

	if _, err := adapter.completeServiceTicketOpsKnowledge(context.Background(), "ST-1", leasedOpsKnowledgeCompletionBody()); err == nil {
		t.Fatal("complete must fail when the ticket cannot be linked")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("assets success acknowledgement and ticket linked projection must share one transaction: %v", err)
	}
}

func TestReserveServiceTicketOpsKnowledgeRollsBackWhenIntegrationOperationInsertFails(t *testing.T) {
	for failAt := 1; failAt <= 2; failAt++ {
		t.Run(fmt.Sprintf("operation_%d", failAt), func(t *testing.T) {
			adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
			defer closeDB()

			mock.ExpectBegin()
			mock.ExpectQuery(`(?s)SELECT \*.*FROM service_ticket.*WHERE code = \?.*FOR UPDATE`).
				WithArgs("ST-1").
				WillReturnRows(sqlmock.NewRows([]string{"id", "code", "codocs_document_uuid", "ops_knowledge_pending_uuid"}).AddRow(int64(1), "ST-1", nil, nil))
			mock.ExpectExec(`(?s)UPDATE service_ticket.*ops_knowledge_pending_uuid = \?.*ops_knowledge_status = 'pending'`).
				WithArgs("DOC-1", opsKnowledgeCorrelationKey, "u1", int64(1)).
				WillReturnResult(sqlmock.NewResult(0, 1))
			expectTrustedOpsKnowledgeSnapshot(mock)
			expectOpsKnowledgeIntegrationOperationSequence(mock, failAt)
			mock.ExpectRollback()

			if _, err := adapter.reserveServiceTicketOpsKnowledge(context.Background(), "ST-1", forgedOpsKnowledgeBindingBody()); err == nil {
				t.Fatal("reserve must fail when an integration operation cannot be persisted")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("expectations: %v", err)
			}
		})
	}
}

func TestReserveServiceTicketOpsKnowledgeSamePendingUUIDDoesNotDuplicateOperations(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT \*.*FROM service_ticket.*WHERE code = \?.*FOR UPDATE`).
		WithArgs("ST-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "code", "codocs_document_uuid", "ops_knowledge_pending_uuid", "ops_knowledge_status", "ops_knowledge_idempotency_key",
		}).AddRow(int64(1), "ST-1", nil, "DOC-1", "pending", opsKnowledgeCorrelationKey))
	mock.ExpectCommit()

	result, err := adapter.reserveServiceTicketOpsKnowledge(context.Background(), "ST-1", forgedOpsKnowledgeBindingBody())
	if err != nil {
		t.Fatalf("idempotent reserve: %v", err)
	}
	if result["idempotent"] != true || result["status"] != "pending" {
		t.Fatalf("result = %#v, want pending idempotent replay", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestReserveServiceTicketOpsKnowledgeRejectsDifferentPendingDocument(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT \*.*FROM service_ticket.*WHERE code = \?.*FOR UPDATE`).
		WithArgs("ST-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "codocs_document_uuid", "ops_knowledge_pending_uuid"}).AddRow(int64(1), "ST-1", nil, "DOC-A"))
	mock.ExpectRollback()

	_, err := adapter.reserveServiceTicketOpsKnowledge(context.Background(), "ST-1", opsKnowledgeBindingBody("DOC-B"))
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "service_ticket_ops_knowledge_conflict" {
		t.Fatalf("error = %#v, want pending document conflict", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
