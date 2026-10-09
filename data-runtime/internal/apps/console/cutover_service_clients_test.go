package console

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/config"
)

func TestRetireLegacyCutoverServiceClientRequiresCredentialedGrantCompleteReplacement(t *testing.T) {
	database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := NewWithDB(config.ConsoleConfig{}, "C000001", database)

	originalIDGenerator := newMutationReceiptID
	newMutationReceiptID = func() (string, error) {
		return "550e8400-e29b-41d4-a716-446655440001", nil
	}
	t.Cleanup(func() { newMutationReceiptID = originalIDGenerator })

	fingerprint := strings.Repeat("c", 64)
	body := map[string]any{
		"changeReference":           "CTR-20260718-003",
		"expectedSourceFingerprint": fingerprint,
		"reasonCode":                "legacy-retired",
		"reason":                    "Duplicate Aims service identity is superseded by its credential-backed runtime identity.",
	}
	hashedPayload := map[string]any{}
	for key, value := range body {
		hashedPayload[key] = value
	}
	hashedPayload["serviceClientId"] = uint64(8)
	canonical, err := json.Marshal(hashedPayload)
	if err != nil {
		t.Fatal(err)
	}
	requestHash := sha256.Sum256(canonical)
	now := time.Date(2026, 4, 30, 17, 17, 17, 0, time.UTC)

	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT INTO console_mutation_receipts`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*console_mutation_receipts.*FOR UPDATE`).
		WithArgs("C000001", "console.cutover_service_client.retire", "cutover-retire-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"receipt_id", "request_sha256", "status", "result_json",
		}).AddRow(
			"550e8400-e29b-41d4-a716-446655440001",
			hex.EncodeToString(requestHash[:]),
			"processing",
			nil,
		))
	mock.ExpectQuery(`(?s)FROM service_clients sc.*current_credential_id IS NULL.*FOR UPDATE`).
		WithArgs(uint64(8)).
		WillReturnRows(sqlmock.NewRows([]string{
			"subject_key", "source_fingerprint", "updated_at", "status", "client_code", "app_code",
		}).AddRow("8", fingerprint, now, "active", "aims", "aims"))
	mock.ExpectQuery(`(?s)FROM service_clients replacement.*LIMIT 1.*FOR UPDATE`).
		WithArgs(uint64(8), "aims", "aims").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "client_code",
		}).AddRow(1, "aims.runtime"))
	mock.ExpectQuery(`(?s)FROM service_client_grants legacy_grant.*replacement_grant.id IS NULL`).
		WithArgs(uint64(1), uint64(8)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectExec(`(?s)UPDATE service_clients.*status='inactive'`).
		WithArgs(uint64(8)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO operation_logs`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE console_mutation_receipts.*status='succeeded'`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := adapter.RetireLegacyCutoverServiceClient(
		context.Background(),
		"8",
		body,
		AuditMutationMeta{
			IdempotencyKey: "cutover-retire-1",
			RequestID:      "request-retire-1",
			ActorType:      "service",
			ActorID:        "client:console.runtime",
			SourceApp:      "console",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result["status"] != "inactive" ||
		result["replacementClientCode"] != "aims.runtime" ||
		result["replacementClientId"] != uint64(1) {
		t.Fatalf("unexpected retirement result: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
