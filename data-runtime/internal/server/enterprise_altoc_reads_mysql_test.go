package server

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"github.com/go-sql-driver/mysql"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/config"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	ec "github.com/huizhi-yun/data-runtime/internal/enterprisecontracts"
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

// Dedicated disposable server only: no environment DB or deployed process.
func TestEnterpriseAltocReadsHTTPMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ALTOC_READ_HTTP_SOCKET")
	if socket == "" {
		t.Skip("dedicated temporary MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	mc := mysql.NewConfig()
	mc.User, mc.Net, mc.Addr, mc.ParseTime = "root", "unix", socket, true
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	exec := func(db *sql.DB, q string) {
		t.Helper()
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	newDB := func() (string, *sql.DB) {
		name := "hzy_altoc_http_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		exec(root, "CREATE DATABASE "+name)
		t.Cleanup(func() { exec(root, "DROP DATABASE "+name) })
		c := *mc
		c.DBName = name
		db, err := sql.Open("mysql", c.FormatDSN())
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		return name, db
	}
	// Cleanup functions run before root close through one explicit cleanup.
	name, business := newDB()
	_, consoleDB := newDB()
	var instance string
	if err = root.QueryRow("SELECT @@server_uuid").Scan(&instance); err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile("../../../altoc/docs/altoc_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	tables := map[string]string{}
	for _, logical := range altoc.BasicReadTables {
		tables[logical] = "altoc_" + logical
	}
	business.SetMaxOpenConns(1)
	exec(business, "SET FOREIGN_KEY_CHECKS=0")
	for _, part := range regexp.MustCompile("(?ms)^CREATE TABLE(?: IF NOT EXISTS)? `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(source), -1) {
		if _, ok := tables[part[1]]; ok {
			q := strings.Replace(part[0], "CREATE TABLE "+part[1], "CREATE TABLE altoc_"+part[1], 1)
			for logical, physical := range tables {
				q = strings.ReplaceAll(q, "REFERENCES "+logical+"(", "REFERENCES "+physical+"(")
			}
			exec(business, q)
		}
	}
	exec(business, "SET FOREIGN_KEY_CHECKS=1")
	business.SetMaxOpenConns(3)
	for _, q := range []string{
		"CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(64),environment_code VARCHAR(64),runtime_deployment VARCHAR(64),schema_version VARCHAR(64),generation BIGINT) ENGINE=InnoDB",
		"INSERT INTO enterprise_schema_registry VALUES(1,'tenant-a','test','runtime-test','v1',1)",
		"INSERT INTO altoc_customer(id,code,name,owner_user_id,owner_dept_code) VALUES(1,'CU1','Visible','person-a','D1'),(2,'CU2','Hidden','other','D2'),(3,'CU3','Department','other','D1')",
		"INSERT INTO altoc_contract(id,code,name,customer_id,owner_user_id,owner_dept_code) VALUES(1,'CT1','Visible contract',1,'person-a','D1'),(2,'CT2','Hidden contract',2,'other','D2')",
		"INSERT INTO altoc_receivable_plan(id,code,contract_id,customer_id,plan_name,amount,owner_user_id,collection_responsible_uid) VALUES(1,'RP1',1,1,'Plan',10,'person-a',NULL),(2,'RP2',2,2,'Collection',20,'other','person-a'),(3,'RP3',2,2,'Hidden',30,'other',NULL)",
	} {
		exec(business, q)
	}
	for _, q := range []string{
		"CREATE TABLE service_clients(id BIGINT PRIMARY KEY,status VARCHAR(20),current_credential_id BIGINT,client_code VARCHAR(100),client_name VARCHAR(100),client_type VARCHAR(20),app_code VARCHAR(40))",
		"CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,service_client_id BIGINT,client_id VARCHAR(128),status VARCHAR(20),expires_at DATETIME)",
		"CREATE TABLE service_client_grants(service_client_id BIGINT,resource_code VARCHAR(128),action VARCHAR(64),scope_json JSON,status VARCHAR(20))",
		"INSERT INTO service_clients VALUES(1,'active',7,'enterprise.runtime','Enterprise','runtime','enterprise')",
		"INSERT INTO service_client_credentials VALUES(7,1,'enterprise.runtime','active',NULL)",
	} {
		exec(consoleDB, q)
	}
	exec(consoleDB, "INSERT INTO service_client_grants VALUES(1,'data-runtime:altoc:enterprise-host','execute',JSON_OBJECT('audience','data-runtime','semanticScope','altoc:enterprise-host:execute'),'active')")
	fixtureUser := "hzy_read_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	password := uuid.NewString()
	exec(root, "CREATE USER '"+fixtureUser+"'@'localhost' IDENTIFIED BY '"+password+"'")
	t.Cleanup(func() { exec(root, "DROP USER '"+fixtureUser+"'@'localhost'") })
	exec(root, "GRANT SELECT ON "+name+".* TO '"+fixtureUser+"'@'localhost'")
	readonly := *mc
	readonly.User, readonly.Passwd, readonly.DBName = fixtureUser, password, name
	readDB, err := sql.Open("mysql", readonly.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	registry := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return readDB, nil })
	t.Cleanup(func() { registry.Close() })
	binding := e.Binding{Key: e.BindingKey{Tenant: "tenant-a", Environment: "test", RuntimeDeployment: "runtime-test"}, Storage: e.Storage{InstanceID: instance, Address: "127.0.0.1:3306", Database: name}, SchemaVersion: "v1", Generation: 1, Domains: map[string]e.DomainBinding{"altoc": {OwnerDeployment: "enterprise-test", Read: e.PathUnified, Write: e.PathDisabled, Scheduler: e.PathDisabled, Tables: tables}}}
	if err = registry.Register(context.Background(), binding); err != nil {
		t.Fatal(err)
	}
	service, err := ec.NewBasicReadService(registry, binding)
	if err != nil {
		t.Fatal(err)
	}
	revision := int64(42)
	call := func(path, id string, scope altoc.BasicReadScope, query altoc.BasicReadQuery, claimsChange func(jwt.MapClaims), tamper bool) (int, map[string]any) {
		t.Helper()
		spec := enterpriseAltocReadPaths[path]
		authenticator, r, _ := enterpriseContextFixture(t, func(c jwt.MapClaims) {
			c["scope"] = "altoc:enterprise-host:execute"
			if claimsChange != nil {
				claimsChange(c)
			}
		}, true)
		r.Method, r.URL.Path, r.URL.RawQuery = "POST", path, ""
		bearer := runtimeBearerToken(r)
		r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, bearer, r.Method, r.URL.RequestURI(), "person-a", nil, r.Header.Get("X-HZY-Actor-Signed-At")))
		permit := enterpriseAltocReadPermit{ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: spec.Resource, Action: "view", Operation: spec.Action, ObjectID: id, Allowed: true, ExpiresAt: time.Now().Add(14 * time.Second).UnixMilli(), Scope: scope, Query: query, BundleVersion: "v1", BundleHash: "hash", PolicyRevision: &revision}
		mac := hmac.New(sha256.New, []byte(bearer))
		mac.Write([]byte(enterpriseAltocReadPermitCanonical(r, permit)))
		r.Header.Set("X-HZY-Enterprise-Altoc-Permit-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
		if tamper {
			permit.Scope.Access = "all"
			permit.Scope.DepartmentCodes = []string{}
		}
		raw, _ := json.Marshal(enterpriseAltocReadInput{ID: id, Query: query, Authorization: permit})
		r.Body = io.NopCloser(bytes.NewReader(raw))
		r.Header.Set("Content-Type", "application/json")
		s := &Server{cfg: config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"enterprise": "enterprise-test"}, Enterprise: config.EnterpriseConfig{Enabled: true, Environment: "test", Domains: map[string]config.EnterpriseDomainConfig{"altoc": {Read: e.PathUnified}}}}, auth: authenticator, enterpriseAltocReads: service, console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-a", consoleDB)}
		httpServer := httptest.NewServer(s)
		defer httpServer.Close()
		request, _ := http.NewRequest("POST", httpServer.URL+path, r.Body)
		request.Header = r.Header
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var out map[string]any
		if err = json.NewDecoder(response.Body).Decode(&out); err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, out
	}
	q := altoc.BasicReadQuery{Page: 1, PageSize: 1}
	self := altoc.BasicReadScope{Access: "self"}
	for path, spec := range enterpriseAltocReadPaths {
		t.Run(spec.Resource+"/"+spec.Action, func(t *testing.T) {
			id := ""
			if spec.Action == "view" {
				id = "1"
			}
			status, out := call(path, id, self, q, nil, false)
			if status != 200 {
				t.Fatalf("expected actual qualified grant success, got %d %v", status, out)
			}
			for _, scenario := range []string{"missing-cap", "wrong-audience", "wrong-source"} {
				status, _ := call(path, id, self, q, func(c jwt.MapClaims) {
					switch scenario {
					case "missing-cap":
						c["scope"] = "aims:enterprise-host:execute"
					case "wrong-audience":
						c["aud"] = "altoc"
					case "wrong-source":
						c["source_app"] = "altoc"
					}
				}, false)
				if status != 403 {
					t.Fatalf("%s status%d", scenario, status)
				}
			}
			status, _ = call(path, id, self, q, nil, true)
			if status != 403 {
				t.Fatalf("body tamper status%d", status)
			}
		})
	}
	list := "/v1/enterprise/altoc/customers:list"
	view := "/v1/enterprise/altoc/customers:view"
	q.Page = 2
	status, out := call(list, "", altoc.BasicReadScope{Access: "dept", DepartmentCodes: []string{"D1"}}, q, nil, false)
	if status != 200 {
		t.Fatal(status, out)
	}
	data := out["data"].(map[string]any)
	if data["total"] != float64(2) || len(data["items"].([]any)) != 1 {
		t.Fatal("COUNT scope drift", data)
	}
	q.Page = 1
	status, _ = call(view, "2", self, q, nil, false)
	if status != 404 {
		t.Fatal("owner scope leaked", status)
	}

	filtered := q
	filtered.Search = "Department"
	status, out = call(list, "", altoc.BasicReadScope{Access: "dept", DepartmentCodes: []string{"D1"}}, filtered, nil, false)
	if status != 200 || out["data"].(map[string]any)["total"] != float64(1) {
		t.Fatal("filtered COUNT drift", status, out)
	}
	exec(business, "UPDATE altoc_customer SET owner_dept_code='D2' WHERE id=3")
	status, _ = call(view, "3", altoc.BasicReadScope{Access: "dept", DepartmentCodes: []string{"D1"}}, q, nil, false)
	if status != 404 {
		t.Fatal("stale department allowed", status)
	}
	exec(business, "UPDATE altoc_customer SET owner_user_id='other' WHERE id=1")
	status, _ = call(view, "1", self, q, nil, false)
	if status != 404 {
		t.Fatal("stale owner allowed", status)
	}
	status, _ = call("/v1/enterprise/altoc/receivable-plans:view", "2", self, q, nil, false)
	if status != 200 {
		t.Fatal("collection scope missing", status)
	}
	status, _ = call("/v1/enterprise/altoc/contracts:view", "2", self, q, nil, false)
	if status != 404 {
		t.Fatal("collection granted contract master", status)
	}
	status, _ = call("/v1/enterprise/altoc/receivable-plans:view", "3", self, q, nil, false)
	if status != 404 {
		t.Fatal("unrelated plan leaked", status)
	}
	exec(business, "UPDATE enterprise_schema_registry SET generation=2")
	status, _ = call(list, "", self, q, nil, false)
	if status != 503 {
		t.Fatal("persistent fence accepted stale binding", status)
	}
	exec(business, "UPDATE enterprise_schema_registry SET generation=1")
	for _, field := range []string{"audience", "semanticScope"} {
		value := "altoc"
		restore := "data-runtime"
		if field == "semanticScope" {
			value = "altoc:contract:view"
			restore = "altoc:enterprise-host:execute"
		}
		_, err = consoleDB.Exec("UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,?,?) WHERE resource_code='data-runtime:altoc:enterprise-host'", "$."+field, value)
		if err != nil {
			t.Fatal(err)
		}
		status, _ = call(list, "", self, q, nil, false)
		if status != 403 {
			t.Fatalf("grant %s mismatch status%d, want403", field, status)
		}
		_, err = consoleDB.Exec("UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,?,?) WHERE resource_code='data-runtime:altoc:enterprise-host'", "$."+field, restore)
		if err != nil {
			t.Fatal(err)
		}
	}
	exec(consoleDB, "UPDATE service_client_grants SET status='revoked'")
	status, _ = call(list, "", self, q, nil, false)
	if status != 403 {
		t.Fatal("revoked grant status (want403)", status)
	}
	exec(consoleDB, "UPDATE service_client_grants SET status='active'")
	exec(consoleDB, "UPDATE service_client_credentials SET status='revoked' WHERE id=7")
	status, _ = call(list, "", self, q, nil, false)
	if status != 403 {
		t.Fatal("revoked credential status (want403)", status)
	}
	exec(consoleDB, "DROP TABLE service_client_credentials")
	status, _ = call(list, "", self, q, nil, false)
	if status != 503 {
		t.Fatal("Console outage not preserved", status)
	}
}
