package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"github.com/golang-jwt/jwt/v5"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseplanning"
	"io"
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

// Run only via scripts/test-enterprise-catalog-mysql.mjs. The wrapper owns
// the isolated server; this test owns and cleans its two random fixture schemas.
func TestEnterpriseCatalogHTTPMySQL(t *testing.T) {
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
		name := "hzy_catalog_http_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		"CREATE TABLE assets_product_assets(product_code VARCHAR(64) PRIMARY KEY,product_name VARCHAR(255),product_line VARCHAR(64),status VARCHAR(64),business_owner_uid VARCHAR(64),technical_owner_uid VARCHAR(64),project_code VARCHAR(64),updated_at DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB",
		"CREATE TABLE assets_asset_category_groups(category_scope VARCHAR(64),category_value VARCHAR(64),category_label VARCHAR(255),sort_order INT DEFAULT 0,updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY scope_value(category_scope,category_value)) ENGINE=InnoDB",
		"CREATE TABLE assets_product_catalog_state(id INT PRIMARY KEY,epoch VARCHAR(64),revision BIGINT,ready INT) ENGINE=InnoDB",
		"INSERT INTO enterprise_schema_registry VALUES(1,'tenant-a','isolated','runtime-test','v1',1)",
		"INSERT INTO assets_product_assets(product_code,product_name,product_line,status,business_owner_uid,technical_owner_uid,project_code) VALUES('A','Visible product','visible','iterating','person-a',NULL,'P1'),('B','Hidden product','hidden','poc','other',NULL,'P2')",
		"INSERT INTO assets_asset_category_groups(category_scope,category_value,category_label) VALUES('product','visible','Visible line'),('product','hidden','Hidden line')",
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
		"INSERT INTO service_client_grants VALUES(1,'aims:products','view','active')",
	} {
		exec(consoleDB, statement)
	}
	fixturePassword := uuid.NewString()
	// MySQL account DDL does not accept prepared value placeholders. The only
	// interpolated value is a locally generated UUID, never user/config input.
	exec(root, "CREATE USER 'hzy_catalog_http'@'127.0.0.1' IDENTIFIED BY '"+fixturePassword+"'")
	t.Cleanup(func() { _, _ = root.Exec("DROP USER 'hzy_catalog_http'@'127.0.0.1'") })
	exec(root, "GRANT SELECT,SHOW VIEW ON `"+businessName+"`.* TO 'hzy_catalog_http'@'127.0.0.1'")
	cfg := config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"enterprise": "enterprise-test", "assets": "assets-test"}, Enterprise: config.EnterpriseConfig{Enabled: true, Environment: "isolated", SchemaVersion: "v1", Generation: 1, InstanceID: instance, DB: config.DBConfig{Host: "127.0.0.1", Port: port, User: "hzy_catalog_http", Password: fixturePassword, Database: businessName, ConnectionLimit: 3}, Domains: map[string]config.EnterpriseDomainConfig{"assets": {OwnerDeployment: "assets-test", Read: enterprise.PathUnified, Write: enterprise.PathDisabled, Scheduler: enterprise.PathDisabled, Tables: map[string]string{"product_assets": "assets_product_assets", "asset_category_groups": "assets_asset_category_groups", "assets_product_catalog_state": "assets_product_catalog_state"}}}}}

	// Small route fixture; complete production-schema/query semantics are covered
	// by enterpriseplanning's canonical-schema MySQL test.
	for _, ddl := range []string{
		"CREATE TABLE aims_product_workspaces(product_code VARCHAR(64) PRIMARY KEY,biz_id VARCHAR(64),status VARCHAR(32),revision BIGINT,positioning TEXT,target_users TEXT,value_statement TEXT,created_by VARCHAR(64),updated_by VARCHAR(64),created_at DATETIME DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB",
		"CREATE TABLE aims_product_members(product_code VARCHAR(64),uid VARCHAR(64),relation_type VARCHAR(32),status VARCHAR(32),valid_from DATETIME,valid_until DATETIME) ENGINE=InnoDB",
		"CREATE TABLE aims_product_component_sources(source_product_code VARCHAR(64) PRIMARY KEY,product_code VARCHAR(64),component_id BIGINT,source_product_name VARCHAR(255)) ENGINE=InnoDB",
		"CREATE TABLE aims_product_line_workspaces(product_code VARCHAR(64) PRIMARY KEY,line_code VARCHAR(64),line_label VARCHAR(255)) ENGINE=InnoDB",
		"INSERT INTO aims_product_workspaces(product_code,biz_id,status,revision) VALUES('W','workspace','active',1)",
	} {
		exec(business, ddl)
	}
	cfg.DeploymentBindings["aims"] = "aims-test"
	names := []string{"product_workspaces", "product_members", "product_component_sources", "product_line_workspaces"}
	mapping := map[string]string{}
	for _, name := range names {
		mapping[name] = "aims_" + name
	}
	cfg.Enterprise.Domains["aims"] = config.EnterpriseDomainConfig{OwnerDeployment: "aims-test", Read: enterprise.PathUnified, Write: enterprise.PathDisabled, Scheduler: enterprise.PathDisabled, Tables: mapping}
	binding, err := cfg.EnterpriseBinding()
	if err != nil {
		t.Fatal(err)
	}
	exec(business, "UPDATE enterprise_schema_registry SET generation=0")
	plan, err := enterprise.PlanCompatibilityViews(context.Background(), business, binding, "aims", names)
	if err != nil {
		t.Fatal(err)
	}
	if err = enterprise.ApplyCompatibilityViews(context.Background(), business, binding, "aims", names, plan.ReviewHash); err != nil {
		t.Fatal(err)
	}
	exec(business, "UPDATE enterprise_schema_registry SET generation=1")
	// Workspace authorization uses the owning root FOR UPDATE lock.
	exec(root, "GRANT UPDATE ON `"+businessName+"`.`product_workspaces` TO 'hzy_catalog_http'@'127.0.0.1'")
	exec(root, "GRANT UPDATE ON `"+businessName+"`.`aims_product_workspaces` TO 'hzy_catalog_http'@'127.0.0.1'")
	// SELECT is sufficient for this read path's shared registry lock.
	registry, err := initializeEnterpriseRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { registry.Close() })
	service, err := enterpriseplanning.NewCatalogService(context.Background(), registry, binding)
	if err != nil {
		t.Fatal(err)
	}
	authenticator, signedTemplate, _ := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = "aims:products:view" }, true)
	server := httptest.NewServer(&Server{cfg: cfg, auth: authenticator, enterpriseRegistry: registry, enterpriseCatalog: service, console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-a", consoleDB)})
	defer server.Close()
	call := func(mutate func(*enterpriseProductListInput, *http.Request)) (int, string) {
		input := enterpriseProductListInput{Tenant: "tenant-a", Deployment: "enterprise-test", Input: pc.ProductListQuery{Page: 1, PageSize: 20}, Authorization: pc.ProductListPermit{ActorUID: "person-a", Resource: "products", Action: "view", ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli(), DefaultMask: 7}}
		input.AssetsAuthorization = enterpriseDirectoryAuthorization{ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "products", Action: "view", ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli(), Scope: map[string]string{"current_user_assets_object_access": "relation", "current_user_assets_scope_units": `[{"directRelation":true,"relationPredicates":["owner"]}]`}}
		request, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/enterprise/aims/product-list", nil)
		request.Header = signedTemplate.Header.Clone()
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, runtimeBearerToken(request), request.Method, request.URL.RequestURI(), "person-a", nil, request.Header.Get("X-HZY-Actor-Signed-At")))
		if mutate != nil {
			mutate(&input, request)
		}
		raw, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		request.Body = io.NopCloser(bytes.NewReader(raw))
		request.ContentLength = int64(len(raw))
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, _ := io.ReadAll(response.Body)
		return response.StatusCode, string(body)
	}
	code, body := call(nil)
	if code != 200 || !strings.Contains(body, "Visible product") || strings.Contains(body, "Hidden product") {
		t.Fatalf("scoped catalog %d %s", code, body)
	}
	exec(business, "UPDATE assets_product_assets SET product_name='Renamed live' WHERE product_code='A'")
	if code, body := call(nil); code != 200 || !strings.Contains(body, "Renamed live") {
		t.Fatalf("live rename %d %s", code, body)
	}
	code, body = call(func(i *enterpriseProductListInput, _ *http.Request) {
		i.AssetsAuthorization.Scope = map[string]string{"current_user_assets_object_access": "none"}
	})
	var page struct {
		Data pc.ProductListPage `json:"data"`
	}
	if code != 200 || json.Unmarshal([]byte(body), &page) != nil || page.Data.Total != 1 || len(page.Data.Items) != 1 || page.Data.Items[0].ProductCode != "W" || page.Data.Items[0].ProductName != nil {
		t.Fatalf("Assets denial must retain only Aims workspace code: %d %s", code, body)
	}
	for _, mutate := range []func(*enterpriseProductListInput, *http.Request){
		func(i *enterpriseProductListInput, _ *http.Request) { i.Tenant = "other" },
		func(i *enterpriseProductListInput, _ *http.Request) { i.Deployment = "other" },
		func(i *enterpriseProductListInput, _ *http.Request) { i.Authorization.ActorUID = "other" },
		func(i *enterpriseProductListInput, _ *http.Request) {
			i.Authorization.ExpiresAt = time.Now().Add(time.Minute).UnixMilli()
		},
		func(i *enterpriseProductListInput, _ *http.Request) { i.AssetsAuthorization.Tenant = "other" },
		func(i *enterpriseProductListInput, _ *http.Request) { i.AssetsAuthorization.Deployment = "other" },
		func(i *enterpriseProductListInput, _ *http.Request) { i.AssetsAuthorization.ActorUID = "other" },
		func(i *enterpriseProductListInput, _ *http.Request) { i.AssetsAuthorization.Scope["schema"] = "other" },
		func(_ *enterpriseProductListInput, r *http.Request) { r.Header.Set("X-HZY-Actor-Uid", "other") },
	} {
		if code, body := call(mutate); code != 403 {
			t.Fatalf("forged boundary accepted %d %s", code, body)
		}
	}
	exerciseEnterpriseWorkspaceHTTP(t, server.URL, signedTemplate, business)
	exec(consoleDB, "UPDATE service_client_grants SET status='revoked'")
	if code, body := call(nil); code != 403 {
		t.Fatalf("revoked grant accepted %d %s", code, body)
	}
	exec(consoleDB, "UPDATE service_client_grants SET status='active'")
	exec(consoleDB, "UPDATE service_client_credentials SET status='revoked'")
	if code, body := call(nil); code != 403 {
		t.Fatalf("revoked credential accepted %d %s", code, body)
	}
	exec(consoleDB, "UPDATE service_client_credentials SET status='active'")
	exec(business, "UPDATE enterprise_schema_registry SET generation=2")
	if code, body := call(nil); code != 503 {
		t.Fatalf("stale generation accepted %d %s", code, body)
	}
	t.Log("real HTTP, exact live grant, signed actor, tenant/deployment scopes, denial-as-empty Assets and current names verified")
}
