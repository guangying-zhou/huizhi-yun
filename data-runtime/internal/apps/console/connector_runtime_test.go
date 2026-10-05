package console

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"database/sql/driver"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/config"
)

type excludesEnrollmentSecret struct{}

func (excludesEnrollmentSecret) Match(value driver.Value) bool {
	var text string
	switch typed := value.(type) {
	case string:
		text = typed
	case []byte:
		text = string(typed)
	default:
		return false
	}
	return !strings.Contains(text, "hzy_cre_")
}

func TestIssueConnectorRuntimeEnrollmentStoresOnlyHashAndSafeReceipt(t *testing.T) {
	database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := NewWithDB(config.ConsoleConfig{}, "tenant-1", database)

	originalIDGenerator := newMutationReceiptID
	newMutationReceiptID = func() (string, error) {
		return "550e8400-e29b-41d4-a716-446655440099", nil
	}
	t.Cleanup(func() { newMutationReceiptID = originalIDGenerator })

	payloadJSON, _ := json.Marshal(map[string]any{"deploymentCode": "console-prod"})
	requestHash := sha256.Sum256(payloadJSON)
	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT INTO console_mutation_receipts`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*FOR UPDATE`).
		WithArgs("tenant-1", "connector-runtime.enrollment.issue", "issue-1").
		WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "request_sha256", "status", "result_json"}).
			AddRow("550e8400-e29b-41d4-a716-446655440099", hex.EncodeToString(requestHash[:]), "processing", nil))
	mock.ExpectExec(`(?s)UPDATE connector_runtime_enrollments.*status='revoked'`).
		WithArgs("tenant-1", "console-prod").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO connector_runtime_enrollments`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "tenant-1", "console-prod", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO operation_logs`).
		WithArgs(
			"connector_runtime", "issue_enrollment", "connector_runtime_enrollment",
			sqlmock.AnyArg(), "human", "admin-1", "request-1", excludesEnrollmentSecret{},
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE console_mutation_receipts.*status='succeeded'`).
		WithArgs(excludesEnrollmentSecret{}, "550e8400-e29b-41d4-a716-446655440099").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := adapter.IssueConnectorRuntimeEnrollment(
		context.Background(),
		"console-prod",
		ConnectorRuntimeMutationMeta{
			IdempotencyKey: "issue-1",
			RequestID:      "request-1",
			ActorID:        "admin-1",
		},
	)
	if err != nil {
		t.Fatalf("IssueConnectorRuntimeEnrollment: %v", err)
	}
	code, _ := result["enrollmentCode"].(string)
	if !connectorRuntimeEnrollmentCode.MatchString(code) {
		t.Fatalf("invalid one-time enrollment code: %#v", result)
	}
	if result["enrollmentCodeLast4"] != code[len(code)-4:] {
		t.Fatalf("last4 mismatch: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestConnectorRuntimePublicKeyRequiresRSA3072(t *testing.T) {
	for _, bits := range []int{2048, 3072} {
		privateKey, err := rsa.GenerateKey(rand.Reader, bits)
		if err != nil {
			t.Fatal(err)
		}
		encoded, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
		if err != nil {
			t.Fatal(err)
		}
		publicPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: encoded}))
		_, _, err = validateConnectorRuntimePublicKey(publicPEM)
		if bits == 2048 && err == nil {
			t.Fatal("RSA-2048 public key must be rejected")
		}
		if bits == 3072 && err != nil {
			t.Fatalf("RSA-3072 public key rejected: %v", err)
		}
	}
}

func TestRecordConnectorRuntimeHeartbeatBindsVerifiedIdentityAndBoundsMetrics(t *testing.T) {
	database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := NewWithDB(config.ConsoleConfig{}, "tenant-1", database)

	startedAt := time.Date(2026, 7, 17, 13, 0, 0, 0, time.UTC)
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT status FROM connector_runtime_instances.*FOR UPDATE`).
		WithArgs("connector-runtime.console-prod", "tenant-1", "console-prod").
		WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("active"))
	mock.ExpectExec(`(?s)UPDATE connector_runtime_instances.*metrics_json`).
		WithArgs(
			"0.4.19",
			`["notifications.send@v1"]`,
			`{"available":true,"databaseBytes":0,"deliveries":{"failed":3,"partial_unknown":0,"processing":0,"succeeded":0},"peopleJobs":{"failed":0,"pending":0,"running":0,"success":0}}`,
			startedAt,
			"connector-runtime.console-prod",
		).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := adapter.RecordConnectorRuntimeHeartbeat(context.Background(), "console-prod", map[string]any{
		"connectorId":        "connector-runtime.console-prod",
		"verifiedClientCode": "connector-runtime.console-prod",
		"version":            "0.4.19",
		"capabilities":       []any{"notifications.send@v1"},
		"startedAt":          startedAt.Format(time.RFC3339),
		"metrics": map[string]any{
			"available":     true,
			"databaseBytes": float64(-1),
			"deliveries":    map[string]any{"failed": float64(3), "secret": float64(99)},
			"peopleJobs":    map[string]any{"pending": float64(100_000_001)},
		},
	})
	if err != nil {
		t.Fatalf("RecordConnectorRuntimeHeartbeat: %v", err)
	}
	if result["status"] != "active" || result["nextHeartbeatSeconds"] != 60 {
		t.Fatalf("unexpected heartbeat result: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
