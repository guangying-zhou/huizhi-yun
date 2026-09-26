package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseplanning"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// Run only via scripts/test-enterprise-planning-mysql.mjs. The wrapper owns
// the isolated server; this test owns and cleans its two random fixture schemas.
func TestEnterprisePlanningHTTPMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_PLANNING_TEST_SOCKET")
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
		name := "hzy_planning_http_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	canonical, err := os.ReadFile("../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	operationDDL := regexp.MustCompile(`(?s)CREATE TABLE IF NOT EXISTS integration_operation \(.*?ENGINE=InnoDB.*?;`).FindString(string(canonical))
	if operationDDL == "" {
		t.Fatal("missing prerequisite")
	}
	exec(business, operationDDL)
	for _, name := range []string{"../../data-runtime/internal/apps/aims/productcenter/testdata/legacy_product_versions.sql", "migration_v5.19_product_center.sql", "migration_v5.20_product_comment_cycles.sql", "migration_v5.21_product_components.sql", "migration_v5.27_cross_product_dependencies.sql", "migration_v5.29_priority_model_versions.sql", "migration_v5.30_rice_reach_observations.sql", "migration_v5.31_rice_assessments.sql", "migration_v5.32_roadmap_saved_views.sql", "migration_v5.33_roadmap_saved_view_deletion.sql", "migration_v5.34_product_documents.sql", "migration_v5.35_product_document_creation_requests.sql", "migration_v5.36_product_feedback_bindings.sql", "migration_v5.37_product_line_management.sql", "migration_v5.38_lightweight_product_planning.sql"} {
		raw, err := os.ReadFile("../../../aims/docs/" + name)
		if err != nil {
			t.Fatal(err)
		}
		delimiter := ";"
		var buffer strings.Builder
		for _, line := range strings.Split(string(raw), "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "--") {
				continue
			}
			if strings.HasPrefix(trimmed, "DELIMITER ") {
				delimiter = strings.TrimSpace(strings.TrimPrefix(trimmed, "DELIMITER "))
				continue
			}
			buffer.WriteString(line + "\n")
			if strings.HasSuffix(trimmed, delimiter) {
				exec(business, strings.TrimSuffix(strings.TrimSpace(buffer.String()), delimiter))
				buffer.Reset()
			}
		}
		if strings.TrimSpace(buffer.String()) != "" {
			t.Fatal("unterminated migration")
		}
	}
	names := []string{"product_workspaces", "product_members", "product_command_receipts", "product_requests", "product_components", "product_activity_logs", "product_versions", "product_version_plans", "product_version_plan_scopes", "product_version_plan_confirmations", "product_version_features", "product_planning_items", "product_planning_item_requests", "product_planning_dependencies", "product_request_delivery_links", "product_feedback_bindings", "product_request_features", "product_features"}
	mapping := map[string]string{}
	var renames []string
	for _, name := range names {
		mapping[name] = "aims_" + name
		renames = append(renames, "`"+name+"` TO `aims_"+name+"`")
	}
	exec(business, "RENAME TABLE "+strings.Join(renames, ","))
	exec(business, "CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(64),environment_code VARCHAR(64),runtime_deployment VARCHAR(64),schema_version VARCHAR(64),generation BIGINT) ENGINE=InnoDB")
	exec(business, "INSERT INTO enterprise_schema_registry VALUES(1,'tenant-a','isolated','runtime-test','v1',0)")
	exec(business, "INSERT INTO aims_product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P-A',?,'person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", uuid.NewString())
	for _, statement := range []string{
		"CREATE TABLE service_clients(id BIGINT PRIMARY KEY,status VARCHAR(20),current_credential_id BIGINT) ENGINE=InnoDB",
		"CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,service_client_id BIGINT,client_id VARCHAR(128),status VARCHAR(20),expires_at DATETIME) ENGINE=InnoDB",
		"CREATE TABLE service_client_grants(service_client_id BIGINT,resource_code VARCHAR(128),action VARCHAR(64),status VARCHAR(20)) ENGINE=InnoDB",
		"INSERT INTO service_clients VALUES(1,'active',7)",
		"INSERT INTO service_client_credentials VALUES(7,1,'enterprise.runtime','active',NULL)",
		"INSERT INTO service_client_grants VALUES(1,'aims:product-requests','create','active')",
	} {
		exec(consoleDB, statement)
	}
	fixturePassword := uuid.NewString()
	// MySQL account DDL does not accept prepared value placeholders. The only
	// interpolated value is a locally generated UUID, never user/config input.
	exec(root, "CREATE USER 'hzy_planning_http'@'127.0.0.1' IDENTIFIED BY '"+fixturePassword+"'")
	t.Cleanup(func() { _, _ = root.Exec("DROP USER 'hzy_planning_http'@'127.0.0.1'") })
	exec(root, "GRANT SELECT,INSERT,UPDATE,DELETE,SHOW VIEW ON `"+businessName+"`.* TO 'hzy_planning_http'@'127.0.0.1'")
	cfg := config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"enterprise": "enterprise-test", "aims": "aims-test"}, Enterprise: config.EnterpriseConfig{Enabled: true, Environment: "isolated", SchemaVersion: "v1", Generation: 1, InstanceID: instance, DB: config.DBConfig{Host: "127.0.0.1", Port: port, User: "hzy_planning_http", Password: fixturePassword, Database: businessName, ConnectionLimit: 3}, Domains: map[string]config.EnterpriseDomainConfig{"aims": {OwnerDeployment: "aims-test", Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathDisabled, Tables: mapping}}}}
	binding, err := cfg.EnterpriseBinding()
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	plan, err := enterprise.PlanCompatibilityViews(ctx, business, binding, "aims", names)
	if err != nil {
		t.Fatal(err)
	}
	if err := enterprise.ApplyCompatibilityViews(ctx, business, binding, "aims", names, plan.ReviewHash); err != nil {
		t.Fatal(err)
	}
	exec(business, "UPDATE enterprise_schema_registry SET generation=1")
	registry, err := initializeEnterpriseRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { registry.Close() })
	service, err := enterpriseplanning.NewPlanningService(ctx, registry, binding)
	if err != nil {
		t.Fatal(err)
	}
	exec(consoleDB, "INSERT INTO service_client_grants VALUES(1,'aims:product-components','read','active'),(1,'aims:product-versions','read','active'),(1,'aims:product-versions','create','active'),(1,'aims:product-versions','edit','active')")
	exec(business, "INSERT INTO aims_product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P-A','person-a','manager','active',UTC_TIMESTAMP(3),'fixture','fixture',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	authenticator, template, _ := enterpriseContextFixture(t, func(c jwt.MapClaims) {
		c["scope"] = "aims:product-versions:create aims:product-versions:edit aims:product-versions:read aims:product-components:read"
	}, true)
	server := httptest.NewServer(&Server{cfg: cfg, auth: authenticator, enterpriseRegistry: registry, enterprisePlanning: service, console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-a", consoleDB)})
	defer server.Close()
	permit := func(resource, action string) productcenter.AuthorizationPermit {
		facts, err := productcenter.LoadAuthorizationFacts(ctx, business, "P-A", "person-a")
		if err != nil {
			t.Fatal(err)
		}
		return productcenter.AuthorizationPermit{Resource: resource, Action: action, Facts: facts, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli()}
	}
	call := func(action, key string, value any, mutate func(*enterprisePlanningInput)) (int, string) {
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		input := enterprisePlanningInput{ProductCode: "P-A", Tenant: "tenant-a", Deployment: "enterprise-test", Input: raw, Authorization: permit("product_versions", "edit"), RequestAuthorization: permit("product_requests", "view"), DecisionAuthorization: permit("product_requests", "decide"), PlanningAuthorization: permit("product_priorities", "edit")}
		reading := action == "components" || action == "list" || action == "view" || action == "plan" || action == "plan-items"
		if reading {
			input.Authorization.Action = "view"
		}
		if action == "plan-confirm" {
			input.PlanningAuthorization.Action = "prioritize"
		}
		if action == "components" {
			input.Authorization.Resource = "product_components"
		}
		if mutate != nil {
			mutate(&input)
		}
		if reading {
			envelope := map[string]any{"productCode": input.ProductCode, "tenant": input.Tenant, "deployment": input.Deployment, "authorization": input.Authorization, "input": input.Input}
			if action == "plan" || action == "plan-items" {
				envelope["request_authorization"] = input.RequestAuthorization
			}
			raw, err = json.Marshal(envelope)
		} else {
			raw, err = json.Marshal(input)
		}
		if err != nil {
			t.Fatal(err)
		}
		endpoint := "/v1/enterprise/aims/versions:" + action
		if action == "components" {
			endpoint = "/v1/enterprise/aims/components:list"
		}
		r, _ := http.NewRequest(http.MethodPost, server.URL+endpoint, bytes.NewReader(raw))
		r.Header = template.Header.Clone()
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", key)
		r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, runtimeBearerToken(r), r.Method, r.URL.RequestURI(), "person-a", nil, r.Header.Get("X-HZY-Actor-Signed-At")))
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, _ := io.ReadAll(response.Body)
		return response.StatusCode, string(body)
	}
	success := func(action, key string, value any) productcenter.CommandResult {
		code, body := call(action, key, value, nil)
		var result struct {
			Data productcenter.CommandResult `json:"data"`
		}
		if code != 200 || json.Unmarshal([]byte(body), &result) != nil {
			t.Fatalf("%s: %d %s", action, code, body)
		}
		return result.Data
	}
	state := func() string {
		var out strings.Builder
		for _, table := range []string{"product_components", "product_workspaces", "product_versions", "product_version_plans", "product_version_plan_scopes", "product_version_features", "product_planning_items", "product_planning_item_requests", "product_requests", "product_command_receipts", "product_activity_logs", "product_version_plan_confirmations"} {
			rows, err := business.Query("SELECT * FROM aims_" + table)
			if err != nil {
				t.Fatal(err)
			}
			cols, _ := rows.Columns()
			for rows.Next() {
				values := make([]any, len(cols))
				pointers := make([]any, len(cols))
				for i := range values {
					pointers[i] = &values[i]
				}
				if err = rows.Scan(pointers...); err != nil {
					t.Fatal(err)
				}
				raw, _ := json.Marshal(values)
				out.Write(raw)
			}
			rows.Close()
		}
		return out.String()
	}
	checkReplay := func(action, key string, value any) {
		first := success(action, key, value)
		before := state()
		again := success(action, key, value)
		if !again.Replayed || again.ReceiptID != first.ReceiptID || state() != before {
			t.Fatalf("%s replay repeated mutation", action)
		}
	}
	owner := "person-a"
	versionInput := productcenter.ProductVersionDraft{ExpectedRevision: 1, VersionCode: "v-http", Name: "HTTP plan", PlanningMode: "simple", BusinessOwnerUID: &owner}
	created := success("create", "version", versionInput)
	var version struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(created.Value, &version); err != nil || version.ID == 0 {
		t.Fatal("version result", err)
	}
	committed := state()
	replayed := success("create", "version", versionInput)
	if !replayed.Replayed || replayed.ReceiptID != created.ReceiptID || state() != committed {
		t.Fatal("create replay repeated writes")
	}
	changed := versionInput
	changed.Name = "different"
	if code, body := call("create", "version", changed, nil); code != 409 {
		t.Fatalf("payload conflict: %d %s", code, body)
	}
	// Construct optimistic revisions from actual committed records, never fixture counters.
	revisions := func() map[string]any {
		var workspace, vr, pr, sr uint64
		if err := business.QueryRow("SELECT w.revision,v.revision,p.revision,p.scope_revision FROM aims_product_workspaces w JOIN aims_product_versions v ON v.product_code=w.product_code JOIN aims_product_version_plans p ON p.version_id=v.id WHERE v.id=?", version.ID).Scan(&workspace, &vr, &pr, &sr); err != nil {
			t.Fatal(err)
		}
		return map[string]any{"version_id": version.ID, "expected_revision": workspace, "expected_version_revision": vr, "expected_plan_revision": pr, "expected_scope_revision": sr}
	}
	planInput := revisions()
	delete(planInput, "expected_scope_revision")
	planInput["goal"] = "Deliver login"
	planInput["starts_on"] = "2099-01-01"
	planInput["planned_release_date"] = "2099-01-31"
	planInput["available_person_days"] = "10"
	planInput["reserve_person_days"] = "1"
	checkReplay("plan-edit", "plan", planInput)
	requestID := uuid.NewString()
	exec(business, "INSERT INTO aims_product_requests(biz_id,product_code,title,source_type,urgency_level,decision_status,created_by,updated_by,created_at,updated_at) VALUES(?,'P-A','Request','internal','P2','submitted','person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", requestID)
	item := revisions()
	delete(item, "expected_scope_revision")
	item["expected_request_revision"] = 1
	item["request_biz_id"] = requestID
	item["scope_summary"] = "Login"
	item["acceptance_criteria"] = "Login succeeds"
	item["estimate_person_days"] = "2"
	item["adopt_request"] = true
	for _, mutate := range []func(*enterprisePlanningInput){func(i *enterprisePlanningInput) { i.RequestAuthorization = productcenter.AuthorizationPermit{} }, func(i *enterprisePlanningInput) { i.PlanningAuthorization.Action = "view" }, func(i *enterprisePlanningInput) { i.DecisionAuthorization.Facts.ActorUID = "other" }} {
		before := state()
		if code, body := call("plan-item-create", "scope", item, mutate); code != 403 {
			t.Fatalf("secondary permit: %d %s", code, body)
		}
		if state() != before {
			t.Fatal("rejected secondary permit wrote state")
		}
	}
	// A late audit SQL failure must roll back adoption, plan scope and all receipts.
	beforeFailure := state()
	exec(business, "CREATE TRIGGER fail_planning_audit BEFORE INSERT ON aims_product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='private fixture audit failure'")
	if code, body := call("plan-item-create", "scope", item, nil); code != 503 || strings.Contains(body, "private fixture") {
		t.Fatal("late audit failure not redacted 503", code, body)
	}
	if state() != beforeFailure {
		t.Fatal("late failure leaked transaction state")
	}
	exec(business, "DROP TRIGGER fail_planning_audit")
	scopeResult := success("plan-item-create", "scope", item)
	var scope struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(scopeResult.Value, &scope); err != nil || scope.ID == 0 {
		t.Fatal("scope result", err)
	}
	beforeReplay := state()
	if replay := success("plan-item-create", "scope", item); !replay.Replayed || state() != beforeReplay {
		t.Fatal("scope replay repeated adoption")
	}
	edit := revisions()
	edit["scope_id"] = scope.ID
	edit["scope_summary"] = "Login updated"
	edit["acceptance_criteria"] = "Login works"
	edit["estimate_person_days"] = "3"
	edit["reason"] = "estimate clarified"
	checkReplay("plan-item-edit", "edit", edit)
	confirmation := revisions()
	beforeConfirm := state()
	if code, body := call("plan-confirm", "confirm", confirmation, func(i *enterprisePlanningInput) { i.PlanningAuthorization.Action = "edit" }); code != 403 {
		t.Fatalf("confirmation secondary permit: %d %s", code, body)
	}
	if state() != beforeConfirm {
		t.Fatal("rejected confirm wrote state")
	}
	checkReplay("plan-confirm", "confirm", confirmation)
	exec(business, "INSERT INTO aims_product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P-B',?,'fixture','fixture',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", uuid.NewString())
	for _, row := range []struct {
		id         int
		code, name string
		parent     any
	}{{10, "P-A", "Root", nil}, {11, "P-A", "Child", 10}, {20, "P-B", "Private other root", nil}} {
		exec(business, "INSERT INTO aims_product_components(id,biz_id,product_code,parent_id,name,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,'fixture','fixture',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", row.id, uuid.NewString(), row.code, row.parent, row.name)
	}
	beforeReads := state()
	read := func(action string, query any) map[string]any {
		code, body := call(action, "", query, nil)
		var result struct {
			Data map[string]any `json:"data"`
		}
		if code != 200 || json.Unmarshal([]byte(body), &result) != nil {
			t.Fatalf("%s read: %d %s", action, code, body)
		}
		return result.Data
	}
	rootComponents := read("components", map[string]any{"page": 1, "page_size": 10})
	if rootComponents["total"] != float64(1) || !strings.Contains(stringMustJSON(t, rootComponents), "Root") || strings.Contains(stringMustJSON(t, rootComponents), "Private other") {
		t.Fatal("root component isolation", rootComponents)
	}
	children := read("components", map[string]any{"page": 1, "page_size": 10, "parent_id": 10})
	if children["total"] != float64(1) || !strings.Contains(stringMustJSON(t, children), "Child") {
		t.Fatal("child component list", children)
	}
	if code, body := call("components", "", map[string]any{"page": 1, "page_size": 10, "parent_id": 20}, nil); code != 404 {
		t.Fatalf("foreign parent accepted: %d %s", code, body)
	}
	if code, body := call("components", "", map[string]any{"page": 1, "page_size": 10}, func(i *enterprisePlanningInput) { i.Authorization.Action = "edit" }); code != 403 {
		t.Fatalf("component permit: %d %s", code, body)
	}
	exec(consoleDB, "UPDATE service_client_grants SET status='revoked' WHERE resource_code='aims:product-components'")
	if code, body := call("components", "", map[string]any{"page": 1, "page_size": 10}, nil); code != 403 {
		t.Fatalf("component grant: %d %s", code, body)
	}
	exec(consoleDB, "UPDATE service_client_grants SET status='active' WHERE resource_code='aims:product-components'")
	listed := read("list", map[string]any{"page": 1, "page_size": 1})
	if listed["total"] != float64(1) || len(listed["items"].([]any)) != 1 {
		t.Fatal("version list", listed)
	}
	if filtered := read("list", map[string]any{"page": 1, "page_size": 1, "keyword": "unmatched"}); filtered["total"] != float64(0) {
		t.Fatal("version filter", filtered)
	}
	if detail := read("view", map[string]any{"version_id": version.ID}); detail["product_code"] != "P-A" {
		t.Fatal("version detail", detail)
	}
	if plan := read("plan", map[string]any{"version_id": version.ID}); plan["plan_status"] != "confirmed" {
		t.Fatal("plan detail", plan)
	}
	if items := read("plan-items", map[string]any{"version_id": version.ID, "page": 1, "page_size": 1}); items["total"] != float64(1) {
		t.Fatal("plan items", items)
	}
	for _, action := range []string{"plan", "plan-items"} {
		if code, body := call(action, "", map[string]any{"version_id": version.ID}, func(i *enterprisePlanningInput) { i.RequestAuthorization.Action = "edit" }); code != 403 {
			t.Fatalf("read secondary permit: %d %s", code, body)
		}
	}
	if code, body := call("view", "", map[string]any{"version_id": version.ID}, func(i *enterprisePlanningInput) {
		i.Authorization.ExpiresAt = time.Now().Add(16 * time.Second).UnixMilli()
	}); code != 403 {
		t.Fatalf("read permit lifetime: %d %s", code, body)
	}
	exec(business, "UPDATE enterprise_schema_registry SET generation=2")
	if code, body := call("list", "", map[string]any{"page": 1, "page_size": 1}, nil); code != 503 {
		t.Fatalf("read generation: %d %s", code, body)
	}
	exec(business, "UPDATE enterprise_schema_registry SET generation=1")
	if state() != beforeReads {
		t.Fatal("version/plan reads mutated receipts audit or domain facts")
	}
	removal := revisions()
	removal["scope_id"] = scope.ID
	removal["reason"] = "scope withdrawn"
	checkReplay("plan-item-delete", "delete", removal)
	var count int
	if err := business.QueryRow("SELECT COUNT(*) FROM aims_product_version_plan_scopes").Scan(&count); err != nil || count != 0 {
		t.Fatal("scope not deleted", count, err)
	}
	exec(consoleDB, "UPDATE service_client_grants SET status='revoked' WHERE resource_code='aims:product-versions'")
	if code, body := call("create", "revoked", versionInput, nil); code != 403 {
		t.Fatalf("live revoked grant: %d %s", code, body)
	}
}

func stringMustJSON(t *testing.T, value any) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
