package directory

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestRedeemConnectorEnrollmentVerifiesPlatformSignatureAndCommitsAtomically(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := newAdapter(db, false, "tenant-1", "", "")

	platformPublicKey, platformPrivateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	platformKeyDER, err := x509.MarshalPKIXPublicKey(platformPublicKey)
	if err != nil {
		t.Fatal(err)
	}
	platformKeyPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: platformKeyDER}))

	connectorPrivateKey, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		t.Fatal(err)
	}
	connectorKeyDER, err := x509.MarshalPKIXPublicKey(&connectorPrivateKey.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	connectorKeyPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: connectorKeyDER}))

	now := time.Now().UTC()
	payload := connectorEnrollmentPayload{
		JTI:            "550e8400-e29b-41d4-a716-446655440000",
		TenantCode:     "tenant-1",
		DeploymentCode: "console-prod",
		RuntimeCode:    "runtime-prod",
		IssuedAt:       now.Add(-time.Minute).Format(time.RFC3339),
		ExpiresAt:      now.Add(time.Hour).Format(time.RFC3339),
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	tokenJSON, err := json.Marshal(signedConnectorEnrollment{
		SchemaVersion: "directory-connector-enrollment.v1",
		Payload:       payloadJSON,
		Signature:     base64.RawURLEncoding.EncodeToString(ed25519.Sign(platformPrivateKey, payloadJSON)),
		Kid:           "psk-test",
		Alg:           "Ed25519",
	})
	if err != nil {
		t.Fatal(err)
	}

	mock.ExpectBegin()
	mock.ExpectExec(`(?s)INSERT IGNORE INTO directory_connector_enrollments`).
		WithArgs(payload.JTI, "tenant-1", "console-prod", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO directory_connectors`).
		WithArgs(
			"directory-connector.console-prod", "tenant-1", "console-prod",
			strings.TrimSpace(connectorKeyPEM), `["ldap","password.write"]`, "0.3.114",
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO operation_logs`).
		WithArgs("directory-connector.console-prod", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	result, err := adapter.RedeemConnectorEnrollment(
		context.Background(),
		map[string]any{
			"enrollmentToken": string(tokenJSON),
			"publicKeyPem":    connectorKeyPEM,
			"version":         "0.3.114",
			"capabilities":    []any{"ldap", "password.write", "ldap"},
		},
		"tenant-1",
		"console-prod",
		"psk-test",
		platformKeyPEM,
	)
	if err != nil {
		t.Fatalf("RedeemConnectorEnrollment: %v", err)
	}
	if result["connectorId"] != "directory-connector.console-prod" ||
		result["transport"] != "tenant-runtime-loopback-signature" {
		t.Fatalf("result = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
