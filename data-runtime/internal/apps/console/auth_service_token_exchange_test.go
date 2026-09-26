package console

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/golang-jwt/jwt/v5"
)

func exchangeTestBody() map[string]any {
	return map[string]any{
		"clientId": "aims.runtime", "clientSecret": "fixture-secret",
		"audience": "data-runtime", "scope": "aims:product:view",
		"issuer": "https://example.test/console", "ttlSeconds": 900,
		"sourceBinding": "service-client-policy", "policyVersion": "v7", "caps": "hash-7",
	}
}

func exchangeTestSubjectRows() *sqlmock.Rows {
	digest := sha256.Sum256([]byte("fixture-secret"))
	return sqlmock.NewRows([]string{
		"sc.id", "scc.id", "scc.client_id", "sc.client_code", "sc.client_name", "sc.client_type",
		"sc.app_code", "scc.expires_at", "vs.id", "vsv.id", "vs.storage_backend",
		"vsv.encryption_scheme", "vsv.ciphertext_blob", "vsv.backend_secret_ref", "vsv.content_hash",
	}).AddRow(10, 20, "aims.runtime", "aims.runtime", "Aims", "runtime", "aims", nil,
		30, 40, "db_encrypted", "sha256-only", []byte{}, "hash-only", "sha256_"+hex.EncodeToString(digest[:]))
}

func expectExchangeQueries(mock sqlmock.Sqlmock, policyVersion string, auditError error) {
	mock.ExpectBegin()
	mock.ExpectQuery("FROM service_client_credentials scc").WithArgs("aims.runtime").WillReturnRows(exchangeTestSubjectRows())
	mock.ExpectExec("INSERT INTO vault_access_logs").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("FROM service_client_grants").WithArgs(uint64(10)).WillReturnRows(
		sqlmock.NewRows([]string{"resource_code", "action", "scope_json"}).
			AddRow("aims:product", "view", `{"audience":"data-runtime","semanticScope":"aims:product:view","tenantCode":"C000001","deploymentCode":"C000001-test-aims"}`),
	)
	mock.ExpectExec("UPDATE service_client_grants").WithArgs(uint64(10), "aims:product", "view").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT bundle_version,bundle_hash FROM policy_bundle_snapshots").WithArgs("C000001", "C000001-test-console").WillReturnRows(
		sqlmock.NewRows([]string{"bundle_version", "bundle_hash"}).AddRow(policyVersion, "hash-7"),
	)
	if policyVersion != "v7" {
		mock.ExpectRollback()
		return
	}
	mock.ExpectQuery("SELECT id FROM auth_signing_keys").WithArgs(uint64(5)).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(5))
	mock.ExpectExec("UPDATE service_client_credentials").WithArgs(uint64(20)).WillReturnResult(sqlmock.NewResult(0, 1))
	audit := mock.ExpectExec("INSERT INTO auth_token_events").WithArgs("aims.runtime")
	if auditError != nil {
		audit.WillReturnError(auditError)
		mock.ExpectRollback()
	} else {
		audit.WillReturnResult(sqlmock.NewResult(1, 1))
		mock.ExpectCommit()
	}
}

