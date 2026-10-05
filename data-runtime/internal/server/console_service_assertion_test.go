package server

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/policyenvelope"
)

func TestConsoleServiceAssertionHTTPMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_POLICY_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires dedicated temporary MySQL")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("refusing non-isolated socket")
	}
	mc := mysql.NewConfig()
	mc.User, mc.Net, mc.Addr = "root", "unix", socket
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	schema := "hzy_assertion_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE `" + schema + "`"); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE `" + schema + "`")
	mc.DBName = schema
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, file := range []string{"verified-policy-snapshots", "verified-policy-renewal-state", "console-service-assertion-replay"} {
		migration, err := os.ReadFile("../../../console/docs/sql/Console-SQL-Migration-" + file + ".sql")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(string(migration)); err != nil {
			t.Fatal(file, err)
		}
	}

	cfg, platformKey := testRuntimeJWTConfig(t)
	cfg.DeploymentBindings = map[string]string{"console": "deployment-1"}
	cfg.Control.PlatformURL = "https://platform.example"
	cfg.Control.PlatformSigningKeyID = "test-key"
	pub, _ := x509.MarshalPKIXPublicKey(platformKey.Public())
	cfg.Control.PlatformSigningPublicKey = string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pub}))
	cfg.Apps.Console.PolicyEnvelope = config.PolicyEnvelopeConfig{Enabled: true, Environment: "test"}
	srv := httptest.NewServer(&Server{cfg: cfg, auth: auth.New(cfg), console: consoleapp.NewWithDB(config.ConsoleConfig{}, cfg.Tenant, db)})
	defer srv.Close()

	consolePublic, consoleKey, _ := ed25519.GenerateKey(rand.Reader)
	otherPublic, _, _ := ed25519.GenerateKey(rand.Reader)
	serviceKey := func(public ed25519.PublicKey) policyenvelope.ServiceKey {
		return policyenvelope.ServiceKey{Deployment: "deployment-1", KID: policyenvelope.ServiceKeyID(public), PublicKey: base64.RawURLEncoding.EncodeToString(public), NotAfter: time.Now().Add(24 * time.Hour).UnixMilli()}
	}
	// Stores a genuinely signed snapshot directly, as durable state left across
	// time (it may already be past its lease), with the given renewal state.
	store := func(issuedAt int64, keys []policyenvelope.ServiceKey, renewal string, attemptedAt int64) {
		t.Helper()
		payload, _ := json.Marshal(map[string]any{"tenant": map[string]any{"tenantCode": cfg.Tenant}, "environment": "test", "policyRevision": 1, "deployments": []any{map[string]any{"deploymentCode": "deployment-1", "environment": "test", "status": "active"}}})
		digest := sha256.Sum256(payload)
		body, _ := json.Marshal(policyenvelope.Body{Purpose: "enterprise-policy", Issuer: cfg.Control.PlatformURL, Tenant: cfg.Tenant, Environment: "test", Deployments: []string{"deployment-1"}, BundleVersion: "version", PolicyRevision: 1, Status: "active", IssuedAt: issuedAt, ExpiresAt: issuedAt + 300000, PayloadHash: "sha256_" + hex.EncodeToString(digest[:]), Payload: string(payload), ServiceKeys: keys})
		envelope := policyenvelope.Envelope{Schema: policyenvelope.Schema, Alg: "Ed25519", KID: "test-key", Body: string(body), Signature: base64.RawURLEncoding.EncodeToString(ed25519.Sign(platformKey, []byte(policyenvelope.Schema+"\n"+string(body))))}
		etag := sha256.Sum256([]byte(envelope.KID + "\n" + envelope.Body + "\n" + envelope.Signature))
		snapshot, _ := json.Marshal(policyenvelope.Snapshot{Tenant: cfg.Tenant, Environment: "test", Deployment: "deployment-1", Envelope: envelope, ETag: hex.EncodeToString(etag[:]), AcceptedAt: issuedAt + 1, PolicyRevision: 1, IssuedAt: issuedAt, PayloadHash: "sha256_" + hex.EncodeToString(digest[:])})
		state, attempted := sql.NullString{String: renewal, Valid: renewal != ""}, sql.NullInt64{Int64: attemptedAt, Valid: renewal != ""}
		if _, err := db.Exec("REPLACE INTO verified_policy_snapshots (tenant_code,environment,deployment_code,snapshot,renewal_state,renewal_attempted_at) VALUES (?,?,?,?,?,?)", cfg.Tenant, "test", "deployment-1", string(snapshot), state, attempted); err != nil {
			t.Fatal(err)
		}
	}
	assertion := func(private ed25519.PrivateKey, public ed25519.PublicKey, patch map[string]any) string {
		now := time.Now().Unix()
		header, _ := json.Marshal(map[string]any{"alg": "EdDSA", "typ": policyenvelope.AssertionType, "kid": policyenvelope.ServiceKeyID(public)})
		claims := map[string]any{"iss": "console:deployment-1", "sub": "console:deployment-1", "aud": policyenvelope.AssertionAudience, "token_use": policyenvelope.AssertionUse,
			"tenant": cfg.Tenant, "deployment": "deployment-1", "scope": policyenvelope.AssertionScope, "iat": now, "exp": now + 60, "jti": strings.ReplaceAll(uuid.NewString(), "-", "")}
		for k, v := range patch {
			claims[k] = v
		}
		body, _ := json.Marshal(claims)
		input := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(body)
		return input + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, []byte(input)))
	}
	issue := func(token string) (int, string) {
		t.Helper()
		req, _ := http.NewRequest("POST", srv.URL+"/v1/console/auth/service-tokens/issue", strings.NewReader(`{}`))
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var result struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&result)
		return resp.StatusCode, result.Error.Code
	}
	// Authentication passed when the request reaches the issuer's own body
	// validation (the empty body is then rejected as a bad request).
	authenticated := func(status int, code string) bool {
		return status != 401 && status != 403 && status != 503 && !strings.HasPrefix(code, "console_assertion")
	}

	if status, code := issue(assertion(consoleKey, consolePublic, nil)); status != 403 || code != "console_assertion_policy_inactive" {
		t.Fatalf("no snapshot: %d %s", status, code)
	}
	now := time.Now().UnixMilli()
	store(now-60_000, []policyenvelope.ServiceKey{serviceKey(consolePublic)}, "ok", now-60_000)
	token := assertion(consoleKey, consolePublic, nil)
	if status, code := issue(token); !authenticated(status, code) {
		t.Fatalf("valid envelope: %d %s", status, code)
	}
	if status, code := issue(token); status != 401 || code != "console_assertion_replayed" {
		t.Fatalf("replay: %d %s", status, code)
	}
	for name, patch := range map[string]map[string]any{
		"scope":      {"scope": "console:policy-bundle:write"},
		"deployment": {"deployment": "other", "iss": "console:other", "sub": "console:other"},
		"tenant":     {"tenant": "other"},
		"expired":    {"iat": time.Now().Unix() - 120, "exp": time.Now().Unix() - 60},
	} {
		if status, code := issue(assertion(consoleKey, consolePublic, patch)); status != 401 || code != "console_assertion_invalid" {
			t.Fatalf("%s: %d %s", name, status, code)
		}
	}
	if status, code := issue(assertion(consoleKey, otherPublic, nil)); status != 401 || code != "console_assertion_invalid" {
		t.Fatalf("unregistered key: %d %s", status, code)
	}

	// Lease over: only a live platform_unavailable renewal keeps the key usable.
	stale := now - 600_000
	store(stale, []policyenvelope.ServiceKey{serviceKey(consolePublic)}, "platform_unavailable", now-30_000)
	if status, code := issue(assertion(consoleKey, consolePublic, nil)); !authenticated(status, code) {
		t.Fatalf("outage grace: %d %s", status, code)
	}
	for _, renewal := range []string{"refused", "invalid", "ok", ""} {
		store(stale, []policyenvelope.ServiceKey{serviceKey(consolePublic)}, renewal, now-30_000)
		if status, code := issue(assertion(consoleKey, consolePublic, nil)); status != 403 || code != "console_assertion_policy_inactive" {
			t.Fatalf("renewal %q after lease: %d %s", renewal, status, code)
		}
	}
	store(stale, []policyenvelope.ServiceKey{serviceKey(consolePublic)}, "platform_unavailable", now-policyenvelope.RenewalLivenessMS-1000)
	if status, code := issue(assertion(consoleKey, consolePublic, nil)); status != 403 || code != "console_assertion_policy_inactive" {
		t.Fatalf("stopped syncer: %d %s", status, code)
	}
	// Key removed from a newer envelope stops working at once.
	store(now-30_000, nil, "ok", now-30_000)
	if status, code := issue(assertion(consoleKey, consolePublic, nil)); status != 401 || code != "console_assertion_invalid" {
		t.Fatalf("removed key: %d %s", status, code)
	}

	store(now-30_000, []policyenvelope.ServiceKey{serviceKey(consolePublic)}, "ok", now-30_000)
	if _, err := db.Exec("DROP TABLE console_service_assertion_replay"); err != nil {
		t.Fatal(err)
	}
	if status, code := issue(assertion(consoleKey, consolePublic, nil)); status != 503 || code != "console_assertion_not_migrated" {
		t.Fatalf("unmigrated replay table: %d %s", status, code)
	}
	disabled := cfg
	disabled.Apps.Console.PolicyEnvelope.Enabled = false
	off := httptest.NewServer(&Server{cfg: disabled, auth: auth.New(disabled), console: consoleapp.NewWithDB(config.ConsoleConfig{}, disabled.Tenant, db)})
	defer off.Close()
	req, _ := http.NewRequest("POST", off.URL+"/v1/console/auth/service-tokens/issue", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer "+assertion(consoleKey, consolePublic, nil))
	resp, err := off.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 503 {
		t.Fatalf("disabled verified policy: %d", resp.StatusCode)
	}
}
