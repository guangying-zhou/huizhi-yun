package enterpriseplanning

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

func planningMySQLFixture(t *testing.T) (*sql.DB, *e.Registry, e.Binding) {
	t.Helper()
	socket := os.Getenv("HZY_PRODUCT_CENTER_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires dedicated isolated MySQL socket")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-product-center.") {
		t.Fatal("refusing non-isolated socket")
	}
	cfg := mysql.NewConfig()
	cfg.User = "root"
	cfg.Net = "unix"
	cfg.Addr = socket
	cfg.Timeout = 5 * time.Second
	root, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	name := "hzy_pc_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE `" + name + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"); err != nil {
		t.Fatal(err)
	}
	cfg.DBName = name
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Close()
		if _, err := root.Exec("DROP DATABASE `" + name + "`"); err != nil {
			t.Error(err)
		}
		root.Close()
	})
	schema, err := os.ReadFile("../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	conn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = conn.ExecContext(context.Background(), "SET FOREIGN_KEY_CHECKS=0"); err != nil {
		t.Fatal(err)
	}
	tables := regexp.MustCompile("(?ms)^CREATE TABLE IF NOT EXISTS `?([a-zA-Z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(schema), -1)
	if len(tables) < 100 {
		t.Fatal("incomplete canonical schema extraction", len(tables))
	}
	mapping := map[string]string{}
	var names, renames []string
	for _, table := range tables {
		if _, err = conn.ExecContext(context.Background(), table[0]); err != nil {
			t.Fatalf("canonical %s: %v", table[1], err)
		}
		mapping[table[1]] = "u_" + table[1]
		names = append(names, table[1])
		renames = append(renames, "`"+table[1]+"` TO `u_"+table[1]+"`")
	}
	if _, err = conn.ExecContext(context.Background(), "SET FOREIGN_KEY_CHECKS=1"); err != nil {
		t.Fatal(err)
	}
	conn.Close()
	if _, err = db.Exec("RENAME TABLE " + strings.Join(renames, ",")); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(64),environment_code VARCHAR(64),runtime_deployment VARCHAR(64),schema_version VARCHAR(64),generation BIGINT) ENGINE=InnoDB"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO enterprise_schema_registry VALUES(1,'tenant','test','runtime','v1',0)"); err != nil {
		t.Fatal(err)
	}
	var instance string
	if err = db.QueryRow("SELECT @@server_uuid").Scan(&instance); err != nil {
		t.Fatal(err)
	}
	b := e.Binding{Key: e.BindingKey{Tenant: "tenant", Environment: "test", RuntimeDeployment: "runtime"}, Storage: e.Storage{InstanceID: instance, Address: "127.0.0.1:3306", Database: name}, SchemaVersion: "v1", Generation: 1, Domains: map[string]e.DomainBinding{"aims": {OwnerDeployment: "aims", Tables: mapping, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathDisabled}}}
	ctx := context.Background()
	plan, err := e.PlanCompatibilityViews(ctx, db, b, "aims", names)
	if err != nil {
		t.Fatal(err)
	}
	if err = e.ApplyCompatibilityViews(ctx, db, b, "aims", names, plan.ReviewHash); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("UPDATE enterprise_schema_registry SET generation=1"); err != nil {
		t.Fatal(err)
	}
	registry := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return db, nil })
	if err = registry.Register(ctx, b); err != nil {
		t.Fatal(err)
	}
	return db, registry, b
}

