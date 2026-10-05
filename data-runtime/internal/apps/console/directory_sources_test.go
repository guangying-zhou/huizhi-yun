package console

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/config"
)

func TestUpsertDirectorySourceCommitsCredentialBindingReceiptAndAuditAtomically(t *testing.T) {
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

	configBody := map[string]any{
		"corpId": "ww-test", "agentId": "1000001", "syncDepartmentId": 1,
	}
	configJSON, err := json.Marshal(configBody)
	if err != nil {
		t.Fatal(err)
	}
	payload := map[string]any{
		"providerCode": "wecom", "integrationName": "企业微信通讯录",
		"baseUrl": "https://qyapi.weixin.qq.com", "status": "active",
		"config": json.RawMessage(configJSON), "credentialSupplied": true,
		"secretCode": "directory.wecom.contact_secret", "storageBackend": "env_ref",
	}
	encodedPayload, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	requestHash := sha256.Sum256(encodedPayload)
	now := time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC)

	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT INTO console_mutation_receipts`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*console_mutation_receipts.*FOR UPDATE`).
		WithArgs("tenant-1", "console.directory-source.upsert", "source-save-1").
		WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "request_sha256", "status", "result_json"}).
			AddRow("550e8400-e29b-41d4-a716-446655440001", hex.EncodeToString(requestHash[:]), "processing", nil))
	mock.ExpectQuery(`SELECT id,current_credential_id FROM integrations`).
		WithArgs("directory.wecom").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`(?s)INSERT INTO integrations`).
		WillReturnResult(sqlmock.NewResult(10, 1))
	mock.ExpectQuery(`(?s)SELECT id,current_version_id,usage_type,owner_type,owner_key.*FROM vault_secrets`).
		WithArgs("directory.wecom.contact_secret").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`(?s)INSERT INTO vault_secrets`).
		WillReturnResult(sqlmock.NewResult(20, 1))
	mock.ExpectQuery(`SELECT COALESCE\(MAX\(version_no\),0\)\+1 FROM vault_secret_versions`).
		WithArgs(uint64(20)).
		WillReturnRows(sqlmock.NewRows([]string{"version_no"}).AddRow(1))
	mock.ExpectExec(`(?s)UPDATE vault_secret_versions.*status='retired'`).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`(?s)INSERT INTO vault_secret_versions`).
		WillReturnResult(sqlmock.NewResult(30, 1))
	mock.ExpectExec(`(?s)UPDATE vault_secrets SET.*current_version_id`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO vault_access_logs`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT COALESCE\(MAX\(version_no\),0\)\+1 FROM integration_credentials`).
		WithArgs(uint64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"version_no"}).AddRow(1))
	mock.ExpectExec(`UPDATE integration_credentials SET status='inactive'`).
		WithArgs(uint64(10)).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`(?s)INSERT INTO integration_credentials`).
		WillReturnResult(sqlmock.NewResult(40, 1))
	mock.ExpectExec(`UPDATE integrations SET current_credential_id`).
		WithArgs(int64(40), uint64(10)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT.*FROM integrations i.*WHERE i.integration_code=\? LIMIT 1`).
		WithArgs("directory.wecom").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "integration_code", "integration_type", "integration_name", "provider_code",
			"base_url", "config_json", "connectivity_status", "last_checked_at",
			"last_error_message", "status", "current_credential_id", "secret_code",
			"secret_ref", "storage_backend", "backend_secret_ref", "credential_status",
			"created_at", "updated_at",
		}).AddRow(
			10, "directory.wecom", "directory_source", "企业微信通讯录", "wecom",
			"https://qyapi.weixin.qq.com", configJSON, "unknown", nil, nil, "active", 40,
			"directory.wecom.contact_secret", "hzybase://vault/directory.wecom.contact_secret",
			"env_ref", "WECOM_CONTACT_SECRET", "active", now, now,
		))
	mock.ExpectExec(`(?s)INSERT INTO operation_logs`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE console_mutation_receipts.*status='succeeded'`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := adapter.UpsertDirectorySource(context.Background(), "wecom", map[string]any{
		"integrationName": "企业微信通讯录",
		"baseUrl":         "https://qyapi.weixin.qq.com",
		"status":          "active",
		"config":          configBody,
		"credential": map[string]any{
			"secretCode":       "directory.wecom.contact_secret",
			"storageBackend":   "env_ref",
			"backendSecretRef": "WECOM_CONTACT_SECRET",
		},
	}, MutationMeta{
		IdempotencyKey: "source-save-1", RequestID: "request-1", ActorID: "admin-1",
	})
	if err != nil {
		t.Fatalf("UpsertDirectorySource: %v", err)
	}
	if result["providerCode"] != "wecom" ||
		result["receiptId"] != "550e8400-e29b-41d4-a716-446655440001" {
		t.Fatalf("unexpected result: %#v", result)
	}
	encodedResult, _ := json.Marshal(result)
	if containsString(string(encodedResult), "WECOM_CONTACT_SECRET") {
		t.Fatalf("backend secret reference leaked in response: %s", encodedResult)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDirectoryConnectorConfigurationEncryptsVaultSecretForRegisteredConnector(t *testing.T) {
	database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	adapter := NewWithDB(config.ConsoleConfig{VaultMasterKey: key}, "tenant-1", database)
	privateKey, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		t.Fatal(err)
	}
	publicDER, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	publicPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER}))
	material, err := adapter.encryptVaultPlaintext("bind-password-value")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 17, 12, 30, 0, 0, time.UTC)
	sourceConfig, _ := json.Marshal(map[string]any{
		"managementMode": "managed", "directoryType": "openldap",
		"host": "ldap.internal", "port": 636, "transport": "ldaps",
		"baseDN": "dc=example,dc=com", "userBase": "ou=people,dc=example,dc=com",
		"bindDN": "cn=service,dc=example,dc=com", "syncIntervalSeconds": 300,
		"pageSize": 500, "useTLS": true,
	})

	mock.ExpectQuery(`(?s)SELECT public_key_pem.*FROM directory_connectors`).
		WithArgs("connector-1", "tenant-1", "deployment-1").
		WillReturnRows(sqlmock.NewRows([]string{"public_key_pem"}).AddRow(publicPEM))
	mock.ExpectQuery(`(?s)SELECT.*FROM integrations i.*WHERE i.integration_code=\? LIMIT 1`).
		WithArgs("directory.ldap").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "integration_code", "integration_type", "integration_name", "provider_code",
			"base_url", "config_json", "connectivity_status", "last_checked_at",
			"last_error_message", "status", "current_credential_id", "secret_code",
			"secret_ref", "storage_backend", "backend_secret_ref", "credential_status",
			"created_at", "updated_at",
		}).AddRow(
			10, "directory.ldap", "directory_source", "LDAP 目录源", "ldap",
			nil, sourceConfig, "healthy", nil, nil, "active", 40,
			"directory.ldap.bind_password", "hzybase://vault/directory.ldap.bind_password",
			"db_encrypted", nil, "active", now, now,
		))
	mock.ExpectQuery(`(?s)SELECT.*FROM vault_secrets vs.*INNER JOIN vault_secret_versions`).
		WithArgs("directory.ldap.bind_password").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "secret_code", "secret_ref", "secret_name", "secret_type", "usage_type",
			"owner_type", "owner_key", "storage_backend", "reveal_policy", "masked_preview",
			"status", "current_version_id", "version_id", "version_no", "ciphertext_blob",
			"backend_secret_ref", "content_hash", "encryption_scheme",
		}).AddRow(
			20, "directory.ldap.bind_password", "hzybase://vault/directory.ldap.bind_password",
			"LDAP Bind", "client_secret", "integration", "integration", "directory.ldap",
			"db_encrypted", "approval", "bind****alue", "active", 30, 30, 1,
			material.CiphertextBlob, nil, material.ContentHash, material.EncryptionScheme,
		))
	mock.ExpectExec(`(?s)INSERT INTO vault_access_logs`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE directory_connectors.*last_seen_at`).
		WithArgs("connector-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	result, err := adapter.DirectoryConnectorConfiguration(
		context.Background(), "connector-1", "tenant-1", "deployment-1",
	)
	if err != nil {
		t.Fatalf("DirectoryConnectorConfiguration: %v", err)
	}
	encodedCiphertext, _ := result["bindPasswordCiphertext"].(string)
	ciphertext, err := base64.StdEncoding.DecodeString(encodedCiphertext)
	if err != nil {
		t.Fatal(err)
	}
	plaintext, err := rsa.DecryptOAEP(sha256.New(), rand.Reader, privateKey, ciphertext, nil)
	if err != nil {
		t.Fatal(err)
	}
	if string(plaintext) != "bind-password-value" {
		t.Fatalf("unexpected decrypted secret: %q", plaintext)
	}
	if result["host"] != "ldap.internal" || result["bindDN"] != "cn=service,dc=example,dc=com" {
		t.Fatalf("unexpected configuration: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDirectorySourceConfigRejectsEmbeddedSecrets(t *testing.T) {
	_, _, err := normalizeDirectorySourceConfig(map[string]any{
		"host":   "ldap.internal",
		"nested": map[string]any{"bindPassword": "must-not-be-stored"},
	})
	if err == nil {
		t.Fatal("expected embedded secret config to be rejected")
	}
}
