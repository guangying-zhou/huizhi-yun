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
func TestEnterpriseOnboardingHTTPMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_ONBOARDING_TEST_SOCKET")
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
		name := "hzy_onboard_http_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		"INSERT INTO service_client_grants VALUES(1,'aims:products','onboard','active')",
	} {
		exec(consoleDB, statement)
	}
	fixturePassword := uuid.NewString()
	// MySQL account DDL does not accept prepared value placeholders. The only
	// interpolated value is a locally generated UUID, never user/config input.
	exec(root, "CREATE USER 'hzy_onboard_http'@'127.0.0.1' IDENTIFIED BY '"+fixturePassword+"'")
	t.Cleanup(func() { _, _ = root.Exec("DROP USER 'hzy_onboard_http'@'127.0.0.1'") })
	exec(root, "GRANT SELECT,INSERT,UPDATE,DELETE,SHOW VIEW ON `"+businessName+"`.* TO 'hzy_onboard_http'@'127.0.0.1'")
	cfg := config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"enterprise": "enterprise-test", "assets": "assets-test"}, Enterprise: config.EnterpriseConfig{Enabled: true, Environment: "isolated", SchemaVersion: "v1", Generation: 1, InstanceID: instance, DB: config.DBConfig{Host: "127.0.0.1", Port: port, User: "hzy_onboard_http", Password: fixturePassword, Database: businessName, ConnectionLimit: 3}, Domains: map[string]config.EnterpriseDomainConfig{"assets": {OwnerDeployment: "assets-test", Read: enterprise.PathUnified, Write: enterprise.PathDisabled, Scheduler: enterprise.PathDisabled, Tables: map[string]string{"product_assets": "assets_product_assets", "asset_category_groups": "assets_asset_category_groups", "assets_product_catalog_state": "assets_product_catalog_state"}}}}}

	// Build the actual owning-domain schema needed by onboarding, including
	// uniqueness, command receipts and audit. No view points to a mock success store.
	names := []string{"product_catalog_control", "product_workspaces", "product_members", "product_command_receipts", "product_activity_logs", "product_components", "product_component_sources", "product_line_workspaces"}
	schema, err := os.ReadFile("../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	business.SetMaxOpenConns(1)
	exec(business, "SET FOREIGN_KEY_CHECKS=0")
	var renames []string
	for _, name := range names {
		start := strings.Index(string(schema), "CREATE TABLE IF NOT EXISTS "+name+" (")
		if start < 0 {
			start = strings.Index(string(schema), "CREATE TABLE IF NOT EXISTS `"+name+"` (")
		}
		if start < 0 {
			t.Fatal(name)
		}
		end := strings.Index(string(schema)[start:], ";\n")
		if end < 0 {
			t.Fatal("DDL terminator")
		}
		exec(business, string(schema)[start:start+end])
		renames = append(renames, "`"+name+"` TO `aims_"+name+"`")
	}
	exec(business, "RENAME TABLE "+strings.Join(renames, ","))
	exec(business, "SET FOREIGN_KEY_CHECKS=1")
	business.SetMaxOpenConns(4)
	exec(business, "INSERT INTO aims_product_catalog_control(id) VALUES(1)")
	cfg.DeploymentBindings["aims"] = "aims-test"
	mapping := map[string]string{}
	for _, name := range names {
		mapping[name] = "aims_" + name
	}
	cfg.Enterprise.Domains["aims"] = config.EnterpriseDomainConfig{OwnerDeployment: "aims-test", Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathDisabled, Tables: mapping}
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
	exec(root, "GRANT UPDATE ON `"+businessName+"`.`product_workspaces` TO 'hzy_onboard_http'@'127.0.0.1'")
	exec(root, "GRANT UPDATE ON `"+businessName+"`.`aims_product_workspaces` TO 'hzy_onboard_http'@'127.0.0.1'")
	// SELECT is sufficient for this read path's shared registry lock.
	registry, err := initializeEnterpriseRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { registry.Close() })
	service, err := enterpriseplanning.NewOnboardingService(context.Background(), registry, binding)
	if err != nil {
		t.Fatal(err)
	}
	authenticator, signedTemplate, _ := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = "aims:products:onboard" }, true)
	server := httptest.NewServer(&Server{cfg: cfg, auth: authenticator, enterpriseRegistry: registry, enterpriseOnboarding: service, console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-a", consoleDB)})
	defer server.Close()
	call := func(action, code, line string, body any, mutate func(*enterpriseOnboardInput)) (int, string) {
		t.Helper()
		inputRaw, _ := json.Marshal(body)
		product := code
		if line != "" {
			product = pc.LineWorkspaceCode(line)
		}
		if action == "candidates" {
			product = "*"
		}
		input := enterpriseOnboardInput{Tenant: "tenant-a", Deployment: "enterprise-test", ProductCode: code, LineCode: line, Input: inputRaw, Authorization: pc.OnboardPermit{ProductCode: product, ActorUID: "person-a", Resource: "products", Action: "onboard", ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli()}, Directory: pc.MemberDirectoryEvidence{ActiveUIDs: []string{"person-a"}, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli()}, AssetsAuthorization: enterpriseDirectoryAuthorization{ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "products", Action: "view", ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli(), Scope: map[string]string{"current_user_assets_object_access": "relation", "current_user_assets_scope_units": `[{"directRelation":true,"relationPredicates":["owner"]}]`}}}
		if mutate != nil {
			mutate(&input)
		}
		paths := map[string]string{"candidates": "product-onboard:candidates", "candidate": "product-onboard:candidate", "line-candidates": "product-line-onboard:candidates", "onboard": "product-onboard", "onboard-line": "product-line-onboard"}
		raw, _ := json.Marshal(input)
		r, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/enterprise/aims/"+paths[action], bytes.NewReader(raw))
		r.Header = signedTemplate.Header.Clone()
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", "onboard-"+code+line)
		r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, runtimeBearerToken(r), r.Method, r.URL.RequestURI(), "person-a", nil, r.Header.Get("X-HZY-Actor-Signed-At")))
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		out, _ := io.ReadAll(response.Body)
		return response.StatusCode, string(out)
	}
	status, body := call("candidates", "", "", map[string]any{"page": 1, "pageSize": 10}, nil)
	if status != 200 || !strings.Contains(body, "Visible product") || strings.Contains(body, "Hidden product") {
		t.Fatal("candidate scope", status, body)
	}
	if status, body := call("candidate", "B", "", nil, nil); status != 403 {
		t.Fatal("hidden candidate", status, body)
	}
	if status, body := call("line-candidates", "", "visible", nil, nil); status != 403 {
		t.Fatal("partial line scope", status, body)
	}
	draft := pc.OnboardInput{ManagerUID: "person-a", Reason: "Plan product"}
	for _, mutate := range []func(*enterpriseOnboardInput){func(i *enterpriseOnboardInput) { i.Tenant = "other" }, func(i *enterpriseOnboardInput) { i.Authorization.ActorUID = "other" }, func(i *enterpriseOnboardInput) { i.Authorization.ExpiresAt = time.Now().Add(time.Minute).UnixMilli() }, func(i *enterpriseOnboardInput) { i.AssetsAuthorization.ActorUID = "other" }} {
		if status, body := call("onboard", "A", "", draft, mutate); status != 403 {
			t.Fatal("forged permit", status, body)
		}
	}
	exec(business, "CREATE TRIGGER onboarding_late BEFORE INSERT ON aims_product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='late audit failure'")
	if status, body := call("onboard", "A", "", draft, nil); status != 503 {
		t.Fatal("late audit", status, body)
	}
	var count int
	for _, table := range []string{"aims_product_workspaces", "aims_product_members", "aims_product_command_receipts"} {
		if err = business.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatal("rollback", table, count, err)
		}
	}
	exec(business, "DROP TRIGGER onboarding_late")
	if status, body := call("onboard", "A", "", draft, nil); status != 200 {
		t.Fatal("onboard", status, body)
	}
	if status, body := call("onboard", "A", "", draft, nil); status != 200 {
		t.Fatal("replay", status, body)
	}
	if err = business.QueryRow("SELECT COUNT(*) FROM aims_product_command_receipts").Scan(&count); err != nil || count != 1 {
		t.Fatal("duplicate receipt", count, err)
	}
	draft.Reason = "different"
	if status, body := call("onboard", "A", "", draft, nil); status != 409 {
		t.Fatal("payload conflict", status, body)
	}
	allAssets := func(i *enterpriseOnboardInput) {
		i.AssetsAuthorization.Scope = map[string]string{"current_user_assets_object_access": "all"}
	}
	status, body = call("line-candidates", "", "hidden", nil, allAssets)
	var candidates struct {
		Data struct {
			Watermark string `json:"watermark"`
		} `json:"data"`
	}
	if status != 200 || json.Unmarshal([]byte(body), &candidates) != nil || candidates.Data.Watermark == "" {
		t.Fatal("line candidate", status, body)
	}
	lineInput := pc.LineOnboardInput{LineCode: "hidden", ExpectedWatermark: candidates.Data.Watermark, ManagerUID: "person-a", ProductCodes: []string{"B"}}
	if status, body := call("onboard-line", "", "hidden", lineInput, allAssets); status != 200 {
		t.Fatal("line onboard", status, body)
	}
	if status, body := call("onboard-line", "", "hidden", lineInput, allAssets); status != 200 {
		t.Fatal("line replay", status, body)
	}
	if err = business.QueryRow("SELECT COUNT(*) FROM aims_product_component_sources WHERE source_product_code='B'").Scan(&count); err != nil || count != 1 {
		t.Fatal("line source", count, err)
	}
	exec(consoleDB, "UPDATE service_client_grants SET status='revoked'")
	if status, body := call("candidates", "", "", map[string]any{}, nil); status != 403 {
		t.Fatal("revoked service grant", status, body)
	}
	exec(consoleDB, "UPDATE service_client_grants SET status='active'")
	exec(business, "UPDATE enterprise_schema_registry SET generation=2")
	if status, body := call("candidates", "", "", map[string]any{}, nil); status != 503 {
		t.Fatal("generation", status, body)
	}
	t.Log("real signed Host request, current Assets scoped candidates, atomic onboard/replay/conflict, identity binding, late rollback, service revocation and generation guard passed")
}
