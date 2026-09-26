package server

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/golang-jwt/jwt/v5"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	ec "github.com/huizhi-yun/data-runtime/internal/enterprisecontracts"
	"io"
	"net/http"
	"net/http/httptest"

	"database/sql"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	altocapp "github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/config"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"time"

	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestEnterpriseContractActivationHTTPMySQL(t *testing.T) {
	socket := os.Getenv("HZY_CONTRACT_ACTIVATION_HTTP_SOCKET")
	if socket == "" {
		t.Skip("dedicated MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
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
	defer root.Close()
	exec := func(db *sql.DB, q string) {
		t.Helper()
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	name := "hzy_contract_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	exec(root, "CREATE DATABASE "+name)
	defer exec(root, "DROP DATABASE "+name)
	mc.DBName = name
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	source, err := os.ReadFile("../../../altoc/docs/altoc_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	exec(db, "SET FOREIGN_KEY_CHECKS=0")
	tables := regexp.MustCompile("(?ms)^CREATE TABLE(?: IF NOT EXISTS)? `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(source), -1)
	if len(tables) < 30 {
		t.Fatal("canonical schema missing")
	}
	for _, table := range tables {
		exec(db, table[0])
	}
	exec(db, "SET FOREIGN_KEY_CHECKS=1")
	db.SetMaxOpenConns(5)
	var port int
	if err = root.QueryRow("SELECT @@port").Scan(&port); err != nil {
		t.Fatal(err)
	}
	secret := uuid.NewString()
	exec(root, "CREATE USER 'hzy_contract'@'127.0.0.1' IDENTIFIED BY '"+secret+"'")
	defer exec(root, "DROP USER 'hzy_contract'@'127.0.0.1'")
	exec(root, "GRANT ALL ON "+name+".* TO 'hzy_contract'@'127.0.0.1'")
	base, err := compat.New(compat.Config{DB: config.DBConfig{Host: "127.0.0.1", Port: port, User: "hzy_contract", Password: secret, Database: name}})
	if err != nil {
		t.Fatal(err)
	}
	defer base.DB().Close()
	a := &altocapp.Adapter{Adapter: base}
	ctx := context.Background()
	exec(db, "INSERT INTO customer(id,code,name,owner_user_id) VALUES(1,'CU-1','Customer','person-a')")
	exec(db, "INSERT INTO contract(id,code,name,customer_id,owner_user_id) VALUES(1,'CT-1','Contract',1,'person-a')")
	exec(db, "INSERT INTO contract_line(code,contract_id,line_no,line_type,name,project_policy) VALUES('LINE-1',1,1,'implementation','Delivery','required')")
	exec(db, "INSERT INTO contract_payment_term(id,contract_id,term_name,term_type,amount,trigger_stage_type) VALUES(1,1,'Signed','advance',20,'contract_signed')")
	altocTables := map[string]string{}
	renames := []string{}
	for _, table := range tables {
		altocTables[table[1]] = "altoc_" + table[1]
		renames = append(renames, "`"+table[1]+"` TO `altoc_"+table[1]+"`")
	}
	exec(db, "RENAME TABLE "+strings.Join(renames, ","))
	sourceAims, err := os.ReadFile("../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	needed := map[string]bool{"service_command_receipt": true, "integration_operation": true, "integration_operation_attempt": true, "integration_operation_dead_letter_actionable": true, "approval_records": true}
	for _, name := range ec.MilestoneReceivableAimsViews() {
		needed[name] = true
	}
	aimsTables := map[string]string{}
	db.SetMaxOpenConns(1)
	exec(db, "SET FOREIGN_KEY_CHECKS=0")
	for _, table := range regexp.MustCompile("(?ms)^CREATE TABLE IF NOT EXISTS `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(sourceAims), -1) {
		if !needed[table[1]] {
			continue
		}
		physical := "aims_" + table[1]
		aimsTables[table[1]] = physical
		ddl := strings.Replace(table[0], table[1], physical, 1)
		for logical := range needed {
			ddl = strings.ReplaceAll(ddl, "REFERENCES `"+logical+"`", "REFERENCES `aims_"+logical+"`")
			ddl = strings.ReplaceAll(ddl, "REFERENCES "+logical+" (", "REFERENCES aims_"+logical+" (")
			ddl = strings.ReplaceAll(ddl, "REFERENCES "+logical+"", "REFERENCES aims_"+logical)
		}

		for _, prefix := range []string{"chk_scr_", "chk_iop_", "chk_iopdla_", "chk_ioa_", "chk_approval_", "fk_iopdla_", "fk_ioa_", "fk_approval_"} {
			ddl = strings.ReplaceAll(ddl, prefix, "aims_"+prefix)
		}
		exec(db, ddl)
	}
	exec(db, "SET FOREIGN_KEY_CHECKS=1")
	db.SetMaxOpenConns(5)
	// A conflicting domain audit table must not receive Altoc's audit rows.
	exec(db, "CREATE TABLE aims_audit_log LIKE altoc_audit_log")
	aimsTables["audit_log"] = "aims_audit_log"
	var instance string
	db.QueryRow("SELECT @@server_uuid").Scan(&instance)
	binding := e.Binding{Key: e.BindingKey{Tenant: "tenant-a", Environment: "isolated", RuntimeDeployment: "runtime-test"}, Storage: e.Storage{InstanceID: instance, Address: "127.0.0.1:3306", Database: name}, SchemaVersion: "v1", Generation: 1, Domains: map[string]e.DomainBinding{"altoc": {OwnerDeployment: "enterprise-test", Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathUnified, Tables: altocTables}, "aims": {OwnerDeployment: "enterprise-test", Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathUnified, Tables: aimsTables}}}
	exec(db, "CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(64),environment_code VARCHAR(64),runtime_deployment VARCHAR(64),schema_version VARCHAR(64),generation BIGINT) ENGINE=InnoDB")
	exec(db, "INSERT INTO enterprise_schema_registry VALUES(1,'tenant-a','isolated','runtime-test','v1',0)")
	for domain, views := range map[string][]string{"altoc": ec.ActivationAltocViews(), "aims": ec.MilestoneReceivableAimsViews()} {
		plan, err := e.PlanCompatibilityViews(ctx, db, binding, domain, views)
		if err != nil {
			t.Fatal(err)
		}
		if err = e.ApplyCompatibilityViews(ctx, db, binding, domain, views, plan.ReviewHash); err != nil {
			t.Fatal(err)
		}
	}
	exec(db, "UPDATE enterprise_schema_registry SET generation=1")
	registry := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return db, nil })
	if err = registry.Register(ctx, binding); err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	service, err := ec.NewActivationService(ctx, registry, binding, ec.DeploymentBinding{AltocDeployment: "altoc-test", AimsDeployment: "aims-test", AltocClient: "altoc.runtime"}, a, &aimsapp.Adapter{Adapter: base})
	if err != nil {
		t.Fatal(err)
	}
	milestoneService, err := ec.NewMilestoneReceivableService(ctx, registry, binding, ec.DeploymentBinding{AltocDeployment: "altoc-test", AimsDeployment: "aims-test", AltocClient: "altoc.runtime"}, a, &aimsapp.Adapter{Adapter: base})
	if err != nil {
		t.Fatal(err)
	}
	_ = milestoneService // AA04 HTTP callback assertions are added below this fixture.

	consoleName := name + "_console"
	exec(root, "CREATE DATABASE "+consoleName)
	defer exec(root, "DROP DATABASE "+consoleName)
	consoleConfig := *mc
	consoleConfig.DBName = consoleName
	consoleDB, err := sql.Open("mysql", consoleConfig.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer consoleDB.Close()
	for _, q := range []string{"CREATE TABLE service_clients(id BIGINT PRIMARY KEY,status VARCHAR(20),current_credential_id BIGINT)", "CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,service_client_id BIGINT,client_id VARCHAR(128),status VARCHAR(20),expires_at DATETIME)", "CREATE TABLE service_client_grants(service_client_id BIGINT,resource_code VARCHAR(128),action VARCHAR(64),status VARCHAR(20))", "INSERT INTO service_clients VALUES(1,'active',7),(2,'active',8)", "INSERT INTO service_client_credentials VALUES(7,1,'enterprise.runtime','active',NULL),(8,2,'aims.runtime','active',NULL)", "INSERT INTO service_client_grants VALUES(1,'altoc:contract','activate-delivery','active'),(2,'aims','write','active'),(2,'altoc:receivable','mark-billable','active')"} {
		exec(consoleDB, q)
	}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	jwks, _ := json.Marshal(map[string]any{"keys": []any{map[string]any{"kty": "OKP", "crv": "Ed25519", "kid": "contract-http", "x": base64.RawURLEncoding.EncodeToString(public)}}})
	cfg := config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"enterprise": "enterprise-test", "altoc": "altoc-test", "aims": "aims-test"}, Enterprise: config.EnterpriseConfig{Enabled: true, EnableContractActivation: true, EnableMilestoneReceivable: true, Environment: "isolated"}, Auth: config.AuthConfig{Mode: config.AuthJWT, JWT: config.JWTConfig{Issuer: "https://console.test", Audience: "data-runtime", JWKSJSON: string(jwks)}}}
	server := &Server{cfg: cfg, auth: auth.New(cfg), enterpriseRegistry: registry, enterpriseContractActivation: service, enterpriseMilestoneReceivable: milestoneService, aims: &aimsapp.Adapter{Adapter: base}, console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-a", consoleDB)}
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	call := func(change func(*enterpriseContractActivationInput, jwt.MapClaims)) (int, map[string]any) {
		t.Helper()
		permit := ec.CompiledActivationPermit{ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", ContractCode: "CT-1", IdempotencyKey: "http-key", ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli(), Resource: "contract", Action: "edit", Allowed: true, Access: "self"}
		aimsPermit := permit
		aimsPermit.Resource = "projects"
		aimsPermit.Action = "create"
		aimsPermit.Access = ""
		input := enterpriseContractActivationInput{ContractCode: "CT-1", Authorization: permit, AimsAuthorization: aimsPermit}
		now := time.Now()
		claims := jwt.MapClaims{"iss": "https://console.test", "aud": "data-runtime", "sub": "client:enterprise.runtime", "tenant": "tenant-a", "deployment": "enterprise-test", "source_app": "enterprise", "target_app": "data-runtime", "client_id": "enterprise.runtime", "token_use": "service", "scope": "altoc:contract:activate-delivery", "hzy": map[string]any{"credentialId": 7, "appCode": "enterprise"}, "iat": now.Unix(), "exp": now.Add(time.Minute).Unix()}
		if change != nil {
			change(&input, claims)
		}
		token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
		token.Header["kid"] = "contract-http"
		bearer, err := token.SignedString(private)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(input)
		req, _ := http.NewRequest(http.MethodPost, httpServer.URL+"/v1/enterprise/altoc/contracts:activate-delivery", bytes.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+bearer)
		req.Header.Set("Idempotency-Key", "http-key")
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-HZY-Actor-Uid", "person-a")
		req.Header.Set("X-HZY-Actor-Signed-At", "1760000000000")
		req.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, bearer, req.Method, req.URL.RequestURI(), "person-a", nil, "1760000000000"))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		data, _ := io.ReadAll(res.Body)
		out := map[string]any{}
		if err = json.Unmarshal(data, &out); err != nil {
			t.Fatal(err)
		}
		return res.StatusCode, out
	}
	expect := func(status int, out map[string]any, want int) {
		t.Helper()
		if status != want {
			t.Fatalf("HTTP %d want%d: %v", status, want, out)
		}
	}
	status, out := call(func(i *enterpriseContractActivationInput, c jwt.MapClaims) { i.AimsAuthorization.Allowed = false })
	expect(status, out, 403)
	status, out = call(func(i *enterpriseContractActivationInput, c jwt.MapClaims) { i.Authorization.Allowed = false })
	expect(status, out, 403)
	status, out = call(func(i *enterpriseContractActivationInput, c jwt.MapClaims) { c["tenant"] = "tenant-b" })
	expect(status, out, 403)
	status, out = call(func(i *enterpriseContractActivationInput, c jwt.MapClaims) { c["scope"] = "altoc:contract:edit" })
	expect(status, out, 403)
	status, out = call(func(i *enterpriseContractActivationInput, c jwt.MapClaims) { i.AimsAuthorization.ActorUID = "other" })
	expect(status, out, 403)
	status, out = call(func(i *enterpriseContractActivationInput, c jwt.MapClaims) {
		i.Authorization.ExpiresAt = time.Now().Add(-time.Second).UnixMilli()
	})
	expect(status, out, 403)
	exec(db, "CREATE TRIGGER late_http_checkpoint BEFORE UPDATE ON altoc_contract_orchestration_step FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='late checkpoint failure'")
	status, out = call(nil)
	expect(status, out, 503)
	for _, table := range []string{"altoc_contract_orchestration_job", "aims_aims_projects", "aims_milestones", "aims_service_command_receipt", "altoc_integration_operation"} {
		var n int
		db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n)
		if n != 0 {
			t.Fatalf("late HTTP failure left %s", table)
		}
	}
	exec(db, "DROP TRIGGER late_http_checkpoint")
	status, out = call(nil)
	expect(status, out, 200)
	status, out = call(nil)
	expect(status, out, 200)
	var receipts int
	db.QueryRow("SELECT COUNT(*) FROM aims_service_command_receipt").Scan(&receipts)
	if receipts != 2 {
		t.Fatal("replay duplicated receipts")
	}
	exec(db, "UPDATE altoc_contract SET owner_user_id='person-b' WHERE id=1")
	status, out = call(nil)
	expect(status, out, 403)
	exec(db, "UPDATE altoc_contract SET owner_user_id='person-a' WHERE id=1")
	exec(consoleDB, "UPDATE service_client_credentials SET status='revoked' WHERE id=7")
	status, out = call(nil)
	expect(status, out, 403)
	server.cfg.Enterprise.EnableContractActivation = false
	status, out = call(nil)
	expect(status, out, 503)

	// AA04 uses the same authenticated Aims callback route, but coordinates the
	// source completion, Altoc receipt and source ACK in one Registry tx.
	exec(db, "INSERT INTO altoc_contract(id,code,name,customer_id,owner_user_id) VALUES(2,'CT-AA04','AA04',1,'person-a')")
	exec(db, "INSERT INTO altoc_contract_payment_term(id,contract_id,term_name,term_type,amount,trigger_stage_type) VALUES(2,2,'AA04','advance',20,'contract_signed')")
	exec(db, "INSERT INTO altoc_receivable_plan(code,contract_id,payment_term_id,customer_id,plan_name,plan_type,status,amount) VALUES('RP-AA04',2,2,1,'AA04','advance','pending',20)")
	exec(db, "INSERT INTO aims_aims_projects(project_code,name,short_name,category,lifecycle_status,leader_uid,created_by,contract_code) VALUES('PRJ-AA04','P','P','delivery','active','pm-1','pm-1','CT-AA04')")
	var projectID, milestoneID, approvalID int64
	if err = db.QueryRow("SELECT id FROM aims_aims_projects WHERE project_code='PRJ-AA04'").Scan(&projectID); err != nil {
		t.Fatal(err)
	}
	exec(db, fmt.Sprintf("INSERT INTO aims_milestones(project_id,name,status,payment_term_id,sort_order,created_by) VALUES(%d,'M','active',2,1,'pm-1')", projectID))
	if err = db.QueryRow("SELECT id FROM aims_milestones WHERE project_id=?", projectID).Scan(&milestoneID); err != nil {
		t.Fatal(err)
	}
	exec(db, fmt.Sprintf("INSERT INTO aims_approval_records(request_no,milestone_owner_id,transition,requested_by,snapshot_sha256,idempotency_key,reviewer_uid,status,workflow_instance_id,project_id,project_code) VALUES('MCR-AA04',%d,'active→completed','pm-1','hash-aa04','key-aa04','director','pending','wf-aa04',%d,'PRJ-AA04')", milestoneID, projectID))
	if err = db.QueryRow("SELECT id FROM aims_approval_records WHERE request_no='MCR-AA04'").Scan(&approvalID); err != nil {
		t.Fatal(err)
	}
	exec(db, fmt.Sprintf("UPDATE aims_milestones SET completion_lock_request_id=%d WHERE id=%d", approvalID, milestoneID))
	callbackBody := map[string]any{"event": "flow_completed", "instance_id": "wf-aa04", "app_code": "aims", "resource_code": "milestones", "action_code": "milestone_completion", "biz_id": fmt.Sprint(milestoneID), "status": "approved", "initiator_uid": "pm-1", "form_data": map[string]any{"completionRequestId": approvalID, "requestNo": "MCR-AA04", "snapshotSha256": "hash-aa04", "projectDirectorUid": "director", "projectDirectorRevision": 1, "projectDirectorRoleCode": "project_director"}}
	callback := func(change func(jwt.MapClaims)) (int, map[string]any) {
		claims := jwt.MapClaims{"iss": "https://console.test", "aud": "data-runtime", "sub": "aims.runtime", "tenant": "tenant-a", "deployment": "aims-test", "source_app": "aims", "target_app": "data-runtime", "client_id": "aims.runtime", "token_use": "service", "scope": "aims.write altoc:receivable:mark-billable", "hzy": map[string]any{"credentialId": 8, "appCode": "aims"}, "iat": time.Now().Unix(), "exp": time.Now().Add(time.Minute).Unix()}
		if change != nil {
			change(claims)
		}
		token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
		token.Header["kid"] = "contract-http"
		bearer, signErr := token.SignedString(private)
		if signErr != nil {
			t.Fatal(signErr)
		}
		raw, _ := json.Marshal(callbackBody)
		req, _ := http.NewRequest(http.MethodPost, httpServer.URL+"/v1/aims/service/workflow/callback?workflow_callback_verified=1", bytes.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+bearer)
		req.Header.Set("Content-Type", "application/json")
		res, callErr := http.DefaultClient.Do(req)
		if callErr != nil {
			t.Fatal(callErr)
		}
		defer res.Body.Close()
		data, _ := io.ReadAll(res.Body)
		out := map[string]any{}
		_ = json.Unmarshal(data, &out)
		return res.StatusCode, out
	}
	status, out = callback(nil)
	expect(status, out, 200)
	data, _ := out["data"].(map[string]any)
	op, _ := data["receivableBillable"].(map[string]any)
	if op["operationStatus"] != "succeeded" {
		t.Fatalf("AA04 operation status=%#v", op)
	}
	status, out = callback(nil)
	expect(status, out, 200)
	status, out = callback(func(c jwt.MapClaims) { c["scope"] = "aims.write" })
	expect(status, out, 403)
	status, out = callback(func(c jwt.MapClaims) { c["deployment"] = "other-aims" })
	expect(status, out, 403)
	status, out = callback(func(c jwt.MapClaims) { c["token_use"] = "user" })
	expect(status, out, 403)
	server.enterpriseMilestoneReceivable = nil
	status, out = callback(nil)
	expect(status, out, 503)
	server.enterpriseMilestoneReceivable = milestoneService
	server.cfg.Enterprise.EnableMilestoneReceivable = false
	status, out = callback(nil)
	expect(status, out, 200)
	server.cfg.Enterprise.EnableMilestoneReceivable = true
	// A fresh callback whose source ACK fails after the target receipt must roll
	// back every source and Altoc mutation in the shared Registry transaction.
	exec(db, "INSERT INTO altoc_contract_payment_term(id,contract_id,term_name,term_type,amount,trigger_stage_type) VALUES(3,2,'AA04 rollback','advance',20,'contract_signed')")
	exec(db, "INSERT INTO altoc_receivable_plan(code,contract_id,payment_term_id,customer_id,plan_name,plan_type,status,amount) VALUES('RP-AA04-R',2,3,1,'AA04 rollback','advance','pending',20)")
	exec(db, "INSERT INTO aims_aims_projects(project_code,name,short_name,category,lifecycle_status,leader_uid,created_by,contract_code) VALUES('PRJ-AA04-R','P','P','delivery','active','pm-1','pm-1','CT-AA04')")
	var rollbackProject, rollbackMilestone, rollbackApproval int64
	if err = db.QueryRow("SELECT id FROM aims_aims_projects WHERE project_code='PRJ-AA04-R'").Scan(&rollbackProject); err != nil {
		t.Fatal(err)
	}
	exec(db, fmt.Sprintf("INSERT INTO aims_milestones(project_id,name,status,payment_term_id,sort_order,created_by) VALUES(%d,'M','active',3,1,'pm-1')", rollbackProject))
	if err = db.QueryRow("SELECT id FROM aims_milestones WHERE project_id=?", rollbackProject).Scan(&rollbackMilestone); err != nil {
		t.Fatal(err)
	}
	exec(db, fmt.Sprintf("INSERT INTO aims_approval_records(request_no,milestone_owner_id,transition,requested_by,snapshot_sha256,idempotency_key,reviewer_uid,status,workflow_instance_id,project_id,project_code) VALUES('MCR-AA04-R',%d,'active→completed','pm-1','hash-aa04-r','key-aa04-r','director','pending','wf-aa04-r',%d,'PRJ-AA04-R')", rollbackMilestone, rollbackProject))
	if err = db.QueryRow("SELECT id FROM aims_approval_records WHERE request_no='MCR-AA04-R'").Scan(&rollbackApproval); err != nil {
		t.Fatal(err)
	}
	exec(db, fmt.Sprintf("UPDATE aims_milestones SET completion_lock_request_id=%d WHERE id=%d", rollbackApproval, rollbackMilestone))
	exec(db, "CREATE TRIGGER aims_http_late_ack BEFORE UPDATE ON aims_integration_operation FOR EACH ROW BEGIN IF OLD.status='processing' AND NEW.status='succeeded' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='late ack'; END IF; END")
	callbackBody["instance_id"] = "wf-aa04-r"
	callbackBody["biz_id"] = fmt.Sprint(rollbackMilestone)
	form := callbackBody["form_data"].(map[string]any)
	form["completionRequestId"] = rollbackApproval
	form["requestNo"] = "MCR-AA04-R"
	form["snapshotSha256"] = "hash-aa04-r"
	status, out = callback(nil)
	expect(status, out, 500)
	exec(db, "DROP TRIGGER aims_http_late_ack")
	for _, check := range []struct {
		query string
		want  int
	}{
		{"SELECT COUNT(*) FROM aims_approval_records WHERE request_no='MCR-AA04-R' AND status='pending'", 1},
		{"SELECT COUNT(*) FROM aims_milestones m JOIN aims_approval_records a ON a.milestone_owner_id=m.id WHERE a.request_no='MCR-AA04-R' AND m.status='active' AND m.completion_lock_request_id=a.id", 1},
		{"SELECT COUNT(*) FROM altoc_receivable_plan WHERE code='RP-AA04-R' AND status='pending'", 1},
		{"SELECT COUNT(*) FROM aims_integration_operation", 1},
		{"SELECT COUNT(*) FROM altoc_service_command_receipt", 1},
	} {
		var count int
		if err := db.QueryRow(check.query).Scan(&count); err != nil || count != check.want {
			t.Fatalf("AA04 HTTP late ACK rollback failed: count=%d want=%d err=%v", count, check.want, err)
		}
	}
	// The identical callback succeeds after removing only the late-failure
	// trigger, proving the prior rejection reached the intended transaction.
	status, out = callback(nil)
	expect(status, out, 200)
	exec(consoleDB, "UPDATE service_client_credentials SET status='revoked' WHERE id=8")
	status, out = callback(nil)
	expect(status, out, 403)
}
