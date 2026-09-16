package aims

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const testServiceTicketDeliveryOperationKey = "aims:work-item:WI-1:ticket-result:g1:v1"

type aimsOperationUUIDMatcher struct{}

func (aimsOperationUUIDMatcher) Match(value driver.Value) bool {
	text, ok := value.(string)
	return ok && integrationoperation.IsValidOperationID(text)
}

type serviceTicketDeliveryCommandMatcher struct{}

func (serviceTicketDeliveryCommandMatcher) Match(value driver.Value) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	var command map[string]any
	if json.Unmarshal([]byte(text), &command) != nil {
		return false
	}
	expected := map[string]string{
		"ticketCode":      "ST-1",
		"aimsProjectCode": "PRJ-TRUSTED",
		"workItemKey":     "WI-1",
		"workItemType":    "task",
		"workItemStatus":  "completed",
		"deliveryStatus":  "closed",
		"handlerUserId":   "handler-trusted",
		"documentUuid":    "DOC-TRUSTED",
	}
	for key, want := range expected {
		if strings.TrimSpace(fmt.Sprint(command[key])) != want {
			return false
		}
	}
	if strings.TrimSpace(fmt.Sprint(command["quotaConsumed"])) != "4.5" || strings.TrimSpace(fmt.Sprint(command["closedAt"])) == "" {
		return false
	}
	encoded := strings.ToLower(text)
	return !strings.Contains(encoded, "evil") && !strings.Contains(encoded, "internalurl")
}

type aimsSHA256Matcher struct{}

func (aimsSHA256Matcher) Match(value driver.Value) bool {
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

func serviceTicketDeliveryOperationBody() map[string]any {
	return map[string]any{
		"current_user":                  "u1",
		"status":                        "completed",
		"hzy_runtime_tenant_code":       "TENANT-TRUSTED",
		"hzy_runtime_deployment_code":   "DEPLOYMENT-TRUSTED",
		"hzy_runtime_source_app":        "aims",
		"hzy_runtime_service_client_id": "AIMS-CLIENT-TRUSTED",
		"hzy_runtime_request_id":        "REQUEST-TRUSTED",

		"ticketCode":     "EVIL-TICKET",
		"workItemKey":    "EVIL-ITEM",
		"deliveryStatus": "accepted",
		"documentUuid":   "EVIL-DOCUMENT",
		"targetApp":      "evil-target",
		"operationCode":  "evil.operation.v9",
		"idempotencyKey": "evil-idempotency",
		"tenantCode":     "EVIL-TENANT",
		"deploymentCode": "EVIL-DEPLOYMENT",
		"internalUrl":    "https://evil.invalid",
	}
}

func expectUpdatedServiceTicketWorkItemSnapshot(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`(?s)SELECT.*wi\.id, wi\.item_key, wi\.type, wi\.status, wi\.assignee_uid.*p\.project_code, wse\.source_ticket_code.*FROM work_items wi.*WHERE wi\.id = \?.*FOR UPDATE`).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "item_key", "type", "status", "assignee_uid", "project_code", "source_ticket_code", "delivery_generation", "last_delivery_status",
		}).AddRow(int64(7), "WI-1", "task", "completed", "handler-trusted", "PRJ-TRUSTED", "ST-1", 0, nil))
}

func expectNoExistingServiceTicketDeliveryOperation(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`(?s)SELECT status, command_json, command_sha256.*FROM integration_operation.*WHERE operation_key = \?.*tenant_code = \?.*deployment_code = \?.*source_app = 'aims'.*target_app = 'altoc'.*operation_code = 'aims\.work-item\.ticket-result\.v1'.*source_biz_type = 'work_item'.*source_biz_code = \?.*idempotency_key = \?.*FOR UPDATE`).
		WithArgs(
			testServiceTicketDeliveryOperationKey,
			"TENANT-TRUSTED",
			"DEPLOYMENT-TRUSTED",
			"WI-1",
			testServiceTicketDeliveryOperationKey,
		).
		WillReturnRows(sqlmock.NewRows([]string{"status", "command_json", "command_sha256"}))
}

