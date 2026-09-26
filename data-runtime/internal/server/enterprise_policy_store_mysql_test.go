package server

import (
	"bytes"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
)

func TestEnterprisePolicyStoreHTTPMySQL(t *testing.T) {
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
	mc.ParseTime = true
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	schema := "hzy_policy_http_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE `" + schema + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE `" + schema + "`")
	mc.DBName = schema
	openDB := func() *sql.DB {
		db, err := sql.Open("mysql", mc.FormatDSN())
		if err != nil {
			t.Fatal(err)
		}
		return db
	}
	db := openDB()
	defer func() { db.Close() }()
	exec := func(q string) {
		t.Helper()
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	for _, q := range []string{
		"CREATE TABLE policy_bundle_snapshots(tenant_code VARCHAR(64),deployment_code VARCHAR(191),object_key VARCHAR(80),envelope MEDIUMTEXT NOT NULL,etag CHAR(64),synced_at_ms BIGINT,bundle_version VARCHAR(191),bundle_hash VARCHAR(191),PRIMARY KEY(tenant_code,deployment_code,object_key)) ENGINE=InnoDB",
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
	start := func(tenant, deployment string) *httptest.Server {
		c := cfg
		c.Tenant = tenant
		c.Deployment = deployment
		return httptest.NewServer(&Server{cfg: c, auth: auth.New(c), console: consoleapp.NewWithDB(config.ConsoleConfig{}, tenant, db)})
	}
	server := start("tenant-1", "deployment-1")
	defer func() { server.Close() }()
	token := func(tenant, deployment, scope string) string {
		claims := jwt.MapClaims{"iss": cfg.Auth.JWT.Issuer, "aud": "data-runtime", "source_app": "console", "target_app": "data-runtime", "tenant": tenant, "deployment": deployment, "sub": "client:console.runtime", "client_id": "console.runtime", "token_use": "service", "hzy": map[string]any{"credentialId": 7}, "scope": scope, "iat": time.Now().Add(-time.Minute).Unix(), "exp": time.Now().Add(time.Hour).Unix()}
		jwtToken := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
		jwtToken.Header["kid"] = "test-key"
		signed, err := jwtToken.SignedString(key)
		if err != nil {
			t.Fatal(err)
		}
		return signed
	}
	scope := "policy-http-test"
	keyHash := sha256.Sum256([]byte(scope))
	objectKey := "policy/v1/" + hex.EncodeToString(keyHash[:]) + ".json"
	call := func(target *httptest.Server, method, tenant, deployment, permission string, body any) (int, map[string]any) {
		t.Helper()
		var input io.Reader
		if body != nil {
			raw, _ := json.Marshal(body)
			input = bytes.NewReader(raw)
		}
		path := "/v1/console/policy-bundle"
		if method == "GET" {
			path += "?key=" + objectKey
		}
		req, err := http.NewRequest(method, target.URL+path, input)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+token(tenant, deployment, permission))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", strings.Repeat("d", 64))
		response, err := target.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, _ := io.ReadAll(response.Body)
		var result map[string]any
		if json.Unmarshal(raw, &result) != nil {
			t.Fatalf("non-JSON response %d", response.StatusCode)
		}
		return response.StatusCode, result
	}
	envelope := func(version string, at time.Time) string {
		payload := map[string]any{"revision": version}
		rawPayload, _ := json.Marshal(payload)
		hash := sha256.Sum256(rawPayload)
		value := map[string]any{"tenantCode": "tenant-1", "deploymentCode": "deployment-1", "bundleVersion": version, "bundleHash": hex.EncodeToString(hash[:]), "cachedAt": at.UTC().Format(time.RFC3339Nano), "signature": base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, rawPayload)), "payload": payload}
		record, _ := json.Marshal(map[string]any{"scope": scope, "syncedAt": at.UnixMilli(), "value": value})
		mac := hmac.New(sha256.New, []byte("isolated-fixture-key"))
		mac.Write(record)
		raw, _ := json.Marshal(map[string]any{"body": string(record), "mac": hex.EncodeToString(mac.Sum(nil))})
		return string(raw)
	}
	at := time.Now().Add(-time.Second).Truncate(time.Millisecond)
	first := envelope("v1", at)
	put := func(raw, etag string) (int, map[string]any) {
		return call(server, "PUT", "tenant-1", "deployment-1", "console:policy-bundle:write", map[string]any{"key": objectKey, "body": raw, "expectedEtag": etag})
	}
	get := func() (string, string) {
		t.Helper()
		status, result := call(server, "GET", "tenant-1", "deployment-1", "console:policy-bundle:read", nil)
		if status != 200 {
			t.Fatalf("read: %d %v", status, result)
		}
		data, ok := result["data"].(map[string]any)
		if !ok {
			t.Fatalf("missing row: %v", result)
		}
		return data["body"].(string), data["etag"].(string)
	}
	if status, result := put(first, ""); status != 200 || result["data"].(map[string]any)["stored"] != true {
		t.Fatalf("initial write: %d %v", status, result)
	}
	body, etag := get()
	if body != first {
		t.Fatal("first body differs")
	}
	second := envelope("v2", at.Add(time.Millisecond))
	if status, result := put(second, strings.Repeat("0", 64)); status != 200 || result["data"].(map[string]any)["stored"] != false {
		t.Fatalf("CAS conflict: %d %v", status, result)
	}
	if body, _ := get(); body != first {
		t.Fatal("CAS conflict overwrote row")
	}
	if status, result := put(second, etag); status != 200 || result["data"].(map[string]any)["stored"] != true {
		t.Fatalf("CAS update: %d %v", status, result)
	}
	if status, result := put(first, etag); status != 200 || result["data"].(map[string]any)["stored"] != false {
		t.Fatalf("old write: %d %v", status, result)
	}
	for _, c := range []struct{ tenant, deployment, scope string }{{"tenant-2", "deployment-1", "console:policy-bundle:read"}, {"tenant-1", "deployment-2", "console:policy-bundle:read"}, {"tenant-1", "deployment-1", "console.read"}} {
		if status, _ := call(server, "GET", c.tenant, c.deployment, c.scope, nil); status != 403 {
			t.Fatalf("invalid binding/scope accepted: %d", status)
		}
	}
	for _, binding := range [][2]string{{"tenant-2", "deployment-1"}, {"tenant-1", "deployment-2"}} {
		other := start(binding[0], binding[1])
		status, result := call(other, "GET", binding[0], binding[1], "console:policy-bundle:read", nil)
		other.Close()
		if status != 200 || result["data"] != nil {
			t.Fatalf("other binding leaked row: %d %v", status, result)
		}
	}
	server.Close()
	db.Close()
	db = openDB()
	server = start("tenant-1", "deployment-1")
	if body, _ := get(); body != second {
		t.Fatal("server/DB pool rebuild lost persisted row")
	}
	exec("UPDATE service_client_grants SET status='revoked' WHERE action='read'")
	if status, _ := call(server, "GET", "tenant-1", "deployment-1", "console:policy-bundle:read", nil); status != 403 {
		t.Fatalf("revoked live grant accepted: %d", status)
	}
	exec("UPDATE service_client_grants SET status='active'")
	exec("UPDATE service_client_grants SET status='revoked' WHERE action='write'")
	if status, _ := put(first, etag); status != 403 {
		t.Fatalf("revoked write grant accepted: %d", status)
	}
	if body, _ := get(); body != second {
		t.Fatal("revoked write changed persisted row")
	}
	exec("UPDATE service_client_grants SET status='active'")
	exec("UPDATE service_client_credentials SET status='revoked'")
	if status, _ := call(server, "GET", "tenant-1", "deployment-1", "console:policy-bundle:read", nil); status != 403 {
		t.Fatalf("revoked live credential accepted: %d", status)
	}
	exec("UPDATE service_client_credentials SET status='active'")
	exec("DROP TABLE service_client_credentials")
	if status, result := call(server, "GET", "tenant-1", "deployment-1", "console:policy-bundle:read", nil); status != 503 {
		t.Fatalf("credential dependency failure: %d %v", status, result)
	}
}
