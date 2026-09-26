package server

import (
	"bytes"
	"crypto/ed25519"
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
	"sync"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/policyenvelope"
)

func TestVerifiedPolicyHTTPMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_POLICY_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires dedicated temporary MySQL")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("refusing non-isolated socket")
	}
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.Net = "unix"
	mc.Addr = socket
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	schema := "hzy_verified_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	exec := func(q string) {
		t.Helper()
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	migration, err := os.ReadFile("../../../console/docs/sql/Console-SQL-Migration-verified-policy-snapshots.sql")
	if err != nil {
		t.Fatal(err)
	}
	exec(string(migration))
	renewalMigration, err := os.ReadFile("../../../console/docs/sql/Console-SQL-Migration-verified-policy-renewal-state.sql")
	if err != nil {
		t.Fatal(err)
	}
	exec(string(renewalMigration))
	for _, q := range []string{
		"CREATE TABLE service_clients(id BIGINT PRIMARY KEY,status VARCHAR(20),current_credential_id BIGINT)",
		"CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,service_client_id BIGINT,client_id VARCHAR(128),status VARCHAR(20),expires_at DATETIME)",
		"CREATE TABLE service_client_grants(service_client_id BIGINT,resource_code VARCHAR(128),action VARCHAR(64),status VARCHAR(20))",
		"INSERT INTO service_clients VALUES(1,'active',7)",
		"INSERT INTO service_client_credentials VALUES(7,1,'console.runtime','active',NULL)",
		"INSERT INTO service_client_grants VALUES(1,'console:policy-bundle','read','active'),(1,'console:policy-bundle','write','active')",
	} {
		exec(q)
	}
	cfg, key := testRuntimeJWTConfig(t)
	cfg.Auth.JWT.Issuer = "https://console.test"
	cfg.DeploymentBindings = map[string]string{"console": "deployment-1", "enterprise": "enterprise-1"}
	cfg.Control.PlatformURL = "https://platform.example"
	cfg.Control.PlatformSigningKeyID = "test-key"
	pub, _ := x509.MarshalPKIXPublicKey(key.Public())
	cfg.Control.PlatformSigningPublicKey = string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pub}))
	cfg.Apps.Console.PolicyEnvelope = config.PolicyEnvelopeConfig{Enabled: true, Environment: "test"}
	start := func(c config.Config) *httptest.Server {
		return httptest.NewServer(&Server{cfg: c, auth: auth.New(c), console: consoleapp.NewWithDB(config.ConsoleConfig{}, c.Tenant, db)})
	}
	srv := start(cfg)
	defer func() { srv.Close() }()
	claims := func(scope string) jwt.MapClaims {
		return jwt.MapClaims{"iss": cfg.Auth.JWT.Issuer, "aud": "data-runtime", "source_app": "console", "target_app": "data-runtime", "tenant": "tenant-1", "deployment": "deployment-1", "sub": "client:console.runtime", "client_id": "console.runtime", "token_use": "service", "hzy": map[string]any{"credentialId": 7}, "scope": scope, "iat": time.Now().Add(-time.Minute).Unix(), "exp": time.Now().Add(time.Hour).Unix()}
	}
	requestPath := "/v1/console/verified-policy"
	type readResult struct {
		policyenvelope.Snapshot
		Renewal *policyenvelope.Renewal `json:"renewal"`
	}
	var lastRead readResult
	var lastCode string
	call := func(method string, body any, patch map[string]any) (int, policyenvelope.Snapshot) {
		t.Helper()
		scope := "console:policy-bundle:read"
		if method == "PUT" {
			scope = "console:policy-bundle:write"
		}
		c := claims(scope)
		for k, v := range patch {
			c[k] = v
		}
		token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, c)
		token.Header["kid"] = "test-key"
		signed, _ := token.SignedString(key)
		raw, _ := json.Marshal(body)
		req, _ := http.NewRequest(method, srv.URL+requestPath, bytes.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+signed)
		resp, err := srv.Client().Do(req)
		if err != nil {
			t.Error(err)
			return 0, policyenvelope.Snapshot{}
		}
		defer resp.Body.Close()
		var result struct {
			Data  readResult `json:"data"`
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&result)
		if resp.StatusCode == 404 && result.Error.Code != "policy_snapshot_missing" {
			t.Errorf("ambiguous missing snapshot: %s", result.Error.Code)
		}
		lastRead, lastCode = result.Data, result.Error.Code
		return resp.StatusCode, result.Data.Snapshot
	}
	for _, method := range []string{"GET", "PUT"} {
		for _, c := range []struct {
			name  string
			patch map[string]any
			want  int
		}{
			{"scope", map[string]any{"scope": "console.read"}, 403}, {"source", map[string]any{"source_app": "enterprise"}, 403},
			{"target", map[string]any{"target_app": "people"}, 403}, {"tenant", map[string]any{"tenant": "other"}, 403},
			{"deployment", map[string]any{"deployment": "other"}, 403}, {"audience", map[string]any{"aud": "other"}, 401},
			{"issuer", map[string]any{"iss": "https://other.example"}, 401}, {"expiry", map[string]any{"exp": time.Now().Add(-time.Hour).Unix()}, 401},
			{"credential", map[string]any{"hzy": nil}, 403}, {"token use", map[string]any{"token_use": "access"}, 403},
		} {
			t.Run(method+"/"+c.name, func(t *testing.T) {
				if status, _ := call(method, nil, c.patch); status != c.want {
					t.Fatalf("status %d", status)
				}
			})
			if method == "PUT" {
				t.Run("renewal/"+c.name, func(t *testing.T) {
					requestPath = "/v1/console/verified-policy/renewal"
					defer func() { requestPath = "/v1/console/verified-policy" }()
					if status, _ := call(method, nil, c.patch); status != c.want {
						t.Fatalf("status %d", status)
					}
				})
			}
		}
	}
	epoch := time.Now().Add(-time.Minute).UnixMilli()
	envelope := func(rev int64) policyenvelope.Envelope {
		payload, _ := json.Marshal(map[string]any{"tenant": map[string]any{"tenantCode": "tenant-1"}, "environment": "test", "policyRevision": rev, "deployments": []any{map[string]any{"deploymentCode": "deployment-1", "environment": "test", "status": "active"}, map[string]any{"deploymentCode": "enterprise-1", "environment": "test", "status": "active"}}})
		digest := sha256.Sum256(payload)
		body, _ := json.Marshal(policyenvelope.Body{Purpose: "enterprise-policy", Issuer: cfg.Control.PlatformURL, Tenant: "tenant-1", Environment: "test", Deployments: []string{"deployment-1", "enterprise-1"}, BundleVersion: "version", PolicyRevision: rev, Status: "active", IssuedAt: epoch + rev, ExpiresAt: epoch + rev + 300000, PayloadHash: "sha256_" + hex.EncodeToString(digest[:]), Payload: string(payload)})
		return policyenvelope.Envelope{Schema: policyenvelope.Schema, Alg: "Ed25519", KID: "test-key", Body: string(body), Signature: base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, []byte(policyenvelope.Schema+"\n"+string(body))))}
	}
	write := func(e policyenvelope.Envelope, etag string) (int, policyenvelope.Snapshot) {
		return call("PUT", map[string]any{"envelope": e, "expectedEtag": etag}, nil)
	}
	if status, _ := call("GET", nil, nil); status != 404 {
		t.Fatalf("missing %d", status)
	}
	broken := envelope(1)
	broken.Signature = strings.Repeat("A", 86)
	if status, _ := write(broken, ""); status != 400 {
		t.Fatalf("signature %d", status)
	}
	status, first := write(envelope(1), "")
	if status != 200 {
		t.Fatalf("first %d", status)
	}
	status, replay := write(envelope(1), "")
	if status != 200 || replay.AcceptedAt != first.AcceptedAt {
		t.Fatal("replay renewed freshness")
	}
	if status, _ := call("GET", nil, nil); status != 200 || lastRead.Renewal == nil || lastRead.Renewal.State != "ok" {
		t.Fatalf("successful write did not record renewal ok: %d %+v", status, lastRead.Renewal)
	}
	renew := func(body any, patch map[string]any) (int, string) {
		t.Helper()
		requestPath = "/v1/console/verified-policy/renewal"
		defer func() { requestPath = "/v1/console/verified-policy" }()
		status, _ := call("PUT", body, patch)
		return status, lastCode
	}
	for _, c := range []struct {
		name string
		body any
		want int
		code string
	}{
		{"unknown state", map[string]any{"state": "grace", "expectedEtag": first.ETag}, 400, "policy_renewal_invalid"},
		{"extra field", map[string]any{"state": "refused", "expectedEtag": first.ETag, "attemptedAt": 1}, 400, "policy_renewal_invalid"},
		{"missing etag", map[string]any{"state": "refused"}, 400, "policy_renewal_invalid"},
		{"stale etag", map[string]any{"state": "refused", "expectedEtag": strings.Repeat("0", 64)}, 409, "policy_snapshot_conflict"},
	} {
		if status, code := renew(c.body, nil); status != c.want || code != c.code {
			t.Fatalf("renewal %s: %d %s", c.name, status, code)
		}
	}
	if status, _ := renew(map[string]any{"state": "platform_unavailable", "expectedEtag": first.ETag}, map[string]any{"scope": "console:policy-bundle:read"}); status != 403 {
		t.Fatalf("renewal accepted read scope: %d", status)
	}
	requestPath = "/v1/console/verified-policy/renewal"
	if status, _ := call("GET", nil, nil); status != 405 {
		t.Fatalf("renewal GET %d", status)
	}
	requestPath = "/v1/console/verified-policy"
	beforeOutage := time.Now().UnixMilli()
	if status, _ := renew(map[string]any{"state": "platform_unavailable", "expectedEtag": first.ETag}, nil); status != 200 {
		t.Fatalf("renewal record %d", status)
	}
	if status, _ := call("GET", nil, nil); status != 200 || lastRead.Renewal == nil || lastRead.Renewal.State != "platform_unavailable" || lastRead.Renewal.AttemptedAt < beforeOutage || lastRead.ETag != first.ETag || lastRead.AcceptedAt != first.AcceptedAt {
		t.Fatalf("renewal not readable or receipt changed: %+v", lastRead)
	}
	outageAt := lastRead.Renewal.AttemptedAt
	if _, err := db.Exec("UPDATE verified_policy_snapshots SET renewal_attempted_at=renewal_attempted_at+600000"); err != nil {
		t.Fatal(err)
	}
	if status, _ := renew(map[string]any{"state": "refused", "expectedEtag": first.ETag}, nil); status != 200 {
		t.Fatalf("renewal refused %d", status)
	}
	if status, _ := call("GET", nil, nil); status != 200 || lastRead.Renewal.State != "refused" || lastRead.Renewal.AttemptedAt != outageAt+600000 {
		t.Fatalf("renewal attempt time moved backwards: %+v", lastRead.Renewal)
	}
	// An explicit refusal is sticky: a later outage, ok or replay of the same
	// envelope must not reopen grace. Only a newer signed envelope resets it.
	for _, state := range []string{"platform_unavailable", "ok"} {
		if status, _ := renew(map[string]any{"state": state, "expectedEtag": first.ETag}, nil); status != 200 {
			t.Fatalf("renewal %s after refusal %d", state, status)
		}
		if status, _ := call("GET", nil, nil); status != 200 || lastRead.Renewal.State != "refused" {
			t.Fatalf("%s overwrote refusal: %+v", state, lastRead.Renewal)
		}
	}
	if status, _ := write(envelope(1), ""); status != 200 {
		t.Fatalf("replay after refusal %d", status)
	}
	if status, _ := call("GET", nil, nil); status != 200 || lastRead.Renewal.State != "refused" {
		t.Fatalf("replay cleared refusal: %+v", lastRead.Renewal)
	}
	if status, _ := renew(map[string]any{"state": "invalid", "expectedEtag": first.ETag}, nil); status != 200 {
		t.Fatalf("renewal invalid %d", status)
	}
	if status, _ := call("GET", nil, nil); status != 200 || lastRead.Renewal.State != "invalid" {
		t.Fatalf("invalid not recorded: %+v", lastRead.Renewal)
	}
	if status, _ := renew(map[string]any{"state": "platform_unavailable", "expectedEtag": first.ETag}, nil); status != 200 {
		t.Fatalf("renewal outage after invalid %d", status)
	}
	if status, _ := call("GET", nil, nil); status != 200 || lastRead.Renewal.State != "invalid" {
		t.Fatalf("outage overwrote invalid: %+v", lastRead.Renewal)
	}
	if _, err := db.Exec("UPDATE verified_policy_snapshots SET renewal_attempted_at=?", outageAt); err != nil {
		t.Fatal(err)
	}
	srv.Close()
	srv = start(cfg) // new server instance must observe the same durable row
	status, read := call("GET", nil, nil)
	if status != 200 || read.ETag != first.ETag || read.AcceptedAt != first.AcceptedAt {
		t.Fatal("restart lost receipt")
	}
	if status, _ := write(envelope(2), strings.Repeat("0", 64)); status != 409 {
		t.Fatalf("CAS %d", status)
	}
	var wg sync.WaitGroup
	statuses := make(chan int, 2)
	for _, rev := range []int64{2, 3} {
		wg.Add(1)
		go func(rev int64) { defer wg.Done(); status, _ := write(envelope(rev), first.ETag); statuses <- status }(rev)
	}
	wg.Wait()
	close(statuses)
	winners := 0
	for status := range statuses {
		if status == 200 {
			winners++
		} else if status != 400 && status != 409 {
			t.Fatalf("concurrent %d", status)
		}
	}
	if winners != 1 {
		t.Fatalf("winners %d", winners)
	}
	if status, _ := write(envelope(1), ""); status != 400 {
		t.Fatalf("rollback %d", status)
	}
	_, winner := call("GET", nil, nil)
	if lastRead.Renewal == nil || lastRead.Renewal.State != "ok" {
		t.Fatalf("newer envelope did not reset renewal state: %+v", lastRead.Renewal)
	}
	status, replay = write(envelope(winner.PolicyRevision), first.ETag)
	if status != 200 || replay.AcceptedAt != winner.AcceptedAt {
		t.Fatal("update replay changed receipt")
	}
	// Install a genuinely signed, formerly valid but now expired fixture. This
	// represents durable state left across downtime, not an API expiry bypass.
	currentEpoch := epoch
	epoch -= 600000
	expired, err := policyenvelope.Prepare(envelope(20), nil, "test-key", cfg.Control.PlatformSigningPublicKey, policyenvelope.Context{Issuer: cfg.Control.PlatformURL, Tenant: "tenant-1", Environment: "test", Deployment: "deployment-1", Now: epoch + 21})
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(expired)
	if _, err := db.Exec("UPDATE verified_policy_snapshots SET snapshot=?", string(encoded)); err != nil {
		t.Fatal(err)
	}
	epoch = currentEpoch
	status, old := call("GET", nil, nil)
	if status != 200 || old.ETag != expired.ETag || old.AcceptedAt != expired.AcceptedAt {
		t.Fatal("expired watermark inaccessible for CAS recovery")
	}
	if status, _ := write(envelope(19), old.ETag); status != 400 {
		t.Fatal("expired watermark allowed rollback")
	}
	if status, _ := write(envelope(21), old.ETag); status != 200 {
		t.Fatal("fresh recovery rejected")
	}
	// Distinct real Enterprise identity, no Console impersonation or write path.
	exec("INSERT INTO service_clients VALUES(2,'active',8)")
	exec("INSERT INTO service_client_credentials VALUES(8,2,'enterprise.runtime','active',NULL)")
	exec("INSERT INTO service_client_grants VALUES(2,'console:policy-bundle','read','active')")
	reader := map[string]any{"source_app": "enterprise", "client_id": "enterprise.runtime", "sub": "client:enterprise.runtime", "hzy": map[string]any{"credentialId": 8}, "deployment": "enterprise-1"}
	requestPath = "/v1/enterprise/console-policy"
	if status, _ := call("GET", nil, reader); status != 503 {
		t.Fatal("reader enabled implicitly")
	}
	srv.Close()
	hostConfig := cfg
	hostConfig.Apps.Console.PolicyEnvelope.EnterpriseReadEnabled = true
	srv = start(hostConfig)
	status, projection := call("GET", nil, reader)
	if status != 200 || projection.Deployment != "enterprise-1" || projection.Tenant != "tenant-1" || lastRead.Renewal == nil || lastRead.Renewal.State != "ok" {
		t.Fatalf("reader binding %d %+v", status, lastRead.Renewal)
	}
	requestPath = "/v1/console/verified-policy/renewal"
	if status, _ := call("PUT", map[string]any{"state": "ok", "expectedEtag": projection.ETag}, reader); status != 403 {
		t.Fatalf("Enterprise wrote renewal state: %d", status)
	}
	requestPath = "/v1/enterprise/console-policy"
	// Outage grace on the reader route: an expired, authentic envelope is served
	// only while the syncer records platform_unavailable within the liveness window.
	var savedSnapshot string
	if err := db.QueryRow("SELECT snapshot FROM verified_policy_snapshots").Scan(&savedSnapshot); err != nil {
		t.Fatal(err)
	}
	liveEpoch := epoch
	epoch = time.Now().Add(-40 * time.Minute).UnixMilli()
	stale, err := policyenvelope.Prepare(envelope(50), nil, "test-key", cfg.Control.PlatformSigningPublicKey, policyenvelope.Context{Issuer: cfg.Control.PlatformURL, Tenant: "tenant-1", Environment: "test", Deployment: "deployment-1", Now: epoch + 51})
	if err != nil {
		t.Fatal(err)
	}
	epoch = liveEpoch
	staleJSON, _ := json.Marshal(stale)
	nowMS := time.Now().UnixMilli()
	for _, c := range []struct {
		name      string
		state     any
		attempted any
		want      int
	}{
		{"no renewal state", nil, nil, 503},
		{"platform outage", "platform_unavailable", nowMS - 60000, 200},
		{"explicit refusal", "refused", nowMS - 60000, 503},
		{"stopped syncer", "platform_unavailable", nowMS - 35*60000, 503},
	} {
		if _, err := db.Exec("UPDATE verified_policy_snapshots SET snapshot=?, renewal_state=?, renewal_attempted_at=?", string(staleJSON), c.state, c.attempted); err != nil {
			t.Fatal(err)
		}
		if status, _ := call("GET", nil, reader); status != c.want {
			t.Fatalf("reader grace %s: %d", c.name, status)
		}
	}
	if _, err := db.Exec("UPDATE verified_policy_snapshots SET snapshot=?, renewal_state='ok', renewal_attempted_at=?", savedSnapshot, nowMS); err != nil {
		t.Fatal(err)
	}
	requestPath = "/v1/enterprise/console-policy"
	if status, _ := call("GET", nil, nil); status != 403 {
		t.Fatal("Console used Enterprise route")
	}
	if status, _ := call("PUT", nil, reader); status != 405 {
		t.Fatal("Enterprise writer enabled")
	}
	exec("UPDATE service_client_grants SET status='inactive' WHERE service_client_id=2")
	if status, _ := call("GET", nil, reader); status != 403 {
		t.Fatal("reader grant revocation ignored")
	}
	exec("UPDATE service_client_grants SET status='active' WHERE service_client_id=2")
	// The enrolled reader deployment must also be in the signed envelope.
	srv.Close()
	hostConfig.DeploymentBindings = map[string]string{"console": "deployment-1", "enterprise": "enterprise-2"}
	srv = start(hostConfig)
	reader["deployment"] = "enterprise-2"
	if status, _ := call("GET", nil, reader); status != 503 {
		t.Fatal("unsigned reader deployment accepted")
	}
	srv.Close()
	srv = start(cfg)
	requestPath = "/v1/console/verified-policy"
	exec("UPDATE service_client_grants SET status='inactive'")
	for _, method := range []string{"GET", "PUT"} {
		if status, _ := call(method, nil, nil); status != 403 {
			t.Fatalf("revoked grant %d", status)
		}
	}
	exec("UPDATE service_client_grants SET status='active'")
	exec("UPDATE service_client_credentials SET status='inactive'")
	if status, _ := call("GET", nil, nil); status != 403 {
		t.Fatalf("revoked credential %d", status)
	}
	exec("UPDATE service_client_credentials SET status='active'")
	srv.Close()
	for _, kind := range []string{"disabled", "environment", "prod lifetime", "missing key", "missing binding", "disabled auth"} {
		disabled := cfg
		switch kind {
		case "disabled":
			disabled.Apps.Console.PolicyEnvelope.Enabled = false
		case "environment":
			disabled.Apps.Console.PolicyEnvelope.Environment = ""
		case "prod lifetime":
			disabled.Apps.Console.PolicyEnvelope.Environment = "prod"
			disabled.Apps.Console.PolicyEnvelope.MaxAgeMS = 93600000
		case "missing key":
			disabled.Control.PlatformSigningPublicKey = ""
		case "missing binding":
			disabled.DeploymentBindings = nil
		case "disabled auth":
			disabled.Auth.Mode = config.AuthDisabled
		}
		srv = start(disabled)
		want := 503
		if kind == "missing binding" || kind == "disabled auth" {
			want = 403
		}
		if status, _ := call("GET", nil, nil); status != want {
			t.Fatalf("%s %d", kind, status)
		}
		srv.Close()
	}
	srv = start(cfg)
	exec("ALTER TABLE verified_policy_snapshots DROP COLUMN renewal_state, DROP COLUMN renewal_attempted_at")
	status, unmigrated := call("GET", nil, nil)
	if status != 200 || lastRead.Renewal != nil {
		t.Fatalf("unmigrated renewal columns broke reads: %d %+v", status, lastRead.Renewal)
	}
	if status, code := renew(map[string]any{"state": "platform_unavailable", "expectedEtag": unmigrated.ETag}, nil); status != 503 || code != "policy_renewal_not_migrated" {
		t.Fatalf("unmigrated renewal write %d %s", status, code)
	}
	if status, _ := write(envelope(unmigrated.PolicyRevision+1), unmigrated.ETag); status != 200 {
		t.Fatalf("unmigrated renewal columns blocked envelope write: %d", status)
	}
	exec("DROP TABLE verified_policy_snapshots")
	if status, _ := call("GET", nil, nil); status != 503 {
		t.Fatalf("storage failure %d", status)
	}
}
