package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
	"unsafe"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func handoffMySQLDatabase(t *testing.T) *sql.DB {
	t.Helper()
	socket := os.Getenv("HZY_PRODUCT_CENTER_TEST_SOCKET")
	if socket == "" {
		t.Skip("set HZY_PRODUCT_CENTER_TEST_SOCKET to an isolated local MySQL socket")
	}
	// This suite never accepts a network address, ambient DSN, or a business DB.
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-product-center.") {
		t.Fatal("test socket must be inside a dedicated /tmp/hzy-product-center.* directory")
	}
	config := mysql.NewConfig()
	config.User, config.Net, config.Addr = "root", "unix", socket
	config.Timeout, config.ReadTimeout, config.WriteTimeout = 5*time.Second, 10*time.Second, 10*time.Second
	root, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	name := "hzy_pc_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := root.Exec("CREATE DATABASE `" + name + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"); err != nil {
		t.Fatal(err)
	}
	config.DBName = name
	db, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec("DROP DATABASE `" + name + "`"); _ = db.Close() })
	fixture, err := os.ReadFile("productcenter/testdata/legacy_product_versions.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeHandoffSQLScript(t, db, string(fixture))
	return db
}

func executeHandoffSQLScript(t *testing.T, db *sql.DB, script string) {
	t.Helper()
	delimiter := ";"
	var buffer strings.Builder
	for _, line := range strings.Split(script, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "--") {
			continue
		}
		if strings.HasPrefix(trimmed, "DELIMITER ") {
			delimiter = strings.TrimSpace(strings.TrimPrefix(trimmed, "DELIMITER "))
			continue
		}
		buffer.WriteString(line)
		buffer.WriteByte('\n')
		if strings.HasSuffix(trimmed, delimiter) {
			statement := strings.TrimSuffix(strings.TrimSpace(buffer.String()), delimiter)
			if _, err := db.Exec(statement); err != nil {
				t.Fatalf("SQL failed: %v\n%s", err, statement)
			}
			buffer.Reset()
		}
	}
	if rest := strings.TrimSpace(buffer.String()); rest != "" && !strings.HasPrefix(rest, "--") {
		t.Fatalf("unterminated SQL: %s", rest)
	}
}

func migrateHandoffProductCenter(t *testing.T, db *sql.DB) {
	t.Helper()
	script, err := os.ReadFile("../../../../aims/docs/migration_v5.19_product_center.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeHandoffSQLScript(t, db, string(script))
	script, err = os.ReadFile("../../../../aims/docs/migration_v5.21_product_components.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeHandoffSQLScript(t, db, string(script))
	script, err = os.ReadFile("../../../../aims/docs/migration_v5.27_cross_product_dependencies.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeHandoffSQLScript(t, db, string(script))
	for _, name := range []string{"migration_v5.29_priority_model_versions.sql", "migration_v5.30_rice_reach_observations.sql", "migration_v5.31_rice_assessments.sql", "migration_v5.36_product_feedback_bindings.sql", "migration_v5.37_product_line_management.sql", "migration_v5.38_lightweight_product_planning.sql"} {
		modelScript, e := os.ReadFile("../../../../aims/docs/" + name)
		if e != nil {
			t.Fatal(e)
		}
		executeHandoffSQLScript(t, db, string(modelScript))
	}

}

func TestMySQLProductHandoffRuntimeCreatesActualProjectDraft(t *testing.T) {
	exerciseProductHandoffRuntime(t, "")
}

func TestMySQLPublicationCompetesWithWorkItemAttachment(t *testing.T) {
	exerciseProductHandoffRuntime(t, "attach")
}

func TestMySQLPublicationCompetesWithWorkItemVersionPatch(t *testing.T) {
	exerciseProductHandoffRuntime(t, "patch")
}

func TestMySQLPublicationCompetesWithNewScope(t *testing.T) {
	exerciseProductHandoffRuntime(t, "scope")
}

func exerciseProductHandoffRuntime(t *testing.T, publicationRace string) {
	db := handoffMySQLDatabase(t)
	migrateHandoffProductCenter(t, db)
	// Use production table definitions, preserving keys and column types.
	schema, err := os.ReadFile("../../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(`SET FOREIGN_KEY_CHECKS=0`); err != nil {
		t.Fatal(err)
	}
	wanted := map[string]bool{"deliverables": true, "project_template_sets": true, "project_template_versions": true, "milestones": true, "aims_projects": true, "aims_project_members": true, "aims_project_products": true, "requirement_items": true, "requirement_contents": true, "requirement_item_contents": true, "project_documents": true, "work_items": true}
	tables := regexp.MustCompile("(?ms)^CREATE TABLE IF NOT EXISTS `([^`]+)` \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(schema), -1)
	for _, table := range tables {
		if wanted[table[1]] {
			if _, err = db.Exec(table[0]); err != nil {
				t.Fatalf("schema %s: %v", table[1], err)
			}
			delete(wanted, table[1])
		}
	}
	if len(wanted) != 0 {
		t.Fatalf("missing definitions: %v", wanted)
	}
	if _, err = db.Exec(`SET FOREIGN_KEY_CHECKS=1`); err != nil {
		t.Fatal(err)
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	const code = "P-INTEGRATION"
	ctx := context.Background()
	exec(`INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES(?,?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code, uuid.NewString())
	exec(`INSERT INTO aims_projects(id,project_code,name,short_name,category,lifecycle_status,leader_uid,created_by) VALUES(42,'PRJ','产品研发','研发','product_dev','active','pm','pm')`)
	exec(`INSERT INTO aims_project_products(project_id,product_code,product_name,created_by) VALUES(42,?,'产品','pm')`, code)
	item := uuid.NewString()
	exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,created_by,updated_by,created_at,updated_at) VALUES(?,?,'统一登录','登录与退出','growth','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, item, code)
	permit := func(action string) productcenter.AuthorizationPermit {
		t.Helper()
		facts, err := productcenter.LoadAuthorizationFacts(ctx, db, code, "pm")
		if err != nil {
			t.Fatal(err)
		}
		return productcenter.AuthorizationPermit{Resource: "product_priorities", Action: action, Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
	}
	identity := func(action, key string) productcenter.CommandIdentity {
		return productcenter.CommandIdentity{ProductCode: code, ActorUID: "pm", Action: action, IdempotencyKey: key}
	}
	cycleResult, err := productcenter.CreatePlanningCycle(ctx, db, identity("product_priorities:cycle-create", "cycle"), permit("edit"), productcenter.PlanningCycleDraft{ExpectedRevision: 1, Title: "九月计划", StartsOn: "2099-01-01", EndsOn: "2099-01-31", GoalSummary: "统一身份", ReviewIntervalDays: 14})
	if err != nil {
		t.Fatal(err)
	}
	var cycle struct {
		BizID string `json:"biz_id"`
	}
	if err = json.Unmarshal(cycleResult.Value, &cycle); err != nil {
		t.Fatal(err)
	}
	candidate := productcenter.PlanningCycleCandidateAdd{CycleBizID: cycle.BizID, ItemBizID: item, ExpectedRevision: 2, ExpectedCycleRevision: 1, ExpectedItemRevision: 1}
	if _, err = productcenter.AddPlanningCycleCandidate(ctx, db, identity("product_priorities:candidate-add", "candidate"), permit("edit"), candidate); err != nil {
		t.Fatal(err)
	}
	exec(`UPDATE product_planning_cycles SET status='open',total_person_days=20,reserve_person_days=0,reliability_person_days=0,usability_person_days=0,growth_person_days=20 WHERE biz_id=?`, cycle.BizID)
	candidate.ExpectedRevision = 3
	candidate.ExpectedCycleRevision = 2
	score := 5
	confidence, effort := productcenter.Hundredths(80), productcenter.Hundredths(800)
	rationale := map[string]string{}
	refs := map[string][]string{}
	for _, key := range []string{"strategic", "user_value", "business", "risk", "confidence", "effort_person_days"} {
		rationale[key] = "已评估"
		refs[key] = []string{"trial"}
	}
	_, err = productcenter.CreatePlanningAssessment(ctx, db, identity("product_priorities:assess", "assessment"), permit("assess"), productcenter.PlanningAssessmentCreate{PlanningCycleCandidateAdd: candidate, ExpectedScopeRevision: 1, ExpectedEvidenceRevision: 1, Assessment: productcenter.AssessmentInput{ModelVersion: productcenter.AssessmentModel, EffortUnit: "person_day", Strategic: &score, UserValue: &score, Business: &score, Risk: &score, Confidence: &confidence, Effort: &effort}, Rationale: rationale, EvidenceReferences: refs, Evidence: []productcenter.AssessmentEvidence{{Key: "trial", Summary: "技术验证", ObservedOn: "2026-09-07", Kind: "fact", Polarity: "supporting"}}, EstimateConfirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	readCycle, err := productcenter.ReadPlanningCycle(ctx, db, code, "pm", cycle.BizID, permit("view"))
	if err != nil {
		t.Fatal(err)
	}
	candidate.ExpectedRevision = readCycle.WorkspaceRevision
	candidate.ExpectedCycleRevision = readCycle.Revision
	var assessmentID int64
	if err = db.QueryRow(`SELECT current_assessment_id FROM product_planning_cycle_items`).Scan(&assessmentID); err != nil {
		t.Fatal(err)
	}
	_, err = productcenter.SelectPlanningCandidate(ctx, db, identity("product_priorities:select", "select"), permit("prioritize"), productcenter.PlanningSelection{PlanningCycleCandidateAdd: candidate, ExpectedQueueRevision: readCycle.QueueRevision, ExpectedAssessmentID: assessmentID, Reason: "正式选入", Exceptions: []productcenter.DecisionException{}})
	if err != nil {
		t.Fatal(err)
	}
	readCycle, err = productcenter.ReadPlanningCycle(ctx, db, code, "pm", cycle.BizID, permit("view"))
	if err != nil {
		t.Fatal(err)
	}
	input := productHandoffFixture()
	input.ProjectCode = "PRJ"
	input.Operation = "create"
	input.RequirementID = 0
	input.Title = "统一登录草稿"
	input.PlanningDeliveryCheck = productcenter.PlanningDeliveryCheck{ItemBizID: item, CycleBizID: cycle.BizID, ExpectedRevision: readCycle.WorkspaceRevision, ExpectedItemRevision: 1, ExpectedCycleRevision: readCycle.Revision, ExpectedQueueRevision: readCycle.QueueRevision}
	adapter := &Adapter{Adapter: &compat.Adapter{}}
	dbField := reflect.ValueOf(adapter.Adapter).Elem().FieldByName("db")
	reflect.NewAt(dbField.Type(), unsafe.Pointer(dbField.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	query := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims:product-priorities:handoff"}}
	handoffKey := "handoff"
	run := func() (any, error) {
		facts, e := loadProductHandoffProjectFacts(ctx, db, "PRJ", "pm")
		if e != nil {
			t.Fatal(e)
		}
		raw, e := json.Marshal(map[string]any{"input": input, "idempotency_key": handoffKey, "planning_authorization": permit("handoff"), "project_authorization": productHandoffProjectPermit{Resource: "requirements", Action: "edit", Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}})
		if e != nil {
			t.Fatal(e)
		}
		var body map[string]any
		if e = json.Unmarshal(raw, &body); e != nil {
			t.Fatal(e)
		}
		out, _, e := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/planning-handoff:create", query, body)
		return out, e
	}
	// Inject at every transaction stage required by AC-09, including the
	// receipt stage which can run before the project draft is created.
	rollbackTables := []string{"requirement_items", "requirement_contents", "requirement_item_contents", "product_request_delivery_links", "product_activity_logs", "product_command_receipts"}
	baseline := map[string]int{}
	for _, table := range rollbackTables {
		var count int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil {
			t.Fatal(err)
		}
		baseline[table] = count
	}
	for _, failureTable := range rollbackTables {
		exec("CREATE TRIGGER pc_fail_real_handoff BEFORE INSERT ON " + failureTable + " FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected handoff failure'")
		if _, err = run(); err == nil {
			t.Fatalf("%s failure committed", failureTable)
		}
		for _, table := range rollbackTables {
			var count int
			if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != baseline[table] {
				t.Fatalf("failure %s rollback %s: %d want %d, %v", failureTable, table, count, baseline[table], err)
			}
		}
		exec(`DROP TRIGGER pc_fail_real_handoff`)
	}
	result, err := run()
	if err != nil {
		t.Fatal(err)
	}
	envelope, ok := result.(map[string]any)
	if !ok || envelope["code"] != 0 {
		t.Fatalf("envelope: %#v", result)
	}
	var state, title, content string
	if err = db.QueryRow(`SELECT r.status,r.title,c.content_md FROM requirement_items r JOIN requirement_item_contents l ON l.requirement_id=r.id JOIN requirement_contents c ON c.id=l.content_id`).Scan(&state, &title, &content); err != nil || state != "draft" || title != input.Title || content != input.ScopeSummary {
		t.Fatalf("created draft: %s %s %s %v", state, title, content, err)
	}
	if _, err = run(); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM requirement_items`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("duplicate draft: %d %v", count, err)
	}
	// Existing baselined content must survive linking, without new draft rows.
	draftInput, e := parseProjectRequirementCreateInput(42, "pm", map[string]any{"title": "原基线需求", "content": map[string]any{"kind": "module", "headingDepth": 2, "contentMd": "原基线正文"}})
	if e != nil {
		t.Fatal(e)
	}
	existing, e := adapter.createProjectRequirementAttempt(ctx, draftInput)
	if e != nil {
		t.Fatal(e)
	}
	existingID := existing["id"].(int64)
	exec(`UPDATE requirement_items SET status='baselined',current_version=1 WHERE id=?`, existingID)
	exec(`UPDATE requirement_contents c JOIN requirement_item_contents l ON l.content_id=c.id SET c.version_status='baselined' WHERE l.requirement_id=?`, existingID)
	input.ExpectedRevision++
	input.ExpectedItemRevision++
	input.Operation = "link"
	input.Title = ""
	input.RequirementID = existingID
	input.SliceKey = "existing-baseline"
	handoffKey = "link-existing"
	if _, err = run(); err != nil {
		t.Fatal(err)
	}
	var version int
	if err = db.QueryRow(`SELECT r.status,r.title,r.current_version,c.content_md FROM requirement_items r JOIN requirement_item_contents l ON l.requirement_id=r.id JOIN requirement_contents c ON c.id=l.content_id WHERE r.id=?`, existingID).Scan(&state, &title, &version, &content); err != nil || state != "baselined" || title != "原基线需求" || version != 1 || content != "原基线正文" {
		t.Fatalf("baseline modified: %s %s %d %s %v", state, title, version, content, err)
	}
	for _, table := range []string{"requirement_items", "requirement_contents", "product_request_delivery_links"} {
		if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 2 {
			t.Fatalf("link duplicated %s: %d %v", table, count, err)
		}
	}

	// Production project list SQL must apply the binding filter to both pages
	// and totals while retaining ordinary project visibility.
	exec(`INSERT INTO aims_projects(id,project_code,name,short_name,category,lifecycle_status,leader_uid,created_by) VALUES(43,'PRJ2','第二研发','研发二','product_dev','active','pm','pm'),(44,'UNBOUND','未绑定项目','未绑定','product_dev','active','pm','pm')`)
	exec(`INSERT INTO aims_project_products(project_id,product_code,product_name,created_by) VALUES(43,?,'产品','pm')`, code)
	exec(`INSERT INTO aims_project_products(project_id,product_code,product_name,created_by) VALUES(44,?,'另一个产品','pm')`, strings.ToLower(code))
	foreignBinding := input
	foreignBinding.ProjectCode = "UNBOUND"
	foreignBinding.Operation = "create"
	foreignBinding.RequirementID = 0
	foreignBinding.Title = "不应创建"
	tx, e := db.BeginTx(ctx, nil)
	if e != nil {
		t.Fatal(e)
	}
	_, bindingErr := adapter.resolveProductHandoffRequirementTx(ctx, tx, code, "pm", 44, foreignBinding)
	if e = tx.Rollback(); e != nil {
		t.Fatal(e)
	}
	if bindingErr != sql.ErrNoRows {
		t.Fatalf("case-sensitive binding: %v", bindingErr)
	}
	listQuery := url.Values{"current_user": {"pm"}, "product_code": {code}, "category": {"product_dev"}, "lifecycle_status": {"active"}, "pageSize": {"1"}, "page": {"1"}}
	first, e := adapter.memberProjects(ctx, listQuery)
	if e != nil {
		t.Fatal(e)
	}
	listQuery.Set("page", "2")
	second, e := adapter.memberProjects(ctx, listQuery)
	if e != nil {
		t.Fatal(e)
	}
	if first["total"] != int64(2) || second["total"] != int64(2) {
		t.Fatalf("binding totals: %v %v", first["total"], second["total"])
	}

	seen := map[int64]bool{}
	for _, page := range []map[string]any{first, second} {
		items, ok := page["items"].([]map[string]any)
		if !ok || len(items) != 1 {
			t.Fatalf("page size: %#v", page)
		}
		id, ok := items[0]["id"].(int64)
		if !ok || seen[id] || (id != 42 && id != 43) {
			t.Fatalf("unbound or duplicate project: %#v", items)
		}
		seen[id] = true
	}

	versionPermit := permit("edit")
	versionPermit.Resource = "product_versions"
	query.Set("current_user_scopes", "aims:product-versions:create")
	createdVersion, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:create", query, map[string]any{"input": productcenter.ProductVersionDraft{ExpectedRevision: versionPermit.Facts.Revision, VersionCode: "v1.0", Name: "独立产品版本"}, "authorization": versionPermit, "idempotency_key": "version-create"})
	if err != nil {
		t.Fatal(err)
	}
	if createdVersion.(map[string]any)["code"] != 0 {
		t.Fatalf("version creation envelope: %#v", createdVersion)
	}
	versionPermit = permit("view")
	versionPermit.Resource = "product_versions"
	query.Set("current_user_scopes", "aims:product-versions:read")
	listedVersions, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:list", query, map[string]any{"input": productcenter.ProductVersionPageQuery{Page: 1, PageSize: 20}, "authorization": versionPermit})
	if err != nil {
		t.Fatal(err)
	}
	versionEnvelope := listedVersions.(map[string]any)
	versionPage, ok := versionEnvelope["data"].(productcenter.ProductVersionPage)
	if versionEnvelope["code"] != 0 || !ok || versionPage.Total != 1 || len(versionPage.Items) != 1 || versionPage.Items[0].VersionCode != "v1.0" || versionPage.Items[0].OwnerProjectID != nil {
		t.Fatalf("version list: %#v", listedVersions)
	}

	versionID := versionPage.Items[0].ID
	detailResult, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:view", query, map[string]any{"input": map[string]any{"version_id": versionID}, "authorization": versionPermit})
	if err != nil {
		t.Fatal(err)
	}
	detail := detailResult.(map[string]any)["data"].(productcenter.ProductVersionDetail)
	versionPermit = permit("edit")
	versionPermit.Resource = "product_versions"
	query.Set("current_user_scopes", "aims:product-versions:edit")
	editResult, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:edit", query, map[string]any{"input": productcenter.ProductVersionEdit{ProductVersionDraft: productcenter.ProductVersionDraft{ExpectedRevision: detail.WorkspaceRevision, VersionCode: detail.VersionCode, Name: "更新后的版本名称"}, VersionID: versionID, ExpectedVersionRevision: detail.Revision, Reason: "核对版本计划"}, "authorization": versionPermit, "idempotency_key": "version-edit"})
	if err != nil {
		t.Fatal(err)
	}
	if editResult.(map[string]any)["code"] != 0 {
		t.Fatalf("version edit envelope: %#v", editResult)
	}

	scopeCheck := input.PlanningDeliveryCheck
	versionPermit = permit("edit")
	versionPermit.Resource = "product_versions"
	scopeCheck.ExpectedRevision = versionPermit.Facts.Revision
	if err = db.QueryRow(`SELECT revision FROM product_planning_items WHERE biz_id=?`, item).Scan(&scopeCheck.ExpectedItemRevision); err != nil {
		t.Fatal(err)
	}
	scopeInput := productcenter.ProductVersionScopeDraft{PlanningDeliveryCheck: scopeCheck, VersionID: versionID, ExpectedVersionRevision: detail.Revision + 1, Title: "统一登录范围", AcceptanceCriteria: "完成登录注销验证", ChangeType: "new", Reason: "按周期决定安排"}
	query.Set("current_user_scopes", "aims:product-versions:scope-create")
	scopeResult, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:scope-create", query, map[string]any{"input": scopeInput, "authorization": versionPermit, "planning_authorization": permit("prioritize"), "idempotency_key": "version-scope-create"})
	if err != nil {
		t.Fatal(err)
	}
	if scopeResult.(map[string]any)["code"] != 0 {
		t.Fatalf("scope create envelope: %#v", scopeResult)
	}
	versionPermit = permit("view")
	versionPermit.Resource = "product_versions"
	query.Set("current_user_scopes", "aims:product-versions:read")
	scopeList, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:scope-list", query, map[string]any{"input": map[string]any{"version_id": versionID, "page": 1, "page_size": 20}, "authorization": versionPermit})
	if err != nil {
		t.Fatal(err)
	}
	scopePage, ok := scopeList.(map[string]any)["data"].(productcenter.ProductVersionScopePage)
	if !ok || scopePage.Total != 1 || len(scopePage.Items) != 1 || scopePage.Items[0].LegacyUnscored {
		t.Fatalf("scope list: %#v", scopeList)
	}

	versionPermit = permit("edit")
	versionPermit.Resource = "product_versions"
	scopeInput.ExpectedRevision = versionPermit.Facts.Revision
	scopeInput.ExpectedItemRevision++
	scopeInput.ExpectedVersionRevision = scopePage.VersionRevision
	scopeInput.Title = "更新后的统一登录范围"
	scopeInput.AcceptanceCriteria = "补充注销及异常回调验证"
	query.Set("current_user_scopes", "aims:product-versions:scope-edit")
	scopeEdited, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:scope-edit", query, map[string]any{"input": productcenter.ProductVersionScopeEdit{ProductVersionScopeDraft: scopeInput, ScopeID: scopePage.Items[0].ID}, "authorization": versionPermit, "planning_authorization": permit("prioritize"), "idempotency_key": "version-scope-edit"})
	if err != nil {
		t.Fatal(err)
	}
	if scopeEdited.(map[string]any)["code"] != 0 {
		t.Fatalf("scope edit envelope: %#v", scopeEdited)
	}

	versionPermit = permit("accept")
	versionPermit.Resource = "product_versions"
	query.Set("current_user_scopes", "aims:product-versions:scope-deliver")
	deliveryResult, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:scope-deliver", query, map[string]any{"input": productcenter.ProductVersionScopeDelivery{VersionID: versionID, ScopeID: scopePage.Items[0].ID, ExpectedRevision: versionPermit.Facts.Revision, ExpectedVersionRevision: scopePage.VersionRevision + 1, ExpectedScopeRevision: scopePage.ScopeRevision + 1, Evidence: "验收测试报告 TR-01", Reason: "核对范围验收标准"}, "authorization": versionPermit, "idempotency_key": "version-scope-deliver"})
	if err != nil {
		t.Fatal(err)
	}
	if deliveryResult.(map[string]any)["code"] != 0 {
		t.Fatalf("scope delivery envelope: %#v", deliveryResult)
	}

	versionPermit = permit("view")
	versionPermit.Resource = "product_versions"
	query.Set("current_user_scopes", "aims:product-versions:read")
	// Existing fixture version is explicitly assigned before its first review.
	if _, err = db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) SELECT product_code,'pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3) FROM product_versions WHERE id=?`, versionID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE product_versions SET business_owner_uid='pm' WHERE id=?`, versionID); err != nil {
		t.Fatal(err)
	}
	if publicationRace == "scope" {
		// Model an imported delivered scope without a planning-item mapping.
		// The selected planning item remains available for the new scope.
		exec(`UPDATE product_version_features SET planning_item_id=NULL,product_feature_id=NULL WHERE version_id=?`, versionID)
	}
	versionPermit = permit("view")
	versionPermit.Resource = "product_versions"
	acceptancePreviewResult, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:acceptance-preview", query, map[string]any{"input": map[string]any{"version_id": versionID}, "authorization": versionPermit})
	if err != nil {
		t.Fatal(err)
	}
	acceptancePreview, ok := acceptancePreviewResult.(map[string]any)["data"].(productcenter.ProductVersionAcceptancePreview)
	if !ok || acceptancePreview.UnresolvedScopeCount != 0 || len(acceptancePreview.ReviewHash) != 64 {
		t.Fatalf("acceptance preview: %#v", acceptancePreviewResult)
	}
	versionPermit = permit("accept")
	versionPermit.Resource = "product_versions"
	query.Set("current_user_scopes", "aims:product-versions:accept")
	acceptedResult, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:accept", query, map[string]any{"input": productcenter.ProductVersionAcceptanceInput{VersionID: versionID, ExpectedRevision: acceptancePreview.WorkspaceRevision, ExpectedVersionRevision: acceptancePreview.Version.Revision, ExpectedScopeRevision: acceptancePreview.Version.ScopeRevision, ExpectedReviewHash: acceptancePreview.ReviewHash, Checks: []productcenter.VersionAcceptanceCheck{{Code: "execution-review", Evidence: "当前无绑定执行目标，按范围交付证据核验"}, {Code: "blocking-defects-review", Evidence: "缺陷清单人工核验记录 BUG-01"}, {Code: "release-readiness", Evidence: "发布准备清单 READY-01"}}, Exceptions: []productcenter.VersionAcceptanceException{}}, "authorization": versionPermit, "execution_review_hash": acceptancePreview.ReviewHash, "idempotency_key": "version-accept"})
	if err != nil {
		t.Fatal(err)
	}
	if acceptedResult.(map[string]any)["code"] != 0 {
		t.Fatalf("acceptance envelope: %#v", acceptedResult)
	}

	versionPermit = permit("view")
	versionPermit.Resource = "product_versions"
	query.Set("current_user_scopes", "aims:product-versions:read")
	historyResult, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:acceptance-list", query, map[string]any{"input": map[string]any{"version_id": versionID, "page": 1, "page_size": 20}, "authorization": versionPermit})
	if err != nil {
		t.Fatal(err)
	}
	history, ok := historyResult.(map[string]any)["data"].(productcenter.VersionAcceptancePage)
	if !ok || history.Total != 1 || len(history.Items) != 1 {
		t.Fatalf("acceptance history envelope: %#v", historyResult)
	}
	acceptanceDetailResult, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:acceptance-view", query, map[string]any{"input": map[string]any{"version_id": versionID, "acceptance_id": history.Items[0].ID}, "authorization": versionPermit})
	if err != nil {
		t.Fatal(err)
	}
	acceptanceDetail, ok := acceptanceDetailResult.(map[string]any)["data"].(productcenter.VersionAcceptanceDetail)
	if !ok || len(acceptanceDetail.Checks) != 3 || acceptanceDetail.Checks[2].Evidence != "发布准备清单 READY-01" {
		t.Fatalf("acceptance detail envelope: %#v", acceptanceDetailResult)
	}

	publisherFacts, err := productcenter.LoadAuthorizationFacts(ctx, db, code, "publisher")
	if err != nil {
		t.Fatal(err)
	}
	publishPermit := productcenter.AuthorizationPermit{Resource: "product_versions", Action: "publish", Facts: publisherFacts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
	query.Set("current_user", "publisher")
	query.Set("current_user_scopes", "aims:product-versions:publish")
	publishViewPermit := publishPermit
	publishViewPermit.Action = "view"
	publishReview, err := productcenter.PreviewProductVersionAcceptance(ctx, db, code, "publisher", publishViewPermit, versionID)
	if err != nil {
		t.Fatal(err)
	}
	publish := func() (any, error) {
		result, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:publish", query, map[string]any{"input": productcenter.ProductVersionPublishInput{VersionID: versionID, AcceptanceID: history.Items[0].ID, ExpectedRevision: publisherFacts.Revision, ExpectedVersionRevision: acceptancePreview.Version.Revision + 1, ExpectedScopeRevision: acceptancePreview.Version.ScopeRevision, Reason: "独立发布确认"}, "authorization": publishPermit, "execution_review_hash": publishReview.ReviewHash, "idempotency_key": "version-publish"})
		return result, err
	}
	if publicationRace == "scope" {
		db.SetMaxOpenConns(4)
		scopeVersionPermit := permit("edit")
		scopeVersionPermit.Resource = "product_versions"
		scopePlanningPermit := permit("prioritize")
		nextScope := scopeInput
		nextScope.ExpectedRevision = scopeVersionPermit.Facts.Revision
		nextScope.ExpectedVersionRevision = acceptancePreview.Version.Revision + 1
		nextScope.Title = "Concurrent new scope"
		if err := db.QueryRow(`SELECT revision FROM product_planning_items WHERE biz_id=?`, item).Scan(&nextScope.ExpectedItemRevision); err != nil {
			t.Fatal(err)
		}
		start := make(chan struct{})
		publishing, creating := make(chan error, 1), make(chan error, 1)
		go func() { <-start; _, err := publish(); publishing <- err }()
		go func() {
			<-start
			_, err := productcenter.CreateProductVersionScope(ctx, db, productcenter.CommandIdentity{ProductCode: code, ActorUID: "pm", Action: "product_versions:scope-create", IdempotencyKey: "concurrent-scope"}, scopeVersionPermit, scopePlanningPermit, nextScope)
			creating <- err
		}()
		close(start)
		publishErr, createErr := <-publishing, <-creating
		if (publishErr == nil) == (createErr == nil) {
			t.Fatalf("scope race must have one winner: %v / %v", publishErr, createErr)
		}
		losing := publishErr
		if losing == nil {
			losing = createErr
		}
		var rule *productcenter.RuleError
		var httpFailure httperror.Error
		conflict := ""
		if errors.As(losing, &rule) {
			conflict = rule.Code
		}
		if errors.As(losing, &httpFailure) {
			conflict = httpFailure.Code
		}
		if conflict != "product_authorization_changed" {
			t.Fatalf("unexpected scope competition error: %v", losing)
		}
		var scopes, records int
		var state string
		if err := db.QueryRow(`SELECT COUNT(*) FROM product_version_features WHERE version_id=?`, versionID).Scan(&scopes); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRow(`SELECT COUNT(*) FROM product_release_records WHERE version_id=?`, versionID).Scan(&records); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRow(`SELECT status FROM product_versions WHERE id=?`, versionID).Scan(&state); err != nil {
			t.Fatal(err)
		}
		if publishErr == nil {
			if scopes != 1 || records != 1 || state != "released" {
				t.Fatalf("published mutable scope: %d %d %s", scopes, records, state)
			}
		} else {
			if scopes != 2 || records != 0 || state == "released" {
				t.Fatalf("stale publication admitted: %d %d %s", scopes, records, state)
			}
		}
		return
	}
	if publicationRace != "" {
		db.SetMaxOpenConns(4)
		exec(`INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title) VALUES(9002,42,9002,'PRJ-9002','target','requirement','Concurrent attachment')`)
		start := make(chan struct{})
		publication := make(chan error, 1)
		attachment := make(chan error, 1)
		go func() { <-start; _, err := publish(); publication <- err }()
		go func() {
			<-start
			if publicationRace == "patch" {
				tx, err := db.BeginTx(ctx, nil)
				if err != nil {
					attachment <- err
					return
				}
				defer tx.Rollback()
				_, err = tx.ExecContext(ctx, `UPDATE work_items SET title='Concurrent patch' WHERE id=9002`)
				if err == nil {
					err = updateWorkItemVersionTx(ctx, tx, 42, 9002, sql.NullInt64{}, versionID, nil)
				}
				if err == nil {
					err = tx.Commit()
				}
				attachment <- err
			} else {
				_, err := adapter.attachVersionItemsTransaction(ctx, 42, versionID, nil, []int64{9002})
				attachment <- err
			}
		}()
		close(start)
		publishErr, attachErr := <-publication, <-attachment
		if (publishErr == nil) == (attachErr == nil) {
			t.Fatalf("must have one winner: publish=%v attach=%v", publishErr, attachErr)
		}
		losingError, expectedCode := publishErr, "product_version_revision_conflict"
		if losingError == nil {
			losingError, expectedCode = attachErr, "version_not_editable"
		}
		var httpFailure httperror.Error
		var ruleFailure *productcenter.RuleError
		errorCode := ""
		if errors.As(losingError, &httpFailure) {
			errorCode = httpFailure.Code
		}
		if errors.As(losingError, &ruleFailure) {
			errorCode = ruleFailure.Code
		}
		if errorCode != expectedCode {
			t.Fatalf("unexpected competing failure: %T %v; want %s", losingError, losingError, expectedCode)
		}
		var records int
		var currentStatus string
		var attached sql.NullInt64
		if err := db.QueryRow(`SELECT COUNT(*) FROM product_release_records WHERE version_id=?`, versionID).Scan(&records); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRow(`SELECT status FROM product_versions WHERE id=?`, versionID).Scan(&currentStatus); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRow(`SELECT version_id FROM work_items WHERE id=9002`).Scan(&attached); err != nil {
			t.Fatal(err)
		}
		if publicationRace == "patch" {
			var title string
			if err := db.QueryRow(`SELECT title FROM work_items WHERE id=9002`).Scan(&title); err != nil {
				t.Fatal(err)
			}
			expectedTitle := "Concurrent attachment"
			if attachErr == nil {
				expectedTitle = "Concurrent patch"
			}
			if title != expectedTitle {
				t.Fatalf("concurrent generic fields not atomic: %s", title)
			}
		}
		if publishErr == nil {
			if records != 1 || currentStatus != "released" || attached.Valid {
				t.Fatalf("publication winner left inconsistent state: %d %s %v", records, currentStatus, attached)
			}
		} else {
			if records != 0 || currentStatus == "released" || !attached.Valid || attached.Int64 != versionID {
				t.Fatalf("attachment winner left inconsistent state: %d %s %v", records, currentStatus, attached)
			}
		}
		return
	}
	publishedResult, err := publish()
	if err != nil {
		t.Fatal(err)
	}
	if publishedResult.(map[string]any)["code"] != 0 {
		t.Fatalf("publication envelope: %#v", publishedResult)
	}
	var publishedStatus string
	if err = db.QueryRow(`SELECT status FROM product_versions WHERE id=?`, versionID).Scan(&publishedStatus); err != nil || publishedStatus != "released" {
		t.Fatalf("published status: %s %v", publishedStatus, err)
	}

	var releaseID int64
	if err = db.QueryRow(`SELECT current_release_record_id FROM product_versions WHERE id=?`, versionID).Scan(&releaseID); err != nil {
		t.Fatal(err)
	}
	query.Set("current_user_scopes", "aims:product-versions:read")
	releaseFacts, err := productcenter.LoadAuthorizationFacts(ctx, db, code, "publisher")
	if err != nil {
		t.Fatal(err)
	}
	releasePermit := productcenter.AuthorizationPermit{Resource: "product_versions", Action: "view", Facts: releaseFacts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
	releaseResult, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:release-view", query, map[string]any{"input": map[string]any{"version_id": versionID, "record_id": releaseID}, "authorization": releasePermit})
	if err != nil {
		t.Fatal(err)
	}
	releaseView, ok := releaseResult.(map[string]any)["data"].(productcenter.ProductReleaseDetail)
	if !ok || !releaseView.SnapshotAvailable || !releaseView.Current || len(releaseView.Scopes) != 1 {
		t.Fatalf("release snapshot envelope: %#v", releaseResult)
	}

	diffInput := productcenter.ReleaseScopeDiffQuery{BeforeVersionID: versionID, BeforeRecordID: releaseID, AfterVersionID: versionID, AfterRecordID: releaseID, Page: 1, PageSize: 1}
	diffResult, diffOperation, diffErr := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:release-diff", query, map[string]any{"input": diffInput, "authorization": releasePermit})
	if diffErr != nil {
		t.Fatal(diffErr)
	}
	diffEnvelope, diffOK := diffResult.(map[string]any)
	if !diffOK || diffEnvelope["code"] != 0 || diffOperation != "aims.product-versions.release-diff" {
		t.Fatalf("diff envelope %#v %s", diffResult, diffOperation)
	}
	diff, diffOK := diffEnvelope["data"].(productcenter.ReleaseScopeDiffPage)
	if !diffOK || diff.ProductCode != code || diff.BeforeRecordID != releaseID || diff.AfterRecordID != releaseID || diff.BeforeContentHash != releaseView.ContentHash || diff.AfterContentHash != releaseView.ContentHash || diff.Unchanged != 1 || diff.Total != 0 || len(diff.Changes) != 0 || diff.Page != 1 || diff.PageSize != 1 || diff.WorkspaceRevision != releaseFacts.Revision {
		t.Fatalf("diff runtime %+v", diff)
	}
	diffInput.AfterVersionID = versionID + 999
	if _, _, diffErr = adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:release-diff", query, map[string]any{"input": diffInput, "authorization": releasePermit}); diffErr == nil {
		t.Fatal("runtime diff accepted wrong version")
	}

	query.Set("current_user_scopes", "aims:product-versions:reopen")
	reopenPermit := releasePermit
	reopenPermit.Action = "reopen"
	reopenInput := productcenter.ProductVersionReopenInput{VersionID: versionID, ReleaseRecordID: releaseID + 999, ExpectedRevision: releaseFacts.Revision, ExpectedVersionRevision: acceptancePreview.Version.Revision + 2, Reason: "更正发布范围"}
	reopenBody := map[string]any{"input": reopenInput, "authorization": reopenPermit, "idempotency_key": "version-reopen"}
	if _, _, err = adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:reopen", query, reopenBody); err == nil {
		t.Fatal("reopen accepted wrong release")
	}
	reopenInput.ReleaseRecordID = releaseID
	reopenBody["input"] = reopenInput
	reopenedResult, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:reopen", query, reopenBody)
	if err != nil {
		t.Fatal(err)
	}
	reopened, ok := reopenedResult.(map[string]any)["data"].(productcenter.CommandResult)
	if !ok || reopenedResult.(map[string]any)["code"] != 0 {
		t.Fatalf("reopen envelope: %#v", reopenedResult)
	}
	if err = db.QueryRow(`SELECT status FROM product_versions WHERE id=?`, versionID).Scan(&publishedStatus); err != nil || publishedStatus != "developing" {
		t.Fatalf("reopened status: %s %v", publishedStatus, err)
	}
	reopenPermit.Facts, err = productcenter.LoadAuthorizationFacts(ctx, db, code, "publisher")
	if err != nil {
		t.Fatal(err)
	}
	reopenBody["authorization"] = reopenPermit
	replayedResult, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:reopen", query, reopenBody)
	if err != nil {
		t.Fatal(err)
	}
	replayed := replayedResult.(map[string]any)["data"].(productcenter.CommandResult)
	if !replayed.Replayed || replayed.ReceiptID != reopened.ReceiptID {
		t.Fatalf("reopen replay: %+v", replayed)
	}
	query.Set("current_user_scopes", "aims:product-versions:read")
	reopenPermit.Action = "view"
	withdrawnResult, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:release-view", query, map[string]any{"input": map[string]any{"version_id": versionID, "record_id": releaseID}, "authorization": reopenPermit})
	if err != nil {
		t.Fatal(err)
	}
	withdrawnView := withdrawnResult.(map[string]any)["data"].(productcenter.ProductReleaseDetail)
	if !withdrawnView.Withdrawn || withdrawnView.Current || withdrawnView.ContentHash != releaseView.ContentHash {
		t.Fatalf("reopen changed release evidence: %+v", withdrawnView)
	}

	// Isolated fixture links the existing current scope for matrix read coverage.
	featureResult, err := db.Exec(`INSERT INTO product_features(biz_id,product_code,title,created_by,updated_by,created_at,updated_at) VALUES(UUID(),?,'矩阵功能','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code)
	if err != nil {
		t.Fatal(err)
	}
	matrixFeatureID, err := featureResult.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE product_version_features SET product_feature_id=? WHERE id=?`, matrixFeatureID, scopePage.Items[0].ID); err != nil {
		t.Fatal(err)
	}
	matrixFacts, err := productcenter.LoadAuthorizationFacts(ctx, db, code, "publisher")
	if err != nil {
		t.Fatal(err)
	}
	matrixFeaturePermit := productcenter.AuthorizationPermit{Resource: "product_features", Action: "view", Facts: matrixFacts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
	matrixVersionPermit := matrixFeaturePermit
	matrixVersionPermit.Resource = "product_versions"
	query.Set("current_user_scopes", "aims:product-features:read")
	matrixResult, matrixOperation, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/features:version-matrix", query, map[string]any{"input": productcenter.FeatureVersionMatrixQuery{VersionIDs: []int64{versionID}, Page: 1, PageSize: 20}, "authorization": matrixFeaturePermit, "version_authorization": matrixVersionPermit})
	if err != nil {
		t.Fatal(err)
	}
	matrixEnvelope, ok := matrixResult.(map[string]any)
	if !ok || matrixEnvelope["code"] != 0 || matrixOperation != "aims.product-features.version-matrix" {
		t.Fatalf("matrix envelope %#v %s", matrixResult, matrixOperation)
	}
	matrix, ok := matrixEnvelope["data"].(productcenter.FeatureVersionMatrix)
	if !ok || matrix.Total != 1 || len(matrix.Items) != 1 || matrix.ProductCode != code || matrix.WorkspaceRevision != matrixFacts.Revision || len(matrix.Items[0].Cells) != 1 {
		t.Fatalf("matrix %+v", matrix)
	}
	matrixCell := matrix.Items[0].Cells[0]
	if matrixCell.VersionID != versionID || matrixCell.ScopeID == nil || *matrixCell.ScopeID != scopePage.Items[0].ID || matrixCell.Delivered != 1 || matrixCell.Planned != 0 || matrixCell.Deferred != 0 {
		t.Fatalf("matrix cell %+v", matrixCell)
	}
	// The feature was linked after publication: current delivered scope must
	// not fabricate membership in the earlier immutable, withdrawn release.
	evidence := matrixCell.LatestRelease
	if evidence == nil || evidence.RecordID != releaseID || evidence.VersionID != versionID || evidence.Membership != "absent" || evidence.ScopeID != nil || evidence.FrozenStatus != nil || !evidence.Withdrawn || evidence.Current || evidence.Superseded {
		t.Fatalf("matrix rewrote historical evidence: %+v", evidence)
	}

	query.Set("current_user_scopes", "aims:product-versions:read")
	coordinationResult, coordinationOperation, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:execution-coordination", query, map[string]any{"input": map[string]any{"version_id": versionID}, "authorization": matrixVersionPermit})
	if err != nil {
		t.Fatal(err)
	}
	coordinationEnvelope, ok := coordinationResult.(map[string]any)
	if !ok || coordinationEnvelope["code"] != 0 || coordinationOperation != "aims.product-versions.execution-coordination" {
		t.Fatalf("coordination envelope %#v %s", coordinationResult, coordinationOperation)
	}
	coordination, ok := coordinationEnvelope["data"].(productcenter.VersionExecutionCoordination)
	if !ok || coordination.ProductCode != code || coordination.VersionID != versionID || coordination.WorkspaceRevision != matrixFacts.Revision || !coordination.NoExecutionPlan || coordination.TotalWeight != 0 || coordination.CompletedWeight != 0 || coordination.TargetCount != 0 || coordination.IncompleteTargetCount != 0 || coordination.OpenDefectCount != 0 || len(coordination.Projects) != 0 || coordination.DefectCoverage != "linked-descendants-only" {
		t.Fatalf("coordination %+v", coordination)
	}
	if _, _, err = adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:execution-coordination", query, map[string]any{"input": map[string]any{"version_id": versionID + 999}, "authorization": matrixVersionPermit}); err == nil {
		t.Fatal("coordination accepted missing version")
	}

	// Exercise the actual Runtime dispatch, command receipt and history reader.
	cycleBefore, err := productcenter.ReadPlanningCycle(ctx, db, code, "pm", cycle.BizID, permit("view"))
	if err != nil {
		t.Fatal(err)
	}
	query.Set("current_user", "pm")
	query.Set("current_user_scopes", "aims:product-priorities:cycle-review")
	reviewBody := map[string]any{"input": productcenter.PlanningCycleTransition{BizID: cycle.BizID, ExpectedRevision: cycleBefore.WorkspaceRevision, ExpectedCycleRevision: cycleBefore.Revision, Reason: "核对交付进展后继续当前计划"}, "authorization": permit("prioritize"), "idempotency_key": "runtime-review"}
	reviewResponse, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/planning-cycles:review", query, reviewBody)
	if err != nil {
		t.Fatal(err)
	}
	reviewReceipt := reviewResponse.(map[string]any)["data"].(productcenter.CommandResult)
	reviewBody["authorization"] = permit("prioritize")
	reviewResponse, _, err = adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/planning-cycles:review", query, reviewBody)
	if err != nil {
		t.Fatal(err)
	}
	reviewReplay := reviewResponse.(map[string]any)["data"].(productcenter.CommandResult)
	if !reviewReplay.Replayed || reviewReplay.ReceiptID != reviewReceipt.ReceiptID {
		t.Fatalf("review replay %+v", reviewReplay)
	}
	query.Set("current_user_scopes", "aims:product-priorities:read")
	historyResponse, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/planning-reviews:list", query, map[string]any{"input": productcenter.PlanningObservationQuery{CycleBizID: cycle.BizID, Page: 1, PageSize: 10}, "authorization": permit("view")})
	if err != nil {
		t.Fatal(err)
	}
	reviewHistory := historyResponse.(map[string]any)["data"].(productcenter.PlanningCycleReviewPage)
	if reviewHistory.Total != 1 || len(reviewHistory.Items) != 1 || reviewHistory.Items[0].Conclusion != "核对交付进展后继续当前计划" || reviewHistory.Items[0].After.QueueRevision != cycleBefore.QueueRevision {
		t.Fatalf("runtime review history %+v", reviewHistory)
	}

	// After actual publication withdrawal, the delivered scope can be reopened.
	var currentVersionRevision, currentScopeRevision uint64
	if err = db.QueryRow(`SELECT revision,scope_revision FROM product_versions WHERE id=?`, versionID).Scan(&currentVersionRevision, &currentScopeRevision); err != nil {
		t.Fatal(err)
	}
	scopeReopenPermit := permit("accept")
	scopeReopenPermit.Resource = "product_versions"
	query.Set("current_user_scopes", "aims:product-versions:scope-reopen")
	scopeReopenBody := map[string]any{"input": productcenter.ProductVersionScopeReopen{VersionID: versionID, ScopeID: scopePage.Items[0].ID, ExpectedRevision: scopeReopenPermit.Facts.Revision, ExpectedVersionRevision: currentVersionRevision, ExpectedScopeRevision: currentScopeRevision, Reason: "撤回发布后重新核验范围"}, "authorization": scopeReopenPermit, "idempotency_key": "runtime-scope-reopen"}
	scopeReopened, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:scope-reopen", query, scopeReopenBody)
	if err != nil {
		t.Fatal(err)
	}
	scopeReceipt := scopeReopened.(map[string]any)["data"].(productcenter.CommandResult)
	scopeReopenPermit = permit("accept")
	scopeReopenPermit.Resource = "product_versions"
	scopeReopenBody["authorization"] = scopeReopenPermit
	scopeReopened, _, err = adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:scope-reopen", query, scopeReopenBody)
	if err != nil {
		t.Fatal(err)
	}
	scopeReplay := scopeReopened.(map[string]any)["data"].(productcenter.CommandResult)
	if !scopeReplay.Replayed || scopeReplay.ReceiptID != scopeReceipt.ReceiptID {
		t.Fatalf("scope runtime replay %+v", scopeReplay)
	}
	var reopenedScopeState string
	var newScopeRevision uint64
	if err = db.QueryRow(`SELECT f.status,v.scope_revision FROM product_version_features f JOIN product_versions v ON v.id=f.version_id WHERE f.id=?`, scopePage.Items[0].ID).Scan(&reopenedScopeState, &newScopeRevision); err != nil || reopenedScopeState != "planned" || newScopeRevision != currentScopeRevision+1 {
		t.Fatalf("runtime reopened scope %s %d %v", reopenedScopeState, newScopeRevision, err)
	}
	var preservedReleaseCount int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_release_records WHERE id=?`, releaseID).Scan(&preservedReleaseCount); err != nil || preservedReleaseCount != 1 {
		t.Fatalf("release snapshot lost %d %v", preservedReleaseCount, err)
	}

	scopeHistoryPermit := permit("view")
	scopeHistoryPermit.Resource = "product_versions"
	query.Set("current_user_scopes", "aims:product-versions:read")
	scopeHistoryResponse, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:scope-history", query, map[string]any{"input": map[string]any{"version_id": versionID, "scope_id": scopePage.Items[0].ID, "page": 1, "page_size": 10}, "authorization": scopeHistoryPermit})
	if err != nil {
		t.Fatal(err)
	}
	scopeHistory := scopeHistoryResponse.(map[string]any)["data"].(productcenter.ProductVersionScopeHistoryPage)
	if scopeHistory.Total != 4 || len(scopeHistory.Items) != 4 || scopeHistory.Items[0].Action != "scope-reopen" || scopeHistory.Items[0].Reason != "撤回发布后重新核验范围" || scopeHistory.Items[1].Action != "scope-deliver" || scopeHistory.Items[1].Evidence != "验收测试报告 TR-01" {
		t.Fatalf("runtime scope history %+v", scopeHistory)
	}

	// Seed an existing historical scope, then complete its criteria through Runtime.
	historical, err := db.Exec(`INSERT INTO product_version_features(version_id,title,status) VALUES(?,'历史范围 fixture','planned')`, versionID)
	if err != nil {
		t.Fatal(err)
	}
	historicalID, err := historical.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT revision,scope_revision FROM product_versions WHERE id=?`, versionID).Scan(&currentVersionRevision, &currentScopeRevision); err != nil {
		t.Fatal(err)
	}
	criteriaPermit := permit("edit")
	criteriaPermit.Resource = "product_versions"
	query.Set("current_user_scopes", "aims:product-versions:scope-legacy-criteria")
	criteriaBody := map[string]any{"input": productcenter.LegacyProductVersionScopeCriteria{VersionID: versionID, ScopeID: historicalID, ExpectedRevision: criteriaPermit.Facts.Revision, ExpectedVersionRevision: currentVersionRevision, ExpectedScopeRevision: currentScopeRevision, AcceptanceCriteria: "补录历史约定的登录与注销标准", Reason: "根据原验收约定补录"}, "authorization": criteriaPermit, "idempotency_key": "runtime-legacy-criteria"}
	criteriaResponse, _, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:scope-legacy-criteria", query, criteriaBody)
	if err != nil {
		t.Fatal(err)
	}
	criteriaReceipt := criteriaResponse.(map[string]any)["data"].(productcenter.CommandResult)
	criteriaPermit = permit("edit")
	criteriaPermit.Resource = "product_versions"
	criteriaBody["authorization"] = criteriaPermit
	criteriaResponse, _, err = adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/versions:scope-legacy-criteria", query, criteriaBody)
	if err != nil {
		t.Fatal(err)
	}
	criteriaReplay := criteriaResponse.(map[string]any)["data"].(productcenter.CommandResult)
	if !criteriaReplay.Replayed || criteriaReplay.ReceiptID != criteriaReceipt.ReceiptID {
		t.Fatalf("criteria runtime replay %+v", criteriaReplay)
	}
	var historicalCount int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_version_features f JOIN product_versions v ON v.id=f.version_id WHERE f.id=? AND f.planning_item_id IS NULL AND f.acceptance_criteria=? AND v.revision=? AND v.scope_revision=?`, historicalID, "补录历史约定的登录与注销标准", currentVersionRevision+1, currentScopeRevision+1).Scan(&historicalCount); err != nil || historicalCount != 1 {
		t.Fatalf("criteria runtime result %d %v", historicalCount, err)
	}

	// Exercise the legacy detach storage path against canonical work_items.
	exec(`INSERT INTO work_items(id,project_id,version_id,item_number,item_key,tier,type,title) VALUES(9001,42,?,9001,'PRJ-9001','target','requirement','Detach test')`, versionID)
	for _, lockedStatus := range []string{"released", "archived"} {
		exec(`UPDATE product_versions SET status=? WHERE id=?`, lockedStatus, versionID)
		if _, err := adapter.detachVersionItemTransaction(ctx, 42, versionID, 9001); err == nil {
			t.Fatalf("detached from %s", lockedStatus)
		}
	}
	exec(`UPDATE product_versions SET status='developing' WHERE id=?`, versionID)
	var beforeRevision, beforeScope uint64
	if err := db.QueryRow(`SELECT revision,scope_revision FROM product_versions WHERE id=?`, versionID).Scan(&beforeRevision, &beforeScope); err != nil {
		t.Fatal(err)
	}
	exec(`CREATE TRIGGER pc_fail_detach_revision BEFORE UPDATE ON product_versions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected revision failure'`)
	if _, err := adapter.detachVersionItemTransaction(ctx, 42, versionID, 9001); err == nil {
		t.Fatal("revision failure ignored")
	}
	var attached sql.NullInt64
	if err := db.QueryRow(`SELECT version_id FROM work_items WHERE id=9001`).Scan(&attached); err != nil || !attached.Valid || attached.Int64 != versionID {
		t.Fatalf("detach rollback: %v %v", attached, err)
	}
	exec(`DROP TRIGGER pc_fail_detach_revision`)
	if _, err := adapter.detachVersionItemTransaction(ctx, 42, versionID, 9001); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT version_id FROM work_items WHERE id=9001`).Scan(&attached); err != nil || attached.Valid {
		t.Fatalf("detach result: %v %v", attached, err)
	}
	var afterRevision, afterScope uint64
	if err := db.QueryRow(`SELECT revision,scope_revision FROM product_versions WHERE id=?`, versionID).Scan(&afterRevision, &afterScope); err != nil || afterRevision != beforeRevision+1 || afterScope != beforeScope+1 {
		t.Fatalf("detach revisions: %d %d %v", afterRevision, afterScope, err)
	}

	// Attaching must protect both the original and destination versions.
	newVersion, err := db.Exec(`INSERT INTO product_versions(product_code,version_code,status) VALUES(?,'attach-target','planning')`, code)
	if err != nil {
		t.Fatal(err)
	}
	targetVersion, err := newVersion.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	exec(`UPDATE work_items SET version_id=? WHERE id=9001`, versionID)
	exec(`UPDATE product_versions SET status='released' WHERE id=?`, versionID)
	if _, err := adapter.attachVersionItemsTransaction(ctx, 42, targetVersion, nil, []int64{9001}); err == nil {
		t.Fatal("moved released source")
	}
	exec(`UPDATE product_versions SET status='developing' WHERE id=?`, versionID)
	exec(`UPDATE product_versions SET status='released' WHERE id=?`, targetVersion)
	if _, err := adapter.attachVersionItemsTransaction(ctx, 42, targetVersion, nil, []int64{9001}); err == nil {
		t.Fatal("attached to released target")
	}
	exec(`UPDATE product_versions SET status='planning' WHERE id=?`, targetVersion)
	exec(`CREATE TRIGGER pc_fail_attach_revision BEFORE UPDATE ON product_versions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected attach revision failure'`)
	if _, err := adapter.attachVersionItemsTransaction(ctx, 42, targetVersion, nil, []int64{9001}); err == nil {
		t.Fatal("attach revision failure ignored")
	}
	if err := db.QueryRow(`SELECT version_id FROM work_items WHERE id=9001`).Scan(&attached); err != nil || !attached.Valid || attached.Int64 != versionID {
		t.Fatalf("attach rollback: %v %v", attached, err)
	}
	exec(`DROP TRIGGER pc_fail_attach_revision`)
	if _, err := adapter.attachVersionItemsTransaction(ctx, 42, targetVersion, nil, []int64{9001, 9001}); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT version_id FROM work_items WHERE id=9001`).Scan(&attached); err != nil || !attached.Valid || attached.Int64 != targetVersion {
		t.Fatalf("attach result: %v %v", attached, err)
	}
	if err := db.QueryRow(`SELECT revision,scope_revision FROM product_versions WHERE id=?`, versionID).Scan(&beforeRevision, &beforeScope); err != nil || beforeRevision != afterRevision+1 || beforeScope != afterScope+1 {
		t.Fatalf("source revision: %d %d %v", beforeRevision, beforeScope, err)
	}
	if err := db.QueryRow(`SELECT revision,scope_revision FROM product_versions WHERE id=?`, targetVersion).Scan(&beforeRevision, &beforeScope); err != nil || beforeRevision != 2 || beforeScope != 2 {
		t.Fatalf("target revision: %d %d %v", beforeRevision, beforeScope, err)
	}

	// Simulate the generic update and version hook sharing one transaction.
	patchVersion := func(expected sql.NullInt64, destination int64) error {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if _, err := tx.Exec(`UPDATE work_items SET title='Edited with version' WHERE id=9001`); err != nil {
			return err
		}
		if err := updateWorkItemVersionTx(ctx, tx, 42, 9001, expected, destination, nil); err != nil {
			return err
		}
		return tx.Commit()
	}
	exec(`UPDATE product_versions SET status='released' WHERE id=?`, targetVersion)
	if err := patchVersion(sql.NullInt64{Int64: targetVersion, Valid: true}, 0); err == nil {
		t.Fatal("generic patch detached released version")
	}
	exec(`UPDATE product_versions SET status='planning' WHERE id=?`, targetVersion)
	if err := patchVersion(sql.NullInt64{Int64: versionID, Valid: true}, 0); err == nil {
		t.Fatal("generic patch used stale original version")
	}
	var preservedTitle string
	if err := db.QueryRow(`SELECT title FROM work_items WHERE id=9001`).Scan(&preservedTitle); err != nil || preservedTitle != "Detach test" {
		t.Fatalf("generic fields did not rollback: %s %v", preservedTitle, err)
	}
	if err := patchVersion(sql.NullInt64{Int64: targetVersion, Valid: true}, 0); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT version_id,title FROM work_items WHERE id=9001`).Scan(&attached, &preservedTitle); err != nil || attached.Valid || preservedTitle != "Edited with version" {
		t.Fatalf("generic patch result: %v %s %v", attached, preservedTitle, err)
	}

	postflight, err := os.ReadFile("../../../../aims/docs/product_version_write_postflight.sql")
	if err != nil {
		t.Fatal(err)
	}
	readPostflight := func() int {
		t.Helper()
		rows, err := db.Query(string(postflight))
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		count := 0
		for rows.Next() {
			count++
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return count
	}
	if count := readPostflight(); count != 0 {
		t.Fatalf("valid migrated schema failed postflight: %d", count)
	}
	exec(`ALTER TABLE product_versions DROP COLUMN scope_revision`)
	if count := readPostflight(); count != 1 {
		t.Fatalf("postflight missed missing scope revision: %d", count)
	}

}
