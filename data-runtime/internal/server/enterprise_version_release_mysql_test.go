package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"github.com/go-sql-driver/mysql"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/config"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
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
)

func TestEnterpriseVersionReleaseHTTPMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_RELEASE_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires dedicated temporary MySQL")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("refusing nonisolated socket")
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
	t.Cleanup(func() { root.Close() })
	exec := func(db *sql.DB, q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	schemaDB := func() (string, *sql.DB) {
		name := "hzy_release_http_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		exec(root, "CREATE DATABASE `"+name+"` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin")
		t.Cleanup(func() { exec(root, "DROP DATABASE `"+name+"`") })
		c := *mc
		c.DBName = name
		db, err := sql.Open("mysql", c.FormatDSN())
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		return name, db
	}
	name, db := schemaDB()
	_, consoleDB := schemaDB()
	var instance string
	var port int
	if err = root.QueryRow("SELECT @@server_uuid,@@port").Scan(&instance, &port); err != nil {
		t.Fatal(err)
	}
	schema, err := os.ReadFile("../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	tables := regexp.MustCompile("(?ms)^CREATE TABLE IF NOT EXISTS `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(schema), -1)
	if len(tables) < 100 {
		t.Fatal("incomplete canonical schema")
	}
	db.SetMaxOpenConns(1)
	exec(db, "SET FOREIGN_KEY_CHECKS=0")
	mapping := map[string]string{}
	var renames, names []string
	for _, table := range tables {
		exec(db, table[0])
		mapping[table[1]] = "aims_" + table[1]
		names = append(names, table[1])
		renames = append(renames, "`"+table[1]+"` TO `aims_"+table[1]+"`")
	}
	exec(db, "RENAME TABLE "+strings.Join(renames, ","))
	exec(db, "SET FOREIGN_KEY_CHECKS=1")
	db.SetMaxOpenConns(4)
	exec(db, "ALTER TABLE aims_product_versions ADD CONSTRAINT test_version_current_release FOREIGN KEY(current_release_record_id,id) REFERENCES aims_product_release_records(id,version_id)")
	exec(db, "CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(64),environment_code VARCHAR(64),runtime_deployment VARCHAR(64),schema_version VARCHAR(64),generation BIGINT) ENGINE=InnoDB")
	exec(db, "INSERT INTO enterprise_schema_registry VALUES(1,'tenant-a','isolated','runtime-test','v1',0)")
	for _, q := range []string{"CREATE TABLE service_clients(id BIGINT PRIMARY KEY,status VARCHAR(20),current_credential_id BIGINT) ENGINE=InnoDB", "CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,service_client_id BIGINT,client_id VARCHAR(128),status VARCHAR(20),expires_at DATETIME) ENGINE=InnoDB", "CREATE TABLE service_client_grants(service_client_id BIGINT,resource_code VARCHAR(128),action VARCHAR(64),status VARCHAR(20)) ENGINE=InnoDB", "INSERT INTO service_clients VALUES(1,'active',7)", "INSERT INTO service_client_credentials VALUES(7,1,'enterprise.runtime','active',NULL)", "INSERT INTO service_client_grants VALUES(1,'aims:product-versions','edit','active'),(1,'aims:product-versions','delete','active'),(1,'aims:product-versions','archive','active'),(1,'aims:product-versions','reopen','active'),(1,'aims:product-versions','accept','active'),(1,'aims:product-versions','publish','active'),(1,'aims:product-versions','read','active'),(1,'aims:product-versions','scope-deliver','active'),(1,'aims:product-versions','scope-reopen','active'),(1,'aims:product-versions','scope-edit','active'),(1,'aims:product-versions','scope-visibility','active'),(1,'aims:product-versions','scope-legacy-criteria','active')"} {
		exec(consoleDB, q)
	}
	password := uuid.NewString()
	exec(root, "CREATE USER 'hzy_release_http'@'127.0.0.1' IDENTIFIED BY '"+password+"'")
	t.Cleanup(func() { exec(root, "DROP USER 'hzy_release_http'@'127.0.0.1'") })
	exec(root, "GRANT SELECT,INSERT,UPDATE,DELETE,SHOW VIEW ON `"+name+"`.* TO 'hzy_release_http'@'127.0.0.1'")
	cfg := config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"enterprise": "enterprise-test", "aims": "aims-test"}, Enterprise: config.EnterpriseConfig{Enabled: true, Environment: "isolated", SchemaVersion: "v1", Generation: 1, InstanceID: instance, DB: config.DBConfig{Host: "127.0.0.1", Port: port, User: "hzy_release_http", Password: password, Database: name, ConnectionLimit: 3}, Domains: map[string]config.EnterpriseDomainConfig{"aims": {OwnerDeployment: "aims-test", Tables: mapping, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathDisabled}}, AimsDeliveryWorker: &config.EnterpriseDeliveryWorker{Deployment: "aims-test", ServiceClientID: "aims.runtime"}}}
	binding, err := cfg.EnterpriseBinding()
	if err != nil {
		t.Fatal(err)
	}
	plan, err := e.PlanCompatibilityViews(context.Background(), db, binding, "aims", names)
	if err != nil {
		t.Fatal(err)
	}
	if err = e.ApplyCompatibilityViews(context.Background(), db, binding, "aims", names, plan.ReviewHash); err != nil {
		t.Fatal(err)
	}
	exec(db, "UPDATE enterprise_schema_registry SET generation=1")
	registry, err := initializeEnterpriseRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { registry.Close() })
	source, err := cfg.EnterpriseAimsOutboundSource(registry, binding)
	if err != nil {
		t.Fatal(err)
	}
	service, err := enterpriseplanning.NewVersionService(context.Background(), registry, binding, *source)
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"integration_operation", "integration_operation_attempt", "service_command_receipt", "integration_operation_dead_letter_actionable"} {
		exec(db, "DROP VIEW `"+table+"`")
	}
	exec(db, "INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P',UUID(),'person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	exec(db, "INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P','person-a','manager','active',UTC_TIMESTAMP(3),'person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	exec(db, "INSERT INTO product_versions(id,product_code,version_code,status,business_owner_uid) VALUES(1,'P','v1','developing','person-a')")
	exec(db, "INSERT INTO product_features(id,biz_id,product_code,title,created_by,updated_by,created_at,updated_at) VALUES(1,UUID(),'P','Login','person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	exec(db, "INSERT INTO product_version_features(id,version_id,product_feature_id,title,acceptance_criteria,status) VALUES(1,1,1,'Login','Login succeeds','delivered')")
	exec(db, "INSERT INTO product_requests(id,biz_id,product_code,title,created_by,updated_by,created_at,updated_at) VALUES(1,UUID(),'P','Feedback','person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	exec(db, "INSERT INTO product_request_sources(id,request_id,source_type,source_note,created_by,updated_by,created_at,updated_at) VALUES(1,1,'service_ticket','Feedback','person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	exec(db, "INSERT INTO product_feedback_bindings(source_app,source_type,source_biz_id,product_code,request_id,source_id,created_by,created_at) VALUES('altoc','service_ticket','ST-1','P',1,1,'person-a',UTC_TIMESTAMP(3))")
	authenticator, template, _ := enterpriseContextFixture(t, func(c jwt.MapClaims) {
		c["scope"] = "aims:product-versions:edit aims:product-versions:delete aims:product-versions:archive aims:product-versions:reopen aims:product-versions:accept aims:product-versions:publish aims:product-versions:read aims:product-versions:scope-deliver aims:product-versions:scope-reopen aims:product-versions:scope-edit aims:product-versions:scope-visibility aims:product-versions:scope-legacy-criteria"
	}, true)
	server := httptest.NewServer(&Server{cfg: cfg, auth: authenticator, enterpriseRegistry: registry, enterpriseVersions: service, console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-a", consoleDB)})
	defer server.Close()
	actor, reviewHash := "person-a", ""
	call := func(action string, value any, mutate func(*enterpriseVersionInput, *http.Request)) (int, string) {
		t.Helper()
		facts, err := pc.LoadAuthorizationFacts(context.Background(), db, "P", actor)
		if err != nil {
			t.Fatal(err)
		}
		permission := action
		if action == "acceptance-preview" || action == "execution-coordination" || action == "execution-project-authorization" || action == "acceptance-list" || action == "acceptance-view" || action == "release-list" || action == "release-view" || action == "scope-list" || action == "scope-history" {
			permission = "view"
		}
		if action == "transition" {
			permission = "edit"
		}
		if action == "scope-deliver" || action == "scope-reopen" {
			permission = "accept"
		}
		if action == "scope-edit" || action == "scope-visibility" || action == "scope-legacy-criteria" {
			permission = "edit"
		}
		raw, _ := json.Marshal(value)
		input := enterpriseVersionInput{ExecutionReviewHash: reviewHash, ProductCode: "P", Tenant: "tenant-a", Deployment: "enterprise-test", Input: raw, Authorization: pc.AuthorizationPermit{Resource: "product_versions", Action: permission, Facts: facts, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli()}}
		if action == "acceptance-preview" || action == "execution-coordination" || action == "execution-project-authorization" || action == "acceptance-list" || action == "acceptance-view" || action == "release-list" || action == "release-view" || action == "scope-list" || action == "scope-history" || action == "scope-deliver" || action == "scope-reopen" || action == "scope-edit" || action == "scope-visibility" || action == "scope-legacy-criteria" {
			input.ExecutionReviewHash = ""
		}
		request, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/enterprise/aims/product-version:"+action, nil)
		request.Header = template.Header.Clone()
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Idempotency-Key", action)
		if mutate != nil {
			mutate(&input, request)
		}
		raw, _ = json.Marshal(input)
		request.Body = io.NopCloser(bytes.NewReader(raw))
		request.ContentLength = int64(len(raw))
		request.Header.Set("X-HZY-Actor-Uid", actor)
		request.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, runtimeBearerToken(request), request.Method, request.URL.RequestURI(), actor, nil, request.Header.Get("X-HZY-Actor-Signed-At")))
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, _ := io.ReadAll(response.Body)
		return response.StatusCode, string(data)
	}

	expect := func(action string, input any, want int, mutate func(*enterpriseVersionInput, *http.Request)) map[string]any {
		t.Helper()
		status, body := call(action, input, mutate)
		if status != want {
			t.Fatalf("%s got %d want %d: %s", action, status, want, body)
		}
		var out map[string]any
		if err := json.Unmarshal([]byte(body), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	count := func(table string) int {
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	scopes := expect("scope-list", map[string]any{"version_id": 1, "page": 1, "page_size": 20}, 200, nil)["data"].(map[string]any)
	if scopes["total"] != float64(1) || len(scopes["items"].([]any)) != 1 {
		t.Fatal("scope list did not preserve version boundary")
	}
	expect("scope-history", map[string]any{"version_id": 1, "scope_id": 1, "page": 1, "page_size": 10}, 200, nil)
	expect("scope-list", map[string]any{"version_id": 999, "page": 1, "page_size": 20}, 404, nil)
	expect("scope-history", map[string]any{"version_id": 1, "scope_id": 999, "page": 1, "page_size": 10}, 404, nil)
	expect("scope-list", map[string]any{"version_id": 1, "page": 1, "page_size": 20}, 403, func(input *enterpriseVersionInput, _ *http.Request) { input.Authorization.Action = "edit" })
	expect("scope-history", map[string]any{"version_id": 1, "scope_id": 1, "page": 1, "page_size": 10}, 400, func(_ *enterpriseVersionInput, request *http.Request) { request.URL.RawQuery = "page=1" })
	preview := func() pc.ProductVersionAcceptancePreview {
		t.Helper()
		response := expect("acceptance-preview", map[string]any{"version_id": 1}, 200, nil)
		raw, _ := json.Marshal(response["data"])
		var out pc.ProductVersionAcceptancePreview
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	exec(db, "INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by) VALUES(42,'EXEC','Execution project','Exec','person-a','person-a')")
	exec(db, "INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,status,weight,version_id,feature_id,title) VALUES(1,42,1,'EXEC-1','target','requirement','completed',1,1,1,'Delivered target')")
	linkedProject := expect("execution-project-authorization", map[string]any{"version_id": 1, "project_id": 42}, 200, nil)
	if linkedProject["data"] == nil {
		t.Fatal("project facts missing")
	}
	expect("execution-project-authorization", map[string]any{"version_id": 1, "project_id": 999}, 404, nil)
	coord := expect("execution-coordination", map[string]any{"version_id": 1}, 200, nil)["data"].(map[string]any)
	if len(coord["projects"].([]any)) != 1 || coord["target_count"] != float64(1) {
		t.Fatal(coord)
	}
	initial := preview()
	if len(initial.ReviewHash) != 64 || initial.DeliveredScopeCount != 1 {
		t.Fatal(initial)
	}
	if count("product_activity_logs") != 0 || count("product_command_receipts") != 0 {
		t.Fatal("preview writes")
	}
	reviewHash = initial.ReviewHash
	acceptance := pc.ProductVersionAcceptanceInput{VersionID: 1, ExpectedRevision: initial.WorkspaceRevision, ExpectedVersionRevision: initial.Version.Revision, ExpectedScopeRevision: initial.Version.ScopeRevision, ExpectedReviewHash: initial.ReviewHash, Checks: []pc.VersionAcceptanceCheck{{Code: "execution-review", Evidence: "Reviewed execution"}, {Code: "blocking-defects-review", Evidence: "Reviewed defects"}, {Code: "release-readiness", Evidence: "Rollback verified"}}, Exceptions: []pc.VersionAcceptanceException{}}
	expect("accept", acceptance, 400, func(i *enterpriseVersionInput, _ *http.Request) { i.ExecutionReviewHash = "" })
	expect("accept", acceptance, 403, func(i *enterpriseVersionInput, _ *http.Request) { i.Authorization.Action = "edit" })
	expect("accept", acceptance, 409, func(i *enterpriseVersionInput, _ *http.Request) { i.ExecutionReviewHash = strings.Repeat("0", 64) })
	exec(db, "UPDATE work_items SET title='Changed after review' WHERE id=1")
	expect("accept", acceptance, 409, nil)
	exec(db, "UPDATE work_items SET title='Delivered target' WHERE id=1")
	actor = "publisher"
	expect("accept", acceptance, 409, nil)
	actor = "person-a"
	exec(db, "CREATE TRIGGER release_accept_audit BEFORE INSERT ON aims_product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='late acceptance audit'")
	expect("accept", acceptance, 503, nil)
	if count("product_version_acceptances") != 0 || count("product_command_receipts") != 0 {
		t.Fatal("acceptance rollback failed")
	}
	exec(db, "DROP TRIGGER release_accept_audit")
	saved := expect("accept", acceptance, 200, nil)
	expect("accept", acceptance, 200, nil)
	accepted := saved["data"].(map[string]any)["value"].(map[string]any)["acceptance_id"].(float64)
	current := preview()
	reviewHash = current.ReviewHash
	publish := pc.ProductVersionPublishInput{VersionID: 1, AcceptanceID: int64(accepted), ExpectedRevision: current.WorkspaceRevision, ExpectedVersionRevision: current.Version.Revision, ExpectedScopeRevision: current.Version.ScopeRevision, Reason: "Independent publication"}
	expect("publish", publish, 409, nil)
	actor = "publisher"
	expect("publish", publish, 409, func(i *enterpriseVersionInput, _ *http.Request) { i.ExecutionReviewHash = strings.Repeat("0", 64) })
	exec(db, "CREATE TRIGGER release_publish_audit BEFORE INSERT ON aims_product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='late publish audit'")
	expect("publish", publish, 503, nil)
	if count("product_release_records") != 0 || count("aims_integration_operation") != 0 {
		t.Fatal("publication/outbox rollback failed")
	}
	exec(db, "DROP TRIGGER release_publish_audit")
	expect("publish", publish, 200, nil)
	expect("publish", publish, 200, nil)
	if count("product_release_records") != 1 || count("aims_integration_operation") != 1 {
		t.Fatal("release/outbox not exactly once")
	}
	var sourceApp, tenant, deployment string
	if err := db.QueryRow("SELECT source_app,tenant_code,deployment_code FROM aims_integration_operation").Scan(&sourceApp, &tenant, &deployment); err != nil || sourceApp != "aims" || tenant != "tenant-a" || deployment != "aims-test" {
		t.Fatal(sourceApp, tenant, deployment, err)
	}
	// Historical projections preserve immutable evidence without execution details.
	receipts, audits := count("product_command_receipts"), count("product_activity_logs")
	var releaseID int64
	if err := db.QueryRow("SELECT current_release_record_id FROM product_versions WHERE id=1").Scan(&releaseID); err != nil {
		t.Fatal(err)
	}
	acceptanceDetail := expect("acceptance-view", map[string]any{"version_id": 1, "acceptance_id": int64(accepted)}, 200, nil)["data"].(map[string]any)
	if len(acceptanceDetail["checks"].([]any)) != 3 || acceptanceDetail["execution"] != nil {
		t.Fatal(acceptanceDetail)
	}
	for _, action := range []string{"acceptance-list", "release-list"} {
		list := expect(action, map[string]any{"version_id": 1, "page": 1, "page_size": 1}, 200, nil)["data"].(map[string]any)
		if list["total"] != float64(1) || len(list["items"].([]any)) != 1 {
			t.Fatal(list)
		}
		list = expect(action, map[string]any{"version_id": 1, "page": 2, "page_size": 1}, 200, nil)["data"].(map[string]any)
		if list["total"] != float64(1) || len(list["items"].([]any)) != 0 {
			t.Fatal(list)
		}
	}
	detailInput := map[string]any{"version_id": 1, "record_id": releaseID}
	frozen := expect("release-view", detailInput, 200, nil)["data"].(map[string]any)
	exec(db, "UPDATE product_version_features SET title='Later scope title' WHERE version_id=1")
	exec(db, "UPDATE product_workspaces SET status='archived' WHERE product_code='P'")
	later := expect("release-view", detailInput, 200, nil)["data"].(map[string]any)
	if later["content_hash"] != frozen["content_hash"] || later["scopes"].([]any)[0].(map[string]any)["title"] != "Login" || later["execution"] != nil {
		t.Fatal("history substituted live data", later)
	}
	expect("acceptance-view", map[string]any{"version_id": 1, "acceptance_id": int64(accepted)}, 200, nil)
	exec(db, "INSERT INTO product_versions(id,product_code,version_code,status) VALUES(2,'P','other','planning')")
	expect("release-view", map[string]any{"version_id": 2, "record_id": releaseID}, 400, nil)
	expect("acceptance-view", map[string]any{"version_id": 2, "acceptance_id": int64(accepted)}, 400, nil)
	expect("release-view", detailInput, 403, func(i *enterpriseVersionInput, _ *http.Request) { i.Authorization.Facts.ActorUID = "other" })
	if count("product_command_receipts") != receipts || count("product_activity_logs") != audits {
		t.Fatal("history wrote audit/receipt")
	}
	exec(db, "UPDATE product_workspaces SET status='active' WHERE product_code='P'")
	exec(db, "INSERT INTO product_version_features(id,version_id,product_feature_id,title,acceptance_criteria,status) VALUES(2,2,1,'Second scope','Second acceptance','delivered')")
	stage2Scopes := expect("scope-list", map[string]any{"version_id": 2, "page": 1, "page_size": 20}, 200, nil)["data"].(map[string]any)
	revisions := func(page map[string]any) map[string]any {
		return map[string]any{"expected_revision": page["workspace_revision"], "expected_version_revision": page["version_revision"], "expected_scope_revision": page["scope_revision"]}
	}
	reopen := revisions(stage2Scopes)
	reopen["version_id"], reopen["scope_id"], reopen["reason"] = 2, 2, "Marked local test correction"
	reopened := expect("scope-reopen", reopen, 200, nil)
	if reopened["data"].(map[string]any)["value"].(map[string]any)["status"] != "planned" {
		t.Fatal("scope reopen did not return the planned state")
	}
	if replay := expect("scope-reopen", reopen, 200, nil)["data"].(map[string]any); replay["replayed"] != true {
		t.Fatal("scope reopen did not replay its receipt")
	}
	expect("scope-reopen", reopen, 403, func(input *enterpriseVersionInput, request *http.Request) {
		input.Authorization.Action = "edit"
		request.Header.Set("Idempotency-Key", "scope-reopen-denied")
	})
	scopeCurrent := expect("scope-list", map[string]any{"version_id": 2, "page": 1, "page_size": 20}, 200, nil)["data"].(map[string]any)
	visibility := revisions(scopeCurrent)
	visibility["version_id"], visibility["scope_id"], visibility["is_public"], visibility["reason"] = 2, 2, false, "Marked visibility change"
	expect("scope-visibility", visibility, 200, nil)
	if replay := expect("scope-visibility", visibility, 200, nil)["data"].(map[string]any); replay["replayed"] != true {
		t.Fatal("scope visibility did not replay its receipt")
	}
	expect("scope-visibility", visibility, 409, func(_ *enterpriseVersionInput, request *http.Request) {
		request.Header.Set("Idempotency-Key", "scope-visibility-stale")
	})
	expect("scope-visibility", visibility, 400, func(input *enterpriseVersionInput, request *http.Request) {
		input.PlanningAuthorization = &pc.AuthorizationPermit{Resource: "product_priorities", Action: "prioritize", Facts: input.Authorization.Facts, ExpiresAt: input.Authorization.ExpiresAt}
		request.Header.Set("Idempotency-Key", "scope-visibility-extra-permit")
	})
	exec(consoleDB, "UPDATE service_client_grants SET status='revoked' WHERE action='scope-visibility'")
	expect("scope-visibility", visibility, 403, func(_ *enterpriseVersionInput, request *http.Request) {
		request.Header.Set("Idempotency-Key", "scope-visibility-revoked")
	})
	exec(consoleDB, "UPDATE service_client_grants SET status='active' WHERE action='scope-visibility'")
	expect("scope-edit", map[string]any{"version_id": 2, "scope_id": 2}, 403, nil)
	expect("scope-edit", map[string]any{"version_id": 2, "scope_id": 2}, 400, func(input *enterpriseVersionInput, _ *http.Request) {
		input.PlanningAuthorization = &pc.AuthorizationPermit{Resource: "product_priorities", Action: "prioritize", Facts: input.Authorization.Facts, ExpiresAt: input.Authorization.ExpiresAt}
	})
	itemBizID, cycleBizID := uuid.NewString(), uuid.NewString()
	exec(db, `INSERT INTO product_planning_cycles(biz_id,product_code,title,starts_on,ends_on,goal_summary,total_person_days,reserve_person_days,reliability_person_days,usability_person_days,growth_person_days,model_snapshot,status,created_by,updated_by,created_at,updated_at) VALUES(?,'P','Marked cycle','2026-09-01','2026-09-30','Marked goal',10,0,0,10,0,JSON_OBJECT(),'open','person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, cycleBizID)
	exec(db, `INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,feature_id,investment_category,created_by,updated_by,created_at,updated_at) VALUES(?,'P','Marked item','Marked scope',1,'usability','person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, itemBizID)
	exec(db, `INSERT INTO product_planning_cycle_items(cycle_id,planning_item_id,product_code,selection_status,decision_rank) SELECT c.id,i.id,'P','selected',1 FROM product_planning_cycles c JOIN product_planning_items i ON i.product_code=c.product_code WHERE c.biz_id=? AND i.biz_id=?`, cycleBizID, itemBizID)
	assessment, err := db.Exec(`INSERT INTO product_priority_assessments(cycle_id,planning_item_id,scope_revision,evidence_revision,model_version,model_snapshot,strategic,user_value,business,risk,confidence,effort_person_days,value_score,priority_score,evidence_snapshot,rationale,assessed_by,assessed_at) SELECT c.id,i.id,1,1,c.model_version,JSON_OBJECT(),1,1,1,1,1.00,1.00,20,20,JSON_OBJECT(),JSON_OBJECT(),'person-a',UTC_TIMESTAMP(3) FROM product_planning_cycles c JOIN product_planning_items i ON i.product_code=c.product_code WHERE c.biz_id=? AND i.biz_id=?`, cycleBizID, itemBizID)
	if err != nil {
		t.Fatal(err)
	}
	assessmentID, err := assessment.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	decision, err := json.Marshal(map[string]any{"capacity": map[string]any{"version": 1, "item_biz_id": itemBizID, "investment_category": "usability", "effort_person_days": "1.00"}, "scope_revision": 1, "evidence_revision": 1, "model_version": "weighted-value-effort-v1", "assessment_id": assessmentID, "exceptions": []any{}})
	if err != nil {
		t.Fatal(err)
	}
	exec(db, `UPDATE product_planning_cycle_items ci JOIN product_planning_cycles c ON c.id=ci.cycle_id JOIN product_planning_items i ON i.id=ci.planning_item_id SET ci.current_assessment_id=?,ci.decision_snapshot=? WHERE c.biz_id=? AND i.biz_id=?`, assessmentID, decision, cycleBizID, itemBizID)
	exec(db, `UPDATE product_version_features vf JOIN product_planning_items i ON i.biz_id=? SET vf.planning_item_id=i.id WHERE vf.id=2`, itemBizID)
	scopeCurrent = expect("scope-list", map[string]any{"version_id": 2, "page": 1, "page_size": 20}, 200, nil)["data"].(map[string]any)
	edit := revisions(scopeCurrent)
	delete(edit, "expected_scope_revision")
	edit["version_id"], edit["scope_id"], edit["expected_version_revision"] = 2, 2, scopeCurrent["version_revision"]
	edit["item_biz_id"], edit["cycle_biz_id"] = itemBizID, cycleBizID
	edit["expected_item_revision"], edit["expected_cycle_revision"], edit["expected_queue_revision"] = 1, 1, 1
	edit["title"], edit["description"], edit["acceptance_criteria"], edit["change_type"], edit["reason"] = "Edited marked scope", "Marked description", "Updated acceptance", "enhancement", "Marked revision"
	withPlanning := func(input *enterpriseVersionInput, _ *http.Request) {
		input.PlanningAuthorization = &pc.AuthorizationPermit{Resource: "product_priorities", Action: "prioritize", Facts: input.Authorization.Facts, ExpiresAt: input.Authorization.ExpiresAt}
	}
	expect("scope-edit", edit, 200, withPlanning)
	if replay := expect("scope-edit", edit, 200, withPlanning)["data"].(map[string]any); replay["replayed"] != true {
		t.Fatal("scope edit did not replay its receipt")
	}
	expect("scope-edit", edit, 409, func(input *enterpriseVersionInput, request *http.Request) {
		withPlanning(input, request)
		request.Header.Set("Idempotency-Key", "scope-edit-stale")
	})
	exec(consoleDB, "UPDATE service_client_grants SET status='revoked' WHERE action='scope-edit'")
	expect("scope-edit", edit, 403, func(input *enterpriseVersionInput, request *http.Request) {
		withPlanning(input, request)
		request.Header.Set("Idempotency-Key", "scope-edit-revoked")
	})
	exec(consoleDB, "UPDATE service_client_grants SET status='active' WHERE action='scope-edit'")
	scopeCurrent = expect("scope-list", map[string]any{"version_id": 2, "page": 1, "page_size": 20}, 200, nil)["data"].(map[string]any)
	deliver := revisions(scopeCurrent)
	deliver["version_id"], deliver["scope_id"], deliver["evidence"], deliver["reason"] = 2, 2, "Marked local acceptance evidence", "Accepted after correction"
	expect("scope-deliver", deliver, 200, nil)
	if replay := expect("scope-deliver", deliver, 200, nil)["data"].(map[string]any); replay["replayed"] != true {
		t.Fatal("scope delivery did not replay its receipt")
	}
	expect("scope-deliver", deliver, 409, func(_ *enterpriseVersionInput, request *http.Request) {
		request.Header.Set("Idempotency-Key", "scope-deliver-stale")
	})
	latest := expect("scope-list", map[string]any{"version_id": 2, "page": 1, "page_size": 20}, 200, nil)["data"].(map[string]any)
	wrong := revisions(latest)
	wrong["version_id"], wrong["scope_id"], wrong["evidence"], wrong["reason"] = 2, 999, "Marked evidence", "Wrong scope"
	expect("scope-deliver", wrong, 404, func(_ *enterpriseVersionInput, request *http.Request) {
		request.Header.Set("Idempotency-Key", "scope-deliver-wrong")
	})
	exec(db, "INSERT INTO product_version_features(id,version_id,title,status) VALUES(3,2,'Marked legacy scope','planned')")
	latest = expect("scope-list", map[string]any{"version_id": 2, "page": 1, "page_size": 20}, 200, nil)["data"].(map[string]any)
	legacy := revisions(latest)
	legacy["version_id"], legacy["scope_id"], legacy["acceptance_criteria"], legacy["reason"] = 2, 3, "Marked acceptance criteria", "Restore historical criteria"
	expect("scope-legacy-criteria", legacy, 200, nil)
	if replay := expect("scope-legacy-criteria", legacy, 200, nil)["data"].(map[string]any); replay["replayed"] != true {
		t.Fatal("legacy criteria did not replay its receipt")
	}
	expect("scope-legacy-criteria", legacy, 409, func(_ *enterpriseVersionInput, request *http.Request) {
		request.Header.Set("Idempotency-Key", "scope-legacy-stale")
	})
	exec(consoleDB, "UPDATE service_client_grants SET status='revoked' WHERE action='scope-legacy-criteria'")
	expect("scope-legacy-criteria", legacy, 403, func(_ *enterpriseVersionInput, request *http.Request) {
		request.Header.Set("Idempotency-Key", "scope-legacy-revoked")
	})
	exec(consoleDB, "UPDATE service_client_grants SET status='active' WHERE action='scope-legacy-criteria'")
	exec(consoleDB, "UPDATE service_client_grants SET status='revoked' WHERE action='scope-deliver'")
	expect("scope-deliver", deliver, 403, func(_ *enterpriseVersionInput, request *http.Request) {
		request.Header.Set("Idempotency-Key", "scope-deliver-revoked")
	})
	exec(consoleDB, "UPDATE service_client_grants SET status='active' WHERE action='scope-deliver'")
	exec(consoleDB, "UPDATE service_client_grants SET status='revoked' WHERE action='read'")
	expect("acceptance-preview", map[string]any{"version_id": 1}, 403, nil)
	exec(consoleDB, "UPDATE service_client_grants SET status='active'")
	exec(db, "UPDATE enterprise_schema_registry SET generation=2")
	expect("acceptance-preview", map[string]any{"version_id": 1}, 503, nil)
	expect("release-view", detailInput, 503, nil)
}