func expectNewServiceTicketDeliveryCommandSnapshot(mock sqlmock.Sqlmock) {
	mock.ExpectExec(`(?s)UPDATE work_item_service_ext.*first_responded_at.*resolved_at.*WHERE work_item_id = \?`).
		WithArgs(1, 1, int64(1), "closed", int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT COALESCE\(codocs_uuid, uuid\) AS document_uuid.*FROM project_documents.*WHERE work_item_id = \?.*LIMIT 2`).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"document_uuid"}).AddRow("DOC-TRUSTED"))
	mock.ExpectQuery(`(?s)SELECT COALESCE\(SUM\(hours\), 0\) AS actual_hours.*FROM time_entries.*WHERE work_item_id = \?`).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"actual_hours"}).AddRow(4.5))
	mock.ExpectQuery(`(?s)SELECT.*first_responded_at.*resolved_at.*FROM work_item_service_ext.*WHERE work_item_id = \?.*LIMIT 1`).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"first_responded_at", "resolved_at"}).AddRow("2026-07-10 12:00:00", "2026-07-10 13:00:00"))
}

func expectServiceTicketDeliveryOperationInsert(mock sqlmock.Sqlmock, failure error) {
	expectation := mock.ExpectExec(`(?s)INSERT INTO integration_operation.*operation_id.*operation_key.*correlation_key.*tenant_code.*deployment_code.*source_app.*target_app.*operation_code.*required_capability.*source_biz_type.*source_biz_code.*idempotency_key.*command_schema_version.*command_json.*command_sha256.*status.*original_request_id.*original_actor_uid.*service_client_id.*VALUES`).
		WithArgs(
			aimsOperationUUIDMatcher{},
			testServiceTicketDeliveryOperationKey,
			testServiceTicketDeliveryOperationKey,
			"TENANT-TRUSTED",
			"DEPLOYMENT-TRUSTED",
			serviceTicketDeliveryOperationCode,
			serviceTicketDeliveryRequiredCapability,
			"WI-1",
			testServiceTicketDeliveryOperationKey,
			serviceTicketDeliveryCommandMatcher{},
			aimsSHA256Matcher{},
			"REQUEST-TRUSTED",
			"u1",
			"AIMS-CLIENT-TRUSTED",
			"u1",
			"u1",
		)
	if failure != nil {
		expectation.WillReturnError(failure)
		return
	}
	expectation.WillReturnResult(sqlmock.NewResult(1, 1))
}

func TestEnqueueServiceTicketDeliveryOperationReusesExistingStageWithoutChangingFrozenCommand(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*wi\.id, wi\.item_key, wi\.type, wi\.status, wi\.assignee_uid.*p\.project_code, wse\.source_ticket_code.*FROM work_items wi.*WHERE wi\.id = \?.*FOR UPDATE`).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "item_key", "type", "status", "assignee_uid", "project_code", "source_ticket_code", "delivery_generation", "last_delivery_status",
		}).AddRow(int64(7), "WI-1", "task", "completed", "handler-trusted", "PRJ-TRUSTED", "ST-1", 1, "closed"))
	frozen := map[string]any{
		"ticketCode": "ST-1", "workItemKey": "WI-1", "deliveryStatus": "closed", "deliveryGeneration": int64(1),
	}
	frozenJSON, _ := json.Marshal(frozen)
	frozenHash, _ := integrationoperation.ValidateAndDigestCommand(frozen)
	mock.ExpectQuery(`(?s)SELECT status, command_json, command_sha256.*FROM integration_operation.*WHERE operation_key = \?.*FOR UPDATE`).
		WithArgs(
			testServiceTicketDeliveryOperationKey,
			"TENANT-TRUSTED",
			"DEPLOYMENT-TRUSTED",
			"WI-1",
			testServiceTicketDeliveryOperationKey,
		).
		WillReturnRows(sqlmock.NewRows([]string{"status", "command_json", "command_sha256"}).AddRow("retry_wait", string(frozenJSON), frozenHash))
	mock.ExpectCommit()

	tx, err := adapter.DB().BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	metadata, err := adapter.enqueueServiceTicketDeliveryOperationTx(context.Background(), tx, "7", serviceTicketDeliveryOperationBody())
	if err != nil {
		t.Fatalf("enqueueServiceTicketDeliveryOperationTx: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	delivery := metadata["serviceTicketDelivery"].(map[string]any)
	if delivery["operationKey"] != testServiceTicketDeliveryOperationKey || delivery["operationStatus"] != "retry_wait" {
		t.Fatalf("metadata = %#v", metadata)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("existing operation must be reused without UPDATE/INSERT of frozen command: %v", err)
	}
}

func TestEnqueueServiceTicketDeliveryOperationInsertFailureRollsBackWorkItemUpdate(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE work_items SET status = \? WHERE id = \?`).
		WithArgs("completed", int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectUpdatedServiceTicketWorkItemSnapshot(mock)
	expectNoExistingServiceTicketDeliveryOperation(mock)
	expectNewServiceTicketDeliveryCommandSnapshot(mock)
	expectServiceTicketDeliveryOperationInsert(mock, errors.New("outbox unavailable"))
	mock.ExpectRollback()

	tx, err := adapter.DB().BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	if _, err := tx.ExecContext(context.Background(), "UPDATE work_items SET status = ? WHERE id = ?", "completed", int64(7)); err != nil {
		t.Fatalf("update work item: %v", err)
	}
	if _, err := adapter.enqueueServiceTicketDeliveryOperationTx(context.Background(), tx, "7", serviceTicketDeliveryOperationBody()); err == nil {
		t.Fatal("enqueue unexpectedly succeeded")
	}
	if err := tx.Rollback(); err != nil {
		t.Fatalf("Rollback: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("outbox failure must roll back the preceding work item update: %v", err)
	}
}