func TestMySQLProductDocumentRequestsUseMappedAimsOutbox(t *testing.T) {
	db, registry, binding := planningMySQLFixture(t)
	ctx := context.Background()
	writer := e.ResolveRequest{Key: binding.Key, Domain: "aims", OwnerDeployment: "aims", SchemaVersion: binding.SchemaVersion, Generation: binding.Generation, Operation: e.Write}
	resolved, err := registry.Resolve(writer)
	if err != nil {
		t.Fatal(err)
	}
	source, err := e.NewOutboundSource(writer, resolved, "aims", "aims.runtime")
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewPlanningService(ctx, registry, binding, source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("DROP VIEW integration_operation"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P',?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P','pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"); err != nil {
		t.Fatal(err)
	}
	facts, err := pc.LoadAuthorizationFacts(ctx, db, "P", "pm")
	if err != nil {
		t.Fatal(err)
	}
	permit := pc.AuthorizationPermit{Resource: "product_documents", Action: "view", Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
	page, err := service.ListProductDocumentRequests(ctx, "P", "pm", permit, 1, 20)
	if err != nil || page.Total != 0 {
		t.Fatalf("mapped outbox request list failed: total=%d error=%v", page.Total, err)
	}
}

func TestMySQLPlanningServicesUseOwningProjectHandoff(t *testing.T) {
	db, registry, b := planningMySQLFixture(t)
	ctx := context.Background()
	service, err := NewPlanningService(ctx, registry, b)
	if err != nil {
		t.Fatal(err)
	}
	handoff, err := NewLightweightHandoffService(ctx, registry, b)
	if err != nil {
		t.Fatal(err)
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P',?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", uuid.NewString())
	exec("INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P','pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	exec("INSERT INTO aims_projects(id,project_code,name,short_name,category,lifecycle_status,leader_uid,created_by) VALUES(42,'PRJ','Product','Product','product_dev','active','pm','pm')")
	exec("INSERT INTO aims_project_products(project_id,product_code,product_name,created_by) VALUES(42,'P','Product','pm')")
	permit := func(resource, action string) pc.AuthorizationPermit {
		facts, err := pc.LoadAuthorizationFacts(ctx, db, "P", "pm")
		if err != nil {
			t.Fatal(err)
		}
		return pc.AuthorizationPermit{Resource: resource, Action: action, Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
	}
	id := func(action string) pc.CommandIdentity {
		return pc.CommandIdentity{ProductCode: "P", ActorUID: "pm", Action: action, IdempotencyKey: action}
	}
	must := func(out pc.CommandResult, err error) map[string]any {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		var value map[string]any
		if err = json.Unmarshal(out.Value, &value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	request := must(pc.CreateProductRequest(ctx, db, id("product_requests:create"), permit("product_requests", "create"), pc.RequestDraft{ExpectedRevision: 1, Title: "Login", ProblemStatement: "Login", SourceType: "internal", UrgencyLevel: "P2"}))
	owner := "pm"
	versionInput := pc.ProductVersionDraft{ExpectedRevision: 2, VersionCode: "v1", Name: "v1", PlanningMode: "simple", BusinessOwnerUID: &owner}
	version := must(service.CreateProductCenterVersion(ctx, id("product_versions:create"), permit("product_versions", "edit"), versionInput))
	versionID := int64(version["id"].(float64))
	old, err := pc.CreateProductCenterVersion(ctx, db, id("product_versions:create"), permit("product_versions", "edit"), versionInput)
	if err != nil || !old.Replayed {
		t.Fatal("old version entry did not replay", err)
	}
	available, reserve, estimate := pc.Hundredths(1000), pc.Hundredths(100), pc.Hundredths(800)
	must(service.EditLightweightVersionPlan(ctx, id("product_versions:plan-edit"), permit("product_versions", "edit"), pc.LightweightVersionPlanEdit{VersionID: versionID, ExpectedRevision: 3, ExpectedVersionRevision: 1, ExpectedPlanRevision: 1, Goal: "Login", StartsOn: "2099-01-01", PlannedReleaseDate: "2099-01-31", AvailablePersonDays: &available, ReservePersonDays: &reserve}))
	scope := must(service.CreateLightweightVersionPlanItem(ctx, id("product_versions:plan-item-create"), permit("product_versions", "edit"), permit("product_requests", "view"), permit("product_requests", "decide"), permit("product_priorities", "edit"), pc.LightweightVersionPlanItemCreate{VersionID: versionID, ExpectedRevision: 4, ExpectedVersionRevision: 2, ExpectedPlanRevision: 2, ExpectedRequestRevision: 1, RequestBizID: request["biz_id"].(string), ScopeSummary: "Login", AcceptanceCriteria: "Works", EstimatePersonDays: &estimate, AdoptRequest: true}))
	scopeID := int64(scope["id"].(float64))
	must(service.EditLightweightVersionPlanItem(ctx, id("product_versions:plan-item-edit"), permit("product_versions", "edit"), pc.LightweightVersionPlanItemEdit{VersionID: versionID, ScopeID: scopeID, ExpectedRevision: 5, ExpectedVersionRevision: 3, ExpectedPlanRevision: 2, ExpectedScopeRevision: 2, ScopeSummary: "Login", AcceptanceCriteria: "Works", EstimatePersonDays: &estimate}))
	must(service.ConfirmLightweightVersionPlan(ctx, id("product_versions:plan-confirm"), permit("product_versions", "edit"), permit("product_priorities", "prioritize"), pc.LightweightVersionPlanConfirm{VersionID: versionID, ExpectedRevision: 6, ExpectedVersionRevision: 4, ExpectedPlanRevision: 2, ExpectedScopeRevision: 3}))
	facts, err := handoff.ProjectAuthorizationFacts(ctx, "PRJ", "pm")
	if err != nil {
		t.Fatal(err)
	}
	projectPermit := aims.ProductHandoffProjectPermit{Resource: "requirements", Action: "edit", Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
	input := pc.PlanningHandoffInput{PlanningDeliveryCheck: pc.PlanningDeliveryCheck{ExpectedRevision: 6, ItemBizID: scope["planning_item_biz_id"].(string), ExpectedItemRevision: 2}, RequestBizID: request["biz_id"].(string), ExpectedRequestRevision: 2, ProjectCode: "PRJ", SliceKey: "one", Operation: "create", Title: "Login", ScopeSummary: "Login", Reason: "Deliver", PlannedVersionID: versionID, PlannedVersionFeatureID: scopeID}
	call := func(project aims.ProductHandoffProjectPermit) (pc.CommandResult, error) {
		return handoff.HandoffPlanningItem(ctx, id("product_priorities:handoff"), permit("product_priorities", "handoff"), permit("product_requests", "handoff"), permit("product_versions", "view"), project, input)
	}
	if _, err = call(aims.ProductHandoffProjectPermit{}); err == nil {
		t.Fatal("missing target authorization accepted")
	}
	exec("CREATE TRIGGER fail_handoff_audit BEFORE INSERT ON u_product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated audit failure'")
	if _, err = call(projectPermit); err == nil {
		t.Fatal("late audit failure accepted")
	}
	for _, table := range []string{"requirement_items", "requirement_contents", "requirement_item_contents", "product_request_delivery_links"} {
		var n int
		if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil || n != 0 {
			t.Fatal("handoff leaked partial owning facts", table, n, err)
		}
	}
	exec("DROP TRIGGER fail_handoff_audit")
	result := must(call(projectPermit))
	if result["requirement_id"].(float64) <= 0 {
		t.Fatal("missing real draft")
	}
	replay, err := call(projectPermit)
	if err != nil || !replay.Replayed {
		t.Fatal("handoff replay failed", err)
	}
	var drafts, contents, links int
	if err = db.QueryRow("SELECT (SELECT COUNT(*) FROM requirement_items),(SELECT COUNT(*) FROM requirement_contents),(SELECT COUNT(*) FROM product_request_delivery_links)").Scan(&drafts, &contents, &links); err != nil || drafts != 1 || contents != 1 || links != 1 {
		t.Fatal("real owning handoff not atomic/idempotent", drafts, contents, links, err)
	}

	// Remove a newly added unhanded scope through the sixth local service.
	extraID := id("product_requests:create")
	extraID.IdempotencyKey = "extra-request"
	extra := must(pc.CreateProductRequest(ctx, db, extraID, permit("product_requests", "create"), pc.RequestDraft{ExpectedRevision: 7, Title: "Extra", ProblemStatement: "Extra", SourceType: "internal", UrgencyLevel: "P2"}))
	extraScopeID := id("product_versions:plan-item-create")
	extraScopeID.IdempotencyKey = "extra-scope"
	extraScope := must(service.CreateLightweightVersionPlanItem(ctx, extraScopeID, permit("product_versions", "edit"), permit("product_requests", "view"), permit("product_requests", "decide"), permit("product_priorities", "edit"), pc.LightweightVersionPlanItemCreate{VersionID: versionID, ExpectedRevision: 8, ExpectedVersionRevision: 4, ExpectedPlanRevision: 2, ExpectedRequestRevision: 1, RequestBizID: extra["biz_id"].(string), ScopeSummary: "Extra", AcceptanceCriteria: "Works", EstimatePersonDays: &estimate, AdoptRequest: true, Reason: "Add extra"}))
	removal := pc.LightweightVersionPlanItemDelete{VersionID: versionID, ScopeID: int64(extraScope["id"].(float64)), ExpectedRevision: 9, ExpectedVersionRevision: 5, ExpectedPlanRevision: 2, ExpectedScopeRevision: 4, Reason: "Remove extra"}
	must(service.DeleteLightweightVersionPlanItem(ctx, id("product_versions:plan-item-delete"), permit("product_versions", "edit"), removal))
	removedReplay, err := pc.DeleteLightweightVersionPlanItem(ctx, db, id("product_versions:plan-item-delete"), permit("product_versions", "edit"), removal)
	if err != nil || !removedReplay.Replayed {
		t.Fatal("old remove entry did not replay", err)
	}
	exec("UPDATE aims_projects SET leader_uid='changed' WHERE id=42")
	if _, err = call(projectPermit); err == nil {
		t.Fatal("changed project facts replayed handoff receipt")
	}
	bad := b
	bad.Domains = map[string]e.DomainBinding{}
	d := b.Domains["aims"]
	d.Tables = map[string]string{}
	for k, v := range b.Domains["aims"].Tables {
		d.Tables[k] = v
	}
	delete(d.Tables, "product_planning_dependencies")
	bad.Domains["aims"] = d
	if _, err = NewPlanningService(ctx, registry, bad); err == nil {
		t.Fatal("missing command dependency accepted by constructor")
	}
	exec("UPDATE enterprise_schema_registry SET generation=2")
	if _, err = service.CreateProductCenterVersion(ctx, id("product_versions:create"), permit("product_versions", "edit"), versionInput); !errors.Is(err, e.ErrBindingMismatch) {
		t.Fatal("stale service generation accepted", err)
	}
	t.Log("all six local planning service operations and real owning project handoff validated, late failure rollback and replay preserved")
}
