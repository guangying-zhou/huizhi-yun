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
func TestEnterpriseComponentCommandsHTTPMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_COMPONENTS_TEST_SOCKET")
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
		name := "hzy_components_http_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		"INSERT INTO service_client_grants VALUES(1,'aims:product-components','create','active'),(1,'aims:product-components','edit','active'),(1,'aims:product-components','move','active'),(1,'aims:product-components','delete','active')",
	} {
		exec(consoleDB, statement)
	}
	fixturePassword := uuid.NewString()
	// MySQL account DDL does not accept prepared value placeholders. The only
	// interpolated value is a locally generated UUID, never user/config input.
	exec(root, "CREATE USER 'hzy_components_http'@'127.0.0.1' IDENTIFIED BY '"+fixturePassword+"'")
	t.Cleanup(func() { _, _ = root.Exec("DROP USER 'hzy_components_http'@'127.0.0.1'") })
	exec(root, "GRANT SELECT,INSERT,UPDATE,DELETE,SHOW VIEW ON `"+businessName+"`.* TO 'hzy_components_http'@'127.0.0.1'")
	cfg := config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"enterprise": "enterprise-test", "assets": "assets-test"}, Enterprise: config.EnterpriseConfig{Enabled: true, Environment: "isolated", SchemaVersion: "v1", Generation: 1, InstanceID: instance, DB: config.DBConfig{Host: "127.0.0.1", Port: port, User: "hzy_components_http", Password: fixturePassword, Database: businessName, ConnectionLimit: 3}, Domains: map[string]config.EnterpriseDomainConfig{"assets": {OwnerDeployment: "assets-test", Read: enterprise.PathUnified, Write: enterprise.PathDisabled, Scheduler: enterprise.PathDisabled, Tables: map[string]string{"product_assets": "assets_product_assets", "asset_category_groups": "assets_asset_category_groups", "assets_product_catalog_state": "assets_product_catalog_state"}}}}}

	// Build the actual owning-domain schema needed by onboarding, including
	// uniqueness, command receipts and audit. No view points to a mock success store.
	names := []string{"product_catalog_control", "product_workspaces", "product_members", "product_command_receipts", "product_activity_logs", "product_components", "product_component_sources", "product_line_workspaces", "product_features", "product_requests"}
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
	exec(root, "GRANT UPDATE ON `"+businessName+"`.`product_workspaces` TO 'hzy_components_http'@'127.0.0.1'")
	exec(root, "GRANT UPDATE ON `"+businessName+"`.`aims_product_workspaces` TO 'hzy_components_http'@'127.0.0.1'")
	// SELECT is sufficient for this read path's shared registry lock.
	registry, err := initializeEnterpriseRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { registry.Close() })
	service, err := enterpriseplanning.NewComponentService(context.Background(), registry, binding)
	if err != nil {
		t.Fatal(err)
	}
	authenticator, signedTemplate, _ := enterpriseContextFixture(t, func(c jwt.MapClaims) {
		c["scope"] = "aims:product-components:create aims:product-components:edit aims:product-components:move aims:product-components:delete"
	}, true)
	server := httptest.NewServer(&Server{cfg: cfg, auth: authenticator, enterpriseRegistry: registry, enterpriseComponents: service, console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-a", consoleDB)})
	defer server.Close()
	exec(business, "INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P-A',?,'person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", uuid.NewString())
	call := func(action, key string, value any, mutate func(*enterpriseVersionReadInput)) (int, string) {
		t.Helper()
		facts, err := pc.LoadAuthorizationFacts(context.Background(), business, "P-A", "person-a")
		if err != nil {
			t.Fatal(err)
		}
		permission := "edit"
		if action == "delete" {
			permission = "delete"
		}
		raw, _ := json.Marshal(value)
		input := enterpriseVersionReadInput{ProductCode: "P-A", Tenant: "tenant-a", Deployment: "enterprise-test", Authorization: pc.AuthorizationPermit{Resource: "product_components", Action: permission, Facts: facts, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli()}, Input: raw}
		if mutate != nil {
			mutate(&input)
		}
		body, _ := json.Marshal(input)
		r, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/enterprise/aims/components:"+action, bytes.NewReader(body))
		r.Header = signedTemplate.Header.Clone()
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", key)
		r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, runtimeBearerToken(r), r.Method, r.URL.RequestURI(), "person-a", nil, r.Header.Get("X-HZY-Actor-Signed-At")))
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		out, _ := io.ReadAll(response.Body)
		return response.StatusCode, string(out)
	}
	verify := func(action, key string, input any) map[string]any {
		t.Helper()
		status, body := call(action, key, input, nil)
		if status != 200 {
			t.Fatal(action, status, body)
		}
		var result struct {
			Data struct {
				Value map[string]any `json:"value"`
			} `json:"data"`
		}
		if err = json.Unmarshal([]byte(body), &result); err != nil {
			t.Fatal(err)
		}
		if status, body := call(action, key, input, nil); status != 200 {
			t.Fatal("replay", action, status, body)
		}
		return result.Data.Value
	}
	draft := pc.ProductComponentDraft{Name: "Root", ExpectedRevision: 1}
	if status, body := call("create", "deny", draft, func(i *enterpriseVersionReadInput) { i.Authorization.Action = "view" }); status != 403 {
		t.Fatal("wrong permission", status, body)
	}
	if status, body := call("create", "deny", draft, func(i *enterpriseVersionReadInput) { i.Authorization.Facts.ActorUID = "other" }); status != 403 {
		t.Fatal("wrong actor", status, body)
	}
	rootValue := verify("create", "root", draft)
	rootID := int64(rootValue["id"].(float64))
	draft.Name = "Changed"
	if status, body := call("create", "root", draft, nil); status != 409 {
		t.Fatal("payload conflict", status, body)
	}
	child := verify("create", "child", pc.ProductComponentDraft{Name: "Child", ExpectedRevision: 2})
	childID := int64(child["id"].(float64))
	verify("edit", "edit", pc.ProductComponentEdit{ComponentID: rootID, Name: "Edited", Reason: "Clarify", ExpectedRevision: 3, ExpectedComponentRevision: 1})
	move := pc.ProductComponentMove{ComponentID: childID, ParentID: &rootID, Reason: "Organize", ExpectedRevision: 4, ExpectedComponentRevision: 1}
	exec(business, "CREATE TRIGGER component_http_late BEFORE INSERT ON aims_product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='late audit'")
	if status, body := call("move", "move", move, nil); status != 503 {
		t.Fatal("late rollback", status, body)
	}
	var revision, receipts int
	var parent sql.NullInt64
	if err = business.QueryRow("SELECT revision FROM aims_product_workspaces WHERE product_code='P-A'").Scan(&revision); err != nil || revision != 4 {
		t.Fatal("revision leak", revision, err)
	}
	if err = business.QueryRow("SELECT parent_id FROM aims_product_components WHERE id=?", childID).Scan(&parent); err != nil || parent.Valid {
		t.Fatal("tree leak", parent, err)
	}
	if err = business.QueryRow("SELECT COUNT(*) FROM aims_product_command_receipts").Scan(&receipts); err != nil || receipts != 3 {
		t.Fatal("receipt leak", receipts, err)
	}
	exec(business, "DROP TRIGGER component_http_late")
	verify("move", "move", move)
	if status, body := call("move", "cycle", pc.ProductComponentMove{ComponentID: rootID, ParentID: &childID, Reason: "cycle", ExpectedRevision: 5, ExpectedComponentRevision: 2}, nil); status != 400 {
		t.Fatal("cycle", status, body)
	}
	verify("delete", "delete-child", pc.ProductComponentDelete{ComponentID: childID, Reason: "Remove", ExpectedRevision: 5, ExpectedComponentRevision: 2})
	if err = business.QueryRow("SELECT COUNT(*) FROM aims_product_components").Scan(&receipts); err != nil || receipts != 1 {
		t.Fatal("delete", receipts, err)
	}
	exec(consoleDB, "UPDATE service_client_grants SET status='revoked' WHERE action='edit'")
	if status, body := call("edit", "revoked", pc.ProductComponentEdit{ComponentID: rootID, Name: "Updated", Reason: "Edit", ExpectedRevision: 6, ExpectedComponentRevision: 2}, nil); status != 403 {
		t.Fatal("exact grant revoked", status, body)
	}
	exec(business, "UPDATE enterprise_schema_registry SET generation=2")
	if status, body := call("create", "generation", pc.ProductComponentDraft{Name: "New", ExpectedRevision: 6}, nil); status != 503 {
		t.Fatal("generation", status, body)
	}
	t.Log("real signed Host HTTP -> exact grant -> owning create/edit/move/delete; replay, conflict, cycle guard, late audit rollback, actor/permit and generation verified")
}
