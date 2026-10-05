package altoc

import (
	"context"
	"database/sql/driver"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func milestoneReceivableReceiptBody(t *testing.T, paymentTermID int64) map[string]any {
	t.Helper()
	command := map[string]any{
		"milestoneId": 17, "projectCode": "PRJ-1", "contractCode": "CT-1",
		"paymentTermId": paymentTermID, "idempotencyKey": "aims:milestone:PRJ-1:17:accepted:v1",
		"operatorUid": "u1",
	}
	digest, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatalf("digest command: %v", err)
	}
	return map[string]any{
		"current_user":                                                "aims.runtime",
		"current_user_scopes":                                         []string{"altoc:receivable:mark-billable"},
		integrationoperation.TrustedRequestIDKey:                      "REQUEST-1",
		integrationoperation.TrustedServiceCommandTenantKey:           "TENANT-1",
		integrationoperation.TrustedServiceCommandSourceDeploymentKey: "AIMS-DEPLOYMENT-1",
		integrationoperation.TrustedServiceCommandTargetDeploymentKey: "ALTOC-DEPLOYMENT-1",
		integrationoperation.TrustedServiceCommandSourceAppKey:        "aims",
		integrationoperation.TrustedServiceCommandTargetAppKey:        "altoc",
		integrationoperation.TrustedServiceCommandSourceClientKey:     "AIMS-CLIENT-1",
		"serviceCommand": map[string]any{
			"operationId": "550e8400-e29b-41d4-a716-446655440000",
			"targetApp":   "altoc", "operationCode": milestoneReceivableOperationCode,
			"requiredCapability":   milestoneReceivableRequiredCapability,
			"idempotencyKey":       "aims:milestone:PRJ-1:17:accepted:v1",
			"commandSchemaVersion": "v1", "commandSha256": digest, "command": command,
		},
	}
}

func TestExecuteMilestoneReceivableBillableCommitsBusinessAndReceiptThenReplaysWithoutMutation(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()
	body := milestoneReceivableReceiptBody(t, 23)
	envelope := body["serviceCommand"].(map[string]any)
	commandSHA := envelope["commandSha256"].(string)
	loadArgs := []driver.Value{"TENANT-1", "AIMS-DEPLOYMENT-1", "ALTOC-DEPLOYMENT-1", "aims", "altoc", milestoneReceivableOperationCode, "aims:milestone:PRJ-1:17:accepted:v1"}
	receiptColumns := []string{
		"receipt_id", "operation_id", "required_capability", "command_schema_version", "command_sha256",
		"status", "target_biz_type", "target_biz_code", "response_http_status", "response_summary_sha256", "version_no",
	}
	planColumns := []string{"id", "code", "status", "contract_code", "contract_name", "customer_code", "customer_name"}

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*FOR UPDATE`).WithArgs(loadArgs...).WillReturnRows(sqlmock.NewRows(receiptColumns))
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WithArgs(
		sqlmock.AnyArg(), "550e8400-e29b-41d4-a716-446655440000", milestoneReceivableOperationCode,
		"TENANT-1", "AIMS-DEPLOYMENT-1", "ALTOC-DEPLOYMENT-1", "aims", "altoc",
		milestoneReceivableRequiredCapability, "aims:milestone:PRJ-1:17:accepted:v1", "v1", commandSHA,
		"REQUEST-1", "REQUEST-1", nil, nil, "AIMS-CLIENT-1",
	).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT.*FROM receivable_plan rp.*WHERE rp\.payment_term_id = \?.*FOR UPDATE`).
		WithArgs(int64(23)).WillReturnRows(sqlmock.NewRows(planColumns).AddRow(int64(1), "RP-1", "pending", "CT-1", "Contract", "CU-1", "Customer"))
	mock.ExpectExec(`(?s)UPDATE receivable_plan.*SET status = 'to_invoice'`).WithArgs("u1", int64(1)).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT.*FROM receivable_plan rp.*WHERE rp\.payment_term_id = \?.*ORDER BY`).
		WithArgs(int64(23)).WillReturnRows(sqlmock.NewRows(planColumns).AddRow(int64(1), "RP-1", "to_invoice", "CT-1", "Contract", "CU-1", "Customer"))
	mock.ExpectExec(`(?s)UPDATE service_command_receipt.*SET status = 'succeeded'`).WithArgs(
		"receivable_plan_set", "payment-term:23", 200, sqlmock.AnyArg(), sqlmock.AnyArg(),
	).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	first, err := adapter.executeMilestoneReceivableBillable(context.Background(), "23", body)
	if err != nil {
		t.Fatalf("first execution: %v", err)
	}
	if first["idempotent"] != false || first["targetBizCode"] != "payment-term:23" {
		t.Fatalf("first = %#v", first)
	}

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*FOR UPDATE`).WithArgs(loadArgs...).WillReturnRows(
		sqlmock.NewRows(receiptColumns).AddRow(
			"660e8400-e29b-41d4-a716-446655440000", "550e8400-e29b-41d4-a716-446655440000",
			milestoneReceivableRequiredCapability, "v1", commandSHA, "succeeded",
			"receivable_plan_set", "payment-term:23", 200, strings.Repeat("b", 64), uint64(1),
		),
	)
	mock.ExpectExec(`(?s)UPDATE service_command_receipt.*last_request_id`).WithArgs(
		"REQUEST-1", "660e8400-e29b-41d4-a716-446655440000", uint64(1),
	).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	replay, err := adapter.executeMilestoneReceivableBillable(context.Background(), "23", milestoneReceivableReceiptBody(t, 23))
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if replay["idempotent"] != true || replay["targetBizCode"] != "payment-term:23" {
		t.Fatalf("replay = %#v", replay)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("same-key same-hash replay must not repeat business mutation: %v", err)
	}
}

