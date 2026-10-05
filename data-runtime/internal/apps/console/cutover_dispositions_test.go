package console

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestApplyCutoverDispositionIsIdempotentAuditedAndFingerprintBound(t *testing.T) {
	database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := NewWithDB(config.ConsoleConfig{}, "C000001", database)

	ids := []string{
		"550e8400-e29b-41d4-a716-446655440001",
		"550e8400-e29b-41d4-a716-446655440002",
	}
	originalIDGenerator := newMutationReceiptID
	newMutationReceiptID = func() (string, error) {
		id := ids[0]
		ids = ids[1:]
		return id, nil
	}
	t.Cleanup(func() { newMutationReceiptID = originalIDGenerator })

	fingerprint := strings.Repeat("a", 64)
	operationID := "a408cdcd-7b22-4ed4-89d9-94e7c3bd551d"
	body := map[string]any{
		"changeReference": "CTR-20260718-001",
		"dispositions": []any{map[string]any{
			"category":                  cutoverDispositionIntegration,
			"subjectKey":                operationID,
			"expectedSourceFingerprint": fingerprint,
			"reasonCode":                "historical-terminal",
			"reason":                    "Legacy Directory Connector operation is terminal and retained for audit.",
		}},
	}
	canonical, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	requestHash := sha256.Sum256(canonical)
	now := time.Date(2026, 7, 13, 12, 0, 0, 123000000, time.UTC)

	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT INTO console_mutation_receipts`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*console_mutation_receipts.*FOR UPDATE`).
		WithArgs("C000001", "console.cutover_disposition.apply", "cutover-disposition-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"receipt_id", "request_sha256", "status", "result_json",
		}).AddRow(
			"550e8400-e29b-41d4-a716-446655440001",
			hex.EncodeToString(requestHash[:]),
			"processing",
			nil,
		))
	mock.ExpectQuery(`(?s)FROM integration_operation io.*FOR UPDATE`).
		WithArgs(operationID).
		WillReturnRows(sqlmock.NewRows([]string{
			"subject_key", "source_fingerprint", "updated_at", "status",
		}).AddRow(operationID, fingerprint, now, "dead_letter"))
	mock.ExpectExec(`(?s)UPDATE console_cutover_dispositions.*status='superseded'`).
		WithArgs(
			"550e8400-e29b-41d4-a716-446655440002",
			cutoverDispositionIntegration,
			operationID,
		).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`(?s)INSERT INTO console_cutover_dispositions`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO operation_logs`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE console_mutation_receipts.*status='succeeded'`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := adapter.ApplyCutoverDispositions(context.Background(), body, AuditMutationMeta{
		IdempotencyKey: "cutover-disposition-1",
		RequestID:      "request-cutover-1",
		ActorType:      "service",
		ActorID:        "client:console.runtime",
		SourceApp:      "console",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result["count"] != 1 || result["changeReference"] != "CTR-20260718-001" {
		t.Fatalf("unexpected disposition result: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestApplyCutoverDispositionRejectsChangedSourceFingerprint(t *testing.T) {
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

	body := map[string]any{
		"changeReference": "CTR-20260718-002",
		"dispositions": []any{map[string]any{
			"category":                  cutoverDispositionNotification,
			"subjectKey":                "42",
			"expectedSourceFingerprint": strings.Repeat("a", 64),
			"reasonCode":                "historical-terminal",
			"reason":                    "Historical notification failure reviewed during cutover.",
		}},
	}
	canonical, _ := json.Marshal(body)
	requestHash := sha256.Sum256(canonical)
	now := time.Date(2026, 7, 14, 12, 0, 0, 0, time.UTC)

	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT INTO console_mutation_receipts`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*console_mutation_receipts.*FOR UPDATE`).
		WillReturnRows(sqlmock.NewRows([]string{
			"receipt_id", "request_sha256", "status", "result_json",
		}).AddRow(
			"550e8400-e29b-41d4-a716-446655440001",
			hex.EncodeToString(requestHash[:]),
			"processing",
			nil,
		))
	mock.ExpectQuery(`(?s)FROM portal_notification_deliveries pnd.*FOR UPDATE`).
		WithArgs("42").
		WillReturnRows(sqlmock.NewRows([]string{
			"subject_key", "source_fingerprint", "updated_at", "status",
		}).AddRow("42", strings.Repeat("b", 64), now, "failed"))
	mock.ExpectRollback()

	_, err = adapter.ApplyCutoverDispositions(context.Background(), body, AuditMutationMeta{
		IdempotencyKey: "cutover-disposition-2",
		RequestID:      "request-cutover-2",
		ActorType:      "service",
		ActorID:        "client:console.runtime",
		SourceApp:      "console",
	})
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) ||
		httpErr.Status != http.StatusConflict ||
		httpErr.Code != "cutover_disposition_source_changed" {
		t.Fatalf("changed source must fail closed: %T %v", err, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCutoverDispositionReasonCodesAreStateSpecific(t *testing.T) {
	tests := []struct {
		category, status, reason string
		wantError                bool
	}{
		{cutoverDispositionIntegration, "dead_letter", "historical-terminal", false},
		{cutoverDispositionNotification, "failed", "legacy-abandoned", true},
		{cutoverDispositionDirectorySync, "running", "legacy-abandoned", false},
		{cutoverDispositionDirectorySync, "partial_success", "historical-terminal", false},
		{cutoverDispositionDirectorySync, "pending", "historical-terminal", true},
	}
	for _, test := range tests {
		err := validateCutoverDispositionReason(test.category, test.status, test.reason)
		if (err != nil) != test.wantError {
			t.Fatalf("%s/%s/%s: error=%v", test.category, test.status, test.reason, err)
		}
	}
}

func TestCutoverDispositionQueriesBindEffectiveWaiverToCurrentSourceFingerprint(t *testing.T) {
	for _, spec := range cutoverMetrics() {
		switch spec.code {
		case "failed_integration_operations",
			"failed_notification_deliveries",
			"incomplete_directory_sync_jobs":
			if !strings.Contains(spec.query, "console_cutover_dispositions") ||
				!strings.Contains(spec.query, "source_fingerprint") ||
				!strings.Contains(spec.query, "status='active'") {
				t.Fatalf("%s is not fingerprint-bound: %s", spec.code, spec.query)
			}
		}
	}
	for _, spec := range cutoverBlockingChecks("C000001", "C000001-console") {
		if spec.code == "service_client_credential_integrity" {
			if strings.Contains(spec.query, "console_cutover_dispositions") {
				t.Fatalf("active service client integrity must be repaired, not waived: %s", spec.query)
			}
			return
		}
	}
	t.Fatal("service_client_credential_integrity check not found")
}
