package server

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func assertOIDCTrustError(t *testing.T, err error, status int, code string) {
	t.Helper()
	var known httperror.Error
	if !errors.As(err, &known) || known.Status != status || known.Code != code {
		t.Fatalf("expected %d/%s: %v", status, code, err)
	}
}

func oidcTrustReceiptJSON(cfg config.Config, trust config.JWTConfig) string {
	fact := consoleapp.OIDCTrustFact{TenantCode: cfg.Tenant, DeploymentCode: cfg.DeploymentForApp("console"), RuntimeCode: cfg.Control.RuntimeCode, Issuer: trust.Issuer, Audience: trust.Audience, JWKSURL: trust.JWKSURL}
	raw, _ := json.Marshal(fact)
	digest := sha256.Sum256(raw)
	result, _ := json.Marshal(map[string]any{"fact": fact, "sha256": hex.EncodeToString(digest[:])})
	return string(result)
}

func TestSharedOIDCTrustStartupChecksLocalOverlay(t *testing.T) {
	shared := config.JWTConfig{Issuer: "https://tenant.example.test", Audience: "data-runtime", JWKSURL: "https://tenant.example.test/.well-known/jwks.json"}
	for _, tc := range []struct {
		name  string
		local *config.JWTConfig
		code  string
	}{
		{name: "missing overlay recovers only shared trust"},
		{name: "identical overlay", local: &shared},
		{name: "conflicting overlay", local: &config.JWTConfig{Issuer: "https://different.example.test", Audience: "data-runtime", JWKSURL: "https://different.example.test/.well-known/jwks.json"}, code: "console_oidc_bootstrap_jwt_trust_immutable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := config.Config{Tenant: "tenant-a", DeploymentBindings: map[string]string{"console": "console-a"}, Control: config.ControlConfig{RuntimeCode: "runtime-a", ConfigDir: t.TempDir()}}
			cfg.Auth.JWT = config.JWTConfig{Issuer: "https://old.example.test", JWKSJSON: `{"keys":[]}`}
			if tc.local != nil {
				if err := config.PersistJWTTrustOverlay(cfg.Control.ConfigDir, *tc.local); err != nil {
					t.Fatal(err)
				}
			}
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectQuery(`SELECT status,result_json FROM console_mutation_receipts`).WillReturnRows(sqlmock.NewRows([]string{"status", "result_json"}).AddRow("succeeded", oidcTrustReceiptJSON(cfg, shared)))
			adapter := consoleapp.NewWithDB(config.ConsoleConfig{}, cfg.Tenant, db)
			err = validateSharedOIDCTrust(context.Background(), adapter, &cfg)
			if tc.code != "" {
				assertOIDCTrustError(t, err, 409, tc.code)
				if cfg.Auth.JWT.Issuer != "https://old.example.test" {
					t.Fatal("mutated rejected config")
				}
			} else if err != nil {
				t.Fatal(err)
			} else if cfg.Auth.JWT.Issuer != shared.Issuer || cfg.Auth.JWT.JWKSJSON != "" {
				t.Fatal("shared trust did not replace unsafe default")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestOIDCBootstrapSharedConflictBeforeJTIAndKeys(t *testing.T) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKIXPublicKey(public)
	for _, localConflict := range []bool{false, true} {
		t.Run(map[bool]string{false: "second instance empty overlay", true: "local initialized overlay"}[localConflict], func(t *testing.T) {
			cfg := config.Config{Tenant: "tenant-a", DeploymentBindings: map[string]string{"console": "console-a"}, Control: config.ControlConfig{RuntimeCode: "runtime-a", ConfigDir: t.TempDir(), PlatformSigningKeyID: "psk_test", PlatformSigningPublicKey: string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))}}
			if localConflict {
				if err := config.PersistJWTTrustOverlay(cfg.Control.ConfigDir, config.JWTConfig{Issuer: "https://old.example.test", Audience: "data-runtime", JWKSURL: "https://old.example.test/.well-known/jwks.json"}); err != nil {
					t.Fatal(err)
				}
			}
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			if !localConflict {
				mock.ExpectBegin()
				mock.ExpectExec(`INSERT INTO console_mutation_receipts`).WillReturnResult(sqlmock.NewResult(0, 0))
				mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*FOR UPDATE`).WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "request_sha256", "status", "result_json"}).AddRow("existing", "different-canonical-hash", "succeeded", `{}`))
				mock.ExpectRollback()
			}
			s := &Server{cfg: cfg, console: consoleapp.NewWithDB(config.ConsoleConfig{}, cfg.Tenant, db), auth: auth.New(cfg)}
			body := signedConsoleVaultBootstrapEnvelope(t, private, "psk_test", map[string]any{
				"jti": "8a22952d-9467-40f3-bbca-4cfd8412fa86", "tenantCode": "tenant-a", "deploymentCode": "console-a", "runtimeCode": "runtime-a", "reason": "tenant-runtime-custody-cutover",
				"issuer": "https://new.example.test", "jwksUrl": "https://new.example.test/.well-known/jwks.json", "issuedAt": time.Now().UTC().Add(-time.Minute).Format(time.RFC3339), "expiresAt": time.Now().UTC().Add(5 * time.Minute).Format(time.RFC3339),
			})
			body["schemaVersion"] = "console-oidc-signing-bootstrap.v1"
			_, err = s.bootstrapConsoleOIDCSigningKey(context.Background(), body)
			assertOIDCTrustError(t, err, 409, "console_oidc_bootstrap_jwt_trust_immutable")
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
			if s.auth.TrustedJWTIssuer() != "" {
				t.Fatal("rejected request mutated memory")
			}
			local, present, err := config.ReadJWTTrustOverlay(cfg.Control.ConfigDir)
			if err != nil || present != localConflict || (present && local.Issuer != "https://old.example.test") {
				t.Fatal("rejected request mutated disk")
			}
		})
	}
}

func TestSharedOIDCTrustStartupPinsExistingOverlayBeforeServing(t *testing.T) {
	cfg := config.Config{Tenant: "tenant-a", DeploymentBindings: map[string]string{"console": "console-a"}, Control: config.ControlConfig{RuntimeCode: "runtime-a", ConfigDir: t.TempDir()}}
	local := config.JWTConfig{Issuer: "https://tenant.example.test", Audience: "data-runtime", JWKSURL: "https://tenant.example.test/.well-known/jwks.json"}
	if err := config.PersistJWTTrustOverlay(cfg.Control.ConfigDir, local); err != nil {
		t.Fatal(err)
	}
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(`SELECT status,result_json FROM console_mutation_receipts`).WillReturnRows(sqlmock.NewRows([]string{"status", "result_json"}))
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO console_mutation_receipts`).WillReturnResult(sqlmock.NewResult(1, 1))
	// A racing instance has pinned different trust; this startup must not expose
	// the locally configured root or overwrite that shared receipt.
	mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*FOR UPDATE`).WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "request_sha256", "status", "result_json"}).AddRow("existing", "other-root-hash", "succeeded", `{}`))
	mock.ExpectRollback()
	adapter := consoleapp.NewWithDB(config.ConsoleConfig{}, cfg.Tenant, db)
	err = validateSharedOIDCTrust(context.Background(), adapter, &cfg)
	assertOIDCTrustError(t, err, 409, "console_oidc_bootstrap_jwt_trust_immutable")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
