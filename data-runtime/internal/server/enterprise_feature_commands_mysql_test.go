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
func TestEnterpriseFeatureCommandsHTTPMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_FEATURES_TEST_SOCKET")
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
		name := "hzy_features_http_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		"INSERT INTO service_client_grants VALUES(1,'aims:product-features','read','active'),(1,'aims:product-features','create','active'),(1,'aims:product-features','edit','active'),(1,'aims:product-features','delete','active'),(1,'aims:product-features','component-assign','active'),(1,'aims:product-features','lifecycle','active'),(1,'aims:product-features','request-link','active'),(1,'aims:product-priorities','read','active')",
	} {
		exec(consoleDB, statement)
	}
	fixturePassword := uuid.NewString()
	// MySQL account DDL does not accept prepared value placeholders. The only
	// interpolated value is a locally generated UUID, never user/config input.
	exec(root, "CREATE USER 'hzy_features_http'@'127.0.0.1' IDENTIFIED BY '"+fixturePassword+"'")
	t.Cleanup(func() { _, _ = root.Exec("DROP USER 'hzy_features_http'@'127.0.0.1'") })
	exec(root, "GRANT SELECT,INSERT,UPDATE,DELETE,SHOW VIEW ON `"+businessName+"`.* TO 'hzy_features_http'@'127.0.0.1'")
	cfg := config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"enterprise": "enterprise-test", "assets": "assets-test"}, Enterprise: config.EnterpriseConfig{Enabled: true, Environment: "isolated", SchemaVersion: "v1", Generation: 1, InstanceID: instance, DB: config.DBConfig{Host: "127.0.0.1", Port: port, User: "hzy_features_http", Password: fixturePassword, Database: businessName, ConnectionLimit: 3}, Domains: map[string]config.EnterpriseDomainConfig{"assets": {OwnerDeployment: "assets-test", Read: enterprise.PathUnified, Write: enterprise.PathDisabled, Scheduler: enterprise.PathDisabled, Tables: map[string]string{"product_assets": "assets_product_assets", "asset_category_groups": "assets_asset_category_groups", "assets_product_catalog_state": "assets_product_catalog_state"}}}}}

	// Build the actual owning-domain schema needed by onboarding, including
	// uniqueness, command receipts and audit. No view points to a mock success store.
	names := []string{"product_workspaces", "product_members", "product_command_receipts", "product_activity_logs", "product_features", "product_components", "product_requests", "product_request_features", "product_feedback_bindings", "product_versions", "product_version_features", "product_version_plans", "product_version_plan_scopes", "product_version_plan_confirmations", "product_planning_items", "product_planning_item_requests", "product_planning_cycles", "product_planning_cycle_items", "product_release_events", "product_release_records", "product_catalog_control"}
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
	exec(root, "GRANT UPDATE ON `"+businessName+"`.`product_workspaces` TO 'hzy_features_http'@'127.0.0.1'")
	exec(root, "GRANT UPDATE ON `"+businessName+"`.`aims_product_workspaces` TO 'hzy_features_http'@'127.0.0.1'")
	// SELECT is sufficient for this read path's shared registry lock.
	registry, err := initializeEnterpriseRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { registry.Close() })
	service, err := enterpriseplanning.NewFeatureService(context.Background(), registry, binding)
	if err != nil {
		t.Fatal(err)
	}
	authenticator, signedTemplate, _ := enterpriseContextFixture(t, func(c jwt.MapClaims) {
		c["scope"] = "aims:product-features:read aims:product-features:create aims:product-features:edit aims:product-features:delete aims:product-features:component-assign aims:product-features:lifecycle aims:product-features:request-link aims:product-priorities:read"
	}, true)
	server := httptest.NewServer(&Server{cfg: cfg, auth: authenticator, enterpriseRegistry: registry, enterpriseFeatures: service, console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-a", consoleDB)})
	defer server.Close()
	exec(business, "INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P-A',?,'person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", uuid.NewString())
	call := func(action, key string, value any, mutate func(*enterpriseFeatureInput)) (int, string) {
		t.Helper()
		facts, err := pc.LoadAuthorizationFacts(context.Background(), business, "P-A", "person-a")
		if err != nil {
			t.Fatal(err)
		}
		permission := "edit"
		if action == "list" || action == "view" {
			permission = "view"
		}
		if action == "delete" {
			permission = "delete"
		}
		raw, _ := json.Marshal(value)
		input := enterpriseFeatureInput{ProductCode: "P-A", Tenant: "tenant-a", Deployment: "enterprise-test", Authorization: pc.AuthorizationPermit{Resource: "product_features", Action: permission, Facts: facts, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli()}, Input: raw}
		input.RequestAuthorization = pc.AuthorizationPermit{Resource: "product_requests", Action: "view", Facts: facts, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli()}
		if action == "request-link" {
			input.RequestAuthorization.Action = "edit"
		}
		input.FeatureAuthorization = pc.AuthorizationPermit{Resource: "product_features", Action: "view", Facts: facts, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli()}
		input.PlanningAuthorization = pc.AuthorizationPermit{Resource: "product_priorities", Action: "view", Facts: facts, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli()}
		if action == "cycles" {
			input.Authorization = input.PlanningAuthorization
		}
		if mutate != nil {
			mutate(&input)
		}
		body, _ := json.Marshal(input)
		r, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/enterprise/aims/features:"+action, bytes.NewReader(body))
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

	expect := func(action, key string, v any, want int) map[string]any {
		t.Helper()
		status, body := call(action, key, v, nil)
		if status != want {
			t.Fatalf("%s got %d want %d: %s", action, status, want, body)
		}
		var out map[string]any
		if err := json.Unmarshal([]byte(body), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	revision := func() uint64 {
		var n uint64
		if err := business.QueryRow("SELECT revision FROM product_workspaces WHERE product_code='P-A'").Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	count := func(table string) int {
		var n int
		if err := business.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	draft := pc.FeatureDraft{ExpectedRevision: revision(), Title: "Login", Description: "Candidate"}
	result := expect("create", "feature-create", draft, 200)
	value := result["data"].(map[string]any)["value"].(map[string]any)
	feature := value["biz_id"].(string)
	expect("create", "feature-create", draft, 200)
	draft.Title = "Different"
	expect("create", "feature-create", draft, 409)
	query := pc.FeaturePageQuery{Page: 1, PageSize: 1, Keyword: "Login"}
	beforeReceipts, beforeAudit := count("product_command_receipts"), count("product_activity_logs")
	page := expect("list", "", query, 200)["data"].(map[string]any)
	if page["total"] != float64(1) || len(page["items"].([]any)) != 1 {
		t.Fatal(page)
	}
	expect("view", "", map[string]any{"biz_id": feature}, 200)
	expect("cycles", "", pc.PlanningCyclePageQuery{Page: 1, PageSize: 20}, 200)
	expect("request-list", "", pc.FeatureRequestPageQuery{FeatureBizID: feature, Page: 1, PageSize: 20}, 200)
	expect("unscheduled", "", pc.FeatureUnscheduledQuery{FeatureBizID: feature, Page: 1, PageSize: 20}, 200)
	if count("product_command_receipts") != beforeReceipts || count("product_activity_logs") != beforeAudit {
		t.Fatal("read wrote audit/receipt")
	}
	for _, mutate := range []func(*enterpriseFeatureInput){func(i *enterpriseFeatureInput) { i.Tenant = "other" }, func(i *enterpriseFeatureInput) { i.Authorization.Facts.ActorUID = "other" }, func(i *enterpriseFeatureInput) { i.Authorization.Action = "edit" }} {
		status, body := call("list", "", query, mutate)
		if status != 403 {
			t.Fatal(status, body)
		}
	}
	status, body := call("request-list", "", pc.FeatureRequestPageQuery{FeatureBizID: feature, Page: 1, PageSize: 20}, func(i *enterpriseFeatureInput) { i.RequestAuthorization.ExpiresAt = 0 })
	if status != 403 {
		t.Fatal(status, body)
	}
	edit := pc.FeatureEdit{FeatureDraft: pc.FeatureDraft{ExpectedRevision: revision(), Title: "Updated"}, BizID: feature, ExpectedFeatureRevision: 1, Reason: "Correction"}
	expect("edit", "feature-edit", edit, 200)
	expect("edit", "feature-edit", edit, 200)
	assign := pc.FeatureComponentAssignment{BizID: feature, ExpectedRevision: revision(), ExpectedFeatureRevision: 2, Reason: "Keep ungrouped"}
	expect("component-assign", "feature-assign", assign, 200)
	// A late audit failure must roll back the feature, workspace revision and receipt.
	prior := revision()
	edit.ExpectedRevision = prior
	edit.ExpectedFeatureRevision = 3
	edit.Title = "Must rollback"
	exec(business, "CREATE TRIGGER feature_audit_failure BEFORE INSERT ON aims_product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated audit failure'")
	expect("edit", "feature-rollback", edit, 503)
	if revision() != prior {
		t.Fatal("workspace rollback failed")
	}
	var title string
	if err := business.QueryRow("SELECT title FROM product_features WHERE biz_id=?", feature).Scan(&title); err != nil || title != "Updated" {
		t.Fatal(title, err)
	}
	exec(business, "DROP TRIGGER feature_audit_failure")
	del := pc.FeatureDelete{BizID: feature, ExpectedRevision: revision(), ExpectedFeatureRevision: 3, Reason: "Remove candidate"}
	expect("delete", "feature-delete", del, 200)
	expect("delete", "feature-delete", del, 200)
	expect("view", "", map[string]any{"biz_id": feature}, 404)

	// Real lifecycle and request relation commands retain original manager/evidence gates.
	next := expect("create", "next-feature", pc.FeatureDraft{ExpectedRevision: revision(), Title: "Capability"}, 200)
	second := next["data"].(map[string]any)["value"].(map[string]any)["biz_id"].(string)
	life := pc.FeatureLifecycleChange{BizID: second, ExpectedRevision: revision(), ExpectedFeatureRevision: 1, Target: "active", Reason: "Existing capability", Evidence: &pc.FeatureActivationEvidence{Kind: "legacy", Description: "Previously deployed"}}
	expect("lifecycle", "lifecycle-denied", life, 400)
	exec(business, "INSERT INTO product_members(product_code,uid,relation_type,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P-A','person-a','manager',UTC_TIMESTAMP(3),'person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	expect("lifecycle", "activate", life, 200)
	expect("lifecycle", "activate", life, 200)
	requestID := uuid.NewString()
	exec(business, "INSERT INTO product_requests(product_code,biz_id,title,created_by,updated_by,created_at,updated_at) VALUES('P-A',?,'Request','person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", requestID)
	link := pc.FeatureRequestChange{ExpectedRevision: revision(), FeatureBizID: second, RequestBizID: requestID, ExpectedFeatureRevision: 2, ExpectedRequestRevision: 1, Operation: "link", Reason: "Scope"}
	expect("request-link", "link", link, 200)
	expect("request-link", "link", link, 200)
	linked := expect("request-list", "", pc.FeatureRequestPageQuery{FeatureBizID: second, Page: 1, PageSize: 20}, 200)["data"].(map[string]any)
	if linked["total"] != float64(1) {
		t.Fatal(linked)
	}
	// Unlink uses fresh per-object revisions and keeps the request intact.
	link.ExpectedRevision = revision()
	link.Operation = "unlink"
	if err := business.QueryRow("SELECT revision FROM product_features WHERE biz_id=?", second).Scan(&link.ExpectedFeatureRevision); err != nil {
		t.Fatal(err)
	}
	if err := business.QueryRow("SELECT revision FROM product_requests WHERE biz_id=?", requestID).Scan(&link.ExpectedRequestRevision); err != nil {
		t.Fatal(err)
	}
	expect("request-link", "unlink", link, 200)
	foreign := uuid.NewString()
	exec(business, "INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P-B',?,'other','other',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", uuid.NewString())
	exec(business, "INSERT INTO product_features(product_code,biz_id,title,created_by,updated_by,created_at,updated_at) VALUES('P-B',?,'Hidden','other','other',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", foreign)
	expect("view", "", map[string]any{"biz_id": foreign}, 404)
	visible := expect("list", "", pc.FeaturePageQuery{Page: 1, PageSize: 20}, 200)["data"].(map[string]any)
	if visible["total"] != float64(1) {
		t.Fatal("cross-workspace leak", visible)
	}
	cycle := uuid.NewString()
	exec(business, "INSERT INTO product_planning_cycles(biz_id,product_code,title,starts_on,ends_on,goal_summary,model_snapshot,created_by,updated_by,created_at,updated_at) VALUES(?,'P-A','Historical cycle','2026-01-01','2026-12-31','Goal',JSON_OBJECT(),'person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", cycle)
	expect("roadmap", "", pc.FeatureRoadmapQuery{FeatureBizID: second, CycleBizID: cycle, Page: 1, PageSize: 20}, 200)
	exec(consoleDB, "UPDATE service_client_grants SET status='revoked' WHERE action='read'")
	expect("list", "", query, 403)
	exec(consoleDB, "UPDATE service_client_grants SET status='active'")
	exec(business, "UPDATE enterprise_schema_registry SET generation=2")
	expect("list", "", query, 503)
}
