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

func TestEnterpriseVersionCommandsHTTPMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_VERSION_TEST_SOCKET")
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
		name := "hzy_version_http_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	for _, q := range []string{"CREATE TABLE service_clients(id BIGINT PRIMARY KEY,status VARCHAR(20),current_credential_id BIGINT) ENGINE=InnoDB", "CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,service_client_id BIGINT,client_id VARCHAR(128),status VARCHAR(20),expires_at DATETIME) ENGINE=InnoDB", "CREATE TABLE service_client_grants(service_client_id BIGINT,resource_code VARCHAR(128),action VARCHAR(64),status VARCHAR(20)) ENGINE=InnoDB", "INSERT INTO service_clients VALUES(1,'active',7)", "INSERT INTO service_client_credentials VALUES(7,1,'enterprise.runtime','active',NULL)", "INSERT INTO service_client_grants VALUES(1,'aims:product-versions','edit','active'),(1,'aims:product-versions','delete','active'),(1,'aims:product-versions','archive','active'),(1,'aims:product-versions','reopen','active')"} {
		exec(consoleDB, q)
	}
	password := uuid.NewString()
	exec(root, "CREATE USER 'hzy_version_http'@'127.0.0.1' IDENTIFIED BY '"+password+"'")
	t.Cleanup(func() { exec(root, "DROP USER 'hzy_version_http'@'127.0.0.1'") })
	exec(root, "GRANT SELECT,INSERT,UPDATE,DELETE,SHOW VIEW ON `"+name+"`.* TO 'hzy_version_http'@'127.0.0.1'")
	cfg := config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"enterprise": "enterprise-test", "aims": "aims-test"}, Enterprise: config.EnterpriseConfig{Enabled: true, Environment: "isolated", SchemaVersion: "v1", Generation: 1, InstanceID: instance, DB: config.DBConfig{Host: "127.0.0.1", Port: port, User: "hzy_version_http", Password: password, Database: name, ConnectionLimit: 3}, Domains: map[string]config.EnterpriseDomainConfig{"aims": {OwnerDeployment: "aims-test", Tables: mapping, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathDisabled}}, AimsDeliveryWorker: &config.EnterpriseDeliveryWorker{Deployment: "aims-test", ServiceClientID: "aims.runtime"}}}
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
	exec(db, "INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P',UUID(),'person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	exec(db, "INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P','person-a','manager','active',UTC_TIMESTAMP(3),'person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	for i, status := range []string{"planning", "released", "released", "planning"} {
		exec(db, "INSERT INTO product_versions(id,product_code,version_code,status) VALUES(?,'P',?,?)", i+1, "v"+string(rune('1'+i)), status)
	}
	for _, id := range []int{2, 3} {
		exec(db, "INSERT INTO product_release_records(id,biz_id,version_id,release_seq,scope_revision,scope_snapshot,acceptance_snapshot,content_hash,evidence_level,recorded_at) VALUES(?,UUID(),?,1,1,JSON_OBJECT(),JSON_OBJECT(),REPEAT('a',64),'legacy_import',UTC_TIMESTAMP(3))", id, id)
		exec(db, "UPDATE product_versions SET current_release_record_id=? WHERE id=?", id, id)
	}
	exec(db, "INSERT INTO product_requests(id,biz_id,product_code,title,created_by,updated_by,created_at,updated_at) VALUES(1,UUID(),'P','Feedback','person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	exec(db, "INSERT INTO product_request_sources(id,request_id,source_type,source_note,created_by,updated_by,created_at,updated_at) VALUES(1,1,'service_ticket','Feedback','person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	exec(db, "INSERT INTO product_feedback_bindings(source_app,source_type,source_biz_id,product_code,request_id,source_id,created_by,created_at) VALUES('altoc','service_ticket','ST-1','P',1,1,'person-a',UTC_TIMESTAMP(3))")
	authenticator, template, _ := enterpriseContextFixture(t, func(c jwt.MapClaims) {
		c["scope"] = "aims:product-versions:edit aims:product-versions:delete aims:product-versions:archive aims:product-versions:reopen"
	}, true)
	server := httptest.NewServer(&Server{cfg: cfg, auth: authenticator, enterpriseRegistry: registry, enterpriseVersions: service, console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-a", consoleDB)})
	defer server.Close()
	call := func(action string, value any, mutate func(*enterpriseVersionInput, *http.Request)) (int, string) {
		t.Helper()
		facts, err := pc.LoadAuthorizationFacts(context.Background(), db, "P", "person-a")
		if err != nil {
			t.Fatal(err)
		}
		permission := action
		if action == "transition" {
			permission = "edit"
		}
		raw, _ := json.Marshal(value)
		input := enterpriseVersionInput{ProductCode: "P", Tenant: "tenant-a", Deployment: "enterprise-test", Input: raw, Authorization: pc.AuthorizationPermit{Resource: "product_versions", Action: permission, Facts: facts, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli()}}
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
		request.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, runtimeBearerToken(request), request.Method, request.URL.RequestURI(), "person-a", nil, request.Header.Get("X-HZY-Actor-Signed-At")))
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, _ := io.ReadAll(response.Body)
		return response.StatusCode, string(data)
	}
	edit := pc.ProductVersionEdit{VersionID: 1, ExpectedVersionRevision: 1, Reason: "clarify", ProductVersionDraft: pc.ProductVersionDraft{ExpectedRevision: 1, VersionCode: "v1", Name: "Changed"}}
	for _, mutate := range []func(*enterpriseVersionInput, *http.Request){func(i *enterpriseVersionInput, _ *http.Request) { i.Tenant = "other" }, func(i *enterpriseVersionInput, _ *http.Request) { i.Authorization.Action = "view" }, func(i *enterpriseVersionInput, _ *http.Request) {
		i.Authorization.ExpiresAt = time.Now().Add(time.Minute).UnixMilli()
	}, func(_ *enterpriseVersionInput, r *http.Request) { r.Header.Del("Idempotency-Key") }} {
		if status, body := call("edit", edit, mutate); status < 400 {
			t.Fatal("invalid command", status, body)
		}
	}
	exec(db, "CREATE TRIGGER fail_version_http BEFORE INSERT ON aims_product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='late failure'")
	if status, body := call("edit", edit, nil); status < 400 {
		t.Fatal("late audit", status, body)
	}
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM aims_integration_operation").Scan(&count); err != nil || count != 0 {
		t.Fatal("HTTP outbox rollback", count, err)
	}
	exec(db, "DROP TRIGGER fail_version_http")
	actions := []struct {
		action string
		input  any
	}{{"edit", edit}, {"transition", pc.ProductVersionTransitionInput{VersionID: 1, ExpectedRevision: 2, ExpectedVersionRevision: 2, ToStatus: "developing", Reason: "start"}}, {"archive", pc.ProductVersionArchiveInput{VersionID: 2, ExpectedRevision: 3, ExpectedVersionRevision: 1, ExpectedScopeRevision: 1, Reason: "archive"}}, {"reopen", pc.ProductVersionReopenInput{VersionID: 3, ReleaseRecordID: 3, ExpectedRevision: 4, ExpectedVersionRevision: 1, Reason: "correct"}}, {"delete", pc.ProductVersionDeleteInput{VersionID: 4, ExpectedRevision: 5, ExpectedVersionRevision: 1, ExpectedScopeRevision: 1, Reason: "unused"}}}
	for _, action := range actions {
		if status, body := call(action.action, action.input, nil); status != 200 {
			t.Fatal(action.action, status, body)
		}
		if status, body := call(action.action, action.input, nil); status != 200 || !strings.Contains(body, `"replayed":true`) {
			t.Fatal("replay", action.action, status, body)
		}
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM aims_integration_operation WHERE deployment_code='aims-test'").Scan(&count); err != nil || count != 4 {
		t.Fatal("HTTP feedback", count, err)
	}
	exec(consoleDB, "UPDATE service_client_grants SET status='revoked' WHERE action='edit'")
	if status, body := call("edit", edit, nil); status != 403 {
		t.Fatal("revoked grant replay", status, body)
	}
	exec(consoleDB, "UPDATE service_client_grants SET status='active'")
	exec(db, "UPDATE enterprise_schema_registry SET generation=2")
	if status, body := call("archive", actions[2].input, nil); status < 400 {
		t.Fatal("stale generation", status, body)
	}
}
