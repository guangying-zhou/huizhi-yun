package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"github.com/go-sql-driver/mysql"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	aims "github.com/huizhi-yun/data-runtime/internal/apps/aims"
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

func TestEnterpriseHandoffHTTPMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_HANDOFF_TEST_SOCKET")
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
		name := "hzy_handoff_http_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	for _, q := range []string{"CREATE TABLE service_clients(id BIGINT PRIMARY KEY,status VARCHAR(20),current_credential_id BIGINT) ENGINE=InnoDB", "CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,service_client_id BIGINT,client_id VARCHAR(128),status VARCHAR(20),expires_at DATETIME) ENGINE=InnoDB", "CREATE TABLE service_client_grants(service_client_id BIGINT,resource_code VARCHAR(128),action VARCHAR(64),status VARCHAR(20)) ENGINE=InnoDB", "INSERT INTO service_clients VALUES(1,'active',7)", "INSERT INTO service_client_credentials VALUES(7,1,'enterprise.runtime','active',NULL)", "INSERT INTO service_client_grants VALUES(1,'aims:product-versions','edit','active'),(1,'aims:product-versions','delete','active'),(1,'aims:product-versions','archive','active'),(1,'aims:product-versions','reopen','active'),(1,'aims:product-versions','accept','active'),(1,'aims:product-versions','publish','active'),(1,'aims:product-versions','read','active')"} {
		exec(consoleDB, q)
	}
	password := uuid.NewString()
	exec(root, "CREATE USER 'hzy_handoff_http'@'127.0.0.1' IDENTIFIED BY '"+password+"'")
	t.Cleanup(func() { exec(root, "DROP USER 'hzy_handoff_http'@'127.0.0.1'") })
	exec(root, "GRANT SELECT,INSERT,UPDATE,DELETE,SHOW VIEW ON `"+name+"`.* TO 'hzy_handoff_http'@'127.0.0.1'")
	cfg := config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"enterprise": "enterprise-test", "aims": "aims-test"}, Enterprise: config.EnterpriseConfig{Enabled: true, Environment: "isolated", SchemaVersion: "v1", Generation: 1, InstanceID: instance, DB: config.DBConfig{Host: "127.0.0.1", Port: port, User: "hzy_handoff_http", Password: password, Database: name, ConnectionLimit: 3}, Domains: map[string]config.EnterpriseDomainConfig{"aims": {OwnerDeployment: "aims-test", Tables: mapping, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathDisabled}}, AimsDeliveryWorker: &config.EnterpriseDeliveryWorker{Deployment: "aims-test", ServiceClientID: "aims.runtime"}}}
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
	_, err = cfg.EnterpriseAimsOutboundSource(registry, binding)
	if err != nil {
		t.Fatal(err)
	}
	service, err := enterpriseplanning.NewLightweightHandoffService(context.Background(), registry, binding)
	if err != nil {
		t.Fatal(err)
	}

	exec(db, "INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P',UUID(),'person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	exec(db, "INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P','person-a','manager','active',UTC_TIMESTAMP(3),'person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	exec(db, "INSERT INTO aims_projects(id,project_code,name,short_name,category,lifecycle_status,leader_uid,created_by) VALUES(42,'PRJ','Product','Product','product_dev','active','person-a','person-a'),(43,'HIDDEN','Unbound','Unbound','product_dev','active','other','other')")
	exec(db, "INSERT INTO aims_project_products(project_id,product_code,created_by) VALUES(42,'P','person-a')")
	ctx := context.Background()
	planning, err := enterpriseplanning.NewPlanningService(ctx, registry, binding)
	if err != nil {
		t.Fatal(err)
	}
	permit := func(resource, action string) pc.AuthorizationPermit {
		facts, err := pc.LoadAuthorizationFacts(ctx, db, "P", "person-a")
		if err != nil {
			t.Fatal(err)
		}
		return pc.AuthorizationPermit{Resource: resource, Action: action, Facts: facts, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli()}
	}
	id := func(action string) pc.CommandIdentity {
		return pc.CommandIdentity{ProductCode: "P", ActorUID: "person-a", Action: action, IdempotencyKey: action}
	}
	must := func(out pc.CommandResult, err error) map[string]any {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		var v map[string]any
		if err = json.Unmarshal(out.Value, &v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	request := must(pc.CreateProductRequest(ctx, db, id("product_requests:create"), permit("product_requests", "create"), pc.RequestDraft{ExpectedRevision: 1, Title: "Login", ProblemStatement: "Login", SourceType: "internal", UrgencyLevel: "P2"}))
	owner := "person-a"
	versionInput := pc.ProductVersionDraft{ExpectedRevision: 2, VersionCode: "v1", Name: "v1", PlanningMode: "simple", BusinessOwnerUID: &owner}
	version := must(planning.CreateProductCenterVersion(ctx, id("product_versions:create"), permit("product_versions", "edit"), versionInput))
	versionID := int64(version["id"].(float64))
	old, err := pc.CreateProductCenterVersion(ctx, db, id("product_versions:create"), permit("product_versions", "edit"), versionInput)
	if err != nil || !old.Replayed {
		t.Fatal("old version entry did not replay", err)
	}
	available, reserve, estimate := pc.Hundredths(1000), pc.Hundredths(100), pc.Hundredths(800)
	must(planning.EditLightweightVersionPlan(ctx, id("product_versions:plan-edit"), permit("product_versions", "edit"), pc.LightweightVersionPlanEdit{VersionID: versionID, ExpectedRevision: 3, ExpectedVersionRevision: 1, ExpectedPlanRevision: 1, Goal: "Login", StartsOn: "2099-01-01", PlannedReleaseDate: "2099-01-31", AvailablePersonDays: &available, ReservePersonDays: &reserve}))
	scope := must(planning.CreateLightweightVersionPlanItem(ctx, id("product_versions:plan-item-create"), permit("product_versions", "edit"), permit("product_requests", "view"), permit("product_requests", "decide"), permit("product_priorities", "edit"), pc.LightweightVersionPlanItemCreate{VersionID: versionID, ExpectedRevision: 4, ExpectedVersionRevision: 2, ExpectedPlanRevision: 2, ExpectedRequestRevision: 1, RequestBizID: request["biz_id"].(string), ScopeSummary: "Login", AcceptanceCriteria: "Works", EstimatePersonDays: &estimate, AdoptRequest: true}))
	scopeID := int64(scope["id"].(float64))
	must(planning.EditLightweightVersionPlanItem(ctx, id("product_versions:plan-item-edit"), permit("product_versions", "edit"), pc.LightweightVersionPlanItemEdit{VersionID: versionID, ScopeID: scopeID, ExpectedRevision: 5, ExpectedVersionRevision: 3, ExpectedPlanRevision: 2, ExpectedScopeRevision: 2, ScopeSummary: "Login", AcceptanceCriteria: "Works", EstimatePersonDays: &estimate}))
	must(planning.ConfirmLightweightVersionPlan(ctx, id("product_versions:plan-confirm"), permit("product_versions", "edit"), permit("product_priorities", "prioritize"), pc.LightweightVersionPlanConfirm{VersionID: versionID, ExpectedRevision: 6, ExpectedVersionRevision: 4, ExpectedPlanRevision: 2, ExpectedScopeRevision: 3}))

	command := pc.PlanningHandoffInput{PlanningDeliveryCheck: pc.PlanningDeliveryCheck{ExpectedRevision: 6, ItemBizID: scope["planning_item_biz_id"].(string), ExpectedItemRevision: 2}, RequestBizID: request["biz_id"].(string), ExpectedRequestRevision: 2, ProjectCode: "PRJ", SliceKey: "one", Operation: "create", Title: "Login", ScopeSummary: "Login", Reason: "Deliver", PlannedVersionID: versionID, PlannedVersionFeatureID: scopeID}
	exec(consoleDB, "INSERT INTO service_client_grants VALUES(1,'aims:product-priorities','read','active'),(1,'aims:product-priorities','project-authorization','active'),(1,'aims:product-priorities','handoff','active')")
	authenticator, template, _ := enterpriseContextFixture(t, func(c jwt.MapClaims) {
		c["scope"] = "aims:product-priorities:read aims:product-priorities:project-authorization aims:product-priorities:handoff"
	}, true)
	server := httptest.NewServer(&Server{cfg: cfg, auth: authenticator, enterpriseRegistry: registry, enterpriseHandoff: service, console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-a", consoleDB)})
	defer server.Close()
	call := func(action, key string, v any, mutate func(*enterpriseHandoffInput)) (int, string) {
		t.Helper()
		project, err := aims.LoadProductHandoffProjectFacts(ctx, db, "PRJ", "person-a")
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(v)
		input := enterpriseHandoffInput{ProductCode: "P", Tenant: "tenant-a", Deployment: "enterprise-test", Input: raw, Authorization: permit("product_priorities", "view"), PlanningAuthorization: permit("product_priorities", "handoff"), RequestAuthorization: permit("product_requests", "handoff"), VersionAuthorization: permit("product_versions", "view"), ProjectAuthorization: aims.ProductHandoffProjectPermit{Resource: "requirements", Action: "edit", Facts: project, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli()}}
		if mutate != nil {
			mutate(&input)
		}
		raw, _ = json.Marshal(input)
		r, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/enterprise/aims/handoff:"+action, bytes.NewReader(raw))
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
	expect := func(action, key string, v any, want int, mutate func(*enterpriseHandoffInput)) map[string]any {
		t.Helper()
		status, body := call(action, key, v, mutate)
		if status != want {
			t.Fatalf("%s got %d want %d: %s", action, status, want, body)
		}
		var out map[string]any
		if err = json.Unmarshal([]byte(body), &out); err != nil {
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
	receipts, audits := count("product_command_receipts"), count("product_activity_logs")
	projects := expect("projects", "", map[string]any{"keyword": ""}, 200, nil)["data"].([]any)
	if len(projects) != 1 || projects[0].(map[string]any)["project_code"] != "PRJ" {
		t.Fatal(projects)
	}
	expect("detail", "", map[string]any{"biz_id": command.ItemBizID}, 200, nil)
	expect("project-authorization", "", map[string]any{"project_code": "PRJ"}, 200, nil)
	expect("project-authorization", "", map[string]any{"project_code": "PRJ"}, 409, func(i *enterpriseHandoffInput) { i.Authorization.Facts.Revision += 1 })
	expect("requirements", "", map[string]any{"project_code": "HIDDEN", "keyword": ""}, 404, nil)
	if count("product_command_receipts") != receipts || count("product_activity_logs") != audits {
		t.Fatal("read changed business state")
	}
	for _, mutate := range []func(*enterpriseHandoffInput){func(i *enterpriseHandoffInput) { i.Tenant = "other" }, func(i *enterpriseHandoffInput) { i.ProjectAuthorization.Facts.ActorUID = "other" }, func(i *enterpriseHandoffInput) { i.ProjectAuthorization.Facts.LeaderUID = "other" }, func(i *enterpriseHandoffInput) { i.VersionAuthorization.Action = "edit" }, func(i *enterpriseHandoffInput) { i.RequestAuthorization.ExpiresAt = 0 }} {
		expect("create", "handoff", command, 403, mutate)
	}
	exec(db, "CREATE TRIGGER handoff_audit BEFORE INSERT ON aims_product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='late handoff audit'")
	expect("create", "handoff", command, 503, nil)
	if count("requirement_items") != 0 || count("requirement_contents") != 0 || count("product_request_delivery_links") != 0 || count("product_command_receipts") != receipts {
		t.Fatal("handoff partial transaction")
	}
	exec(db, "DROP TRIGGER handoff_audit")
	saved := expect("create", "handoff", command, 200, nil)
	expect("create", "handoff", command, 200, nil)
	reqID := int64(saved["data"].(map[string]any)["value"].(map[string]any)["requirement_id"].(float64))
	if count("requirement_items") != 1 || count("product_request_delivery_links") != 1 {
		t.Fatal("handoff replay duplicate")
	}
	reqs := expect("requirements", "", map[string]any{"project_code": "PRJ", "keyword": "Login"}, 200, nil)["data"].(map[string]any)
	if len(reqs["items"].([]any)) != 1 {
		t.Fatal(reqs)
	}
	command.Operation = "link"
	command.RequirementID = reqID
	command.SliceKey = "linked"
	command.Title = ""
	if err := db.QueryRow("SELECT revision FROM product_workspaces WHERE product_code='P'").Scan(&command.ExpectedRevision); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT revision FROM product_planning_items WHERE biz_id=?", command.ItemBizID).Scan(&command.ExpectedItemRevision); err != nil {
		t.Fatal(err)
	}
	expect("create", "duplicate-link", command, 409, nil)
	exec(db, "INSERT INTO requirement_items(id,project_id,req_number,req_code,title,created_by) VALUES(100,42,100,'PRJ-REQ-100','Existing baseline','person-a')")
	command.RequirementID = 100
	expect("create", "link", command, 200, nil)
	if count("requirement_items") != 2 || count("product_request_delivery_links") != 2 {
		t.Fatal("link did not reuse actual requirement")
	}
	exec(db, "UPDATE enterprise_schema_registry SET generation=2")
	expect("projects", "", map[string]any{"keyword": ""}, 503, nil)
}