func TestExchangeConsoleServiceClientTokenAuditAndPolicyAreAtomic(t *testing.T) {
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name       string
		version    string
		auditError error
		wantToken  bool
	}{
		{name: "success", version: "v7", wantToken: true},
		{name: "policy changed", version: "v8"},
		{name: "audit failed", version: "v7", auditError: errors.New("audit unavailable")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			database, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()
			adapter := &Adapter{db: database, tenant: "C000001"}
			expectExchangeQueries(mock, tc.version, tc.auditError)
			result, err := adapter.exchangeConsoleServiceClientTokenWithKey(context.Background(), exchangeTestBody(),
				"C000001", "C000001-test-console", oidcSigningKey{ID: 5, Kid: "test-kid", PrivateKey: privateKey})
			if tc.wantToken {
				if err != nil {
					t.Fatal(err)
				}
				claims := jwt.MapClaims{}
				parsed, err := jwt.ParseWithClaims(result["accessToken"].(string), claims, func(*jwt.Token) (any, error) {
					return privateKey.Public(), nil
				}, jwt.WithValidMethods([]string{"EdDSA"}))
				if err != nil || !parsed.Valid {
					t.Fatalf("issued token is invalid: %v", err)
				}
				for claim, expected := range map[string]string{
					"sub": "client:aims.runtime", "source_app": "aims", "tenant": "C000001",
					"deployment": "C000001-test-aims", "scope": "aims:product:view",
					"policy_ver": "v7", "caps": "hash-7",
				} {
					if claims[claim] != expected {
						t.Fatalf("claim %s = %v, want %s", claim, claims[claim], expected)
					}
				}
			} else if err == nil || result != nil {
				t.Fatalf("failed exchange returned a token: result=%v err=%v", result != nil, err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestExchangeConsoleServiceClientTokenRejectsUntrustedBindings(t *testing.T) {
	adapter := &Adapter{tenant: "C000001"}
	for _, field := range []string{"appCode", "app_code", "tenant", "deployment"} {
		body := exchangeTestBody()
		body[field] = "other"
		_, err := adapter.ExchangeConsoleServiceClientToken(context.Background(), body, "C000001", "C000001-test-console", AuditMutationMeta{})
		if err == nil || !strings.Contains(err.Error(), "source binding") {
			t.Fatalf("%s should be rejected before database work: %v", field, err)
		}
	}
	if _, err := adapter.ExchangeConsoleServiceClientToken(context.Background(), exchangeTestBody(), "other", "C000001-test-console", AuditMutationMeta{}); err == nil {
		t.Fatal("authenticated cross-tenant context must fail")
	}
}

func TestConsoleExchangeCallerRequiresLiveCredentialAndGrant(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := &Adapter{db: database}
	mock.ExpectQuery("FROM service_clients WHERE client_code").WithArgs("console.runtime").WillReturnRows(
		sqlmock.NewRows([]string{"id", "status", "app_code", "client_type", "current_credential_id"}).
			AddRow(1, "active", "console", "runtime", 2),
	)
	mock.ExpectQuery("FROM service_client_credentials scc").WithArgs(int64(2), uint64(1), "console.runtime").WillReturnRows(
		sqlmock.NewRows([]string{"id"}).AddRow(2),
	)
	mock.ExpectQuery("SELECT resource_code,action FROM service_client_grants").WithArgs(uint64(1)).WillReturnRows(
		sqlmock.NewRows([]string{"resource_code", "action"}).AddRow("console:service-token", "exchange"),
	)
	if err := adapter.VerifyConsoleExchangeCaller(context.Background(), 3); err == nil {
		t.Fatal("a different credential must be rejected")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestExchangeRejectsUnboundSelectedGrant(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := &Adapter{db: database, tenant: "C000001"}
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectBegin()
	mock.ExpectQuery("FROM service_client_credentials scc").WithArgs("aims.runtime").WillReturnRows(exchangeTestSubjectRows())
	mock.ExpectExec("INSERT INTO vault_access_logs").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("FROM service_client_grants").WithArgs(uint64(10)).WillReturnRows(
		sqlmock.NewRows([]string{"resource_code", "action", "scope_json"}).
			AddRow("aims:product", "view", `{"audience":"data-runtime","semanticScope":"aims:product:view"}`),
	)
	mock.ExpectRollback()
	result, err := adapter.exchangeConsoleServiceClientTokenWithKey(context.Background(), exchangeTestBody(),
		"C000001", "C000001-test-console", oidcSigningKey{ID: 5, Kid: "test-kid", PrivateKey: privateKey})
	if err == nil || result != nil {
		t.Fatalf("unbound grant issued token: result=%v err=%v", result != nil, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
