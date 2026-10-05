package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/go-sql-driver/mysql"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprisescheduler"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestEnterpriseSchedulerHTTPMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_SCHEDULER_HTTP_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires dedicated temporary MySQL")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("refusing non-isolated socket")
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
	schema := "hzy_scheduler_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE `" + schema + "`"); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE `" + schema + "`")
	mc.DBName = schema
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	ddl, err := os.ReadFile("../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	exec("SET FOREIGN_KEY_CHECKS=0")
	sourceViews := []string{"company_weekly_summary_versions", "company_weekly_summaries", "weekly_reporting_periods", "time_entry_review_events", "time_entries", "company_weekly_summary_items", "weekly_report_obligations", "aims_projects", "project_weekly_report_versions", "project_management_fact_snapshots"}
	mapping := map[string]string{}
	var renames []string
	for _, name := range append([]string{"integration_operation", "integration_operation_attempt", "integration_operation_dead_letter_actionable", "service_command_receipt"}, sourceViews...) {
		marker := "CREATE TABLE IF NOT EXISTS " + name + " ("
		start := strings.Index(string(ddl), marker)
		if start < 0 {
			start = strings.Index(string(ddl), "CREATE TABLE IF NOT EXISTS `"+name+"` (")
		}
		if start < 0 {
			t.Fatal(name)
		}
		end := strings.Index(string(ddl)[start:], ";\n")
		if end < 0 {
			t.Fatal("DDL terminator")
		}
		exec(string(ddl)[start : start+end])
		mapping[name] = "u_" + name
		renames = append(renames, "`"+name+"` TO `u_"+name+"`")
	}
	exec("RENAME TABLE " + strings.Join(renames, ","))
	exec("SET FOREIGN_KEY_CHECKS=1")
	db.SetMaxOpenConns(4)
	// No compatibility view: a conflicting logical table must remain untouched.
	exec("CREATE TABLE integration_operation LIKE u_integration_operation")
	exec("CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(64),environment_code VARCHAR(64),runtime_deployment VARCHAR(64),schema_version VARCHAR(64),generation BIGINT) ENGINE=InnoDB")
	exec("INSERT INTO enterprise_schema_registry VALUES(1,'tenant-a','test','runtime-a','v1',0)")
	var instance string
	if err = db.QueryRow("SELECT @@server_uuid").Scan(&instance); err != nil {
		t.Fatal(err)
	}
	b := e.Binding{Key: e.BindingKey{Tenant: "tenant-a", Environment: "test", RuntimeDeployment: "runtime-a"}, Storage: e.Storage{InstanceID: instance, Address: "127.0.0.1:3306", Database: schema}, SchemaVersion: "v1", Generation: 1, Domains: map[string]e.DomainBinding{"aims": {OwnerDeployment: "aims-owner", Tables: mapping, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathUnified}}}
	ctx := context.Background()
	plan, err := e.PlanCompatibilityViews(ctx, db, b, "aims", sourceViews)
	if err != nil {
		t.Fatal(err)
	}
	if err = e.ApplyCompatibilityViews(ctx, db, b, "aims", sourceViews, plan.ReviewHash); err != nil {
		t.Fatal(err)
	}
	exec("UPDATE enterprise_schema_registry SET generation=1")
	register := func(binding e.Binding) *e.Registry {
		t.Helper()
		r := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return db, nil })
		if err := r.Register(ctx, binding); err != nil {
			t.Fatal(err)
		}
		return r
	}
	registry := register(b)
	q := e.ResolveRequest{Key: b.Key, Domain: "aims", OwnerDeployment: "aims-owner", SchemaVersion: "v1", Generation: 1, Operation: e.Scheduler}
	resolved, err := registry.Resolve(q)
	if err != nil {
		t.Fatal(err)
	}
	source, err := e.NewOutboundSource(q, resolved, "real-aims-worker", "aims.runtime")
	if err != nil {
		t.Fatal(err)
	}
	service, err := enterprisescheduler.New(registry, b, source)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		"CREATE TABLE service_clients(id BIGINT PRIMARY KEY,status VARCHAR(20),current_credential_id BIGINT)",
		"CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,service_client_id BIGINT,client_id VARCHAR(128),status VARCHAR(20),expires_at DATETIME)",
		"CREATE TABLE service_client_grants(service_client_id BIGINT,resource_code VARCHAR(128),action VARCHAR(64),status VARCHAR(20))",
		"INSERT INTO service_clients VALUES(1,'active',7)",
		"INSERT INTO service_client_credentials VALUES(7,1,'aims.runtime','active',NULL)",
		"INSERT INTO service_client_grants VALUES(1,'aims:integration_operation','execute','active')",
	} {
		exec(q)
	}
	cfg, key := testRuntimeJWTConfig(t)
	cfg.Tenant = "tenant-a"
	cfg.Deployment = "runtime-a"
	cfg.DeploymentBindings = map[string]string{"aims": "real-aims-worker", "enterprise": "enterprise-host"}
	cfg.Auth.JWT.Issuer = "https://console.test"
	cfg.Enterprise = config.EnterpriseConfig{Enabled: true, Environment: "test", Generation: 1, AimsDeliveryWorker: &config.EnterpriseDeliveryWorker{Deployment: "real-aims-worker", ServiceClientID: "aims.runtime"}}
	server := httptest.NewServer(&Server{cfg: cfg, auth: auth.New(cfg), enterpriseRegistry: registry, enterpriseScheduler: service, console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-a", db)})
	defer server.Close()
	token := func(mutate func(jwt.MapClaims)) string {
		t.Helper()
		now := time.Now()
		c := jwt.MapClaims{"iss": "https://console.test", "aud": "data-runtime", "sub": "client:aims.runtime", "tenant": "tenant-a", "deployment": "real-aims-worker", "source_app": "aims", "target_app": "data-runtime", "client_id": "aims.runtime", "token_use": "service", "scope": enterpriseSchedulerCapability, "hzy": map[string]any{"credentialId": 7, "appCode": "aims"}, "iat": now.Unix(), "exp": now.Add(time.Minute).Unix()}
		if mutate != nil {
			mutate(c)
		}
		j := jwt.NewWithClaims(jwt.SigningMethodEdDSA, c)
		j.Header["kid"] = "test-key"
		v, err := j.SignedString(key)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	goodToken := token(nil)
	call := func(bearer, query, body string) (int, string) {
		t.Helper()
		r, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/enterprise/aims/integration-operations:claim"+query, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+bearer)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-HZY-Scheduler-Generation", "1")
		r.Header.Set("X-Request-Id", "scheduler-http-test")
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, _ := io.ReadAll(response.Body)
		return response.StatusCode, string(raw)
	}
	id := uuid.NewString()
	command := json.RawMessage(`{"ticketCode":"T-1"}`)
	digest, err := iop.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatal(err)
	}
	exec("INSERT INTO u_integration_operation(operation_id,operation_key,correlation_key,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_json,command_sha256,next_attempt_at) VALUES(?,'key-1','key-1','tenant-a','real-aims-worker','aims','altoc','aims.work-item.ticket-result.v1','altoc:service-tickets:write','request','R-1','key-1',?,?,UTC_TIMESTAMP(3))", id, string(command), digest)
	untouched := func() {
		t.Helper()
		var n int
		for _, q := range []string{"SELECT COUNT(*) FROM u_integration_operation WHERE status<>'pending'", "SELECT COUNT(*) FROM u_integration_operation_attempt"} {
			if err = db.QueryRow(q).Scan(&n); err != nil || n != 0 {
				t.Fatal("rejected request consumed task", n, err)
			}
		}
	}
	for name, scenario := range map[string]struct {
		status int
		mutate func(jwt.MapClaims)
	}{
		"audience":   {401, func(c jwt.MapClaims) { c["aud"] = "altoc" }},
		"expired":    {401, func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Hour).Unix() }},
		"tenant":     {403, func(c jwt.MapClaims) { c["tenant"] = "other" }},
		"deployment": {403, func(c jwt.MapClaims) { c["deployment"] = "enterprise-host" }},
		"source": {403, func(c jwt.MapClaims) {
			c["source_app"] = "enterprise"
			c["hzy"] = map[string]any{"credentialId": 7, "appCode": "enterprise"}
		}},
		"client":         {403, func(c jwt.MapClaims) { c["client_id"] = "enterprise.runtime"; c["sub"] = "enterprise.runtime" }},
		"scope":          {403, func(c jwt.MapClaims) { c["scope"] = "aims:integration_operation:read" }},
		"wildcard":       {403, func(c jwt.MapClaims) { c["scope"] = "*" }},
		"old-credential": {403, func(c jwt.MapClaims) { c["hzy"] = map[string]any{"credentialId": 6, "appCode": "aims"} }},
	} {
		t.Run(name, func(t *testing.T) {
			if status, body := call(token(scenario.mutate), "", `{}`); status != scenario.status {
				t.Fatalf("want %d got %d %s", scenario.status, status, body)
			}
			untouched()
		})
	}
	// Alter the signature bytes while preserving a syntactically valid JWT.
	parts := strings.Split(goodToken, ".")
	parts[2] = "A" + parts[2][1:]
	if parts[2] == strings.Split(goodToken, ".")[2] {
		parts[2] = "B" + parts[2][1:]
	}
	if status, body := call(strings.Join(parts, "."), "", `{}`); status != 401 {
		t.Fatal("tampered signature", status, body)
	}
	untouched()
	for _, change := range []struct{ disable, restore string }{
		{"UPDATE service_client_grants SET status='revoked'", "UPDATE service_client_grants SET status='active'"},
		{"UPDATE service_client_credentials SET status='revoked'", "UPDATE service_client_credentials SET status='active'"},
		{"UPDATE service_clients SET status='disabled'", "UPDATE service_clients SET status='active'"},
		{"UPDATE service_clients SET current_credential_id=8", "UPDATE service_clients SET current_credential_id=7"},
		{"UPDATE service_client_credentials SET expires_at=UTC_TIMESTAMP()-INTERVAL 1 DAY", "UPDATE service_client_credentials SET expires_at=NULL"},
	} {
		exec(change.disable)
		if status, body := call(goodToken, "", `{}`); status != 403 {
			t.Fatal("live revocation ignored", status, body)
		}
		untouched()
		exec(change.restore)
	}
	// Generation is supplied by the trusted worker transport, never body/defaulted.
	for _, action := range []string{"claim", "succeed", "fail", "pending-failure-notifications", "pending-dead-letter-actionables", "pending-dead-letter-closures", "failure-notified", "dead-letter-actionable-published", "dead-letter-closure-acknowledged"} {
		for _, generation := range []struct {
			value  string
			status int
		}{{"", 400}, {"0", 400}, {"01", 400}, {"+1", 400}, {"1.0", 400}, {"-1", 400}, {"18446744073709551616", 400}, {"2", 409}} {
			r, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/enterprise/aims/integration-operations:"+action, strings.NewReader(`{}`))
			r.Header.Set("Authorization", "Bearer "+goodToken)
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("X-Request-ID", "generation-check")
			if generation.value != "" {
				r.Header.Set("X-HZY-Scheduler-Generation", generation.value)
			}
			res, err := http.DefaultClient.Do(r)
			if err != nil {
				t.Fatal(err)
			}
			raw, _ := io.ReadAll(res.Body)
			res.Body.Close()
			if res.StatusCode != generation.status {
				t.Fatal("generation boundary", action, generation.value, res.StatusCode, string(raw))
			}
			untouched()
		}
	}
	for _, payload := range []string{`{"tenant":"other"}`, `{"worker":"forged"}`, `{"operationKey":null}`, `{"operationKey":""}`, `{"operationKey":1}`, `[]`, `null`, `{"`} {
		if status, body := call(goodToken, "", payload); status != 400 {
			t.Fatal("body accepted", payload, status, body)
		}
		untouched()
	}
	if status, body := call(goodToken, "?tenant=other", `{}`); status != 400 {
		t.Fatal("query accepted", status, body)
	}
	untouched()
	exec("RENAME TABLE service_client_grants TO unavailable_grants")
	if status, body := call(goodToken, "", `{}`); status != 503 || strings.Contains(body, "unavailable_grants") || strings.Contains(body, schema) {
		t.Fatal("credential dependency", status, body)
	}
	untouched()
	exec("RENAME TABLE unavailable_grants TO service_client_grants")
	exec("UPDATE enterprise_schema_registry SET generation=2")
	if status, body := call(goodToken, "", `{}`); status != 503 {
		t.Fatal("stale generation", status, body)
	}
	untouched()
	exec("UPDATE enterprise_schema_registry SET generation=1")
	status, body := call(goodToken, "", `{"operationKey":"key-1"}`)
	if status != 200 {
		t.Fatal("valid claim", status, body)
	}
	var data struct {
		Data map[string]any `json:"data"`
	}
	if err = json.Unmarshal([]byte(body), &data); err != nil || data.Data == nil {
		t.Fatal(body, err)
	}
	var state string
	var count int
	if err = db.QueryRow("SELECT status FROM u_integration_operation WHERE operation_id=?", id).Scan(&state); err != nil || state != "processing" {
		t.Fatal(state, err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM u_integration_operation_attempt WHERE operation_id=?", id).Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
	if status, body := call(goodToken, "", `{}`); status != 200 {
		t.Fatal("empty due queue", status, body)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM u_integration_operation_attempt").Scan(&count); err != nil || count != 1 {
		t.Fatal("double claim", count, err)
	}
	ack := func(action, requestID string, input map[string]any) (int, string) {
		raw, _ := json.Marshal(input)
		r, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/enterprise/aims/integration-operations:"+action, strings.NewReader(string(raw)))
		r.Header.Set("Authorization", "Bearer "+goodToken)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-HZY-Scheduler-Generation", "1")
		r.Header.Set("X-Request-ID", requestID)
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, _ := io.ReadAll(response.Body)
		return response.StatusCode, string(body)
	}
	ackInput := map[string]any{"operationKey": "key-1", "operationId": id, "fencingToken": data.Data["fencingToken"], "httpStatus": 503, "errorCode": "dependency_unavailable", "errorSummary": "temporarily unavailable"}
	if status, body := ack("fail", "different-claim-request", ackInput); status != 409 {
		t.Fatal("wrong lease worker accepted", status, body)
	}
	if status, body := ack("succeed", "scheduler-http-test", ackInput); status != 409 && status != 400 {
		t.Fatal("missing receipt accepted", status, body)
	}
	if err = db.QueryRow("SELECT status FROM u_integration_operation WHERE operation_id=?", id).Scan(&state); err != nil || state != "processing" {
		t.Fatal("rejected ACK mutated task", state, err)
	}
	exec("UPDATE service_client_grants SET status='revoked'")
	if status, body := ack("fail", "scheduler-http-test", ackInput); status != 403 {
		t.Fatal("ACK live revocation", status, body)
	}
	exec("UPDATE service_client_grants SET status='active'")
	if status, body := ack("fail", "scheduler-http-test", ackInput); status != 200 {
		t.Fatal("failure ACK rejected", status, body)
	}
	if err = db.QueryRow("SELECT status FROM u_integration_operation WHERE operation_id=?", id).Scan(&state); err != nil || state != "retry_wait" {
		t.Fatal("failure ACK not committed", state, err)
	}
	if err = db.QueryRow("SELECT result_status FROM u_integration_operation_attempt WHERE operation_id=?", id).Scan(&state); err != nil || state != "retry_wait" {
		t.Fatal("attempt ACK not committed", state, err)
	}
	if status, body := ack("fail", "scheduler-http-test", ackInput); status != 409 {
		t.Fatal("stale ACK replay", status, body)
	}

	notificationID := uuid.NewString()
	exec("INSERT INTO u_integration_operation(operation_id,operation_key,correlation_key,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_json,command_sha256,next_attempt_at,max_attempts) VALUES(?,'notify','notify','tenant-a','real-aims-worker','aims','altoc','aims.work-item.ticket-result.v1','altoc:service-tickets:write','request','R-1','notify',?,?,UTC_TIMESTAMP(3),1)", notificationID, string(command), digest)
	status, body = call(goodToken, "", `{"operationKey":"notify"}`)
	if status != 200 {
		t.Fatal(status, body)
	}
	if err = json.Unmarshal([]byte(body), &data); err != nil {
		t.Fatal(err)
	}
	if status, body = ack("fail", "scheduler-http-test", map[string]any{"operationKey": "notify", "operationId": notificationID, "fencingToken": data.Data["fencingToken"], "httpStatus": 503}); status != 200 {
		t.Fatal(status, body)
	}
	notificationCall := func(action, bearer string, input map[string]any) (int, map[string]any, string) {
		t.Helper()
		raw, _ := json.Marshal(input)
		r, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/enterprise/aims/integration-operations:"+action, strings.NewReader(string(raw)))
		r.Header.Set("Authorization", "Bearer "+bearer)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-HZY-Scheduler-Generation", "1")
		r.Header.Set("X-Request-ID", "notification-http-test")
		res, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		bytes, _ := io.ReadAll(res.Body)
		var envelope struct {
			Data map[string]any `json:"data"`
		}
		_ = json.Unmarshal(bytes, &envelope)
		return res.StatusCode, envelope.Data, string(bytes)
	}
	actions := []string{"pending-failure-notifications", "pending-dead-letter-actionables", "pending-dead-letter-closures", "failure-notified", "dead-letter-actionable-published", "dead-letter-closure-acknowledged"}
	for _, action := range actions {
		input := map[string]any{"operationId": notificationID}
		if st, _, raw := notificationCall(action, token(func(c jwt.MapClaims) { c["tenant"] = "tenant-b" }), input); st != 403 {
			t.Fatal("wrong tenant", action, st, raw)
		}
		exec("UPDATE service_client_grants SET status='revoked'")
		if st, _, raw := notificationCall(action, goodToken, input); st != 403 {
			t.Fatal("revoked grant", action, st, raw)
		}
		exec("UPDATE service_client_grants SET status='active'")
		exec("UPDATE enterprise_schema_registry SET generation=2")
		if st, _, raw := notificationCall(action, goodToken, input); st != 503 {
			t.Fatal("stale generation", action, st, raw)
		}
		exec("UPDATE enterprise_schema_registry SET generation=1")
	}
	firstItem := func(action string) map[string]any {
		t.Helper()
		st, value, raw := notificationCall(action, goodToken, map[string]any{})
		if st != 200 {
			t.Fatal(action, st, raw)
		}
		items, ok := value["items"].([]any)
		if !ok || len(items) != 1 {
			t.Fatal("items", action, raw)
		}
		item := items[0].(map[string]any)
		if item["tenantCode"] != "tenant-a" || item["deploymentCode"] != "real-aims-worker" || item["sourceApp"] != "aims" {
			t.Fatal("source identity", item)
		}
		return item
	}
	failure := firstItem("pending-failure-notifications")
	if failure["operationId"] != notificationID {
		t.Fatal(failure)
	}
	item := firstItem("pending-dead-letter-actionables")
	if _, ok := item["objectVersion"].(string); !ok {
		t.Fatal("object version type", item)
	}
	publish := map[string]any{"operationId": notificationID, "generation": item["generation"], "operationVersion": item["operationVersion"], "actionableKey": item["actionableKey"], "objectVersion": item["objectVersion"], "notificationId": "notification-http-1", "recipientUids": []string{"user-1"}}
	for _, name := range []string{"zero-generation", "zero-version", "empty-recipients"} {
		bad := map[string]any{}
		for k, v := range publish {
			bad[k] = v
		}
		switch name {
		case "zero-generation":
			bad["generation"] = 0
		case "zero-version":
			bad["operationVersion"] = 0
		case "empty-recipients":
			bad["recipientUids"] = []string{}
		}
		if st, _, raw := notificationCall("dead-letter-actionable-published", goodToken, bad); st != 400 {
			t.Fatal("invalid publish input", name, st, raw)
		}
	}
	for j := 0; j < 2; j++ {
		if st, value, raw := notificationCall("dead-letter-actionable-published", goodToken, publish); st != 200 || value["published"] != true {
			t.Fatal(st, raw)
		}
		if st, value, raw := notificationCall("failure-notified", goodToken, map[string]any{"operationId": notificationID, "notificationId": "failure-http-1"}); st != 200 || value["failureNotified"] != true {
			t.Fatal(st, raw)
		}
	}
	tables, err := iop.NewOutboxTables("`u_integration_operation`", "`u_integration_operation_attempt`", "`u_service_command_receipt`", "`u_integration_operation_dead_letter_actionable`")
	if err != nil {
		t.Fatal(err)
	}
	repo, err := iop.NewRepository(db, iop.WithOutboxTables(tables))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = repo.Replay(context.Background(), iop.ReplayInput{TenantCode: "tenant-a", DeploymentCode: "real-aims-worker", SourceApp: "aims", OperationID: notificationID, ExpectedVersion: uint64(item["operationVersion"].(float64)), ActorUID: "user-1", Reason: "fixture-approved-retry", Now: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	closure := firstItem("pending-dead-letter-closures")
	for _, key := range []string{"expectedVersion", "nextVersion"} {
		if _, ok := closure[key].(string); !ok {
			t.Fatal("closure version type", closure)
		}
	}
	recipients, ok := closure["recipientUids"].([]any)
	if !ok || len(recipients) != 1 || recipients[0] != "user-1" {
		t.Fatal("recipients", closure)
	}
	closeInput := map[string]any{"operationId": notificationID, "generation": closure["generation"], "actionableKey": closure["actionableKey"], "expectedVersion": closure["expectedVersion"], "nextVersion": closure["nextVersion"], "state": closure["state"]}
	for _, name := range []string{"zero-generation", "bad-state", "same-version"} {
		bad := map[string]any{}
		for k, v := range closeInput {
			bad[k] = v
		}
		switch name {
		case "zero-generation":
			bad["generation"] = 0
		case "bad-state":
			bad["state"] = "wrong"
		case "same-version":
			bad["nextVersion"] = bad["expectedVersion"]
		}
		if st, _, raw := notificationCall("dead-letter-closure-acknowledged", goodToken, bad); st != 400 {
			t.Fatal("invalid closure input", name, st, raw)
		}
	}
	for j := 0; j < 2; j++ {
		if st, _, raw := notificationCall("dead-letter-closure-acknowledged", goodToken, closeInput); st != 200 {
			t.Fatal(st, raw)
		}
	}
	for _, action := range actions[3:] {
		if st, _, raw := notificationCall(action, goodToken, map[string]any{}); st != 400 {
			t.Fatal("missing operation input", action, st, raw)
		}
	}
	t.Log("actual signed JWT -> live Console credential/grant -> Registry generation -> mapped claim transaction committed; rejection paths did not consume task")
}
