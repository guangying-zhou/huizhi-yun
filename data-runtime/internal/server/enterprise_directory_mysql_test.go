package server

import (
	"bytes"
	"database/sql"
	"encoding/json"
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
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// Run only via scripts/test-enterprise-directory-mysql.mjs. The wrapper owns
// the isolated server; this test owns and cleans its two random fixture schemas.
func TestEnterpriseDirectoryHTTPMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_ROUTE_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires dedicated temporary MySQL harness")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("refusing non-isolated socket")
	}
	mc := mysql.NewConfig()
	mc.User, mc.Net, mc.Addr, mc.ParseTime = "root", "unix", socket, true
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	var instance string
	var port int
	if err := root.QueryRow("SELECT @@server_uuid,@@port").Scan(&instance, &port); err != nil {
		t.Fatal(err)
	}
	newSchema := func() (string, *sql.DB) {
		name := "hzy_directory_http_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		if _, err := root.Exec("CREATE DATABASE `" + name + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if _, err := root.Exec("DROP DATABASE `" + name + "`"); err != nil {
				t.Error(err)
			}
		})
		local := *mc
		local.DBName = name
		db, err := sql.Open("mysql", local.FormatDSN())
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		return name, db
	}
	businessName, business := newSchema()
	_, consoleDB := newSchema()
	exec := func(db *sql.DB, statement string, args ...any) {
		t.Helper()
		if _, err := db.Exec(statement, args...); err != nil {
			t.Fatal(err)
		}
	}
	for _, statement := range []string{
		"CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(64),environment_code VARCHAR(64),runtime_deployment VARCHAR(64),schema_version VARCHAR(64),generation BIGINT) ENGINE=InnoDB",
		"CREATE TABLE assets_product_assets(product_code VARCHAR(64) PRIMARY KEY,product_name VARCHAR(255),product_line VARCHAR(64),status VARCHAR(64),business_owner_uid VARCHAR(64),technical_owner_uid VARCHAR(64),project_code VARCHAR(64)) ENGINE=InnoDB",
		"CREATE TABLE assets_asset_category_groups(category_scope VARCHAR(64),category_value VARCHAR(64),category_label VARCHAR(255),UNIQUE KEY scope_value(category_scope,category_value)) ENGINE=InnoDB",
		"CREATE TABLE assets_product_catalog_state(id INT PRIMARY KEY,epoch VARCHAR(64),revision BIGINT,ready INT) ENGINE=InnoDB",
		"INSERT INTO enterprise_schema_registry VALUES(1,'tenant-a','isolated','runtime-test','v1',1)",
		"INSERT INTO assets_product_assets VALUES('A','Visible product','visible','iterating','person-a',NULL,'P1'),('B','Hidden product','hidden','poc','other',NULL,'P2')",
		"INSERT INTO assets_asset_category_groups VALUES('product','visible','Visible line'),('product','hidden','Hidden line')",
		"INSERT INTO assets_product_catalog_state VALUES(1,'epoch',1,1)",
	} {
		exec(business, statement)
	}
	for _, statement := range []string{
		"CREATE TABLE service_clients(id BIGINT PRIMARY KEY,status VARCHAR(20),current_credential_id BIGINT) ENGINE=InnoDB",
		"CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,service_client_id BIGINT,client_id VARCHAR(128),status VARCHAR(20),expires_at DATETIME) ENGINE=InnoDB",
		"CREATE TABLE service_client_grants(service_client_id BIGINT,resource_code VARCHAR(128),action VARCHAR(64),status VARCHAR(20)) ENGINE=InnoDB",
		"INSERT INTO service_clients VALUES(1,'active',7)",
		"INSERT INTO service_client_credentials VALUES(7,1,'enterprise.runtime','active',NULL)",
		"INSERT INTO service_client_grants VALUES(1,'assets:product','read','active')",
	} {
		exec(consoleDB, statement)
	}
	fixturePassword := uuid.NewString()
	// MySQL account DDL does not accept prepared value placeholders. The only
	// interpolated value is a locally generated UUID, never user/config input.
	exec(root, "CREATE USER 'hzy_directory_http'@'127.0.0.1' IDENTIFIED BY '"+fixturePassword+"'")
	t.Cleanup(func() { _, _ = root.Exec("DROP USER 'hzy_directory_http'@'127.0.0.1'") })
	exec(root, "GRANT SELECT ON `"+businessName+"`.* TO 'hzy_directory_http'@'127.0.0.1'")
	cfg := config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"enterprise": "enterprise-test", "assets": "assets-test"}, Enterprise: config.EnterpriseConfig{Enabled: true, Environment: "isolated", SchemaVersion: "v1", Generation: 1, InstanceID: instance, DB: config.DBConfig{Host: "127.0.0.1", Port: port, User: "hzy_directory_http", Password: fixturePassword, Database: businessName, ConnectionLimit: 3}, Domains: map[string]config.EnterpriseDomainConfig{"assets": {OwnerDeployment: "assets-test", Read: enterprise.PathUnified, Write: enterprise.PathDisabled, Scheduler: enterprise.PathDisabled, Tables: map[string]string{"product_assets": "assets_product_assets", "asset_category_groups": "assets_asset_category_groups", "assets_product_catalog_state": "assets_product_catalog_state"}}}}}
	registry, err := initializeEnterpriseRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { registry.Close() })
	authenticator, signedTemplate, _ := enterpriseContextFixture(t, nil, true)
	s := &Server{cfg: cfg, auth: authenticator, enterpriseRegistry: registry, console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-a", consoleDB)}
	call := func(mutate func(*enterpriseDirectoryInput)) *httptest.ResponseRecorder {
		input := enterpriseDirectoryInput{}
		input.Query.Page, input.Query.PageSize = 1, 50
		input.Authorization.ActorUID, input.Authorization.Tenant, input.Authorization.Deployment = "person-a", "tenant-a", "enterprise-test"
		input.Authorization.Resource, input.Authorization.Action, input.Authorization.ExpiresAt = "products", "view", time.Now().Add(10*time.Second).UnixMilli()
		input.Authorization.Scope = map[string]string{"current_user_assets_object_access": "relation", "current_user_assets_scope_units": `[{"directRelation":true,"relationPredicates":["owner"]}]`}
		if mutate != nil {
			mutate(&input)
		}
		raw, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(http.MethodPost, "/v1/enterprise/assets/product-directory", bytes.NewReader(raw))
		r.Header = signedTemplate.Header.Clone()
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, runtimeBearerToken(r), r.Method, r.URL.RequestURI(), "person-a", nil, r.Header.Get("X-HZY-Actor-Signed-At")))
		response := httptest.NewRecorder()
		s.ServeHTTP(response, r)
		return response
	}
	first := call(nil)
	if first.Code != 200 || !strings.Contains(first.Body.String(), "Visible product") || strings.Contains(first.Body.String(), "Hidden") {
		t.Fatalf("authorized route: %d %s", first.Code, first.Body.String())
	}
	exec(business, "UPDATE assets_product_assets SET product_name='Renamed product' WHERE product_code='A'")
	if got := call(nil); got.Code != 200 || !strings.Contains(got.Body.String(), "Renamed product") {
		t.Fatalf("current fact missing: %d %s", got.Code, got.Body.String())
	}
	if got := call(func(i *enterpriseDirectoryInput) { i.Authorization.Tenant = "tenant-b" }); got.Code != 403 {
		t.Fatalf("cross-tenant proof accepted: %d", got.Code)
	}
	exec(consoleDB, "UPDATE service_client_grants SET status='revoked'")
	if got := call(nil); got.Code != 403 {
		t.Fatalf("revoked grant accepted: %d %s", got.Code, got.Body.String())
	}
	exec(consoleDB, "UPDATE service_client_grants SET status='active'")
	exec(consoleDB, "UPDATE service_client_credentials SET status='revoked'")
	if got := call(nil); got.Code != 403 {
		t.Fatalf("revoked credential accepted: %d", got.Code)
	}
	exec(consoleDB, "DROP TABLE service_client_credentials")
	if got := call(nil); got.Code != 503 || strings.Contains(got.Body.String(), businessName) || strings.Contains(got.Body.String(), "doesn't exist") {
		t.Fatalf("dependency failure not redacted: %d %s", got.Code, got.Body.String())
	}
}
