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

// Run only via scripts/test-enterprise-requests-mysql.mjs. The wrapper owns
// the isolated server; this test owns and cleans its two random fixture schemas.
func TestEnterpriseRequestsHTTPMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_REQUEST_TEST_SOCKET")
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
		name := "hzy_requests_http_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	names := []string{"product_workspaces", "product_members", "product_command_receipts", "product_requests", "product_components", "product_activity_logs", "product_versions", "product_version_plans", "product_version_plan_scopes", "product_version_plan_confirmations", "product_version_features", "product_planning_items", "product_planning_item_requests", "product_planning_dependencies", "product_request_delivery_links", "product_request_sources", "product_feedback_bindings", "product_request_features"}
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
	exec(root, "CREATE USER 'hzy_requests_http'@'127.0.0.1' IDENTIFIED BY '"+fixturePassword+"'")
	t.Cleanup(func() { _, _ = root.Exec("DROP USER 'hzy_requests_http'@'127.0.0.1'") })
	exec(root, "GRANT SELECT,INSERT,UPDATE,DELETE,SHOW VIEW ON `"+businessName+"`.* TO 'hzy_requests_http'@'127.0.0.1'")
	cfg := config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"enterprise": "enterprise-test", "aims": "aims-test"}, Enterprise: config.EnterpriseConfig{Enabled: true, Environment: "isolated", SchemaVersion: "v1", Generation: 1, InstanceID: instance, DB: config.DBConfig{Host: "127.0.0.1", Port: port, User: "hzy_requests_http", Password: fixturePassword, Database: businessName, ConnectionLimit: 3}, Domains: map[string]config.EnterpriseDomainConfig{"aims": {OwnerDeployment: "aims-test", Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathDisabled, Tables: mapping}}}}
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
	service, err := enterpriseplanning.NewRequestService(ctx, registry, binding)
	if err != nil {
		t.Fatal(err)
	}
	authenticator, signedTemplate, _ := enterpriseContextFixture(t, func(c jwt.MapClaims) {
		c["scope"] = "aims:product-requests:create aims:products:authorization-object aims:product-requests:read aims:product-requests:edit aims:product-requests:decide aims:product-requests:source-create aims:product-requests:source-delete aims:product-requests:merge"
	}, true)
	server := httptest.NewServer(&Server{cfg: cfg, auth: authenticator, enterpriseRegistry: registry, enterpriseRequests: service, console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-a", consoleDB)})
	defer server.Close()
	exec(consoleDB, "INSERT INTO service_client_grants VALUES(1,'aims:products','authorization-object','active')")
	factsHTTP := func(payload string) (int, string) {
		r, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/enterprise/aims/product-authorization", strings.NewReader(payload))
		r.Header = signedTemplate.Header.Clone()
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, runtimeBearerToken(r), r.Method, r.URL.RequestURI(), "person-a", nil, r.Header.Get("X-HZY-Actor-Signed-At")))
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, _ := io.ReadAll(response.Body)
		return response.StatusCode, string(raw)
	}
	exec(business, "INSERT INTO aims_product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P-A','other-private-manager','manager','active',UTC_TIMESTAMP(3),'fixture','fixture',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	factsStatus, factsBody := factsHTTP(`{"productCode":"P-A"}`)
	var factsResult struct {
		Data productcenter.AuthorizationFacts `json:"data"`
	}
	if factsStatus != 200 || json.Unmarshal([]byte(factsBody), &factsResult) != nil || factsResult.Data.ActorUID != "person-a" || factsResult.Data.ProductCode != "P-A" || factsResult.Data.IsMember || factsResult.Data.IsManager || strings.Contains(factsBody, "other-private-manager") {
		t.Fatalf("actor facts: %d %s", factsStatus, factsBody)
	}
	for _, payload := range []string{`{"productCode":"P-A","actor":"other"}`, `{"productCode":"P-A","tenant":"tenant-b"}`} {
		if code, body := factsHTTP(payload); code != 400 {
			t.Fatalf("body identity override accepted: %d %s", code, body)
		}
	}
	exec(consoleDB, "UPDATE service_client_grants SET status='revoked' WHERE resource_code='aims:products'")
	if code, body := factsHTTP(`{"productCode":"P-A"}`); code != 403 {
		t.Fatalf("missing exact capability accepted: %d %s", code, body)
	}
	exec(consoleDB, "UPDATE service_client_grants SET status='active' WHERE resource_code='aims:products'")
	permit := func() productcenter.AuthorizationPermit {
		facts, err := productcenter.LoadAuthorizationFacts(ctx, business, "P-A", "person-a")
		if err != nil {
			t.Fatal(err)
		}
		return productcenter.AuthorizationPermit{Resource: "product_requests", Action: "create", Facts: facts, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli()}
	}
	draft := productcenter.RequestDraft{ExpectedRevision: 1, Title: "HTTP request", ProblemStatement: "Real route transaction", SourceType: "internal", UrgencyLevel: "P2"}
	call := func(mutate func(*enterpriseRequestCreateInput, *http.Request)) (int, string) {
		input := enterpriseRequestCreateInput{ProductCode: "P-A", Tenant: "tenant-a", Deployment: "enterprise-test", Authorization: permit(), Input: draft}
		r, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/enterprise/aims/product-requests:create", nil)
		r.Header = signedTemplate.Header.Clone()
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", "same-command")
		r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, runtimeBearerToken(r), r.Method, r.URL.RequestURI(), "person-a", nil, r.Header.Get("X-HZY-Actor-Signed-At")))
		if mutate != nil {
			mutate(&input, r)
		}
		raw, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		r.Body = io.NopCloser(bytes.NewReader(raw))
		r.ContentLength = int64(len(raw))
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, _ := io.ReadAll(response.Body)
		return response.StatusCode, string(body)
	}
	expect := func(status int, mutate func(*enterpriseRequestCreateInput, *http.Request)) {
		t.Helper()
		code, body := call(mutate)
		if code != status {
			t.Fatalf("want %d got %d %s", status, code, body)
		}
	}
	expect(200, func(i *enterpriseRequestCreateInput, r *http.Request) { i.Authorization.Facts = factsResult.Data })
	replay, err := productcenter.CreateProductRequest(ctx, business, productcenter.CommandIdentity{ProductCode: "P-A", ActorUID: "person-a", Action: "product_requests:create", IdempotencyKey: "same-command"}, permit(), draft)
	if err != nil || !replay.Replayed {
		t.Fatal("old Go entry did not replay HTTP receipt", err)
	}
	expect(200, nil)
	expect(409, func(i *enterpriseRequestCreateInput, r *http.Request) { i.Input.Title = "different payload" })
	for _, mutate := range []func(*enterpriseRequestCreateInput, *http.Request){
		func(i *enterpriseRequestCreateInput, r *http.Request) { i.Tenant = "tenant-b" },
		func(i *enterpriseRequestCreateInput, r *http.Request) { i.Deployment = "other" },
		func(i *enterpriseRequestCreateInput, r *http.Request) { i.Authorization.Facts.ActorUID = "other" },
		func(i *enterpriseRequestCreateInput, r *http.Request) { r.Header.Set("X-HZY-Actor-Uid", "tampered") },
	} {
		expect(403, mutate)
	}
	// Exercise remaining actions through the same signed HTTP boundary and real domain tables.
	for _, action := range []string{"merge", "edit", "decide", "source-create", "source-delete", "read"} {
		exec(consoleDB, "INSERT INTO service_client_grants VALUES(1,'aims:product-requests',?,'active')", action)
	}
	var actionBizID string
	if err := business.QueryRow("SELECT biz_id FROM aims_product_requests WHERE product_code='P-A'").Scan(&actionBizID); err != nil {
		t.Fatal(err)
	}
	actionRevisions := func() map[string]any {
		var w, r uint64
		if err := business.QueryRow("SELECT w.revision,r.revision FROM aims_product_workspaces w JOIN aims_product_requests r ON r.product_code=w.product_code WHERE r.biz_id=?", actionBizID).Scan(&w, &r); err != nil {
			t.Fatal(err)
		}
		return map[string]any{"biz_id": actionBizID, "expected_revision": w, "expected_request_revision": r}
	}
	actionCall := func(action, key string, input map[string]any, permission string) (int, string) {
		p := permit()
		p.Action = permission
		raw, err := json.Marshal(map[string]any{"productCode": "P-A", "tenant": "tenant-a", "deployment": "enterprise-test", "authorization": p, "input": input})
		if err != nil {
			t.Fatal(err)
		}
		endpoint := "/v1/enterprise/aims/product-requests:" + action
		if strings.HasPrefix(action, "source-") {
			endpoint = "/v1/enterprise/aims/request-sources:" + strings.TrimPrefix(action, "source-")
		}
		r, _ := http.NewRequest(http.MethodPost, server.URL+endpoint, bytes.NewReader(raw))
		r.Header = signedTemplate.Header.Clone()
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", key)
		r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, runtimeBearerToken(r), r.Method, r.URL.RequestURI(), "person-a", nil, r.Header.Get("X-HZY-Actor-Signed-At")))
		res, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		body, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(body)
	}
	actionState := func() [4]int {
		var out [4]int
		if err := business.QueryRow("SELECT (SELECT COUNT(*) FROM aims_product_command_receipts),(SELECT COUNT(*) FROM aims_product_activity_logs),(SELECT COUNT(*) FROM aims_product_request_sources),(SELECT revision FROM aims_product_workspaces WHERE product_code='P-A')").Scan(&out[0], &out[1], &out[2], &out[3]); err != nil {
			t.Fatal(err)
		}
		return out
	}
	actionSuccess := func(action, key string, input map[string]any, permission string) {
		code, body := actionCall(action, key, input, permission)
		if code != 200 {
			t.Fatalf("%s: %d %s", action, code, body)
		}
		before := actionState()
		code, body = actionCall(action, key, input, permission)
		if code != 200 || !strings.Contains(body, `"replayed":true`) || actionState() != before {
			t.Fatalf("%s replay: %d %s", action, code, body)
		}
		raw, _ := json.Marshal(input)
		id := productcenter.CommandIdentity{ProductCode: "P-A", ActorUID: "person-a", Action: "product_requests:" + action, IdempotencyKey: key}
		p := permit()
		p.Action = permission
		var replay productcenter.CommandResult
		var replayErr error
		switch action {
		case "merge":
			var v productcenter.RequestMerge
			_ = json.Unmarshal(raw, &v)
			replay, replayErr = productcenter.MergeProductRequest(ctx, business, id, p, v)
		case "edit":
			var v productcenter.RequestEdit
			_ = json.Unmarshal(raw, &v)
			replay, replayErr = productcenter.EditProductRequest(ctx, business, id, p, v)
		case "decide":
			var v productcenter.RequestDecision
			_ = json.Unmarshal(raw, &v)
			replay, replayErr = productcenter.DecideProductRequest(ctx, business, id, p, v)
		case "source-create":
			var v productcenter.ManualRequestSource
			_ = json.Unmarshal(raw, &v)
			replay, replayErr = productcenter.AddManualRequestSource(ctx, business, id, p, v)
		case "source-delete":
			var v productcenter.RequestSourceDelete
			_ = json.Unmarshal(raw, &v)
			replay, replayErr = productcenter.DeleteManualRequestSource(ctx, business, id, p, v)
		}
		if replayErr != nil || !replay.Replayed || actionState() != before {
			t.Fatal("old entry did not replay Host receipt", action, replayErr)
		}
	}
	editInput := actionRevisions()
	editInput["title"] = "HTTP request"
	editInput["problem_statement"] = "Edited problem"
	editInput["source_type"] = "internal"
	editInput["urgency_level"] = "P2"
	editInput["reason"] = "clarify"
	if status, _ := actionCall("edit", "edit-request", editInput, "view"); status != 403 {
		t.Fatal("wrong edit permission accepted", status)
	}
	actionSuccess("edit", "edit-request", editInput, "edit")
	decision := actionRevisions()
	decision["status"] = "evaluating"
	decision["reason"] = "triage"
	decision["impact_note"] = ""
	actionSuccess("decide", "decide-request", decision, "decide")
	source := actionRevisions()
	source["note"] = "Manual interview evidence"
	source["evidence_date"] = nil
	source["kind"] = "fact"
	source["direction"] = "supporting"
	beforeFailure := actionState()
	exec(business, "CREATE TRIGGER fail_request_source_audit BEFORE INSERT ON aims_product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='private source audit failure'")
	if status, body := actionCall("source-create", "create-source", source, "edit"); status != 503 || strings.Contains(body, "private source") {
		t.Fatalf("source failure: %d %s", status, body)
	}
	if actionState() != beforeFailure {
		t.Fatal("source transaction escaped rollback")
	}
	exec(business, "DROP TRIGGER fail_request_source_audit")
	actionSuccess("source-create", "create-source", source, "edit")
	beforeList := actionState()
	status, sourceBody := actionCall("source-list", "", map[string]any{"biz_id": actionBizID, "page": 1, "page_size": 10}, "view")
	if status != 200 || !strings.Contains(sourceBody, "Manual interview evidence") || !strings.Contains(sourceBody, "unverified") || actionState() != beforeList {
		t.Fatalf("source list: %d %s", status, sourceBody)
	}
	var sourceID int64
	if err := business.QueryRow("SELECT id FROM aims_product_request_sources").Scan(&sourceID); err != nil {
		t.Fatal(err)
	}
	removal := actionRevisions()
	removal["source_id"] = sourceID
	removal["expected_source_revision"] = 1
	removal["reason"] = "duplicate evidence"
	actionSuccess("source-delete", "delete-source", removal, "delete")
	code, body := call(func(i *enterpriseRequestCreateInput, r *http.Request) {
		exec(business, "UPDATE aims_product_workspaces SET revision=revision+1 WHERE product_code='P-A'")
	})
	if code != 409 || !strings.Contains(body, "product_authorization_changed") {
		t.Fatalf("scope facts mismatch: %d %s", code, body)
	}
	exec(consoleDB, "INSERT INTO service_client_grants VALUES(1,'aims:product-requests','read','active')")
	exec(business, "INSERT INTO aims_product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P-B',?,'person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", uuid.NewString())
	readCall := func(detail bool, mutate func(*enterpriseRequestReadInput)) (int, string) {
		input := enterpriseRequestReadInput{ProductCode: "P-A", Tenant: "tenant-a", Deployment: "enterprise-test", Authorization: permit(), Query: productcenter.RequestPageQuery{Page: 1, PageSize: 1}}
		input.Authorization.Action = "view"
		if mutate != nil {
			mutate(&input)
		}
		raw, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		endpoint := "list"
		if detail {
			endpoint = "view"
		}
		r, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/enterprise/aims/product-requests:"+endpoint, bytes.NewReader(raw))
		r.Header = signedTemplate.Header.Clone()
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, runtimeBearerToken(r), r.Method, r.URL.RequestURI(), "person-a", nil, r.Header.Get("X-HZY-Actor-Signed-At")))
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		out, _ := io.ReadAll(response.Body)
		return response.StatusCode, string(out)
	}
	counts := func() [2]int {
		var c [2]int
		if err := business.QueryRow("SELECT (SELECT COUNT(*) FROM aims_product_command_receipts),(SELECT COUNT(*) FROM aims_product_activity_logs)").Scan(&c[0], &c[1]); err != nil {
			t.Fatal(err)
		}
		return c
	}
	beforeReads := counts()
	page := func(mutate func(*enterpriseRequestReadInput)) productcenter.RequestPage {
		code, body := readCall(false, mutate)
		var result struct {
			Data productcenter.RequestPage `json:"data"`
		}
		if code != 200 || json.Unmarshal([]byte(body), &result) != nil {
			t.Fatalf("list: %d %s", code, body)
		}
		return result.Data
	}
	firstPage := page(nil)
	if firstPage.Total != 1 || firstPage.UnmergedTotal != 1 || firstPage.Page != 1 || firstPage.PageSize != 1 || len(firstPage.Items) != 1 || firstPage.Items[0].Title != "HTTP request" {
		t.Fatalf("invalid first page: %#v", firstPage)
	}
	bizID := firstPage.Items[0].BizID
	if next := page(func(i *enterpriseRequestReadInput) { i.Query.Page = 2 }); next.Total != 1 || len(next.Items) != 0 {
		t.Fatalf("page two: %#v", next)
	}
	if filtered := page(func(i *enterpriseRequestReadInput) { i.Query.Keyword = "no-such-request" }); filtered.Total != 0 || len(filtered.Items) != 0 {
		t.Fatalf("keyword filter: %#v", filtered)
	}
	if filtered := page(func(i *enterpriseRequestReadInput) { i.Query.SourceType = "internal"; i.Query.UrgencyLevel = "P2" }); filtered.Total != 1 {
		t.Fatal("combined filters", filtered)
	}
	detailCode, detailBody := readCall(true, func(i *enterpriseRequestReadInput) { i.BizID = bizID })
	var detailResult struct {
		Data productcenter.RequestRecord `json:"data"`
	}
	if detailCode != 200 || json.Unmarshal([]byte(detailBody), &detailResult) != nil || detailResult.Data.BizID != bizID || detailResult.Data.ProductCode != "P-A" {
		t.Fatalf("detail: %d %s", detailCode, detailBody)
	}
	otherWorkspace := func(i *enterpriseRequestReadInput) {
		i.ProductCode = "P-B"
		facts, err := productcenter.LoadAuthorizationFacts(ctx, business, "P-B", "person-a")
		if err != nil {
			t.Fatal(err)
		}
		i.Authorization.Facts = facts
	}
	if other := page(otherWorkspace); other.Total != 0 || len(other.Items) != 0 {
		t.Fatal("workspace list leak", other)
	}
	if code, body := readCall(true, func(i *enterpriseRequestReadInput) { otherWorkspace(i); i.BizID = bizID }); code != 404 {
		t.Fatalf("workspace detail leak: %d %s", code, body)
	}
	for _, mutate := range []func(*enterpriseRequestReadInput){func(i *enterpriseRequestReadInput) { i.Authorization.Action = "create" }, func(i *enterpriseRequestReadInput) { i.Authorization.Facts.ActorUID = "other" }} {
		if code, body := readCall(false, mutate); code != 403 {
			t.Fatalf("read permit accepted: %d %s", code, body)
		}
	}
	exec(business, "UPDATE enterprise_schema_registry SET generation=2")
	for _, detail := range []bool{false, true} {
		if code, body := readCall(detail, func(i *enterpriseRequestReadInput) { i.BizID = bizID }); code != 503 {
			t.Fatalf("stale read generation: %d %s", code, body)
		}
	}
	exec(business, "UPDATE enterprise_schema_registry SET generation=1")
	if after := counts(); after != beforeReads {
		t.Fatalf("reads wrote receipts/audit: %v -> %v", beforeReads, after)
	}
	mergeTarget := uuid.NewString()
	exec(business, "INSERT INTO aims_product_requests(biz_id,product_code,title,source_type,urgency_level,decision_status,created_by,updated_by,created_at,updated_at) VALUES(?,'P-A','Merge target','internal','P2','submitted','person-a','person-a',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", mergeTarget)
	merge := actionRevisions()
	merge["target_biz_id"] = mergeTarget
	merge["expected_target_revision"] = 1
	merge["reason"] = "same customer problem"
	merge["impact_note"] = "retain source evidence"
	if status, _ := actionCall("merge", "merge-request", merge, "edit"); status != 403 {
		t.Fatal("merge edit permission accepted", status)
	}
	beforeMergeFailure := actionState()
	exec(business, "CREATE TRIGGER fail_request_merge_audit BEFORE INSERT ON aims_product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='private merge audit failure'")
	if status, _ := actionCall("merge", "merge-request", merge, "decide"); status != 503 {
		t.Fatal("merge audit failure accepted", status)
	}
	if actionState() != beforeMergeFailure {
		t.Fatal("merge failure wrote receipt/workspace")
	}
	var decisionAfterFailure string
	if err := business.QueryRow("SELECT decision_status FROM aims_product_requests WHERE biz_id=?", actionBizID).Scan(&decisionAfterFailure); err != nil || decisionAfterFailure != "evaluating" {
		t.Fatal("merge source mutation escaped rollback", err)
	}
	exec(business, "DROP TRIGGER fail_request_merge_audit")
	actionSuccess("merge", "merge-request", merge, "decide")
	beforeMergeReads := actionState()
	if status, body := readCall(true, func(i *enterpriseRequestReadInput) { i.BizID = actionBizID }); status != 200 || !strings.Contains(body, "merge_trail") || !strings.Contains(body, mergeTarget) {
		t.Fatalf("merge trail unavailable: %d %s", status, body)
	}
	mergedSources := page(func(i *enterpriseRequestReadInput) { i.Query.MergedIntoBizID = mergeTarget })
	if mergedSources.Total != 1 || len(mergedSources.Items) != 1 || mergedSources.Items[0].BizID != actionBizID {
		t.Fatal("merged source list unavailable", mergedSources)
	}
	if actionState() != beforeMergeReads {
		t.Fatal("merge reads mutated state")
	}
	exec(consoleDB, "UPDATE service_client_grants SET status='revoked'")
	expect(403, nil)
	exec(consoleDB, "UPDATE service_client_grants SET status='active'")
	exec(consoleDB, "UPDATE service_client_credentials SET status='revoked'")
	expect(403, nil)
	exec(consoleDB, "UPDATE service_client_credentials SET status='active'")
	exec(business, "UPDATE enterprise_schema_registry SET generation=2")
	expect(503, nil)
	exec(business, "UPDATE enterprise_schema_registry SET generation=1")
	var requests, receipts int
	if err := business.QueryRow("SELECT (SELECT COUNT(*) FROM aims_product_requests),(SELECT COUNT(*) FROM aims_product_command_receipts)").Scan(&requests, &receipts); err != nil || requests != 2 || receipts != 6 {
		t.Fatal("unexpected writes", requests, receipts, err)
	}
	exec(consoleDB, "DROP TABLE service_client_credentials")
	code, body = call(nil)
	if code != 503 || strings.Contains(body, "doesn't exist") || strings.Contains(body, businessName) {
		t.Fatalf("dependency not redacted: %d %s", code, body)
	}
}
