package console

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

func TestGatewayExchangeMySQL(t *testing.T) {
	socket := os.Getenv("HZY_GATEWAY_EXCHANGE_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires disposable /tmp MySQL")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("refusing non-isolated MySQL")
	}
	cfg := mysql.NewConfig()
	cfg.User = "root"
	cfg.Net = "unix"
	cfg.Addr = socket
	root, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	name := "gateway_exchange_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE `" + name + "`"); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE `" + name + "`")
	cfg.DBName = name
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	statements := []string{
		`CREATE TABLE org_profiles(singleton_key INT PRIMARY KEY,tenant_code VARCHAR(64));`,
		`INSERT INTO org_profiles VALUES(1,'C000001')`,
		`CREATE TABLE service_clients(id BIGINT PRIMARY KEY,client_code VARCHAR(128),client_name VARCHAR(128),client_type VARCHAR(32),app_code VARCHAR(64),status VARCHAR(16),current_credential_id BIGINT)`,
		`CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,service_client_id BIGINT,client_id VARCHAR(128),status VARCHAR(16),expires_at DATETIME,last_used_at DATETIME)`,
		`CREATE TABLE service_client_grants(service_client_id BIGINT,resource_code VARCHAR(128),action VARCHAR(32),scope_json JSON,status VARCHAR(16),last_used_at DATETIME,created_at DATETIME,updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,UNIQUE(service_client_id,resource_code,action))`,
		`CREATE TABLE policy_bundle_snapshots(tenant_code VARCHAR(64),deployment_code VARCHAR(128),bundle_version VARCHAR(32),bundle_hash VARCHAR(64),synced_at_ms BIGINT)`,
		`CREATE TABLE auth_signing_keys(id BIGINT PRIMARY KEY,status VARCHAR(16),not_before DATETIME,not_after DATETIME)`,
		`CREATE TABLE auth_token_events(event_type VARCHAR(32),client_id VARCHAR(128),result VARCHAR(16),created_at DATETIME)`,
		`INSERT INTO service_clients VALUES(10,'aims.runtime','Aims','runtime','aims','active',20),(11,'console.runtime','Console','runtime','console','active',21)`,
		`INSERT INTO service_client_credentials VALUES(20,10,'aims.runtime','active',NULL,NULL),(21,11,'console.runtime','active',NULL,NULL)`,
		`INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status) VALUES(10,'aims:product','view','{"audience":"data-runtime","semanticScope":"aims:product:view","tenantCode":"C000001","deploymentCode":"C000001-test-aims"}','active')`,
		`INSERT INTO policy_bundle_snapshots VALUES('C000001','C000001-test-console','v7','hash-7',1)`,
		`INSERT INTO auth_signing_keys VALUES(5,'current',NULL,NULL)`,
	}
	for _, q := range statements {
		if _, err = db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	t.Run("enterprise exact five binding repair preserves unrelated data", func(t *testing.T) {
		if _, err := db.Exec(`ALTER TABLE service_client_grants ADD COLUMN id BIGINT UNIQUE NULL`); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`INSERT INTO service_clients VALUES(12,'enterprise.runtime','Enterprise','runtime','enterprise','active',22)`); err != nil {
			t.Fatal(err)
		}
		fixtures := []struct {
			id                                           int64
			resource, action, source, audience, semantic string
		}{
			{13227387, "assets:ip-asset", "link-product", "seed:v2.13", "data-runtime", "assets:ip-asset:link-product"},
			{10319368, "console:policy-bundle", "read", "enterprise-policy-reader", "", ""},
			{10325375, "data-runtime:console:policy-bundle", "read", "enterprise-policy-reader", "data-runtime", "console:policy-bundle:read"},
			{10325376, "tenant-runtime:console:policy-bundle", "read", "enterprise-policy-reader", "tenant-runtime", "console:policy-bundle:read"},
			{13227397, "workflow", "proxy", "seed:v2.12", "workflow", "workflow:proxy"},
		}
		for _, row := range fixtures {
			payload := map[string]any{"source": row.source, "untouched": "fixture", "tenantCode": nil}
			if row.audience != "" {
				payload["audience"] = row.audience
				payload["semanticScope"] = row.semantic
			}
			raw, _ := json.Marshal(payload)
			if _, err := db.Exec(`INSERT INTO service_client_grants(id,service_client_id,resource_code,action,scope_json,status,updated_at) VALUES(?,12,?,?,?,'active','2020-01-01 00:00:00')`, row.id, row.resource, row.action, string(raw)); err != nil {
				t.Fatal(err)
			}
		}
		runSQL := func(name string) {
			t.Helper()
			raw, err := os.ReadFile("../../../../console/docs/sql/" + name)
			if err != nil {
				t.Fatal(err)
			}
			lines := []string{}
			for _, line := range strings.Split(string(raw), "\n") {
				if !strings.HasPrefix(strings.TrimSpace(line), "--") {
					lines = append(lines, line)
				}
			}
			for _, q := range strings.Split(strings.Join(lines, "\n"), ";") {
				if strings.TrimSpace(q) != "" {
					if _, err := db.Exec(q); err != nil {
						t.Fatal(err)
					}
				}
			}
		}
		snapshot := func() string {
			var raw string
			if err := db.QueryRow(`SELECT CAST(JSON_ARRAYAGG(JSON_OBJECT('id',id,'client',service_client_id,'resource',resource_code,'action',action,'status',status,'lastUsedAt',last_used_at,'createdAt',created_at,'scope',JSON_REMOVE(scope_json,'$.tenantCode','$.deploymentCode'))) AS CHAR) FROM service_client_grants WHERE service_client_id=12`).Scan(&raw); err != nil {
				t.Fatal(err)
			}
			return raw
		}
		before := snapshot()
		repair := "Console-SQL-Repair-v2.21-enterprise-gateway-bindings.sql"
		// Wrong binding and revoked records are never repaired.
		if _, err := db.Exec(`UPDATE service_client_grants SET status='revoked' WHERE id=13227387`); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,'$.tenantCode','other') WHERE id=10319368`); err != nil {
			t.Fatal(err)
		}
		runSQL(repair)
		var untouched int
		if err := db.QueryRow(`SELECT COUNT(*) FROM service_client_grants WHERE id IN(13227387,10319368) AND JSON_EXTRACT(scope_json,'$.deploymentCode') IS NULL`).Scan(&untouched); err != nil || untouched != 2 {
			t.Fatal("changed rejected rows", err)
		}
		if _, err := db.Exec(`UPDATE service_client_grants SET status='active',scope_json=JSON_REMOVE(scope_json,'$.tenantCode','$.deploymentCode'),updated_at='2020-01-01 00:00:00' WHERE service_client_id=12`); err != nil {
			t.Fatal(err)
		}
		runSQL(repair)
		var timestampUpdated int
		if err := db.QueryRow(`SELECT COUNT(*) FROM service_client_grants WHERE service_client_id=12 AND updated_at>'2020-01-01 00:00:00'`).Scan(&timestampUpdated); err != nil || timestampUpdated != 5 {
			t.Fatal("repair must record truthful updated_at", timestampUpdated, err)
		}
		runSQL(repair)
		if snapshot() != before {
			t.Fatal("repair changed non-binding fields")
		}
		verify, err := os.ReadFile("../../../../console/docs/sql/Console-SQL-Verify-v2.21-enterprise-gateway-bindings.sql")
		if err != nil {
			t.Fatal(err)
		}
		var total, bound int
		if err = db.QueryRow(string(verify)).Scan(&total, &bound); err != nil || total != 5 || bound != 5 {
			t.Fatal("repair verification failed", total, bound, err)
		}
		// Remove only disposable fixtures to preserve the existing exchange cases.
		if _, err = db.Exec(`DELETE FROM service_client_grants WHERE service_client_id=12`); err != nil {
			t.Fatal(err)
		}
	})
	migration, err := os.ReadFile("../../../../console/docs/sql/Console-SQL-Migration-gateway-service-assertion-replay.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(string(migration)); err != nil {
		t.Fatal(err)
	}
	seed, err := os.ReadFile("../../../../console/docs/sql/Console-SQL-Seed-v2.20-gateway-service-token-exchange.sql")
	if err != nil {
		t.Fatal(err)
	}
	// Parse this additive seed into individual statements; all parameters are
	// public fixture identities, never environment credentials.
	lines := strings.Split(string(seed), "\n")
	filtered := []string{}
	for _, line := range lines {
		if !strings.HasPrefix(strings.TrimSpace(line), "--") {
			filtered = append(filtered, line)
		}
	}
	for i := 0; i < 2; i++ {
		for _, q := range strings.Split(strings.Join(filtered, "\n"), ";") {
			if strings.TrimSpace(q) != "" {
				if _, err = db.Exec(q); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM service_client_grants WHERE action='gateway-exchange'`).Scan(&count); err != nil || count != 1 {
		t.Fatal("seed not idempotent", err)
	}
	var scopeRaw string
	_ = db.QueryRow(`SELECT scope_json FROM service_client_grants WHERE action='gateway-exchange'`).Scan(&scopeRaw)
	var scope map[string]any
	_ = json.Unmarshal([]byte(scopeRaw), &scope)
	if scope["tenantCode"] != "C000001" || scope["semanticScope"] != GatewayExchangeScope || scope["deploymentCode"] != "wiztek-test-console" {
		t.Fatal("wrong seed binding")
	}
	verify, err := os.ReadFile("../../../../console/docs/sql/Console-SQL-Verify-v2.20-gateway-service-token-exchange.sql")
	if err != nil {
		t.Fatal(err)
	}
	verifyLines := []string{}
	for _, line := range strings.Split(string(verify), "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "--") {
			verifyLines = append(verifyLines, line)
		}
	}
	verifyRows, err := db.Query(strings.Join(verifyLines, "\n"))
	if err != nil {
		t.Fatal(err)
	}
	columns, err := verifyRows.Columns()
	if err != nil || !verifyRows.Next() {
		t.Fatal("verify did not return a row", err)
	}
	values := make([]sql.NullInt64, len(columns))
	pointers := make([]any, len(columns))
	for i := range values {
		pointers[i] = &values[i]
	}
	if err = verifyRows.Scan(pointers...); err != nil {
		t.Fatal(err)
	}
	for i, value := range values {
		if !value.Valid || value.Int64 != 1 {
			t.Fatalf("verify %s must equal 1", columns[i])
		}
	}
	if err = verifyRows.Close(); err != nil {
		t.Fatal(err)
	}
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	adapter := &Adapter{db: db, tenant: "C000001"}
	claims := gatewayClaims()
	claims.ExpiresAt = time.Now().Add(time.Minute).Unix()
	issue := func() (map[string]any, error) {
		return adapter.exchangeConsoleServiceTokenWithKey(context.Background(), gatewayBody(), "C000001", "C000001-test-console", oidcSigningKey{ID: 5, Kid: "fixture", PrivateKey: key}, &claims)
	}
	// A failing success audit must roll back the consumed jti as well as grant/client changes.
	if _, err = db.Exec(`CREATE TRIGGER reject_audit BEFORE INSERT ON auth_token_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture audit failure'`); err != nil {
		t.Fatal(err)
	}
	if result, e := issue(); e == nil || result != nil {
		t.Fatal("failed audit returned token")
	}
	_ = db.QueryRow(`SELECT COUNT(*) FROM gateway_service_assertion_replay`).Scan(&count)
	if count != 0 {
		t.Fatal("replay did not roll back")
	}
	_, _ = db.Exec(`DROP TRIGGER reject_audit`)
	var wg sync.WaitGroup
	wg.Add(2)
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() { defer wg.Done(); _, e := issue(); results <- e }()
	}
	wg.Wait()
	close(results)
	success, failed := 0, 0
	for e := range results {
		if e == nil {
			success++
		} else {
			failed++
		}
	}
	if success != 1 || failed != 1 {
		t.Fatalf("duplicate consumption: %d success %d failure", success, failed)
	}
	_ = db.QueryRow(`SELECT COUNT(*) FROM auth_token_events`).Scan(&count)
	if count != 1 {
		t.Fatal("more than one successful token audit")
	}
	// Cleanup only the first 100 expired rows, keeping fresh and skew-window rows.
	now := time.Now()
	for i := 0; i < 150; i++ {
		_, err = db.Exec(`INSERT INTO gateway_service_assertion_replay(gateway_deployment_code,jti,tenant_code,environment,kid,expires_at) VALUES(?,?,?,?,?,?)`, "cleanup-gateway", strings.ReplaceAll(uuid.NewString(), "-", ""), "C000001", "test", strings.Repeat("b", 64), now.Add(-time.Minute).UnixMilli())
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, ms := range []int64{now.Add(-10 * time.Second).UnixMilli(), now.Add(time.Minute).UnixMilli()} {
		_, err = db.Exec(`INSERT INTO gateway_service_assertion_replay(gateway_deployment_code,jti,tenant_code,environment,kid,expires_at) VALUES(?,?,?,?,?,?)`, "cleanup-gateway", strings.ReplaceAll(uuid.NewString(), "-", ""), "C000001", "test", strings.Repeat("b", 64), ms)
		if err != nil {
			t.Fatal(err)
		}
	}
	tx, _ := db.BeginTx(context.Background(), nil)
	if err = cleanupGatewayReplay(context.Background(), tx, now); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	_ = db.QueryRow(`SELECT COUNT(*) FROM gateway_service_assertion_replay WHERE gateway_deployment_code='cleanup-gateway'`).Scan(&count)
	if count != 52 {
		t.Fatalf("cleanup not bounded/skew safe: %d", count)
	}
	// Revoke the represented grant: no token, no new jti.
	_, _ = db.Exec(`UPDATE service_client_grants SET status='revoked' WHERE service_client_id=10`)
	claims.JTI = strings.ReplaceAll(uuid.NewString(), "-", "")
	if r, e := issue(); e == nil || r != nil {
		t.Fatal("revoked grant accepted")
	}
	_ = db.QueryRow(`SELECT COUNT(*) FROM gateway_service_assertion_replay WHERE gateway_deployment_code='test-gateway'`).Scan(&count)
	if count != 1 {
		t.Fatal("failed grant consumed jti")
	}
}
