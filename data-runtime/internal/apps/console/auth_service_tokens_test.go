package console

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestConsoleRuntimeServiceDeploymentUsesAuthenticatedBinding(t *testing.T) {
	for _, deployment := range []string{"wiztek-test-console", "tenant-console-prod", "C000001-console", ""} {
		if got := consoleRuntimeServiceDeployment(" " + deployment + " "); got != deployment {
			t.Fatalf("deployment = %q, want authenticated binding %q", got, deployment)
		}
	}
}

func TestServiceClientSecretMatchesHashOnlyMaterial(t *testing.T) {
	adapter := &Adapter{}
	secret := "hzy_cr_test_secret"
	digest := sha256.Sum256([]byte(secret))
	contentHash := "sha256_" + hex.EncodeToString(digest[:])

	if !adapter.serviceClientSecretMatches(
		"db_encrypted", "sha256-only", nil, "hash-only", contentHash, secret,
	) {
		t.Fatal("expected the enrolled secret digest to match")
	}
	if adapter.serviceClientSecretMatches(
		"db_encrypted", "sha256-only", nil, "hash-only", contentHash, secret+"-wrong",
	) {
		t.Fatal("a different secret must not match the enrolled digest")
	}
}

func TestServiceClientSecretRejectsMalformedHashOnlyMaterial(t *testing.T) {
	adapter := &Adapter{}
	for _, contentHash := range []string{"", "sha256_not-hex", "sha256_00"} {
		if adapter.serviceClientSecretMatches(
			"db_encrypted", "sha256-only", nil, "hash-only", contentHash, "secret",
		) {
			t.Fatalf("malformed content hash %q must fail closed", contentHash)
		}
	}
}

func TestServiceClientSemanticScopeRequiresExactAudienceBinding(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := &Adapter{db: database}
	subject := consumedServiceClient{
		ServiceClientID: 64,
		CredentialID:    4,
		ClientID:        "workflow.runtime",
		ClientCode:      "workflow.runtime",
		ClientName:      "Workflow Runtime",
		ClientType:      "runtime",
		AppCode:         sql.NullString{String: "workflow", Valid: true},
	}
	grantPolicy := `{"audience":"aims","semanticScope":"workflow:callback"}`
	mock.ExpectQuery(`(?s)SELECT resource_code,action,scope_json.*FROM service_client_grants`).
		WithArgs(uint64(64)).
		WillReturnRows(sqlmock.NewRows([]string{"resource_code", "action", "scope_json"}).
			AddRow("workflow", "callback", grantPolicy))
	mock.ExpectExec(`(?s)UPDATE service_client_grants.*last_used_at=UTC_TIMESTAMP`).
		WithArgs(uint64(64), "workflow", "callback").
		WillReturnResult(sqlmock.NewResult(0, 1))

	result, err := adapter.authorizeServiceClientScopes(
		context.Background(), subject, "aims", "workflow:callback",
	)
	if err != nil {
		t.Fatalf("authorizeServiceClientScopes: %v", err)
	}
	if result["scope"] != "workflow:callback" {
		t.Fatalf("scope=%v, want workflow:callback", result["scope"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestServiceClientSemanticScopeRejectsDifferentAudience(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := &Adapter{db: database}
	subject := consumedServiceClient{ServiceClientID: 64}
	mock.ExpectQuery(`(?s)SELECT resource_code,action,scope_json.*FROM service_client_grants`).
		WithArgs(uint64(64)).
		WillReturnRows(sqlmock.NewRows([]string{"resource_code", "action", "scope_json"}).
			AddRow("workflow", "callback", `{"audience":"people","semanticScope":"workflow:callback"}`))

	if _, err := adapter.authorizeServiceClientScopes(
		context.Background(), subject, "aims", "workflow:callback",
	); err == nil || !strings.Contains(err.Error(), "scope does not match audience") {
		t.Fatalf("error=%v, want audience mismatch", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
