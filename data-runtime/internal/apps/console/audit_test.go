package console

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/config"
)

func TestAppendLoginLogPersistsProviderAndAllowsDistinctTargetApp(t *testing.T) {
	database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := NewWithDB(config.ConsoleConfig{}, "tenant-1", database)

	originalIDGenerator := newMutationReceiptID
	newMutationReceiptID = func() (string, error) {
		return "550e8400-e29b-41d4-a716-446655440001", nil
	}
	t.Cleanup(func() { newMutationReceiptID = originalIDGenerator })

	body := map[string]any{
		"uid": "U1001", "identityId": 44, "targetApp": "aims",
		"authProvider": "wecom", "loginType": "wecom", "loginResult": 1,
		"ipAddress": "203.0.113.8", "location": "Halifax",
		"device": "Desktop", "browser": "Chrome", "os": "macOS",
		"sessionId": "session-1",
	}
	payload := map[string]any{
		"uid": stringPointer("U1001"), "identityId": 44,
		"targetApp": "aims", "authProvider": "wecom",
		"loginType": "wecom", "loginResult": 1,
		"failureReason": (*string)(nil), "sessionId": stringPointer("session-1"),
		"ipAddress": stringPointer("203.0.113.8"), "location": stringPointer("Halifax"),
		"device": stringPointer("Desktop"), "browser": stringPointer("Chrome"),
		"os": stringPointer("macOS"),
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(encoded)
	requestHash := hex.EncodeToString(digest[:])

	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT INTO console_mutation_receipts`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*console_mutation_receipts.*FOR UPDATE`).
		WithArgs("tenant-1", "console.audit.login.append", "login-event-1").
		WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "request_sha256", "status", "result_json"}).
			AddRow("550e8400-e29b-41d4-a716-446655440001", requestHash, "processing", nil))
	mock.ExpectExec(`(?s)INSERT INTO auth_login_events.*identity_id.*auth_provider`).
		WithArgs(
			"U1001", 44, "aims", "wecom", "wecom", "success",
			nil, "203.0.113.8", "Halifax", "Desktop", "Chrome", "macOS", "session-1",
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE console_mutation_receipts.*status='succeeded'`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := adapter.AppendLoginLog(context.Background(), body, AuditMutationMeta{
		IdempotencyKey: "login-event-1",
		RequestID:      "request-1",
		ActorType:      "service",
		ActorID:        "console.runtime",
		SourceApp:      "console",
	})
	if err != nil {
		t.Fatalf("AppendLoginLog: %v", err)
	}
	if replayed, _ := result["replayed"].(bool); replayed {
		t.Fatalf("unexpected replay result: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAppendLoginLogRejectsInvalidIdentityID(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := NewWithDB(config.ConsoleConfig{}, "tenant-1", database)

	_, err = adapter.AppendLoginLog(context.Background(), map[string]any{
		"identityId": -1, "targetApp": "console", "authProvider": "local",
		"loginType": "password", "loginResult": 0,
	}, AuditMutationMeta{
		IdempotencyKey: "login-event-invalid",
		ActorType:      "service",
		ActorID:        "console.runtime",
		SourceApp:      "console",
	})
	if err == nil {
		t.Fatal("expected invalid identityId to be rejected")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func stringPointer(value string) *string {
	return &value
}
