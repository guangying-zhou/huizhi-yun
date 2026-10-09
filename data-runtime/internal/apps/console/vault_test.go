package console

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/config"
)

func TestCreateVaultSecretCommitsCiphertextReceiptAndAuditAtomically(t *testing.T) {
	database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	adapter := NewWithDB(config.ConsoleConfig{VaultMasterKey: key}, "tenant-1", database)

	originalIDGenerator := newMutationReceiptID
	newMutationReceiptID = func() (string, error) {
		return "550e8400-e29b-41d4-a716-446655440000", nil
	}
	t.Cleanup(func() { newMutationReceiptID = originalIDGenerator })

	payload := map[string]any{
		"secretCode": "directory.ldap.bind_password", "secretName": "LDAP Bind",
		"secretType": "client_secret", "usageType": "integration",
		"ownerType": "integration", "ownerKey": "directory.ldap",
		"storageBackend": "db_encrypted", "revealPolicy": "approval",
		"expiresAt": nil, "materialSupplied": true,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	requestHash := sha256.Sum256(encoded)

	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT INTO console_mutation_receipts`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*console_mutation_receipts.*FOR UPDATE`).
		WithArgs("tenant-1", "console.vault.secret.create", "vault-create-1").
		WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "request_sha256", "status", "result_json"}).
			AddRow("550e8400-e29b-41d4-a716-446655440000", hex.EncodeToString(requestHash[:]), "processing", nil))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM vault_secrets`).
		WithArgs("directory.ldap.bind_password", "hzybase://vault/directory.ldap.bind_password").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectExec(`(?s)INSERT INTO vault_secrets`).
		WillReturnResult(sqlmock.NewResult(11, 1))
	mock.ExpectExec(`(?s)INSERT INTO vault_secret_versions`).
		WillReturnResult(sqlmock.NewResult(21, 1))
	mock.ExpectExec(`(?s)UPDATE vault_secrets.*current_version_id`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO vault_access_logs`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO operation_logs`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE console_mutation_receipts.*status='succeeded'`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := adapter.CreateVaultSecret(context.Background(), map[string]any{
		"secretCode": "directory.ldap.bind_password", "secretName": "LDAP Bind",
		"secretType": "client_secret", "usageType": "integration",
		"ownerType": "integration", "ownerKey": "directory.ldap",
		"storageBackend": "db_encrypted", "revealPolicy": "approval",
		"material": map[string]any{"plaintext": "tenant-secret-value"},
	}, MutationMeta{
		IdempotencyKey: "vault-create-1", RequestID: "request-1", ActorID: "admin-1",
	})
	if err != nil {
		t.Fatalf("CreateVaultSecret: %v", err)
	}
	if result["secretCode"] != "directory.ldap.bind_password" ||
		result["receiptId"] != "550e8400-e29b-41d4-a716-446655440000" {
		t.Fatalf("result = %#v", result)
	}
	if encodedResult, _ := json.Marshal(result); string(encodedResult) == "" ||
		containsString(string(encodedResult), "tenant-secret-value") {
		t.Fatalf("plaintext leaked in response: %s", encodedResult)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func containsString(value string, needle string) bool {
	for index := 0; index+len(needle) <= len(value); index++ {
		if value[index:index+len(needle)] == needle {
			return true
		}
	}
	return false
}
