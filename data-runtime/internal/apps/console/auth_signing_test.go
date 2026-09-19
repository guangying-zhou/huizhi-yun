package console

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestSignOIDCTokenKeepsPrivateKeyInRuntimeAndPinsTenant(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	kid := "csk_runtime_test"
	publicJWK := oidcSigningJWK{
		Kty: "OKP", Crv: "Ed25519", X: base64.RawURLEncoding.EncodeToString(publicKey),
		Kid: kid, Alg: "EdDSA", Use: "sig",
	}
	privateJWK := publicJWK
	privateJWK.D = base64.RawURLEncoding.EncodeToString(privateKey.Seed())
	publicJSON, _ := json.Marshal(publicJWK)
	privateJSON, _ := json.Marshal(privateJWK)
	t.Setenv("TEST_TENANT_RUNTIME_OIDC_PRIVATE_JWK", string(privateJSON))

	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	// Issuance is authorized from the live session before any key is touched.
	mock.ExpectQuery(`(?s)SELECT ls.uid.*FROM local_sessions ls`).
		WithArgs("sha256_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").
		WillReturnRows(sqlmock.NewRows([]string{"uid"}).AddRow("u1001"))
	mock.ExpectQuery(`(?s)SELECT id,kid,alg,use_type,public_jwk_json,private_key_ref.*FROM auth_signing_keys`).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "kid", "alg", "use_type", "public_jwk_json", "private_key_ref",
		}).AddRow(7, kid, "EdDSA", "sig", string(publicJSON), "env:TEST_TENANT_RUNTIME_OIDC_PRIVATE_JWK"))

	adapter := NewWithDB(config.ConsoleConfig{}, "tenant-a", database)
	result, err := adapter.SignOIDCToken(context.Background(), map[string]any{
		"ttlSeconds": 300,
		"claims": map[string]any{
			"iss": "https://console.example.test", "sub": "user:u1001", "aud": "aims",
			"tenant": "forged-tenant", "deployment": "tenant-a-aims",
			"sid":       "sha256_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"token_use": "access",
			"hzy":       map[string]any{"uid": "u1001", "subjectType": "user", "subjectCode": "u1001"},
		},
	}, AuditMutationMeta{ActorID: "console.runtime"})
	if err != nil {
		t.Fatalf("SignOIDCToken: %v", err)
	}
	rawToken, _ := result["token"].(string)
	parsed, err := jwt.Parse(rawToken, func(token *jwt.Token) (any, error) {
		return publicKey, nil
	}, jwt.WithValidMethods([]string{"EdDSA"}))
	if err != nil || !parsed.Valid {
		t.Fatalf("signed token is invalid: %v", err)
	}
	claims := parsed.Claims.(jwt.MapClaims)
	if claims["tenant"] != "tenant-a" {
		t.Fatalf("tenant claim = %v, want tenant-a", claims["tenant"])
	}
	if parsed.Header["kid"] != kid || parsed.Header["typ"] != "JWT" {
		t.Fatalf("unexpected protected header: %#v", parsed.Header)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOIDCSigningRejectsUnapprovedClaims(t *testing.T) {
	adapter := NewWithDB(config.ConsoleConfig{}, "tenant-a", nil)
	_, err := adapter.normalizeOIDCSigningClaims(map[string]any{
		"iss": "https://console.example.test", "sub": "user:u1001", "aud": "aims",
		"sid":       "sha256_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"token_use": "access", "private_key": "must-not-pass",
		"hzy": map[string]any{"uid": "u1001"},
	})
	if err == nil {
		t.Fatal("normalizeOIDCSigningClaims accepted an unapproved claim")
	}
}

func TestOIDCSigningRejectsUnapprovedNestedHZYClaims(t *testing.T) {
	adapter := NewWithDB(config.ConsoleConfig{}, "tenant-a", nil)
	baseUser := map[string]any{
		"iss": "https://console.example.test", "sub": "user:u1001", "aud": "aims",
		"deployment": "tenant-a-aims",
		"sid":        "sha256_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"token_use":  "access",
		"hzy": map[string]any{
			"uid": "u1001", "subjectType": "user", "subjectCode": "u1001",
		},
	}
	for _, forbidden := range []string{"credentialId", "clientCode", "privateKey", "roles"} {
		claims := cloneSigningClaims(baseUser)
		claims["hzy"].(map[string]any)[forbidden] = "forged"
		_, err := adapter.normalizeOIDCSigningClaims(claims)
		assertHTTPErrorCode(t, err, http.StatusBadRequest, "oidc_signing_hzy_claim_not_allowed")
	}

	baseService := map[string]any{
		"iss": "https://console.example.test", "sub": "client:console.runtime", "aud": "data-runtime",
		"client_id": "console.runtime", "scope": "data-runtime:runtime:update",
		"deployment": "tenant-a-console", "token_use": "service",
		"hzy": map[string]any{
			"subjectType": "service", "subjectCode": "console.runtime",
			"clientCode": "console.runtime", "clientName": "Console Runtime",
			"clientType": "runtime", "appCode": "console", "credentialId": 7,
		},
	}
	for _, forbidden := range []string{"uid", "directorySnapshot", "secret"} {
		claims := cloneSigningClaims(baseService)
		claims["hzy"].(map[string]any)[forbidden] = "forged"
		_, err := adapter.normalizeOIDCSigningClaims(claims)
		assertHTTPErrorCode(t, err, http.StatusBadRequest, "oidc_signing_hzy_claim_not_allowed")
	}
}

func TestOIDCSigningPinsTenantAndRequiresDeploymentAndIdentityConsistency(t *testing.T) {
	adapter := NewWithDB(config.ConsoleConfig{}, "tenant-a", nil)
	valid := map[string]any{
		"iss": "https://console.example.test", "sub": "user:u1001", "aud": "aims",
		"tenant": "forged", "deployment": "tenant-a-aims",
		"sid":       "sha256_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"token_use": "access",
		"hzy":       map[string]any{"uid": "u1001", "subjectType": "user", "subjectCode": "u1001"},
	}
	normalized, err := adapter.normalizeOIDCSigningClaims(cloneSigningClaims(valid))
	if err != nil {
		t.Fatal(err)
	}
	if normalized["tenant"] != "tenant-a" {
		t.Fatalf("tenant = %v, want tenant-a", normalized["tenant"])
	}

	missingDeployment := cloneSigningClaims(valid)
	delete(missingDeployment, "deployment")
	_, err = adapter.normalizeOIDCSigningClaims(missingDeployment)
	assertHTTPErrorCode(t, err, http.StatusBadRequest, "oidc_signing_deployment_invalid")

	mismatchedSubject := cloneSigningClaims(valid)
	mismatchedSubject["hzy"].(map[string]any)["subjectCode"] = "u9999"
	_, err = adapter.normalizeOIDCSigningClaims(mismatchedSubject)
	assertHTTPErrorCode(t, err, http.StatusBadRequest, "oidc_signing_user_identity_invalid")
}

func TestConsoleRuntimeIssuedScopeAllowsOnlyExactDataRuntimeDerivation(t *testing.T) {
	tests := []struct {
		name       string
		audience   string
		authorized string
		requested  string
		want       string
		wantError  bool
	}{
		{"default exact grant", "connector-runtime", "connector-runtime:jobs:view", "", "connector-runtime:jobs:view", false},
		{"explicit exact grant", "connector-runtime", "connector-runtime:jobs:view", "connector-runtime:jobs:view", "connector-runtime:jobs:view", false},
		{"data runtime compatibility derivation", "data-runtime", "data-runtime:runtime:update", "runtime.update", "runtime.update", false},
		{"wrong audience", "tenant-runtime", "data-runtime:runtime:update", "runtime.update", "", true},
		{"unrelated scope", "data-runtime", "console:audit:view", "runtime.update", "", true},
		{"scope expansion", "data-runtime", "data-runtime:runtime:update", "runtime.admin", "", true},
	}
	for _, item := range tests {
		t.Run(item.name, func(t *testing.T) {
			got, err := resolveConsoleRuntimeIssuedScope(item.audience, item.authorized, item.requested)
			if item.wantError {
				assertHTTPErrorCode(t, err, http.StatusForbidden, "console_service_token_issued_scope_invalid")
				return
			}
			if err != nil || got != item.want {
				t.Fatalf("scope=%q err=%v, want %q", got, err, item.want)
			}
		})
	}
}

func TestConsoleRuntimeServiceScopesIncludeCutoverReadOnlyCapability(t *testing.T) {
	for _, scope := range consoleRuntimeServiceScopes {
		if scope == "console.schema.read" {
			return
		}
	}
	t.Fatal("Console Runtime service identity cannot mint the schema-read token required by the cutover verifier")
}

func TestConsoleRuntimeServiceScopesIncludeConnectorDirectoryProfileCallback(t *testing.T) {
	for _, scope := range consoleRuntimeServiceScopes {
		if scope == "console:directory-profiles:sync" {
			return
		}
	}
	t.Fatal("Console Runtime service identity cannot mint the Connector directory-profile callback token")
}

func TestConsoleRuntimeServiceScopesRoundTripThroughGrantStorage(t *testing.T) {
	for _, scope := range consoleRuntimeServiceScopes {
		resource, action, err := splitConsoleServiceScope(scope)
		if err != nil {
			t.Fatalf("scope %q cannot be stored as a service grant: %v", scope, err)
		}
		if got := joinConsoleServiceScope(resource, action); got != scope {
			t.Fatalf("scope %q round-tripped as %q", scope, got)
		}
	}
}

func cloneSigningClaims(input map[string]any) map[string]any {
	result := make(map[string]any, len(input))
	for key, value := range input {
		if nested, ok := value.(map[string]any); ok {
			copyNested := make(map[string]any, len(nested))
			for nestedKey, nestedValue := range nested {
				copyNested[nestedKey] = nestedValue
			}
			result[key] = copyNested
			continue
		}
		result[key] = value
	}
	return result
}

func assertHTTPErrorCode(t *testing.T, err error, status int, code string) {
	t.Helper()
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != status || httpErr.Code != code {
		t.Fatalf("error=%T %v, want status=%d code=%s", err, err, status, code)
	}
}

func TestVerifyOIDCServiceTokenStateRequiresCurrentCredentialAndAllGrants(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := NewWithDB(config.ConsoleConfig{}, "tenant-a", database)
	mock.ExpectQuery(`(?s)SELECT sc.id,sc.status,sc.current_credential_id,scc.status,scc.expires_at`).
		WithArgs(11, "console.runtime").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "status", "current_credential_id", "credential_status", "expires_at",
		}).AddRow(5, "active", 11, "active", nil))
	mock.ExpectQuery(`(?s)SELECT resource_code,action.*FROM service_client_grants`).
		WithArgs(uint64(5)).
		WillReturnRows(sqlmock.NewRows([]string{"resource_code", "action"}).
			AddRow("console", "auth-oidc:read").
			AddRow("workflow", "proxy"))

	result, err := adapter.VerifyOIDCServiceTokenState(context.Background(), map[string]any{
		"clientId": "console.runtime", "credentialId": 11,
		"scope": "console:auth-oidc:read workflow:proxy",
	})
	if err != nil {
		t.Fatalf("VerifyOIDCServiceTokenState: %v", err)
	}
	if active, _ := result["active"].(bool); !active {
		t.Fatalf("service token state = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
