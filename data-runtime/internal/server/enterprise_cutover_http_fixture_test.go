package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"encoding/pem"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// A real HTTP fixture process for the Node Platform/coordinator integration.
// The active DB state is fixture data; ActivateFinalCopy itself is exercised in
// TestSourceFenceMySQL. No route, signing or observation implementation is mocked.
func TestCutoverActivationHTTPFixture(t *testing.T) {
	socket, dir := os.Getenv("HZY_CUTOVER_HTTP_SOCKET"), os.Getenv("HZY_CUTOVER_HTTP_DIR")
	if socket == "" {
		t.Skip("dedicated fixture only")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || !strings.HasPrefix(filepath.Clean(dir), "/tmp/hzy-cutover-http-") {
		t.Fatal("isolated fixture paths required")
	}
	token, evidence := os.Getenv("HZY_CUTOVER_HTTP_TOKEN"), os.Getenv("HZY_CUTOVER_EVIDENCE_HASH")
	if token == "" || len(evidence) != 64 {
		t.Fatal("fixture identity missing")
	}
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.Net = "unix"
	mc.Addr = socket
	mc.DBName = "hzy_console"
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var instance string
	if err := db.QueryRow("SELECT @@server_uuid").Scan(&instance); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{
		"CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(64),environment_code VARCHAR(32),runtime_deployment VARCHAR(128),schema_version VARCHAR(32),generation BIGINT)",
		"INSERT INTO enterprise_schema_registry VALUES(1,'C000001','test','fixture-runtime','v1',7)",
		"CREATE TABLE enterprise_cutover_receipt(operation_key VARCHAR(191),review_hash CHAR(64),evidence_hash CHAR(64),generation BIGINT)",
		"CREATE TABLE enterprise_migration_ledger(id INT PRIMARY KEY,review_hash CHAR(64),status VARCHAR(32))",
		"INSERT INTO enterprise_migration_ledger VALUES(1,REPEAT('b',64),'active')",
		"CREATE TABLE aims_enterprise_source_fence(id INT PRIMARY KEY,state VARCHAR(32),contract_hash CHAR(64),transition_key VARCHAR(191))",
		"CREATE TABLE assets_enterprise_source_fence LIKE aims_enterprise_source_fence",
		"INSERT INTO aims_enterprise_source_fence VALUES(1,'active',REPEAT('c',64),'cutover-1')",
		"INSERT INTO assets_enterprise_source_fence SELECT * FROM aims_enterprise_source_fence",
	} {
		if _, err := db.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec("INSERT INTO enterprise_cutover_receipt VALUES('cutover-1',REPEAT('b',64),?,7)", evidence); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{Tenant: "C000001", Deployment: "fixture-runtime", DeploymentBindings: map[string]string{"aims": "C000001-test-aims", "assets": "C000001-test-assets"}, Control: config.ControlConfig{RuntimeCode: "runtime-1", Token: token}, Enterprise: config.EnterpriseConfig{Enabled: true, Environment: "test", SchemaVersion: "v1", Generation: 7, InstanceID: instance, DB: config.DBConfig{Host: "127.0.0.1", Port: 3306, User: "root", Database: "hzy_console", ConnectionLimit: 1}, Domains: map[string]config.EnterpriseDomainConfig{"aims": {OwnerDeployment: "C000001-test-aims", Tables: map[string]string{"facts": "aims_facts"}, Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathUnified}}}}
	binding, err := cfg.EnterpriseBinding()
	if err != nil {
		t.Fatal(err)
	}
	registry := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if err := registry.Register(context.Background(), binding); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewTLSServer(&Server{cfg: cfg, enterpriseRegistry: registry})
	defer srv.Close()
	cert := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: srv.Certificate().Raw})
	if err := os.WriteFile(filepath.Join(dir, "ca.pem"), cert, 0600); err != nil {
		t.Fatal(err)
	}
	ready, _ := json.Marshal(map[string]string{"endpoint": srv.URL})
	if err := os.WriteFile(filepath.Join(dir, "ready.json"), ready, 0600); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(90 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(filepath.Join(dir, "stop")); err == nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("fixture orchestrator did not stop")
}