func TestExecuteMilestoneReceivableBillableRejectsPathCommandMismatchBeforeMutation(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	_, err := adapter.executeMilestoneReceivableBillable(context.Background(), "24", milestoneReceivableReceiptBody(t, 23))
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Code != "service_command_path_mismatch" {
		t.Fatalf("error = %#v, want service_command_path_mismatch", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("path mismatch must not touch receipt or business tables: %v", err)
	}
}

func TestExecuteMilestoneReceivableBillableRejectsSameKeyDifferentHashBeforeMutation(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()
	body := milestoneReceivableReceiptBody(t, 23)
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*FOR UPDATE`).WithArgs(
		"TENANT-1", "AIMS-DEPLOYMENT-1", "ALTOC-DEPLOYMENT-1", "aims", "altoc",
		milestoneReceivableOperationCode, "aims:milestone:PRJ-1:17:accepted:v1",
	).WillReturnRows(sqlmock.NewRows([]string{
		"receipt_id", "operation_id", "required_capability", "command_schema_version", "command_sha256",
		"status", "target_biz_type", "target_biz_code", "response_http_status", "response_summary_sha256", "version_no",
	}).AddRow(
		"660e8400-e29b-41d4-a716-446655440000", "550e8400-e29b-41d4-a716-446655440000",
		milestoneReceivableRequiredCapability, "v1", strings.Repeat("c", 64), "succeeded",
		"receivable_plan_set", "payment-term:23", 200, strings.Repeat("b", 64), uint64(1),
	))
	mock.ExpectRollback()

	_, err := adapter.executeMilestoneReceivableBillable(context.Background(), "23", body)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Code != "idempotency_payload_mismatch" {
		t.Fatalf("error = %#v, want idempotency_payload_mismatch", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("different hash must fail before receivable mutation: %v", err)
	}
}

func TestExecuteMilestoneReceivableBillableRequiresReceiptEnvelope(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	_, err := adapter.executeMilestoneReceivableBillable(context.Background(), "23", map[string]any{
		"current_user_scopes": []string{"altoc:receivable:mark-billable"},
		"paymentTermId":       23,
	})
	if err == nil {
		t.Fatal("plain mutable body unexpectedly accepted")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("missing envelope must fail before mutation: %v", err)
	}
}

func TestMarkReceivablePlansBillableTxTreatsAlreadyBillableSetAsIdempotent(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	columns := []string{"id", "code", "status", "contract_code", "contract_name", "customer_code", "customer_name"}
	mock.ExpectQuery(`(?s)SELECT.*FROM receivable_plan rp.*WHERE rp\.payment_term_id = \?.*FOR UPDATE`).
		WithArgs(int64(23)).
		WillReturnRows(sqlmock.NewRows(columns).AddRow(int64(1), "RP-1", "to_invoice", "CT-1", "Contract", "CU-1", "Customer"))
	mock.ExpectQuery(`(?s)SELECT.*FROM receivable_plan rp.*WHERE rp\.payment_term_id = \?.*ORDER BY`).
		WithArgs(int64(23)).
		WillReturnRows(sqlmock.NewRows(columns).AddRow(int64(1), "RP-1", "to_invoice", "CT-1", "Contract", "CU-1", "Customer"))
	mock.ExpectCommit()

	tx, err := adapter.DB().BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	result, err := adapter.markReceivablePlansBillableByPaymentTermTx(context.Background(), tx, 23, map[string]any{
		"current_user_scopes": []string{"altoc:receivable:mark-billable"},
		"current_user":        "aims.runtime",
	})
	if err != nil {
		t.Fatalf("mark billable: %v", err)
	}
	if result["idempotent"] != true || result["changedCount"] != 0 {
		t.Fatalf("result = %#v", result)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("idempotent replay must not update a receivable plan: %v", err)
	}
}
