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
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const testSigningSID = "sha256_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

func signingAdapter(t *testing.T) (*Adapter, sqlmock.Sqlmock) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	jwk := oidcSigningJWK{
		Kty: "OKP", Crv: "Ed25519", X: base64.RawURLEncoding.EncodeToString(publicKey),
		Kid: "csk_authority_test", Alg: "EdDSA", Use: "sig",
	}
	private := jwk
	private.D = base64.RawURLEncoding.EncodeToString(privateKey.Seed())
	privateJSON, _ := json.Marshal(private)
	t.Setenv("TEST_TENANT_RUNTIME_OIDC_PRIVATE_JWK", string(privateJSON))
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	return NewWithDB(config.ConsoleConfig{}, "tenant-a", database), mock
}

func userSigningBody(sid, sub, uid string) map[string]any {
	return map[string]any{
		"ttlSeconds": 300,
		"claims": map[string]any{
			"iss": "https://console.example.test", "sub": sub, "aud": "aims",
			"deployment": "tenant-a-aims", "sid": sid, "token_use": "access",
			"hzy": map[string]any{"uid": uid, "subjectType": "user", "subjectCode": uid},
		},
	}
}

func assertSigningForbidden(t *testing.T, err error, code string) {
	t.Helper()
	var known httperror.Error
	if !errors.As(err, &known) {
		t.Fatalf("expected an httperror, got %v", err)
	}
	if known.Status != http.StatusForbidden || known.Code != code {
		t.Fatalf("status/code = %d/%s, want 403/%s", known.Status, known.Code, code)
	}
}

// A workload holding the signing capability may ask for a token; it must not be
// able to assert a session that this Runtime cannot confirm.
func TestUserTokenSigningRejectsUnknownOrRevokedSession(t *testing.T) {
	adapter, mock := signingAdapter(t)
	mock.ExpectQuery(`(?s)SELECT ls.uid.*FROM local_sessions ls`).
		WithArgs(testSigningSID).
		WillReturnRows(sqlmock.NewRows([]string{"uid"}))
	_, err := adapter.SignOIDCToken(context.Background(), userSigningBody(testSigningSID, "user:u1001", "u1001"), AuditMutationMeta{ActorID: "console.runtime"})
	assertSigningForbidden(t, err, "oidc_signing_session_not_active")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The session decides the subject. sub and hzy.uid are both read by consumers,
// so neither may disagree with the session the token claims to represent.
func TestUserTokenSigningRejectsSubjectThatDoesNotMatchTheSession(t *testing.T) {
	for name, body := range map[string]map[string]any{
		"hzy.uid impersonates another user": userSigningBody(testSigningSID, "user:u1001", "u2002"),
		"sub impersonates another user":     userSigningBody(testSigningSID, "user:u2002", "u1001"),
	} {
		t.Run(name, func(t *testing.T) {
			adapter, mock := signingAdapter(t)
			mock.ExpectQuery(`(?s)SELECT ls.uid.*FROM local_sessions ls`).
				WithArgs(testSigningSID).
				WillReturnRows(sqlmock.NewRows([]string{"uid"}).AddRow("u1001"))
			_, err := adapter.SignOIDCToken(context.Background(), body, AuditMutationMeta{ActorID: "console.runtime"})
			assertSigningForbidden(t, err, "oidc_signing_session_subject_mismatch")
		})
	}
}

func serviceSigningBody(scope string) map[string]any {
	return map[string]any{
		"ttlSeconds": 300,
		"claims": map[string]any{
			"iss": "https://console.example.test", "sub": "client:aims-runtime", "aud": "assets",
			"deployment": "tenant-a-assets", "token_use": "service",
			"client_id": "aims-runtime-client", "scope": scope,
			"hzy": map[string]any{
				"subjectType": "service", "subjectCode": "aims-runtime",
				"clientCode": "aims-runtime", "credentialId": 42,
			},
		},
	}
}

func expectServiceCredential(mock sqlmock.Sqlmock, status string) {
	mock.ExpectQuery(`(?s)FROM service_client_credentials scc`).
		WithArgs(int64(42), "aims-runtime-client").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "status", "current_credential_id", "scc.status", "expires_at",
		}).AddRow(9, status, 42, status, nil))
}

// The credential and grant state that guards consumption must also guard
// issuance: a revoked credential cannot be minted into a fresh token.
func TestServiceTokenSigningRejectsInactiveCredential(t *testing.T) {
	adapter, mock := signingAdapter(t)
	expectServiceCredential(mock, "revoked")
	_, err := adapter.SignOIDCToken(context.Background(), serviceSigningBody("assets:product:read"), AuditMutationMeta{ActorID: "console.runtime"})
	assertSigningForbidden(t, err, "oidc_signing_service_state_inactive")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Every requested scope needs its own active grant; a signing request cannot
// widen what the service client was actually granted.
func TestServiceTokenSigningRejectsUngrantedScope(t *testing.T) {
	adapter, mock := signingAdapter(t)
	expectServiceCredential(mock, "active")
	mock.ExpectQuery(`(?s)FROM service_client_grants`).
		WithArgs(uint64(9)).
		WillReturnRows(sqlmock.NewRows([]string{"resource_code", "action"}).AddRow("product", "read"))
	_, err := adapter.SignOIDCToken(context.Background(), serviceSigningBody("assets:product:read assets:product:write"), AuditMutationMeta{ActorID: "console.runtime"})
	assertSigningForbidden(t, err, "oidc_signing_service_state_inactive")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
