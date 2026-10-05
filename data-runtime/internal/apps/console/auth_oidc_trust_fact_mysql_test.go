package console

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/config"
)

func TestOIDCTrustFactMySQL(t *testing.T) {
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
	cfg.ParseTime = true
	root, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	name := "trust_fact_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	for _, q := range []string{
		`CREATE TABLE console_mutation_receipts(receipt_id VARCHAR(64) PRIMARY KEY,tenant_code VARCHAR(64) NOT NULL,operation_code VARCHAR(128) NOT NULL,idempotency_key VARCHAR(191) NOT NULL,request_sha256 CHAR(64) NOT NULL,status VARCHAR(32) NOT NULL,actor_type VARCHAR(32),actor_id VARCHAR(128),request_id VARCHAR(64),result_json JSON,response_http_status INT,created_at DATETIME(3),updated_at DATETIME(3),completed_at DATETIME(3),UNIQUE KEY uk_console_mutation_receipt_identity(tenant_code,operation_code,idempotency_key))`,
		`CREATE TABLE operation_logs(id BIGINT AUTO_INCREMENT PRIMARY KEY,domain_code VARCHAR(32),action VARCHAR(128),target_type VARCHAR(64),target_key VARCHAR(191),actor_type VARCHAR(32),actor_id VARCHAR(128),request_id VARCHAR(64),detail_json JSON,created_at DATETIME)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	a := NewWithDB(config.ConsoleConfig{}, "tenant-a", db)
	b := NewWithDB(config.ConsoleConfig{}, "tenant-a", db)
	fact := OIDCTrustFact{TenantCode: "tenant-a", DeploymentCode: "console-a", RuntimeCode: "runtime-a", Issuer: "https://tenant.example.test", Audience: "data-runtime", JWKSURL: "https://tenant.example.test/.well-known/jwks.json"}
	ctx := context.Background()
	meta := AuditMutationMeta{ActorType: "system", ActorID: "platform:tenant-owner"}
	if _, present, err := a.ReadOIDCTrustFact(ctx, "console-a", "runtime-a"); err != nil || present {
		t.Fatalf("initial presence=%v error=%v", present, err)
	}
	var wg sync.WaitGroup
	failures := make(chan error, 2)
	for _, adapter := range []*Adapter{a, b} {
		wg.Add(1)
		go func(adapter *Adapter) { defer wg.Done(); failures <- adapter.EnsureOIDCTrustFact(ctx, fact, meta) }(adapter)
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	stored, present, err := b.ReadOIDCTrustFact(ctx, "console-a", "runtime-a")
	if err != nil || !present || stored != fact {
		t.Fatalf("shared receipt presence=%v error=%v", present, err)
	}
	jti := "8a22952d-9467-40f3-bbca-4cfd8412fa86"
	trust := map[string]any{"issuer": fact.Issuer, "audience": fact.Audience, "jwksUrl": fact.JWKSURL}
	replay, err := a.ConsumeOIDCBootstrapJTI(ctx, jti, trust, meta)
	if err != nil || replay {
		t.Fatalf("first jti replay=%v error=%v", replay, err)
	}
	replay, err = b.ConsumeOIDCBootstrapJTI(ctx, jti, trust, meta)
	if err != nil || !replay {
		t.Fatalf("second instance jti replay=%v error=%v", replay, err)
	}
	changed := fact
	changed.Issuer = "https://different.example.test"
	changed.JWKSURL = changed.Issuer + "/.well-known/jwks.json"
	assertSigningConflict := func(err error) {
		t.Helper()
		assertHTTPErrorCode(t, err, 409, "console_oidc_bootstrap_jwt_trust_immutable")
	}
	assertSigningConflict(a.EnsureOIDCTrustFact(ctx, changed, meta))
	assertSigningConflict(b.EnsureOIDCTrustFact(ctx, changed, meta))
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM console_mutation_receipts`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("receipt count=%d error=%v", count, err)
	}
	// A consumed JTI cannot carry a different trust, even after a new Adapter.
	trust["issuer"] = changed.Issuer
	_, err = b.ConsumeOIDCBootstrapJTI(ctx, jti, trust, meta)
	assertHTTPErrorCode(t, err, 409, "idempotency_payload_mismatch")
	if err := db.QueryRow(`SELECT COUNT(*) FROM operation_logs`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("audit count=%d error=%v", count, err)
	}
	// Corruption of the fixed receipt fails closed rather than making it absent.
	raw, _ := json.Marshal(map[string]any{"fact": fact, "sha256": "corrupt"})
	if _, err := db.Exec(`UPDATE console_mutation_receipts SET result_json=? WHERE operation_code=?`, raw, oidcTrustFactOperation); err != nil {
		t.Fatal(err)
	}
	_, _, err = b.ReadOIDCTrustFact(ctx, "console-a", "runtime-a")
	assertHTTPErrorCode(t, err, 503, "console_oidc_bootstrap_trust_receipt_invalid")
}
