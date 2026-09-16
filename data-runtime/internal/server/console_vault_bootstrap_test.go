package server

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestConsoleVaultBootstrapImportsSignedBoundKeyOnceAt0600(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	keyFile := filepath.Join(t.TempDir(), "console-vault-master-key")
	cfg := config.Config{
		Tenant:             "C000001",
		Deployment:         "c000001-prod-tenant-runtime",
		DeploymentBindings: map[string]string{"console": "console-prod"},
		Control: config.ControlConfig{
			RuntimeCode:              "c000001-prod-tenant-runtime",
			PlatformSigningKeyID:     "psk_test",
			PlatformSigningPublicKey: string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})),
		},
		Apps: config.AppsConfig{
			Console: config.ConsoleConfig{VaultMasterKeyFile: keyFile},
		},
	}
	adapter := consoleapp.NewWithDB(cfg.Apps.Console, cfg.Tenant, nil)
	s := &Server{cfg: cfg, console: adapter}
	envelope := signedConsoleVaultBootstrapEnvelope(t, privateKey, "psk_test", map[string]any{
		"jti":                       "8a22952d-9467-40f3-bbca-4cfd8412fa86",
		"tenantCode":                "C000001",
		"deploymentCode":            "console-prod",
		"runtimeCode":               "c000001-prod-tenant-runtime",
		"vaultMasterKey":            "customer-held-vault-key",
		"vaultMasterKeyFingerprint": consoleapp.VaultMasterKeyFingerprint("customer-held-vault-key"),
		"issuedAt":                  time.Now().UTC().Add(-time.Minute).Format(time.RFC3339),
		"expiresAt":                 time.Now().UTC().Add(5 * time.Minute).Format(time.RFC3339),
	})

	first := postConsoleVaultBootstrap(t, s, envelope)
	result, ok := first.Body.(map[string]any)
	if !ok || result["status"] != "imported" {
		t.Fatalf("unexpected first bootstrap result: %#v", first.Body)
	}
	content, err := os.ReadFile(keyFile)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(content)) != "customer-held-vault-key" {
		t.Fatal("protected Runtime key file does not contain the imported key")
	}
	info, err := os.Stat(keyFile)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("Runtime key file mode = %#o, want 0600", info.Mode().Perm())
	}

	second := postConsoleVaultBootstrap(t, s, envelope)
	replayed, ok := second.Body.(map[string]any)
	if !ok || replayed["status"] != "already_present" {
		t.Fatalf("same signed key must be idempotent: %#v", second.Body)
	}
}

func TestConsoleVaultBootstrapRejectsTamperingAndDifferentKey(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKIXPublicKey(publicKey)
	cfg := config.Config{
		Tenant:             "C000001",
		Deployment:         "runtime-prod",
		DeploymentBindings: map[string]string{"console": "console-prod"},
		Control: config.ControlConfig{
			RuntimeCode:              "runtime-prod",
			PlatformSigningKeyID:     "psk_test",
			PlatformSigningPublicKey: string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})),
		},
		Apps: config.AppsConfig{
			Console: config.ConsoleConfig{VaultMasterKeyFile: filepath.Join(t.TempDir(), "key")},
		},
	}
	adapter := consoleapp.NewWithDB(config.ConsoleConfig{VaultMasterKey: "original-key"}, cfg.Tenant, nil)
	s := &Server{cfg: cfg, console: adapter}
	envelope := signedConsoleVaultBootstrapEnvelope(t, privateKey, "psk_test", map[string]any{
		"jti":                       "8a22952d-9467-40f3-bbca-4cfd8412fa86",
		"tenantCode":                "C000001",
		"deploymentCode":            "console-prod",
		"runtimeCode":               "runtime-prod",
		"vaultMasterKey":            "different-key",
		"vaultMasterKeyFingerprint": consoleapp.VaultMasterKeyFingerprint("different-key"),
		"issuedAt":                  time.Now().UTC().Add(-time.Minute).Format(time.RFC3339),
		"expiresAt":                 time.Now().UTC().Add(5 * time.Minute).Format(time.RFC3339),
	})
	encoded, _ := json.Marshal(envelope)
	request := httptest.NewRequest(http.MethodPost, "/runtime/bootstrap/console-vault-master-key", strings.NewReader(string(encoded)))
	_, err = s.route(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "console_vault_key_conflict" {
		t.Fatalf("different key error = %T %v", err, err)
	}

	envelope["signature"] = "tampered"
	encoded, _ = json.Marshal(envelope)
	request = httptest.NewRequest(http.MethodPost, "/runtime/bootstrap/console-vault-master-key", strings.NewReader(string(encoded)))
	_, err = s.route(request)
	if !errors.As(err, &httpErr) || httpErr.Code != "console_vault_bootstrap_signature_invalid" {
		t.Fatalf("tampered signature error = %T %v", err, err)
	}
}

func TestConsoleOIDCBootstrapJWTTrustIsTenantBound(t *testing.T) {
	trust, err := consoleJWTTrust(consoleOIDCSigningBootstrapPayload{
		Issuer:  "https://wiztek.huizhi.yun",
		JWKSURL: "https://wiztek.huizhi.yun/.well-known/jwks.json",
	})
	if err != nil {
		t.Fatal(err)
	}
	if trust.Issuer != "https://wiztek.huizhi.yun" ||
		trust.JWKSURL != "https://wiztek.huizhi.yun/.well-known/jwks.json" ||
		trust.Audience != "data-runtime" {
		t.Fatalf("unexpected JWT trust: %#v", trust)
	}

	_, err = consoleJWTTrust(consoleOIDCSigningBootstrapPayload{
		Issuer:  "https://wiztek.huizhi.yun",
		JWKSURL: "https://console.huizhi.yun/.well-known/jwks.json",
	})
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "console_oidc_bootstrap_jwks_mismatch" {
		t.Fatalf("cross-tenant JWKS error = %T %v", err, err)
	}

	_, err = consoleJWTTrust(consoleOIDCSigningBootstrapPayload{
		Issuer:  "https://127.0.0.1",
		JWKSURL: "https://127.0.0.1/.well-known/jwks.json",
	})
	if !errors.As(err, &httpErr) || httpErr.Code != "console_oidc_bootstrap_jwt_trust_private" {
		t.Fatalf("private JWT trust error = %T %v", err, err)
	}
}

func signedConsoleVaultBootstrapEnvelope(t *testing.T, privateKey ed25519.PrivateKey, kid string, payload map[string]any) map[string]any {
	t.Helper()
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return map[string]any{
		"schemaVersion": "console-vault-bootstrap.v1",
		"payload":       base64.RawURLEncoding.EncodeToString(payloadJSON),
		"signature":     base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, payloadJSON)),
		"kid":           kid,
		"alg":           "Ed25519",
	}
}

func postConsoleVaultBootstrap(t *testing.T, server *Server, envelope map[string]any) routeResult {
	t.Helper()
	encoded, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/runtime/bootstrap/console-vault-master-key", strings.NewReader(string(encoded)))
	result, err := server.route(request)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
