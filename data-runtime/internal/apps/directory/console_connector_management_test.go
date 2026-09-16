package directory

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestConsoleQueueLDAPConnectionTestCommitsCommandReceiptAndAuditAtomically(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := newAdapter(db, false, "tenant-1", "", "")

	originalRandom := rand.Reader
	randomBytes := make([]byte, 64)
	for index := range randomBytes {
		randomBytes[index] = byte(index)
	}
	rand.Reader = bytes.NewReader(randomBytes)
	t.Cleanup(func() { rand.Reader = originalRandom })

	payloadJSON, err := json.Marshal(map[string]any{
		"deployment": "console-prod", "sourceBizCode": "__ldap_connection__",
	})
	if err != nil {
		t.Fatal(err)
	}
	requestHash := sha256.Sum256(payloadJSON)
	receiptID := "00010203-0405-4607-8809-0a0b0c0d0e0f"

	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT INTO console_mutation_receipts`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*console_mutation_receipts.*FOR UPDATE`).
		WithArgs("tenant-1", "directory.connector.test-connection.queue", "ldap-test-1").
		WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "request_sha256", "status", "result_json"}).
			AddRow(receiptID, hex.EncodeToString(requestHash[:]), "processing", nil))
	mock.ExpectQuery(`(?s)SELECT status,config_json FROM integrations.*FOR UPDATE`).
		WillReturnRows(sqlmock.NewRows([]string{"status", "config_json"}).
			AddRow("active", []byte(`{"managementMode":"managed"}`)))
	mock.ExpectQuery(`(?s)SELECT connector_id,public_key_pem,status FROM directory_connectors.*FOR UPDATE`).
		WithArgs("tenant-1", "console-prod").
		WillReturnRows(sqlmock.NewRows([]string{"connector_id", "public_key_pem", "status"}).
			AddRow("connector-1", "unused-for-connection-test", "active"))
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM integration_operation.*test-connection`).
		WithArgs("tenant-1", "console-prod").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectExec(`(?s)INSERT INTO integration_operation`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE integrations.*connectivity_status='checking'`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO operation_logs`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE console_mutation_receipts.*status='succeeded'`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := adapter.ConsoleQueueLDAPConnectionTest(
		context.Background(),
		"console-prod",
		ConsoleMutationMeta{
			IdempotencyKey: "ldap-test-1",
			RequestID:      "request-1",
			ActorID:        "admin-1",
			ActorType:      "human",
		},
	)
	if err != nil {
		t.Fatalf("ConsoleQueueLDAPConnectionTest: %v", err)
	}
	if result["status"] != "pending" || result["receiptId"] != receiptID || result["replayed"] != false {
		t.Fatalf("result = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestConsoleDirectoryConnectorOperationIsActorBoundAndFormatsTimes(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := newAdapter(db, false, "tenant-1", "", "")
	created := time.Date(2026, time.July, 17, 10, 11, 12, 123000000, time.UTC)
	updated := created.Add(time.Minute)

	mock.ExpectQuery(`SELECT operation_code,source_biz_code,status,attempt_count,`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000", "admin-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"operation_code", "source_biz_code", "status", "attempt_count",
			"created_at", "updated_at", "last_error_code", "last_error_summary",
		}).AddRow("console.directory-connector.sync-now.v1", "__ldap_directory__", "succeeded", 1,
			created, updated, nil, nil))

	result, err := adapter.ConsoleDirectoryConnectorOperation(
		context.Background(),
		"550e8400-e29b-41d4-a716-446655440000",
		"admin-1",
	)
	if err != nil {
		t.Fatalf("ConsoleDirectoryConnectorOperation: %v", err)
	}
	if result["createdAt"] != "2026-07-17T10:11:12.123Z" ||
		result["updatedAt"] != "2026-07-17T10:12:12.123Z" {
		t.Fatalf("result = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
