package aims

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/config"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestEnterpriseProjectMembersMySQL(t *testing.T) {
	socket := os.Getenv("HZY_PROJECT_MEMBER_SOCKET")
	if socket == "" {
		t.Skip("isolated MySQL required")
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
	name := "hzy_member_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	exec := func(db *sql.DB, q string) {
		t.Helper()
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	exec(root, "CREATE DATABASE "+name)
	defer exec(root, "DROP DATABASE "+name)
	mc.DBName = name
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	source, err := os.ReadFile("../../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	exec(db, "SET FOREIGN_KEY_CHECKS=0")
	for _, ddl := range regexp.MustCompile("(?ms)^CREATE TABLE IF NOT EXISTS `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(source), -1) {
		exec(db, ddl[0])
	}
	exec(db, "SET FOREIGN_KEY_CHECKS=1")
	db.SetMaxOpenConns(8)
	exec(db, "INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by) VALUES(1,'P1','Project','P1','U1','U1'),(2,'P2','Other','P2','U4','U4')")
	exec(db, "INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(1,'U1','manager','active'),(2,'U4','manager','active')")
	var port int
	if err = root.QueryRow("SELECT @@port").Scan(&port); err != nil {
		t.Fatal(err)
	}
	secret := uuid.NewString()
	exec(root, "CREATE USER 'hzy_member'@'127.0.0.1' IDENTIFIED BY '"+secret+"'")
	defer exec(root, "DROP USER 'hzy_member'@'127.0.0.1'")
	exec(root, "GRANT ALL ON "+name+".* TO 'hzy_member'@'127.0.0.1'")
	base, err := New(config.AimsConfig{DB: config.DBConfig{Host: "127.0.0.1", Port: port, User: "hzy_member", Password: secret, Database: name}})
	if err != nil {
		t.Fatal(err)
	}
	defer base.DB().Close()
	a := base
	ctx := context.Background()
	var instance string
	if err = db.QueryRow("SELECT @@server_uuid").Scan(&instance); err != nil {
		t.Fatal(err)
	}
	exec(db, "CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(100),environment_code VARCHAR(100),runtime_deployment VARCHAR(100),schema_version VARCHAR(100),generation BIGINT UNSIGNED) ENGINE=InnoDB")
	exec(db, "INSERT INTO enterprise_schema_registry VALUES(1,'T1','test','aims-test','v1',1)")
	tables := map[string]string{}
	for _, ddl := range regexp.MustCompile("(?ms)^CREATE TABLE IF NOT EXISTS `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(source), -1) {
		tables[ddl[1]] = ddl[1]
	}
	binding := e.Binding{Key: e.BindingKey{Tenant: "T1", Environment: "test", RuntimeDeployment: "aims-test"}, Storage: e.Storage{InstanceID: instance, Address: fmt.Sprintf("127.0.0.1:%d", port), Database: name}, SchemaVersion: "v1", Generation: 1, Domains: map[string]e.DomainBinding{"aims": {OwnerDeployment: "aims-test", Tables: tables, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathDisabled}}}
	binding.Domains["workflow"] = e.DomainBinding{OwnerDeployment: "aims-test", Tables: map[string]string{"flow_instances": "flow_instances"}, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathDisabled}
	registry := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return a.DB(), nil })
	if err = registry.Register(ctx, binding); err != nil {
		t.Fatal(err)
	}
	if err = a.ConfigureEnterpriseWrites(ctx, registry, binding, "enterprise-test", "aims-test"); err != nil {
		t.Fatal(err)
	}
	t.Run("R2b quality writes", func(t *testing.T) { testEnterpriseDeliverableQualityMySQL(t, a, db) })
	t.Run("R2a output projection", func(t *testing.T) { testEnterpriseProjectOutputMySQL(t, a, db) })
	t.Run("R1a requirement writes", func(t *testing.T) { testEnterpriseRequirementsMySQL(t, a, db) })
	t.Run("R1c requirement Workflow", func(t *testing.T) { testEnterpriseRequirementsR1cMySQL(t, a, db) })
	t.Run("R1b requirement preparation", func(t *testing.T) { testEnterpriseRequirementsR1bMySQL(t, a, db) })
	t.Run("R3 lifecycle request Workflow binding and callbacks", func(t *testing.T) { testProjectLifecycleWorkflowMySQL(t, a, db) })
	t.Run("PA04 deliverable receipts", func(t *testing.T) { testEnterpriseDeliverableReceiptsMySQL(t, a, db) })
	t.Run("Host timesheet reviews", func(t *testing.T) { testEnterpriseTimeEntryReviewsMySQL(t, a, db) })
	t.Run("PA04 project time receipts", func(t *testing.T) { testEnterpriseProjectTimeReceiptsMySQL(t, a, db) })
	t.Run("PA04 work item time receipts", func(t *testing.T) { testEnterpriseWorkItemTimeReceiptsMySQL(t, a, db) })
	t.Run("PA04 legacy work item receipts", func(t *testing.T) { testEnterpriseLegacyWorkItemReceiptsMySQL(t, a, db) })
	t.Run("PA04 plan receipts", func(t *testing.T) { testEnterprisePlanReceiptsMySQL(t, a, db) })
	t.Run("P6a scoped overview and management boolean", func(t *testing.T) { testProjectOverviewPaginationMySQL(t, a, db) })
	t.Run("Project tab access and own time filtering", func(t *testing.T) { testEnterpriseProjectTabsMySQL(t, a, db) })
	t.Run("PA01 read scope before count and pagination", func(t *testing.T) { testEnterpriseProjectReadScopeMySQL(t, a, db) })
	t.Run("PA01 enterprise work item document link ACL and unlink", func(t *testing.T) { testEnterpriseWorkItemDocumentScopeMySQL(t, a, db) })
	t.Run("PA01 repository comment commit and sync scope", func(t *testing.T) { testEnterpriseGitlabWriteScopeMySQL(t, a, db) })
	t.Run("PA04 repository and GitLab receipts", func(t *testing.T) { testEnterpriseGitlabReceiptsMySQL(t, a, db) })
	t.Run("V2 work item start reset reopen and stale version", func(t *testing.T) {
		exec(db, "INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,lifecycle_status) VALUES(3,'WF3','Workflow','WF3','U1','U1','active')")
		exec(db, "INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(3,'U1','manager','active')")
		exec(db, "INSERT INTO workflow_status_catalog(entity_type,status,is_initial,is_terminal,sort_order) VALUES('matter','todo',1,0,10),('matter','in_progress',0,0,20),('matter','completed',0,1,40)")
		exec(db, "INSERT INTO workflow_transitions(project_id,entity_type,from_status,to_status,transition_key) VALUES(NULL,'matter','todo','in_progress','start'),(NULL,'matter','in_progress','todo','reset'),(NULL,'matter','completed','in_progress','reopen')")
		exec(db, "INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status) VALUES(7000,3,1,'WF3-1','matter','task','Marked test item','todo')")
		version := func() string {
			t.Helper()
			_, v, err := a.EnterpriseWorkItemEditableSnapshot(ctx, "7000")
			if err != nil {
				t.Fatal(err)
			}
			return v
		}
		transition := func(action, key, expected string) error {
			t.Helper()
			id := EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "U1", ServiceClientID: "enterprise.runtime", RequestID: key, IdempotencyKey: key}
			id.CommandScope = &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, Masks: []int{65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
			_, err := a.TransitionEnterpriseWorkItem(ctx, id, "3", "7000", action, map[string]any{"expectedVersion": expected})
			return err
		}
		actions, err := a.EnterpriseWorkItemStateActions(ctx, "7000", "U1", url.Values{})
		if err != nil || len(actions) != 1 || actions[0] != "start" {
			t.Fatalf("initial state actions=%v err=%v", actions, err)
		}
		// A public project remains readable, but its visibility never grants writes.
		for _, action := range []string{"start", "reset", "reopen", "plan-ready"} {
			id := EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "U1", ServiceClientID: "enterprise.runtime", RequestID: "scoped-" + action, IdempotencyKey: "scoped-" + action,
				CommandScope: &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, ProjectCodes: []string{"OTHER"}, Masks: []int{0, 65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}}
			_, err := a.TransitionEnterpriseWorkItem(ctx, id, "3", "7000", action, map[string]any{"expectedVersion": version()})
			var denied httperror.Error
			if !errors.As(err, &denied) || denied.Status != 403 {
				t.Fatalf("outside-scope %s = %v", action, err)
			}
		}
		original := version()
		for _, step := range []struct{ action, key, status string }{{"start", "start-7000", "in_progress"}, {"reset", "reset-7000", "todo"}, {"start", "start-again-7000", "in_progress"}} {
			if err := transition(step.action, step.key, version()); err != nil {
				t.Fatal(err)
			}
			var status string
			if err := db.QueryRow("SELECT status FROM work_items WHERE id=7000").Scan(&status); err != nil || status != step.status {
				t.Fatalf("%s status=%s err=%v", step.action, status, err)
			}
		}
		for _, scope := range []*EnterpriseProjectCommandScope{
			{Projection: projectscope.Projection{Version: 1, Masks: []int{0}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()},
			{Projection: projectscope.Projection{Version: 1, Masks: []int{65535}}, ExpiresAt: time.Now().Add(-time.Second).UnixMilli()},
		} {
			id := EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "U1", ServiceClientID: "enterprise.runtime", RequestID: "start-7000", IdempotencyKey: "start-7000", CommandScope: scope}
			if _, err := a.TransitionEnterpriseWorkItem(ctx, id, "3", "7000", "start", map[string]any{"expectedVersion": original}); err == nil {
				t.Fatal("revoked/expired scope replay returned receipt")
			}
		}
		exec(db, "UPDATE aims_projects SET leader_uid='U3' WHERE id=3")
		exec(db, "UPDATE aims_project_members SET status='suspended' WHERE project_id=3 AND uid='U1'")
		if err := transition("start", "start-7000", original); err == nil {
			t.Fatal("removed member replay accepted")
		}
		exec(db, "UPDATE aims_projects SET leader_uid='U1' WHERE id=3")
		exec(db, "UPDATE aims_project_members SET status='active' WHERE project_id=3 AND uid='U1'")
		var stale httperror.Error
		if err := transition("reset", "stale-7000", original); !errors.As(err, &stale) || stale.Status != 409 || stale.Code != "work_item_version_conflict" {
			t.Fatalf("expected stale version 409, got %v", err)
		}
		exec(db, "UPDATE work_items SET status='completed' WHERE id=7000")
		if err := transition("reopen", "reopen-7000", version()); err != nil {
			t.Fatal(err)
		}
		var status string
		if err := db.QueryRow("SELECT status FROM work_items WHERE id=7000").Scan(&status); err != nil || status != "in_progress" {
			t.Fatalf("reopen status=%s err=%v", status, err)
		}
	})
	t.Run("target plan-ready requires V2 rule and planned fields", func(t *testing.T) {
		exec(db, "INSERT INTO workflow_status_catalog(entity_type,status,is_initial,is_terminal,sort_order) VALUES('target','planning',1,0,10),('target','todo',0,0,20)")
		exec(db, "INSERT INTO workflow_transitions(project_id,entity_type,from_status,to_status,transition_key) VALUES(NULL,'target','planning','todo','decompose')")
		exec(db, "INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status) VALUES(7001,3,2,'WF3-2','target','task','Marked target','planning')")
		version := func() string {
			t.Helper()
			_, value, err := a.EnterpriseWorkItemEditableSnapshot(ctx, "7001")
			if err != nil {
				t.Fatal(err)
			}
			return value
		}
		call := func(key, expected string) error {
			id := EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "U1", ServiceClientID: "enterprise.runtime", RequestID: key, IdempotencyKey: key}
			_, err := a.TransitionEnterpriseWorkItem(ctx, id, "3", "7001", "plan-ready", map[string]any{"expectedVersion": expected})
			return err
		}
		expectConflict := func(key, expected, code string) {
			t.Helper()
			var state httperror.Error
			if err := call(key, expected); !errors.As(err, &state) || state.Status != 409 || state.Code != code {
				t.Fatalf("expected %s 409, got %v", code, err)
			}
		}
		original := version()
		expectConflict("plan-fields-missing", original, "work_item_plan_incomplete")
		exec(db, "UPDATE work_items SET start_date='2026-09-10',due_date='2026-09-20',estimated_hours=8 WHERE id=7001")
		expectConflict("plan-deliverable-missing", version(), "work_item_plan_incomplete")
		exec(db, "INSERT INTO deliverables(id,target_id,project_id,name,created_by,sort_order) VALUES(70011,7001,3,'Result','U1',0)")
		actions, err := a.EnterpriseWorkItemStateActions(ctx, "7001", "U1", url.Values{})
		if err != nil || len(actions) != 1 || actions[0] != "plan-ready" {
			t.Fatalf("plan-ready action=%v err=%v", actions, err)
		}
		unauthorized, err := a.EnterpriseWorkItemStateActions(ctx, "7001", "U2", url.Values{})
		if err != nil || len(unauthorized) != 0 {
			t.Fatalf("unauthorized action=%v err=%v", unauthorized, err)
		}
		expectConflict("plan-stale", original, "work_item_version_conflict")
		if err := call("plan-ready", version()); err != nil {
			t.Fatal(err)
		}
		var status string
		if err := db.QueryRow("SELECT status FROM work_items WHERE id=7001").Scan(&status); err != nil || status != "todo" {
			t.Fatalf("plan-ready status=%s err=%v", status, err)
		}
	})
	t.Run("PA03 static or current manager authorization and revoked replay", func(t *testing.T) {
		exec(db, "INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by) VALUES(930,'PA03','Pilot','PA03','U1','U1')")
		exec(db, "INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(930,'U1','manager','active')")
		update := func(actor, key string, static bool, command map[string]any) (map[string]any, error) {
			id := EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: actor, ServiceClientID: "enterprise.runtime", IdempotencyKey: key, StaticProjectEdit: static}
			if leader := firstBodyText(command, "leaderUid"); leader != "" {
				id.Personnel = []EnterprisePersonnelPermit{{Tenant: "T1", Deployment: "enterprise-test", ActorUID: actor, Resource: "projects", ObjectID: "930", Action: "edit", Field: "leaderUid", UID: leader, Status: "active", ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli()}}
			}
			return a.UpdateEnterpriseProject(ctx, id, "930", command)
		}
		version := func() string {
			_, v, err := a.EnterpriseProjectEditableSnapshot(ctx, "930")
			if err != nil {
				t.Fatal(err)
			}
			return v
		}
		denied := func(err error) {
			var he httperror.Error
			if !errors.As(err, &he) || he.Status != 403 {
				t.Fatalf("expected403 got %v", err)
			}
		}
		_, err := update("U2", "pa03-none", false, map[string]any{"expectedVersion": version(), "description": "denied"})
		denied(err)
		exec(db, "INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(930,'U2','viewer','active')")
		_, err = update("U2", "pa03-viewer", false, map[string]any{"expectedVersion": version(), "description": "denied"})
		denied(err)
		exec(db, "UPDATE aims_project_members SET role='manager' WHERE project_id=930 AND uid='U2'")
		cmd := map[string]any{"expectedVersion": version(), "description": "manager", "leaderUid": "U1"}
		first, err := update("U2", "pa03-manager", false, cmd)
		if err != nil {
			t.Fatal(err)
		}
		replay, err := update("U2", "pa03-manager", false, cmd)
		if err != nil || first["receiptId"] != replay["receiptId"] {
			t.Fatalf("replay %v", err)
		}

		if _, err := update("U2", "pa03-manager-second", false, map[string]any{"expectedVersion": version(), "description": "manager-second", "leaderUid": "U1"}); err != nil {
			t.Fatal("persistent manager second edit", err)
		}
		var managerRole string
		if err := db.QueryRow("SELECT role FROM aims_project_members WHERE project_id=930 AND uid='U2'").Scan(&managerRole); err != nil || managerRole != "manager" {
			t.Fatal("unchanged leader demoted manager", managerRole, err)
		}

		memberIdentity := EnterpriseProjectMemberIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "U2", ServiceClientID: "enterprise.runtime", IdempotencyKey: "pa03-member-add", Personnel: []EnterprisePersonnelPermit{{ActorUID: "U2", Tenant: "T1", Deployment: "enterprise-test", Resource: "project-members", ObjectID: "930", Action: "add", Field: "uid", UID: "U4", Status: "active", ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli()}}}
		if _, err := a.WriteEnterpriseProjectMember(ctx, memberIdentity, "930", "add", map[string]any{"uid": "U4", "role": "viewer"}); err != nil {
			t.Fatal(err)
		}
		exec(db, "UPDATE aims_project_members SET status='suspended' WHERE project_id=930 AND uid='U2'")
		_, err = update("U2", "pa03-manager", false, cmd)
		denied(err)
		_, err = update("U2", "pa03-withdrawn", false, map[string]any{"expectedVersion": version(), "description": "denied"})
		denied(err)
		memberIdentity.Personnel = nil
		memberIdentity.IdempotencyKey = "pa03-member-revoked"
		_, err = a.WriteEnterpriseProjectMember(ctx, memberIdentity, "930", "remove", map[string]any{"uid": "U4"})
		denied(err)
		memberIdentity.StaticProjectEdit = true
		memberIdentity.IdempotencyKey = "pa03-member-static"
		if _, err := a.WriteEnterpriseProjectMember(ctx, memberIdentity, "930", "remove", map[string]any{"uid": "U4"}); err != nil {
			t.Fatal(err)
		}

		// A valid object-scoped static permit allows a non-member; permission facts
		// are never read from the browser input and are verified by the route.
		_, err = update("U2", "pa03-static", true, map[string]any{"expectedVersion": version(), "description": "static"})
		if err != nil {
			t.Fatal(err)
		}
		var leaked int
		db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key IN('pa03-none','pa03-viewer','pa03-withdrawn')").Scan(&leaked)
		if leaked != 0 {
			t.Fatal("denial left receipt")
		}
		change := map[string]any{"expectedVersion": version(), "leaderUid": "U4"}
		changed, err := update("U1", "pa03-leader-change", false, change)
		if err != nil {
			t.Fatal(err)
		}
		var newRole string
		if err := db.QueryRow("SELECT role FROM aims_project_members WHERE project_id=930 AND uid='U4'").Scan(&newRole); err != nil || newRole != "manager" {
			t.Fatal("new leader membership", newRole, err)
		}
		// The former leader keeps the existing ordinary-member disposition.
		if err := db.QueryRow("SELECT role FROM aims_project_members WHERE project_id=930 AND uid='U1'").Scan(&managerRole); err != nil || managerRole != "member" {
			t.Fatal("old leader membership", managerRole, err)
		}
		exec(db, "INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(930,'U5','manager','active')")
		again, err := update("U1", "pa03-leader-change", true, change)
		if err != nil || again["receiptId"] != changed["receiptId"] || again["idempotent"] != true {
			t.Fatal("leader replay", err)
		}
		if err := db.QueryRow("SELECT role FROM aims_project_members WHERE project_id=930 AND uid='U5'").Scan(&managerRole); err != nil || managerRole != "manager" {
			t.Fatal("replay repeated leader synchronization", managerRole, err)
		}

		exec(db, "DELETE FROM aims_project_members WHERE project_id=930 AND uid='U2'")
	})
	t.Run("PA02 access control shares project version receipt and manager gate", func(t *testing.T) {
		version := func() string {
			_, v, err := a.EnterpriseProjectEditableSnapshot(ctx, "930")
			if err != nil {
				t.Fatal(err)
			}
			return v
		}
		update := func(actor, key string, static bool, command map[string]any) (map[string]any, error) {
			id := EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: actor, ServiceClientID: "enterprise.runtime", IdempotencyKey: key, StaticProjectEdit: static}
			return a.UpdateEnterpriseProject(ctx, id, "930", command)
		}
		before, original, err := a.EnterpriseProjectEditableSnapshot(ctx, "930")
		if err != nil || before["accessWhitelist"] != nil {
			t.Fatalf("initial whitelist=%v err=%v", before["accessWhitelist"], err)
		}
		_, err = update("U2", "pa02-non-manager", true, map[string]any{"expectedVersion": original, "securityLevel": "project_team"})
		var denied httperror.Error
		if !errors.As(err, &denied) || denied.Status != 403 {
			t.Fatalf("static non-manager access edit=%v", err)
		}
		_, err = update("U4", "pa02-no-scope", false, map[string]any{"expectedVersion": original, "securityLevel": "project_team"})
		if !errors.As(err, &denied) || denied.Status != 403 {
			t.Fatalf("manager without scoped edit=%v", err)
		}
		command := map[string]any{"expectedVersion": original, "securityLevel": "department", "confidentialityLevel": "L3"}
		first, err := update("U4", "pa02-tighten", true, command)
		if err != nil {
			t.Fatal(err)
		}
		replay, err := update("U4", "pa02-tighten", true, command)
		if err != nil || first["receiptId"] != replay["receiptId"] {
			t.Fatalf("tighten replay=%v", err)
		}
		after, tightened, err := a.EnterpriseProjectEditableSnapshot(ctx, "930")
		if err != nil || after["securityLevel"] != "project_team" || after["confidentialityLevel"] != "L3" || after["accessWhitelist"] != nil || original == tightened {
			t.Fatalf("effective access=%v versionChanged=%v err=%v", after, original != tightened, err)
		}
		_, err = update("U4", "pa02-stale", true, map[string]any{"expectedVersion": original, "description": "stale"})
		var stale httperror.Error
		if !errors.As(err, &stale) || stale.Status != 409 {
			t.Fatalf("access edit did not fence old basic version: %v", err)
		}
		_, err = update("U4", "pa02-whitelist", true, map[string]any{"expectedVersion": tightened, "securityLevel": "whitelist", "accessWhitelist": []any{"U5", "U4", "U5"}})
		if err != nil {
			t.Fatal(err)
		}
		whitelisted, whitelistedVersion, err := a.EnterpriseProjectEditableSnapshot(ctx, "930")
		if err != nil || whitelisted["securityLevel"] != "whitelist" || fmt.Sprint(whitelisted["accessWhitelist"]) != "[U4 U5]" {
			t.Fatalf("whitelist=%v err=%v", whitelisted, err)
		}
		_, err = update("U4", "pa02-preserve", true, map[string]any{"expectedVersion": whitelistedVersion, "description": "preserve whitelist"})
		if err != nil {
			t.Fatal(err)
		}
		preserved, _, err := a.EnterpriseProjectEditableSnapshot(ctx, "930")
		if err != nil || fmt.Sprint(preserved["accessWhitelist"]) != "[U4 U5]" {
			t.Fatalf("patch changed whitelist=%v err=%v", preserved, err)
		}
		exec(db, "UPDATE aims_project_members SET status='suspended' WHERE project_id=930 AND uid='U5'")
		_, err = update("U5", "pa02-revoked", true, map[string]any{"expectedVersion": version(), "securityLevel": "company"})
		if !errors.As(err, &denied) || denied.Status != 403 {
			t.Fatalf("revoked manager access edit=%v", err)
		}
		var receipts int
		if err := db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key IN('pa02-non-manager','pa02-no-scope','pa02-revoked')").Scan(&receipts); err != nil || receipts != 0 {
			t.Fatalf("denied receipt count=%d err=%v", receipts, err)
		}
		exec(db, "UPDATE aims_project_members SET status='active' WHERE project_id=930 AND uid='U5'")
	})
	t.Run("admin project reader and edit use distinct capability and shared receipt", func(t *testing.T) {
		query := map[string]string{"page": "1", "pageSize": "1", "search": "PA03"}
		list, err := a.EnterpriseAdminProjects(ctx, query)
		if err != nil || list["total"] != int64(1) || len(list["items"].([]map[string]any)) != 1 {
			t.Fatalf("admin page=%v err=%v", list, err)
		}
		literal, err := a.EnterpriseAdminProjects(ctx, map[string]string{"search": "%"})
		if err != nil || literal["total"] != int64(0) {
			t.Fatalf("literal wildcard matched=%v err=%v", literal, err)
		}
		_, version, err := a.EnterpriseProjectEditableSnapshot(ctx, "930")
		if err != nil {
			t.Fatal(err)
		}
		id := EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "U9", ServiceClientID: "enterprise.runtime", IdempotencyKey: "admin-project-edit", AdminProject: true}
		command := map[string]any{"expectedVersion": version, "securityLevel": "company", "confidentialityLevel": "L3"}
		first, err := a.UpdateEnterpriseProject(ctx, id, "930", command)
		if err != nil {
			t.Fatal(err)
		}
		replay, err := a.UpdateEnterpriseProject(ctx, id, "930", command)
		if err != nil || first["receiptId"] != replay["receiptId"] {
			t.Fatalf("admin replay=%v err=%v", replay, err)
		}
		var operation, capability, action string
		if err := db.QueryRow("SELECT operation_code,required_capability FROM service_command_receipt WHERE idempotency_key=?", id.IdempotencyKey).Scan(&operation, &capability); err != nil || operation != EnterpriseAdminProjectUpdateOperation || capability != EnterpriseAdminProjectUpdateCapability {
			t.Fatalf("receipt=%s/%s err=%v", operation, capability, err)
		}
		if err := db.QueryRow("SELECT action FROM project_activity_logs WHERE project_id=930 AND request_id=?", id.IdempotencyKey).Scan(&action); err != nil || action != "admin-edit" {
			t.Fatalf("audit=%s err=%v", action, err)
		}
		_, next, err := a.EnterpriseProjectEditableSnapshot(ctx, "930")
		if err != nil {
			t.Fatal(err)
		}
		if next == version {
			t.Fatal("admin edit did not advance version")
		}
		id.IdempotencyKey = "admin-stale"
		if _, err := a.UpdateEnterpriseProject(ctx, id, "930", map[string]any{"expectedVersion": version, "description": "stale"}); err == nil {
			t.Fatal("stale version accepted")
		}
	})
	identity := EnterpriseProjectMemberIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "U1", ServiceClientID: "enterprise.runtime", RequestID: "r1", IdempotencyKey: "add-key"}
	personnel := func(field, uid, resource, object, action string) []EnterprisePersonnelPermit {
		status := "active"
		if uid == "U3" {
			status = "inactive"
		}
		return []EnterprisePersonnelPermit{{Tenant: "T1", Deployment: "enterprise-test", ActorUID: "U1", Resource: resource, ObjectID: object, Action: action, Field: field, UID: uid, Status: status, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli()}}
	}
	call := func(id EnterpriseProjectMemberIdentity, p, action, uid, role string) (map[string]any, error) {
		if action != "remove" {
			id.Personnel = personnel("uid", uid, "project-members", p, action)
		} else {
			id.Personnel = nil
		}
		return a.WriteEnterpriseProjectMember(ctx, id, p, action, map[string]any{"uid": uid, "role": role})
	}
	t.Run("enterprise writes reject missing readonly and stale registry writers", func(t *testing.T) {
		original := a.enterpriseWrites
		id := identity
		id.IdempotencyKey = "fence-reject"
		base := EnterpriseProjectCreateIdentity{Tenant: id.Tenant, SourceDeployment: id.SourceDeployment, TargetDeployment: id.TargetDeployment, ActorUID: id.ActorUID, ServiceClientID: id.ServiceClientID, RequestID: id.RequestID, IdempotencyKey: id.IdempotencyKey}
		base.Personnel = personnel("leaderUid", "U1", "projects", "new", "create")
		_, projectVersion, err := a.EnterpriseProjectEditableSnapshot(ctx, "1")
		if err != nil {
			t.Fatal(err)
		}
		check := func() {
			t.Helper()
			if _, err := call(id, "1", "add", "U2", "member"); err == nil {
				t.Fatal("unfenced member write accepted")
			}
			if _, err := a.CreateEnterpriseProject(ctx, base, map[string]any{"name": "X", "leaderUid": "U1"}); err == nil {
				t.Fatal("unfenced create accepted")
			}
			if _, err := a.WriteEnterpriseWorkItem(ctx, id, "1", "", "create", map[string]any{"title": "X"}); err == nil {
				t.Fatal("unfenced work item accepted")
			}
			if _, err := a.UpdateEnterpriseProject(ctx, id, "1", map[string]any{"expectedVersion": projectVersion, "name": "Unfenced"}); err == nil {
				t.Fatal("unfenced project edit accepted")
			}
		}
		a.enterpriseWrites = nil
		check()
		a.enterpriseWrites = original
		for _, mutate := range []func(*EnterpriseProjectMemberIdentity){func(v *EnterpriseProjectMemberIdentity) { v.Tenant = "T2" }, func(v *EnterpriseProjectMemberIdentity) { v.SourceDeployment = "other-enterprise" }, func(v *EnterpriseProjectMemberIdentity) { v.TargetDeployment = "other-runtime" }} {
			bad := id
			mutate(&bad)
			if _, err := call(bad, "1", "add", "U2", "member"); err == nil {
				t.Fatal("cross-bound writer accepted")
			}
		}
		exec(db, "UPDATE enterprise_schema_registry SET generation=2 WHERE id=1")
		check()
		exec(db, "UPDATE enterprise_schema_registry SET generation=1 WHERE id=1")
		readonly := binding
		readonly.Domains = map[string]e.DomainBinding{"aims": binding.Domains["aims"]}
		d := readonly.Domains["aims"]
		d.Write = e.PathDisabled
		readonly.Domains["aims"] = d
		r := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return a.DB(), nil })
		if err := r.Register(ctx, readonly); err != nil {
			t.Fatal(err)
		}
		if err := a.ConfigureEnterpriseWrites(ctx, r, readonly, "enterprise-test"); err != nil {
			t.Fatal(err)
		}
		check()
		a.enterpriseWrites = original
		var count int
		db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key='fence-reject'").Scan(&count)
		if count != 0 {
			t.Fatal("fence rejection wrote receipt")
		}
	})
	t.Run("registry fenced project creation freezes response-loss replay", func(t *testing.T) {
		id := EnterpriseProjectCreateIdentity{Tenant: identity.Tenant, SourceDeployment: identity.SourceDeployment, TargetDeployment: identity.TargetDeployment, ActorUID: identity.ActorUID, ServiceClientID: identity.ServiceClientID, RequestID: identity.RequestID, IdempotencyKey: "fenced-project-create"}
		id.ProjectCode = "NEW-1"
		id.CreateScope = &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, Masks: []int{1}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
		id.Personnel = personnel("leaderUid", "U1", "projects", "new", "create")
		body := map[string]any{"projectCode": "NEW-1", "name": "New project", "shortName": "NEW", "leaderUid": "U1", "category": "routine"}
		first, err := a.CreateEnterpriseProject(ctx, id, body)
		if err != nil {
			t.Fatal(err)
		}
		replay, err := a.CreateEnterpriseProject(ctx, id, body)
		if err != nil || first["receiptId"] != replay["receiptId"] {
			t.Fatal("fenced create replay", err)
		}
		revoked := id
		revoked.CreateScope = &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, Masks: []int{0}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
		if _, err := a.CreateEnterpriseProject(ctx, revoked, body); err == nil {
			t.Fatal("revoked scope replayed project creation")
		}
		var count int
		db.QueryRow("SELECT COUNT(*) FROM aims_projects WHERE project_code='NEW-1'").Scan(&count)
		if count != 1 {
			t.Fatal("fenced creation duplicated", count)
		}
	})
	first, err := call(identity, "1", "add", "U2", "member")
	if err != nil {
		t.Fatal(err)
	}
	again, err := call(identity, "1", "add", "U2", "member")
	if err != nil || first["receiptId"] != again["receiptId"] {
		t.Fatal("retry did not replay", err)
	}
	if _, err = call(identity, "1", "add", "U2", "manager"); err == nil {
		t.Fatal("same key different payload accepted")
	}
	for _, c := range []struct{ project, action, uid, role string }{{"2", "add", "U2", "member"}, {"1", "add", "U3", "member"}, {"1", "remove", "U1", ""}, {"1", "role", "U1", "member"}} {
		id := identity
		id.IdempotencyKey = uuid.NewString()
		if _, err = call(id, c.project, c.action, c.uid, c.role); err == nil {
			t.Fatalf("invalid write accepted %+v", c)
		}
	}
	exec(db, "DROP TABLE project_activity_logs")
	id := identity
	id.IdempotencyKey = "audit-failure"
	if _, err = call(id, "1", "role", "U2", "manager"); err == nil {
		t.Fatal("audit failure accepted")
	}
	var role string
	if err = db.QueryRow("SELECT role FROM aims_project_members WHERE project_id=1 AND uid='U2'").Scan(&role); err != nil || role != "member" {
		t.Fatal("audit failure leaked mutation", role, err)
	}
	var receipts int
	db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key='audit-failure'").Scan(&receipts)
	if receipts != 0 {
		t.Fatal("audit failure leaked receipt")
	}
	migration, _ := os.ReadFile("../../../../aims/docs/migration_v5.38_project_activity_logs.sql")
	exec(db, string(migration))
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			id := identity
			id.IdempotencyKey = uuid.NewString()
			_, e := call(id, "1", "add", "U4", "member")
			results <- e
		}()
	}
	wg.Wait()
	close(results)
	success := 0
	for e := range results {
		if e == nil {
			success++
		} else {
			var he httperror.Error
			if !errors.As(e, &he) || he.Status != 409 || he.Code != "project_member_exists" {
				t.Fatal("concurrent duplicate add failed outside conflict contract", e)
			}
		}
	}
	if success != 1 {
		t.Fatalf("concurrent duplicate add successes=%d", success)
	}
	t.Run("work item version associations preserve project binding revisions and receipts", func(t *testing.T) {
		exec(db, "INSERT INTO product_versions(id,product_code,version_code,status) VALUES(101,'PROD1','v1','planning'),(102,'PROD1','v2','developing'),(103,'OTHER','v1','planning')")
		exec(db, "INSERT INTO aims_project_products(project_id,product_code) VALUES(1,'PROD1')")
		exec(db, "INSERT INTO product_version_features(id,version_id,title) VALUES(101,101,'Feature1'),(102,102,'Feature2')")
		exec(db, "INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status) VALUES(101,1,101,'P1-101','target','requirement','Target','planning')")
		_, version, err := a.EnterpriseWorkItemEditableSnapshot(ctx, "101")
		if err != nil {
			t.Fatal(err)
		}
		options, err := a.EnterpriseWorkItemAssociationOptions(ctx, "101", "U1")
		if err != nil || len(options) != 2 {
			t.Fatal("range-scoped choices", options, err)
		}
		if _, err = a.EnterpriseWorkItemAssociationOptions(ctx, "101", "U3"); err == nil {
			t.Fatal("non-member choices accepted")
		}
		id := identity
		id.IdempotencyKey = "associate-v1"
		id.CommandScope = &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, Masks: []int{65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
		body := map[string]any{"expectedVersion": version, "versionId": float64(101), "featureId": float64(101)}
		out, err := a.WriteEnterpriseWorkItem(ctx, id, "1", "101", "associate", body)
		if err != nil {
			t.Fatal(err)
		}
		replay, err := a.WriteEnterpriseWorkItem(ctx, id, "1", "101", "associate", body)
		if err != nil || out["receiptId"] != replay["receiptId"] {
			t.Fatal("association replay", err)
		}
		if _, err = a.WriteEnterpriseWorkItem(ctx, id, "1", "101", "associate", map[string]any{"expectedVersion": version, "versionId": float64(102)}); err == nil {
			t.Fatal("same association key different payload accepted")
		}
		var revision int
		if err = db.QueryRow("SELECT scope_revision FROM product_versions WHERE id=101").Scan(&revision); err != nil || revision != 2 {
			t.Fatal("repeat association advanced scope", revision, err)
		}
		_, current, err := a.EnterpriseWorkItemEditableSnapshot(ctx, "101")
		if err != nil {
			t.Fatal(err)
		}
		for _, bad := range []map[string]any{{"expectedVersion": version, "versionId": float64(102)}, {"expectedVersion": current, "versionId": float64(103)}, {"expectedVersion": current, "versionId": float64(102), "featureId": float64(101)}} {
			id.IdempotencyKey = uuid.NewString()
			if _, err = a.WriteEnterpriseWorkItem(ctx, id, "1", "101", "associate", bad); err == nil {
				t.Fatal("invalid association accepted", bad)
			}
		}
		id.IdempotencyKey = "associate-v2"
		if _, err = a.WriteEnterpriseWorkItem(ctx, id, "1", "101", "associate", map[string]any{"expectedVersion": current, "versionId": float64(102), "featureId": float64(102)}); err != nil {
			t.Fatal(err)
		}
		if err = db.QueryRow("SELECT scope_revision FROM product_versions WHERE id=101").Scan(&revision); err != nil || revision != 3 {
			t.Fatal("source scope not revised", revision, err)
		}
		if err = db.QueryRow("SELECT scope_revision FROM product_versions WHERE id=102").Scan(&revision); err != nil || revision != 2 {
			t.Fatal("target scope not revised", revision, err)
		}
		_, err = a.detachVersionItemTransaction(ctx, 1, 101, 101)
		var relationErr httperror.Error
		if !errors.As(err, &relationErr) || relationErr.Status != 409 || relationErr.Code != "relation_changed" {
			t.Fatal("changed version relation did not return 409", err)
		}
		_, err = a.detachVersionItemTransaction(ctx, 1, 101, 999999)
		if !errors.As(err, &relationErr) || relationErr.Status != 404 {
			t.Fatal("missing version work item did not return 404", err)
		}
		_, current, err = a.EnterpriseWorkItemEditableSnapshot(ctx, "101")
		if err != nil {
			t.Fatal(err)
		}
		exec(db, "DROP TABLE project_activity_logs")
		id.IdempotencyKey = "association-audit-failure"
		if _, err = a.WriteEnterpriseWorkItem(ctx, id, "1", "101", "associate", map[string]any{"expectedVersion": current, "versionId": float64(101)}); err == nil {
			t.Fatal("association audit failure accepted")
		}
		var bound int
		db.QueryRow("SELECT version_id FROM work_items WHERE id=101").Scan(&bound)
		if bound != 102 {
			t.Fatal("audit failure leaked version association", bound)
		}
		db.QueryRow("SELECT scope_revision FROM product_versions WHERE id=101").Scan(&revision)
		if revision != 3 {
			t.Fatal("audit failure leaked source scope", revision)
		}
		var count int
		db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key='association-audit-failure'").Scan(&count)
		if count != 0 {
			t.Fatal("audit failure leaked association receipt")
		}
		migration, _ := os.ReadFile("../../../../aims/docs/migration_v5.38_project_activity_logs.sql")
		exec(db, string(migration))
		exec(db, "UPDATE product_versions SET status='released' WHERE id=102")
		id.IdempotencyKey = "associate-detach-released"
		if _, err = a.WriteEnterpriseWorkItem(ctx, id, "1", "101", "associate", map[string]any{"expectedVersion": current, "versionId": nil}); err == nil {
			t.Fatal("released source detached")
		}
	})
	t.Run("work item create and basic edits share receipts audit and concurrency", func(t *testing.T) {
		exec(db, "INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,category,lifecycle_status) VALUES(900,'R3','Routine','R3','U1','U1','routine','active')")
		exec(db, "INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(900,'U1','manager','active')")
		// Counterless legacy project: numbering must continue from existing items.
		exec(db, "INSERT INTO work_items(project_id,item_number,item_key,tier,type,title,status) VALUES(900,7,'R3-7','matter','task','Existing legacy item','todo')")
		var counterRows int
		if err := db.QueryRow("SELECT COUNT(*) FROM project_counters WHERE project_id=900").Scan(&counterRows); err != nil || counterRows != 0 {
			t.Fatalf("work-item fixture must have no counter: %d %v", counterRows, err)
		}
		id := identity
		id.IdempotencyKey = "work-create"
		id.CommandScope = &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, ProjectCodes: []string{"R3"}, Masks: []int{0, 65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
		id.Personnel = personnel("assigneeUid", "U1", "work_items", "project:900", "create")
		command := map[string]any{"title": "Task", "assigneeUid": "U1"}
		out, err := a.WriteEnterpriseWorkItem(ctx, id, "900", "", "create", command)
		if err != nil {
			t.Fatal(err)
		}
		replay, err := a.WriteEnterpriseWorkItem(ctx, id, "900", "", "create", command)
		if err != nil || out["receiptId"] != replay["receiptId"] {
			t.Fatal("create replay failed", err)
		}
		result, ok := out["result"].(map[string]any)
		if !ok {
			t.Fatalf("unexpected result %T", out["result"])
		}
		wid := fmt.Sprint(result["id"])
		var itemNumber, counter int64
		if err := db.QueryRow("SELECT item_number FROM work_items WHERE id=?", wid).Scan(&itemNumber); err != nil || itemNumber != 8 {
			t.Fatalf("counterless work-item create must allocate MAX+1: %d %v", itemNumber, err)
		}
		if err := db.QueryRow("SELECT counter FROM project_counters WHERE project_id=900").Scan(&counter); err != nil || counter != 8 {
			t.Fatalf("work-item replay must not increment counter: %d %v", counter, err)
		}
		// Public/company visibility never widens the action-specific write projection.
		denied := id
		denied.CommandScope = &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, ProjectCodes: []string{"OTHER"}, Masks: []int{0, 65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
		denied.IdempotencyKey = "scope-denied-create"
		if _, e := a.WriteEnterpriseWorkItem(ctx, denied, "900", "", "create", command); e == nil {
			t.Fatal("public out-of-scope project accepted write")
		} else {
			var he httperror.Error
			if !errors.As(e, &he) || he.Status != 403 {
				t.Fatal("scope denial must be 403", e)
			}
		}
		var itemCount int
		if e := db.QueryRow("SELECT COUNT(*) FROM work_items WHERE project_id=900").Scan(&itemCount); e != nil || itemCount != 2 {
			t.Fatal("scope denial leaked work item", e, itemCount)
		}
		var receiptCount int
		if err := db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key='scope-denied-create'").Scan(&receiptCount); err != nil || receiptCount != 0 {
			t.Fatal("denied scope left receipt", err, receiptCount)
		}
		// Recheck current membership before retrieving the existing successful receipt.
		replayID := id
		replayID.CommandScope = &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, Masks: []int{43690}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
		exec(db, "UPDATE aims_project_members SET status='suspended' WHERE project_id=900 AND uid='U1'")
		if _, e := a.WriteEnterpriseWorkItem(ctx, replayID, "900", "", "create", command); e == nil {
			t.Fatal("revoked scope replay returned old success")
		} else {
			var he httperror.Error
			if !errors.As(e, &he) || he.Status != 403 {
				t.Fatal("revoked replay must be 403", e)
			}
		}
		exec(db, "UPDATE aims_project_members SET status='active' WHERE project_id=900 AND uid='U1'")
		expired := id
		expired.CommandScope = &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, Masks: []int{65535}}, ExpiresAt: time.Now().Add(-time.Second).UnixMilli()}
		if _, e := a.WriteEnterpriseWorkItem(ctx, expired, "900", "", "create", command); e == nil {
			t.Fatal("expired scope returned replay")
		} else {
			var he httperror.Error
			if !errors.As(e, &he) || he.Status != 403 {
				t.Fatal("expired replay must be 403", e)
			}
		}

		_, version, err := a.EnterpriseWorkItemEditableSnapshot(ctx, wid)
		if err != nil {
			t.Fatal(err)
		}

		scopedEdit := id
		scopedEdit.Personnel = nil
		scopedEdit.IdempotencyKey = "scope-edit"
		edited, e := a.WriteEnterpriseWorkItem(ctx, scopedEdit, "900", wid, "edit", map[string]any{"expectedVersion": version, "title": "ScopedTask"})
		if e != nil || edited["receiptId"] == nil {
			t.Fatal("scoped edit failed", e)
		}
		_, version, e = a.EnterpriseWorkItemEditableSnapshot(ctx, wid)
		if e != nil {
			t.Fatal(e)
		}
		cross := scopedEdit
		cross.CommandScope = &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, Masks: []int{65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
		cross.IdempotencyKey = "scope-cross-project"
		if _, e := a.WriteEnterpriseWorkItem(ctx, cross, "1", wid, "edit", map[string]any{"expectedVersion": version, "title": "MustNotWrite"}); e == nil {
			t.Fatal("cross-project object accepted")
		} else {
			var he httperror.Error
			if !errors.As(e, &he) || he.Status != 403 {
				t.Fatal("cross project must be 403", e)
			}
		}
		for _, c := range []struct {
			project, action string
			body            map[string]any
		}{{"2", "edit", map[string]any{"expectedVersion": version, "title": "Other"}}, {"900", "edit", map[string]any{"expectedVersion": version, "status": "completed"}}, {"900", "create", map[string]any{"title": "Invalid", "assigneeUid": "U3"}}} {
			identity := identity
			identity.IdempotencyKey = uuid.NewString()
			if _, err = a.WriteEnterpriseWorkItem(ctx, identity, c.project, wid, c.action, c.body); err == nil {
				t.Fatal("invalid work item write accepted", c)
			}
		}
		var wg sync.WaitGroup
		results := make(chan error, 2)
		for _, title := range []string{"TaskA", "TaskB"} {
			wg.Add(1)
			go func(title string) {
				defer wg.Done()
				id := identity
				id.IdempotencyKey = uuid.NewString()
				_, e := a.WriteEnterpriseWorkItem(ctx, id, "900", wid, "edit", map[string]any{"expectedVersion": version, "title": title})
				results <- e
			}(title)
		}
		wg.Wait()
		close(results)
		success, conflicts := 0, 0
		for e := range results {
			if e == nil {
				success++
			} else {
				var he httperror.Error
				if errors.As(e, &he) && he.Status == 409 && he.Code == "work_item_version_conflict" {
					conflicts++
				} else {
					t.Fatal(e)
				}
			}
		}
		if success != 1 || conflicts != 1 {
			t.Fatal("work item stale content version not protected", success, conflicts)
		}
		before, current, err := a.EnterpriseWorkItemEditableSnapshot(ctx, wid)
		if err != nil {
			t.Fatal(err)
		}
		exec(db, "DROP TABLE project_activity_logs")
		id.IdempotencyKey = "work-audit-failure"
		if _, err = a.WriteEnterpriseWorkItem(ctx, id, "900", wid, "edit", map[string]any{"expectedVersion": current, "title": "LeakedTask"}); err == nil {
			t.Fatal("work item audit failure accepted")
		}
		after, _, err := a.EnterpriseWorkItemEditableSnapshot(ctx, wid)
		if err != nil || after["title"] != before["title"] {
			t.Fatal("work item audit failure leaked mutation", err)
		}
		var count int
		db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key='work-audit-failure'").Scan(&count)
		if count != 0 {
			t.Fatal("work item audit failure leaked receipt")
		}
		exec(db, string(migration))
	})
	t.Run("work item completion reliable source contract", func(t *testing.T) { testEnterpriseWorkItemCompletionMySQL(t, ctx, db, a, identity) })
	t.Run("project edits reject same-second stale versions and roll back audit failure", func(t *testing.T) {
		exec(db, "CREATE TRIGGER project_fixed_second BEFORE UPDATE ON aims_projects FOR EACH ROW SET NEW.updated_at='2026-01-01 00:00:00'")
		_, version, err := a.EnterpriseProjectEditableSnapshot(ctx, "1")
		if err != nil {
			t.Fatal(err)
		}
		results := make(chan error, 2)
		var wg sync.WaitGroup
		for _, name := range []string{"ProjectA", "ProjectB"} {
			wg.Add(1)
			go func(name string) {
				defer wg.Done()
				id := identity
				id.IdempotencyKey = uuid.NewString()
				_, e := a.UpdateEnterpriseProject(ctx, id, "1", map[string]any{"expectedVersion": version, "name": name})
				results <- e
			}(name)
		}
		wg.Wait()
		close(results)
		success, conflicts := 0, 0
		for e := range results {
			if e == nil {
				success++
			} else {
				var he httperror.Error
				if errors.As(e, &he) && he.Status == 409 && he.Code == "project_version_conflict" {
					conflicts++
				} else {
					t.Fatal(e)
				}
			}
		}
		if success != 1 || conflicts != 1 {
			t.Fatalf("same-second outcomes success=%d conflicts=%d", success, conflicts)
		}
		before, current, err := a.EnterpriseProjectEditableSnapshot(ctx, "1")
		if err != nil {
			t.Fatal(err)
		}
		id := identity
		id.IdempotencyKey = "edit-retry"
		command := map[string]any{"expectedVersion": current, "name": "FinalProject"}
		first, err := a.UpdateEnterpriseProject(ctx, id, "1", command)
		if err != nil {
			t.Fatal(err)
		}
		replay, err := a.UpdateEnterpriseProject(ctx, id, "1", command)
		if err != nil || first["receiptId"] != replay["receiptId"] {
			t.Fatal("edit replay failed", err)
		}
		_, current, err = a.EnterpriseProjectEditableSnapshot(ctx, "1")
		if err != nil {
			t.Fatal(err)
		}
		exec(db, "DROP TABLE project_activity_logs")
		id.IdempotencyKey = "edit-audit-failure"
		if _, err = a.UpdateEnterpriseProject(ctx, id, "1", map[string]any{"expectedVersion": current, "name": "LeakedProject"}); err == nil {
			t.Fatal("audit failure accepted")
		}
		after, _, err := a.EnterpriseProjectEditableSnapshot(ctx, "1")
		if err != nil || after["name"] != "FinalProject" {
			t.Fatal("audit failure leaked edit", before, after, err)
		}
		var n int
		db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key='edit-audit-failure'").Scan(&n)
		if n != 0 {
			t.Fatal("audit failure leaked edit receipt")
		}
	})
	t.Run("work item task distribution confirm and revoke are fenced receipts with audit", func(t *testing.T) {
		// Earlier subtests exercise audit failure by dropping the activity log;
		// restore it from its real migration when it is missing.
		var auditTables int
		if err := db.QueryRow("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='project_activity_logs'").Scan(&auditTables); err != nil {
			t.Fatal(err)
		}
		if auditTables == 0 {
			migration, err := os.ReadFile("../../../../aims/docs/migration_v5.38_project_activity_logs.sql")
			if err != nil {
				t.Fatal(err)
			}
			exec(db, string(migration))
		}
		exec(db, "INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,lifecycle_status) VALUES(910,'D1','Distribution','D1','U1','U1','active')")
		exec(db, "INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(910,'U1','manager','active'),(910,'U2','member','active'),(910,'U5','manager','active')")
		exec(db, "INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status) VALUES(9100,910,1,'D1-1','target','task','Target','planning'),(9101,910,2,'D1-1-1','matter','task','Child A','planning'),(9102,910,3,'D1-1-2','matter','task','Child B','planning'),(9110,910,4,'D1-2','target','requirement','Requirement','planning'),(9111,910,5,'D1-2-1','matter','task','Requirement child','planning')")
		exec(db, "UPDATE work_items SET parent_id=9100 WHERE id IN (9101,9102)")
		exec(db, "UPDATE work_items SET parent_id=9110 WHERE id=9111")
		update := func(actor, key string) EnterpriseProjectUpdateIdentity {
			return EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: actor, ServiceClientID: "enterprise.runtime", RequestID: "distribution", IdempotencyKey: key}
		}
		scoped := func(actor, key, projectCode string) EnterpriseProjectUpdateIdentity {
			id := update(actor, key)
			id.CommandScope = &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, ProjectCodes: []string{projectCode}, Masks: []int{0, 65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
			return id
		}
		children := func() string {
			t.Helper()
			var statuses string
			if err := db.QueryRow("SELECT GROUP_CONCAT(status ORDER BY id) FROM work_items WHERE parent_id=9100").Scan(&statuses); err != nil {
				t.Fatal(err)
			}
			return statuses
		}
		expectCode := func(err error, status int, code string) {
			t.Helper()
			var he httperror.Error
			if !errors.As(err, &he) || he.Status != status || he.Code != code {
				t.Fatalf("expected %d %s, got %v", status, code, err)
			}
		}
		version := func(id string) string {
			t.Helper()
			_, current, err := a.EnterpriseWorkItemEditableSnapshot(ctx, id)
			if err != nil {
				t.Fatal(err)
			}
			return current
		}

		_, err := a.DistributeEnterpriseWorkItem(ctx, update("U1", "distribution-stale"), "910", "9100", "confirm-distribute", map[string]any{"expectedVersion": strings.Repeat("0", 64)})
		expectCode(err, 409, "work_item_version_conflict")
		_, err = a.DistributeEnterpriseWorkItem(ctx, update("U1", "distribution-requirement"), "910", "9110", "confirm-distribute", map[string]any{"expectedVersion": version("9110")})
		expectCode(err, 409, "requirement_flow")
		if children() != "planning,planning" {
			t.Fatal("rejected confirmations changed children", children())
		}

		confirm := map[string]any{"expectedVersion": version("9100")}
		_, err = a.DistributeEnterpriseWorkItem(ctx, scoped("U1", "distribution-confirm", "OTHER"), "910", "9100", "confirm-distribute", confirm)
		expectCode(err, 403, "enterprise_project_command_scope_denied")
		if children() != "planning,planning" {
			t.Fatal("scope denial changed children", children())
		}
		var deniedReceipts int
		if err := db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key='distribution-confirm'").Scan(&deniedReceipts); err != nil || deniedReceipts != 0 {
			t.Fatal("scope denial created a receipt", deniedReceipts, err)
		}
		out, err := a.DistributeEnterpriseWorkItem(ctx, scoped("U1", "distribution-confirm", "D1"), "910", "9100", "confirm-distribute", confirm)
		if err != nil {
			t.Fatal(err)
		}
		if children() != "todo,todo" {
			t.Fatal("confirm did not move planned children to todo", children())
		}
		_, err = a.DistributeEnterpriseWorkItem(ctx, scoped("U1", "distribution-confirm", "OTHER"), "910", "9100", "confirm-distribute", confirm)
		expectCode(err, 403, "enterprise_project_command_scope_denied")
		replay, err := a.DistributeEnterpriseWorkItem(ctx, scoped("U1", "distribution-confirm", "D1"), "910", "9100", "confirm-distribute", confirm)
		if err != nil || replay["receiptId"] != out["receiptId"] || replay["idempotent"] != true {
			t.Fatal("confirm replay did not return the frozen receipt", replay, err)
		}
		if _, err = a.DistributeEnterpriseWorkItem(ctx, update("U1", "distribution-confirm"), "910", "9100", "revoke-distribute", map[string]any{"expectedVersion": version("9100")}); err == nil {
			t.Fatal("same idempotency key with another action accepted")
		}
		var logged int
		if err = db.QueryRow("SELECT COUNT(*) FROM work_item_changelog WHERE work_item_id IN (9101,9102) AND field_name='status' AND old_value='planning' AND new_value='todo' AND changed_by='U1'").Scan(&logged); err != nil || logged != 2 {
			t.Fatal("child changelog missing", logged, err)
		}
		if err = db.QueryRow("SELECT COUNT(*) FROM project_activity_logs WHERE project_id=910 AND object_code='9100' AND action='confirm-distribute'").Scan(&logged); err != nil || logged != 1 {
			t.Fatal("distribution activity log missing", logged, err)
		}
		_, err = a.DistributeEnterpriseWorkItem(ctx, update("U1", "distribution-confirm-again"), "910", "9100", "confirm-distribute", map[string]any{"expectedVersion": version("9100")})
		expectCode(err, 409, "children_locked")

		_, err = a.DistributeEnterpriseWorkItem(ctx, update("U2", "distribution-revoke-member"), "910", "9100", "revoke-distribute", map[string]any{"expectedVersion": version("9100")})
		expectCode(err, 403, "work_item_distribution_manager_required")
		if children() != "todo,todo" {
			t.Fatal("unauthorized revoke changed children", children())
		}

		exec(db, "CREATE TRIGGER distribution_audit_failure BEFORE INSERT ON project_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit rejected'")
		if _, err = a.DistributeEnterpriseWorkItem(ctx, update("U1", "distribution-revoke-audit-failure"), "910", "9100", "revoke-distribute", map[string]any{"expectedVersion": version("9100")}); err == nil {
			t.Fatal("revoke succeeded although audit failed")
		}
		exec(db, "DROP TRIGGER distribution_audit_failure")
		var receipts int
		if err = db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key='distribution-revoke-audit-failure'").Scan(&receipts); err != nil || receipts != 0 {
			t.Fatal("audit failure leaked a receipt", receipts, err)
		}
		if children() != "todo,todo" {
			t.Fatal("audit failure leaked child status changes", children())
		}

		if _, err = a.DistributeEnterpriseWorkItem(ctx, update("U1", "distribution-revoke"), "910", "9100", "revoke-distribute", map[string]any{"expectedVersion": version("9100")}); err != nil {
			t.Fatal(err)
		}
		if children() != "planning,planning" {
			t.Fatal("leader revoke did not return children to planning", children())
		}
		// A manager-role project member keeps the legacy right to revoke.
		if _, err = a.DistributeEnterpriseWorkItem(ctx, update("U1", "distribution-confirm-second"), "910", "9100", "confirm-distribute", map[string]any{"expectedVersion": version("9100")}); err != nil {
			t.Fatal(err)
		}
		if _, err = a.DistributeEnterpriseWorkItem(ctx, update("U5", "distribution-revoke-manager"), "910", "9100", "revoke-distribute", map[string]any{"expectedVersion": version("9100")}); err != nil {
			t.Fatal("project manager revoke refused", err)
		}
		if children() != "planning,planning" {
			t.Fatal("manager revoke did not return children to planning", children())
		}

		// Appended tasks: only planned tasks added while the target executes are
		// confirmed or discarded; tasks already executing are never touched.
		exec(db, "INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status) VALUES(9120,910,6,'D1-3','target','task','Executing target','in_progress'),(9121,910,7,'D1-3-1','matter','task','Running task','in_progress'),(9122,910,8,'D1-3-2','matter','task','Appended A','planning'),(9123,910,9,'D1-3-3','matter','task','Appended B','planning')")
		exec(db, "UPDATE work_items SET parent_id=9120 WHERE id IN (9121,9122,9123)")
		appended := func() string {
			t.Helper()
			var statuses string
			if err := db.QueryRow("SELECT COALESCE(GROUP_CONCAT(CONCAT(id,':',status) ORDER BY id),'') FROM work_items WHERE parent_id=9120").Scan(&statuses); err != nil {
				t.Fatal(err)
			}
			return statuses
		}
		if _, err = a.DistributeEnterpriseWorkItem(ctx, update("U1", "append-confirm"), "910", "9120", "confirm-append", map[string]any{"expectedVersion": version("9120")}); err != nil {
			t.Fatal(err)
		}
		if appended() != "9121:in_progress,9122:todo,9123:todo" {
			t.Fatal("confirm-append touched the wrong tasks", appended())
		}
		_, err = a.DistributeEnterpriseWorkItem(ctx, update("U1", "append-confirm-empty"), "910", "9120", "confirm-append", map[string]any{"expectedVersion": version("9120")})
		expectCode(err, 409, "no_planning_children")

		exec(db, "INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status,parent_id) VALUES(9124,910,10,'D1-3-4','matter','task','Appended C','planning',9120)")
		if _, err = a.DistributeEnterpriseWorkItem(ctx, update("U2", "append-reject"), "910", "9120", "reject-append", map[string]any{"expectedVersion": version("9120")}); err != nil {
			t.Fatal(err)
		}
		if appended() != "9121:in_progress,9122:todo,9123:todo" {
			t.Fatal("reject-append removed the wrong tasks", appended())
		}
		if err = db.QueryRow("SELECT COUNT(*) FROM project_activity_logs WHERE project_id=910 AND object_code='9120' AND action='reject-append' AND actor_uid='U2'").Scan(&logged); err != nil || logged != 1 {
			t.Fatal("reject-append audit missing", logged, err)
		}
		empty, err := a.DistributeEnterpriseWorkItem(ctx, update("U1", "append-reject-empty"), "910", "9120", "reject-append", map[string]any{"expectedVersion": version("9120")})
		if err != nil {
			t.Fatal("reject-append without planned tasks failed", err)
		}
		if result, _ := empty["result"].(map[string]any); result["mattersUpdated"] != 0 {
			t.Fatal("reject-append without planned tasks reported changes", empty)
		}

		// Appending tasks to an executing target: manager rule, assignee
		// membership, own deliverables, replay and replacement of drafts.
		exec(db, "INSERT INTO project_counters(project_id,counter) VALUES(910,100)")
		exec(db, "INSERT INTO milestones(id,project_id,name,start_date,end_date,status) VALUES(9130,910,'M1','2026-09-01','2026-12-31','active')")
		exec(db, "INSERT INTO work_items(id,project_id,milestone_id,item_number,item_key,tier,type,title,status,priority,due_date) VALUES(9130,910,9130,11,'D1-4','target','task','Append target','in_progress','P2','2026-12-31')")
		task := func(assignee, title string) any {
			return map[string]any{"assigneeUid": assignee, "title": title, "startDate": "2026-09-10", "dueDate": "2026-09-20", "estimatedHours": float64(8), "deliverables": []any{map[string]any{"name": title + " deliverable"}}}
		}
		appendBody := func(tasks ...any) map[string]any {
			return map[string]any{"expectedVersion": version("9130"), "subtasks": tasks}
		}
		planned := func() (titles string, own int) {
			t.Helper()
			if err := db.QueryRow("SELECT COALESCE(GROUP_CONCAT(title ORDER BY title),'') FROM work_items WHERE parent_id=9130 AND status='planning'").Scan(&titles); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow("SELECT COUNT(*) FROM deliverables d JOIN work_items wi ON wi.id=d.matter_id WHERE wi.parent_id=9130 AND d.target_id IS NULL").Scan(&own); err != nil {
				t.Fatal(err)
			}
			return
		}
		_, err = a.AppendEnterpriseWorkItemTasks(ctx, update("U2", "append-tasks-member"), "910", "9130", appendBody(task("U1", "A")))
		expectCode(err, 403, "work_item_distribution_manager_required")
		_, err = a.AppendEnterpriseWorkItemTasks(ctx, update("U1", "append-tasks-outsider"), "910", "9130", appendBody(task("U9", "A")))
		expectCode(err, 409, "work_item_assignee_not_member")
		if titles, own := planned(); titles != "" || own != 0 {
			t.Fatal("rejected appends wrote tasks", titles, own)
		}
		first := appendBody(task("U1", "A"), task("U5", "B"))
		appended1, err := a.AppendEnterpriseWorkItemTasks(ctx, update("U5", "append-tasks"), "910", "9130", first)
		if err != nil {
			t.Fatal(err)
		}
		if titles, own := planned(); titles != "A,B" || own != 2 {
			t.Fatal("append did not create tasks with their deliverables", titles, own)
		}
		replayed, err := a.AppendEnterpriseWorkItemTasks(ctx, update("U5", "append-tasks"), "910", "9130", first)
		if err != nil || replayed["receiptId"] != appended1["receiptId"] || replayed["idempotent"] != true {
			t.Fatal("append replay did not return the frozen receipt", replayed, err)
		}
		if _, err = a.AppendEnterpriseWorkItemTasks(ctx, update("U1", "append-tasks-second"), "910", "9130", appendBody(task("U5", "C"))); err != nil {
			t.Fatal(err)
		}
		if titles, own := planned(); titles != "C" || own != 1 {
			t.Fatal("second append did not replace the earlier drafts", titles, own)
		}
		if _, err = a.DistributeEnterpriseWorkItem(ctx, update("U1", "append-tasks-confirm"), "910", "9130", "confirm-append", map[string]any{"expectedVersion": version("9130")}); err != nil {
			t.Fatal(err)
		}
		if titles, _ := planned(); titles != "" {
			t.Fatal("confirm-append left appended drafts planned", titles)
		}

		// Saving a breakdown: every target deliverable is claimed exactly once,
		// planned children are updated or removed, and a confirmed distribution
		// locks the breakdown.
		exec(db, "INSERT INTO work_items(id,project_id,milestone_id,item_number,item_key,tier,type,title,status,priority,due_date) VALUES(9140,910,9130,12,'D1-5','target','task','Breakdown target','planning','P2','2026-12-31')")
		exec(db, "INSERT INTO deliverables(id,target_id,name,project_id,created_by,sort_order) VALUES(91401,9140,'Design',910,'U1',0),(91402,9140,'Build',910,'U1',1)")
		claim := func(assignee, title string, childID any, sources ...int64) any {
			deliverables := []any{}
			for _, source := range sources {
				deliverables = append(deliverables, map[string]any{"name": fmt.Sprintf("claim %d", source), "sourceDeliverableId": float64(source)})
			}
			deliverables = append(deliverables, map[string]any{"name": title + " notes"})
			subtask := map[string]any{"assigneeUid": assignee, "title": title, "startDate": "2026-09-10", "dueDate": "2026-09-20", "deliverables": deliverables}
			if childID != nil {
				subtask["id"] = childID
			}
			return subtask
		}
		breakdown := func(tasks ...any) map[string]any {
			return map[string]any{"expectedVersion": version("9140"), "subtasks": tasks}
		}
		breakdownState := func() (childrenState, claims string, own int) {
			t.Helper()
			if err := db.QueryRow("SELECT COALESCE(GROUP_CONCAT(CONCAT(title,':',status) ORDER BY title),'') FROM work_items WHERE parent_id=9140").Scan(&childrenState); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow("SELECT COALESCE(GROUP_CONCAT(CONCAT(d.id,'>',COALESCE(wi.title,'-')) ORDER BY d.id),'') FROM deliverables d LEFT JOIN work_items wi ON wi.id=d.matter_id WHERE d.target_id=9140").Scan(&claims); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow("SELECT COUNT(*) FROM deliverables d JOIN work_items wi ON wi.id=d.matter_id WHERE wi.parent_id=9140 AND d.target_id IS NULL").Scan(&own); err != nil {
				t.Fatal(err)
			}
			return
		}
		// A child with a forged cross-project parent must be rejected as part of
		// the complete child set before the breakdown mutates any task or claim.
		exec(db, "INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,lifecycle_status) VALUES(916,'FOREIGN','Foreign','F','U1','U1','active')")
		exec(db, "INSERT INTO work_items(id,project_id,parent_id,item_number,item_key,tier,type,title,status) VALUES(91499,916,9140,1,'F-1','matter','task','Foreign child','planning')")
		_, err = a.SaveEnterpriseWorkItemBreakdown(ctx, scoped("U1", "breakdown-cross-project-child", "D1"), "910", "9140", breakdown(claim("U1", "A", nil, 91401, 91402)))
		expectCode(err, 409, "work_item_child_project_mismatch")
		if childrenState, claims, own := breakdownState(); childrenState != "Foreign child:planning" || claims != "91401>-,91402>-" || own != 0 {
			t.Fatal("cross-project child denial wrote facts", childrenState, claims, own)
		}
		exec(db, "DELETE FROM work_items WHERE id=91499")
		_, err = a.SaveEnterpriseWorkItemBreakdown(ctx, update("U2", "breakdown-member"), "910", "9140", breakdown(claim("U1", "A", nil, 91401, 91402)))
		expectCode(err, 403, "work_item_distribution_manager_required")
		_, err = a.SaveEnterpriseWorkItemBreakdown(ctx, update("U1", "breakdown-uncovered"), "910", "9140", breakdown(claim("U1", "A", nil, 91401)))
		expectCode(err, 400, "targets_uncovered")
		_, err = a.SaveEnterpriseWorkItemBreakdown(ctx, update("U1", "breakdown-duplicated"), "910", "9140", breakdown(claim("U1", "A", nil, 91401, 91402), claim("U5", "B", nil, 91402)))
		expectCode(err, 400, "targets_duplicated")
		_, err = a.SaveEnterpriseWorkItemBreakdown(ctx, update("U1", "breakdown-foreign-child"), "910", "9140", breakdown(claim("U1", "A", float64(9101), 91401, 91402)))
		expectCode(err, 409, "work_item_breakdown_child_mismatch")
		if childrenState, claims, own := breakdownState(); childrenState != "" || claims != "91401>-,91402>-" || own != 0 {
			t.Fatal("rejected breakdowns wrote facts", childrenState, claims, own)
		}
		firstBreakdown := breakdown(claim("U1", "A", nil, 91401), claim("U5", "B", nil, 91402))
		saved, err := a.SaveEnterpriseWorkItemBreakdown(ctx, update("U5", "breakdown"), "910", "9140", firstBreakdown)
		if err != nil {
			t.Fatal(err)
		}
		if childrenState, claims, own := breakdownState(); childrenState != "A:planning,B:planning" || claims != "91401>A,91402>B" || own != 2 {
			t.Fatal("breakdown did not create claimed tasks", childrenState, claims, own)
		}
		savedAgain, err := a.SaveEnterpriseWorkItemBreakdown(ctx, update("U5", "breakdown"), "910", "9140", firstBreakdown)
		if err != nil || savedAgain["receiptId"] != saved["receiptId"] || savedAgain["idempotent"] != true {
			t.Fatal("breakdown replay did not return the frozen receipt", savedAgain, err)
		}
		var childA int64
		if err = db.QueryRow("SELECT id FROM work_items WHERE parent_id=9140 AND title='A'").Scan(&childA); err != nil {
			t.Fatal(err)
		}
		if _, err = a.SaveEnterpriseWorkItemBreakdown(ctx, update("U1", "breakdown-second"), "910", "9140", breakdown(claim("U1", "A2", float64(childA), 91401, 91402))); err != nil {
			t.Fatal(err)
		}
		if childrenState, claims, own := breakdownState(); childrenState != "A2:planning" || claims != "91401>A2,91402>A2" || own != 1 {
			t.Fatal("second breakdown did not update the kept task and remove the dropped one", childrenState, claims, own)
		}
		if _, err = a.DistributeEnterpriseWorkItem(ctx, update("U1", "breakdown-confirm"), "910", "9140", "confirm-distribute", map[string]any{"expectedVersion": version("9140")}); err != nil {
			t.Fatal(err)
		}
		_, err = a.SaveEnterpriseWorkItemBreakdown(ctx, update("U1", "breakdown-locked"), "910", "9140", breakdown(claim("U1", "A3", float64(childA), 91401, 91402)))
		expectCode(err, 409, "distribution_locked")

		// The unified task distribution page reads this context. The read is
		// member-scoped where the writes above are manager-scoped, carries the
		// claim mapping the page needs, and must not touch business facts.
		t.Run("task distribution context is a member-scoped read carrying claims and the edit version", func(t *testing.T) {
			exec(db, "INSERT INTO project_documents(uuid,work_item_id,title,doc_category,is_folder,created_by) VALUES('11111111-1111-4111-8111-111111111111',9140,'Breakdown note','design',0,'U1')")
			exec(db, "INSERT INTO approval_records(project_id,work_item_owner_id,transition,title,requested_by,status) VALUES(910,9140,'planning→todo','Breakdown review','U1','pending')")
			facts := func() string {
				t.Helper()
				var state string
				if err := db.QueryRow("SELECT CONCAT((SELECT COUNT(*) FROM work_items WHERE project_id=910),':',(SELECT COUNT(*) FROM deliverables WHERE project_id=910),':',(SELECT COALESCE(GROUP_CONCAT(CONCAT(id,'>',COALESCE(matter_id,0)) ORDER BY id),'') FROM deliverables WHERE target_id=9140))").Scan(&state); err != nil {
					t.Fatal(err)
				}
				return state
			}
			before := facts()

			read := func(uid string) (map[string]any, error) {
				query := url.Values{}
				if uid != "" {
					query.Set("current_user", uid)
				}
				return a.workItemBreakdownContext(ctx, "9140", query)
			}
			// A plain project member reads it even though the same member is
			// refused every distribution write.
			out, err := read("U2")
			if err != nil {
				t.Fatal(err)
			}
			item, ok := out["item"].(*breakdownItem)
			if !ok || item.ID != 9140 || item.ProjectID != 910 || item.MilestoneID != 9130 || item.Tier != "target" {
				t.Fatalf("context returned the wrong target: %#v", out["item"])
			}
			var status string
			if err = db.QueryRow("SELECT status FROM work_items WHERE id=9140").Scan(&status); err != nil {
				t.Fatal(err)
			}
			if item.Status != status {
				t.Fatalf("context status %q disagrees with stored %q", item.Status, status)
			}

			// Target requirements keep their claim owner, and the page reads the
			// claim back through sourceDeliverableId on the child's copy.
			current, _ := out["current"].(map[string]any)
			targets, ok := current["deliverables"].([]breakdownDeliverable)
			if !ok || len(targets) != 2 {
				t.Fatalf("expected two target deliverables, got %#v", current["deliverables"])
			}
			for i, expected := range []int64{91401, 91402} {
				if targets[i].ID != expected || targets[i].MatterID == nil || *targets[i].MatterID != childA {
					t.Fatalf("target deliverable %d lost its claim: %#v", expected, targets[i])
				}
				if targets[i].SourceDeliverableID == nil || *targets[i].SourceDeliverableID != expected {
					t.Fatalf("target deliverable %d lost its source mapping: %#v", expected, targets[i])
				}
			}
			children, ok := out["children"].([]breakdownChild)
			if !ok || len(children) != 1 || children[0].ID != childA || children[0].Title != "A2" || children[0].Status != "todo" {
				t.Fatalf("expected the single confirmed child, got %#v", out["children"])
			}
			claimed := 0
			for _, deliverable := range children[0].Deliverables {
				if deliverable.SourceDeliverableID != nil {
					claimed++
				}
			}
			if len(children[0].Deliverables) != 3 || claimed != 2 {
				t.Fatalf("child deliverables lost the claim/own split: %#v", children[0].Deliverables)
			}

			documents, ok := current["documents"].([]breakdownDocument)
			if !ok || len(documents) != 1 || documents[0].Title != "Breakdown note" {
				t.Fatalf("expected the work item document, got %#v", current["documents"])
			}
			pending, ok := out["pendingApproval"].(*breakdownApproval)
			if !ok || pending == nil || pending.Status != "pending" {
				t.Fatalf("expected the pending approval, got %#v", out["pendingApproval"])
			}
			latest, ok := out["latestApproval"].(*breakdownApproval)
			if !ok || latest == nil || latest.ID != pending.ID {
				t.Fatalf("expected the latest approval, got %#v", out["latestApproval"])
			}
			if out["previousArtifacts"] == nil {
				t.Fatal("previous artifacts are missing")
			}

			// The Host composes this read with the editable snapshot version, so
			// repeated reads must agree with it and stay stable.
			first := version("9140")
			if len(first) != 64 {
				t.Fatalf("edit version is not a snapshot hash: %q", first)
			}
			if _, err = read("U1"); err != nil {
				t.Fatal(err)
			}
			if second := version("9140"); second != first {
				t.Fatal("reading the context changed the edit version", first, second)
			}

			// Identity and scope failures, including a member of another project.
			_, err = read("")
			expectCode(err, 401, "missing_current_user")
			_, err = read("U9")
			expectCode(err, 403, "project_member_required")
			_, err = read("U4")
			expectCode(err, 403, "project_member_required")
			_, err = a.workItemBreakdownContext(ctx, "9999", url.Values{"current_user": {"U1"}})
			expectCode(err, 404, "work_item_not_found")

			if after := facts(); after != before {
				t.Fatal("reads changed business facts", before, after)
			}
		})
	})

	t.Run("decomposition and template clone require current owning project scope", func(t *testing.T) {
		exec(db, "INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,lifecycle_status) VALUES(960,'TREE-P','Tree','TP','U1','U1','active')")
		exec(db, "INSERT INTO project_counters(project_id,counter) VALUES(960,2)")
		exec(db, "INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(960,'U1','manager','active')")
		exec(db, "INSERT INTO milestones(id,project_id,name,start_date,end_date,status) VALUES(9600,960,'Tree milestone','2026-09-01','2026-12-31','active')")
		exec(db, "INSERT INTO work_items(id,project_id,milestone_id,item_number,item_key,tier,type,title,status,priority,template_key,review_level) VALUES(9601,960,9600,1,'TP-1','target','task','Clone source','todo','P2','requirement_change',0),(9602,960,9600,2,'TP-2','target','requirement','Decompose source','in_progress','P2','requirement_breakdown',0)")
		scope := func(code string) context.Context {
			id := EnterpriseProjectUpdateIdentity{ActorUID: "U1", CommandScope: &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, ProjectCodes: []string{code}, Masks: []int{0, 65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}}
			return WithEnterpriseProjectCommandScope(ctx, id)
		}
		query := url.Values{"current_user": {"U1"}}
		_, err := a.cloneWorkItemFromTemplate(scope("OTHER"), "9601", query)
		var denied httperror.Error
		if !errors.As(err, &denied) || denied.Status != 403 || denied.Code != "enterprise_project_command_scope_denied" {
			t.Fatalf("clone outside scope was not denied: %v", err)
		}
		var created int
		if err := db.QueryRow("SELECT COUNT(*) FROM work_items WHERE project_id=960 AND id NOT IN (9601,9602)").Scan(&created); err != nil || created != 0 {
			t.Fatalf("denied clone wrote a child: %d %v", created, err)
		}
		payload := map[string]any{"mode": "flat", "sourceDocumentUuid": "11111111-1111-4111-8111-111111111111", "sourceDocumentTitle": "Tree source", "workHours": 0.5,
			"items": []any{map[string]any{"kind": "target_with_tasks", "title": "Derived", "headingAnchor": "section-a", "headingDepth": float64(2),
				"tasks": []any{map[string]any{"title": "Derived task", "sourceAnchors": []any{map[string]any{"headingAnchor": "section-a-1", "headingDepth": float64(3)}}}}}}}
		_, err = a.workItemDecomposeSubmit(scope("OTHER"), "9602", query, payload)
		if !errors.As(err, &denied) || denied.Status != 403 || denied.Code != "enterprise_project_command_scope_denied" {
			t.Fatalf("decompose outside scope was not denied: %v", err)
		}
		if err := db.QueryRow("SELECT COUNT(*) FROM work_items WHERE project_id=960 AND id NOT IN (9601,9602)").Scan(&created); err != nil || created != 0 {
			t.Fatalf("denied decompose wrote a child: %d %v", created, err)
		}
		if _, err := a.cloneWorkItemFromTemplate(scope("TREE-P"), "9601", query); err != nil {
			t.Fatalf("clone with current scope failed: %v", err)
		}
		if _, err := a.workItemDecomposeSubmit(scope("TREE-P"), "9602", query, payload); err != nil {
			t.Fatalf("decompose with current scope failed: %v", err)
		}
		identity := func(key string) context.Context {
			return WithEnterpriseProjectCommandScope(ctx, EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "U1", ServiceClientID: "enterprise.runtime", RequestID: key, IdempotencyKey: key, CommandScope: &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, ProjectCodes: []string{"TREE-P"}, Masks: []int{0, 65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}})
		}
		batchPayload := func(anchor string) map[string]any {
			return map[string]any{"mode": "flat", "sourceDocumentUuid": "11111111-1111-4111-8111-111111111111", "sourceDocumentTitle": "Tree source", "workHours": 0.5, "items": []any{map[string]any{"kind": "target_with_tasks", "title": "Derived " + anchor, "headingAnchor": anchor, "headingDepth": float64(2), "tasks": []any{map[string]any{"title": "Task " + anchor, "sourceAnchors": []any{map[string]any{"headingAnchor": anchor + "-1", "headingDepth": float64(3)}}}}}}}
		}
		execArgs := func(query string, args ...any) {
			if _, err := db.Exec(query, args...); err != nil {
				t.Fatal(err)
			}
		}
		firstPayload := batchPayload("section-b")
		first, err := a.workItemDecomposeSubmit(identity("pa04-c-decompose-1"), "9602", query, firstPayload)
		if err != nil || first["receiptId"] == "" || first["replayed"] != false {
			t.Fatalf("first decomposition=%#v err=%v", first, err)
		}
		firstChildren := first["createdWorkItems"].([]decomposeCreatedWorkItem)
		if len(firstChildren) != 2 {
			t.Fatalf("first children=%#v", firstChildren)
		}
		_, err = a.workItemDecomposeSubmit(identity("pa04-c-decompose-1"), "9602", query, batchPayload("section-d"))
		if !errors.As(err, &denied) || denied.Status != 409 {
			t.Fatalf("changed decomposition payload=%v", err)
		}
		second, err := a.workItemDecomposeSubmit(identity("pa04-c-decompose-2"), "9602", query, batchPayload("section-c"))
		if err != nil || second["replayed"] != false {
			t.Fatalf("second decomposition=%#v err=%v", second, err)
		}
		secondChildren := second["createdWorkItems"].([]decomposeCreatedWorkItem)
		if _, err := db.Exec("DELETE FROM work_items WHERE id=?", firstChildren[1].ID); err != nil {
			t.Fatal(err)
		}
		var beforeReplay int
		if err := db.QueryRow("SELECT COUNT(*) FROM work_items WHERE decomposition_source_id=9602").Scan(&beforeReplay); err != nil {
			t.Fatal(err)
		}
		replayed, err := a.workItemDecomposeSubmit(identity("pa04-c-decompose-1"), "9602", query, firstPayload)
		if err != nil || replayed["replayed"] != true || replayed["timeEntryId"] != first["timeEntryId"] {
			t.Fatalf("replay=%#v err=%v", replayed, err)
		}
		replayedChildren := replayed["createdWorkItems"].([]decomposeCreatedWorkItem)
		if len(replayedChildren) != 1 || replayedChildren[0].ID != firstChildren[0].ID || replayedChildren[0].ID == secondChildren[0].ID {
			t.Fatalf("replay mixed executions: %#v", replayedChildren)
		}
		var afterReplay int
		if err := db.QueryRow("SELECT COUNT(*) FROM work_items WHERE decomposition_source_id=9602").Scan(&afterReplay); err != nil || afterReplay != beforeReplay {
			t.Fatalf("replay wrote children: %d -> %d err=%v", beforeReplay, afterReplay, err)
		}
		execArgs("UPDATE work_items SET milestone_id=NULL,project_id=1 WHERE id=?", firstChildren[0].ID)
		moved, err := a.workItemDecomposeSubmit(identity("pa04-c-decompose-1"), "9602", query, firstPayload)
		if err != nil || len(moved["createdWorkItems"].([]decomposeCreatedWorkItem)) != 0 {
			t.Fatalf("cross-project child leaked in replay=%#v err=%v", moved, err)
		}
		execArgs("UPDATE work_items SET project_id=960,milestone_id=9600 WHERE id=?", firstChildren[0].ID)
		execArgs("UPDATE time_entries SET project_id=1 WHERE id=?", first["timeEntryId"])
		movedTime, err := a.workItemDecomposeSubmit(identity("pa04-c-decompose-1"), "9602", query, firstPayload)
		if err != nil || movedTime["timeEntryId"] != nil {
			t.Fatalf("cross-project time entry leaked in replay=%#v err=%v", movedTime, err)
		}
		execArgs("UPDATE time_entries SET project_id=960 WHERE id=?", first["timeEntryId"])
		var auditID int64
		if err := db.QueryRow("SELECT id FROM project_activity_logs WHERE request_id='pa04-c-decompose-1' AND action='decompose-submit'").Scan(&auditID); err != nil {
			t.Fatal(err)
		}
		execArgs("UPDATE project_activity_logs SET actor_uid='U9' WHERE id=?", auditID)
		_, err = a.workItemDecomposeSubmit(identity("pa04-c-decompose-1"), "9602", query, firstPayload)
		if !errors.As(err, &denied) || denied.Status != 409 || denied.Code != "receipt_result_unavailable" {
			t.Fatalf("tampered audit replay=%v", err)
		}
		execArgs("UPDATE project_activity_logs SET actor_uid='U1' WHERE id=?", auditID)
		var savedChanges []byte
		if err := db.QueryRow("SELECT changes FROM project_activity_logs WHERE id=?", auditID).Scan(&savedChanges); err != nil {
			t.Fatal(err)
		}
		execArgs("UPDATE project_activity_logs SET changes=JSON_OBJECT('broken',1) WHERE id=?", auditID)
		_, err = a.workItemDecomposeSubmit(identity("pa04-c-decompose-1"), "9602", query, firstPayload)
		if !errors.As(err, &denied) || denied.Status != 409 || denied.Code != "receipt_result_unavailable" {
			t.Fatalf("invalid audit changes replay=%v", err)
		}
		execArgs("UPDATE project_activity_logs SET changes=? WHERE id=?", savedChanges, auditID)
		if _, err := db.Exec("UPDATE aims_projects SET leader_uid='U9' WHERE id=960"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec("UPDATE aims_project_members SET role='member' WHERE project_id=960 AND uid='U1'"); err != nil {
			t.Fatal(err)
		}
		_, err = a.workItemDecomposeSubmit(identity("pa04-c-decompose-1"), "9602", query, firstPayload)
		if !errors.As(err, &denied) || denied.Status != 403 {
			t.Fatalf("revoked manager replay=%v", err)
		}
		execArgs("UPDATE aims_projects SET leader_uid='U1' WHERE id=960")
		execArgs("UPDATE aims_project_members SET role='manager' WHERE project_id=960 AND uid='U1'")
		if _, err := db.Exec("DELETE FROM project_activity_logs WHERE id=?", auditID); err != nil {
			t.Fatal(err)
		}
		_, err = a.workItemDecomposeSubmit(identity("pa04-c-decompose-1"), "9602", query, firstPayload)
		if !errors.As(err, &denied) || denied.Status != 409 || denied.Code != "receipt_result_unavailable" {
			t.Fatalf("missing audit replay=%v", err)
		}
		if err := db.QueryRow("SELECT COUNT(*) FROM work_items WHERE decomposition_source_id=9602").Scan(&afterReplay); err != nil || afterReplay != beforeReplay {
			t.Fatalf("missing audit replay mutated children: %d -> %d err=%v", beforeReplay, afterReplay, err)
		}
	})

	t.Run("project product link preserves manager scope and receipt", func(t *testing.T) {
		expectCode := func(err error, status int, code string) {
			t.Helper()
			var he httperror.Error
			if !errors.As(err, &he) || he.Status != status || he.Code != code {
				t.Fatalf("expected %d %s, got %v", status, code, err)
			}
		}
		exec(db, "INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,category,lifecycle_status) VALUES(920,'LINK-P','LinkProject','LP','U1','U1','product_dev','active'),(921,'LINK-R','Routine','LR','U1','U1','routine','active'),(922,'LINK-A','Archived','LA','U1','U1','product_dev','archived'),(923,'LINK-O','Outside','LO','U1','U1','product_dev','active')")
		exec(db, "INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(920,'U1','manager','active'),(921,'U1','manager','active'),(922,'U1','manager','active'),(923,'U1','manager','active')")
		exec(db, "INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('PROD-LINK','00000000-0000-4000-8000-000000000920','U1','U1',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
		exec(db, "INSERT INTO product_members(product_code,uid,relation_type,valid_from,created_by,updated_by,created_at,updated_at) VALUES('PROD-LINK','U1','manager',UTC_TIMESTAMP(3),'U1','U1',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
		facts, err := pc.LoadAuthorizationFacts(ctx, db, "PROD-LINK", "U1")
		if err != nil {
			t.Fatal(err)
		}
		permit := pc.AuthorizationPermit{Resource: "products", Action: "view", Facts: facts, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli()}
		id := EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "U1", ServiceClientID: "enterprise.runtime", RequestID: "link-1", IdempotencyKey: "link-project-product"}
		writeContext := func(scope projectscope.Projection, expiresAt int64) context.Context {
			return WithEnterpriseProjectCommandScope(ctx, EnterpriseProjectUpdateIdentity{ActorUID: "U1", CommandScope: &EnterpriseProjectCommandScope{Projection: scope, ExpiresAt: expiresAt}})
		}
		allowedScope := projectscope.Projection{Version: 1, ProjectCodes: []string{"LINK-P"}, Masks: []int{0, 65535}}
		scopedCtx := writeContext(allowedScope, time.Now().Add(15*time.Second).UnixMilli())
		first, err := a.LinkEnterpriseProjectProduct(scopedCtx, id, "920", "PROD-LINK", permit)
		if err != nil {
			t.Fatal(err)
		}
		replay, err := a.LinkEnterpriseProjectProduct(scopedCtx, id, "920", "PROD-LINK", permit)
		if err != nil || first["receiptId"] != replay["receiptId"] || replay["idempotent"] != true {
			t.Fatalf("replay: %v %#v", err, replay)
		}
		var count int
		if err = db.QueryRow("SELECT COUNT(*) FROM aims_project_products WHERE project_id=920 AND product_code='PROD-LINK'").Scan(&count); err != nil || count != 1 {
			t.Fatalf("duplicate row: %d %v", count, err)
		}
		// A manager of another public/company project is still outside the
		// projects:edit scope. Revocation also blocks an existing receipt.
		id.IdempotencyKey = "outside-scope"
		_, err = a.LinkEnterpriseProjectProduct(scopedCtx, id, "923", "PROD-LINK", permit)
		expectCode(err, 403, "enterprise_project_command_scope_denied")
		id.IdempotencyKey = "link-project-product"
		_, err = a.LinkEnterpriseProjectProduct(writeContext(projectscope.Projection{Version: 1, ProjectCodes: []string{"OTHER"}, Masks: []int{0, 65535}}, time.Now().Add(15*time.Second).UnixMilli()), id, "920", "PROD-LINK", permit)
		expectCode(err, 403, "enterprise_project_command_scope_denied")
		_, err = a.LinkEnterpriseProjectProduct(writeContext(allowedScope, time.Now().Add(-time.Second).UnixMilli()), id, "920", "PROD-LINK", permit)
		expectCode(err, 403, "enterprise_project_command_scope_expired")
		if err = db.QueryRow("SELECT COUNT(*) FROM aims_project_products WHERE project_id=923").Scan(&count); err != nil || count != 0 {
			t.Fatalf("scope denial wrote a relation: %d %v", count, err)
		}
		id.IdempotencyKey = "different-key"
		if _, err = a.LinkEnterpriseProjectProduct(ctx, id, "920", "PROD-LINK", permit); err == nil {
			t.Fatal("duplicate relation accepted")
		}
		id.IdempotencyKey = "routine-key"
		if _, err = a.LinkEnterpriseProjectProduct(ctx, id, "921", "PROD-LINK", permit); err == nil {
			t.Fatal("routine project accepted")
		}
		id.IdempotencyKey = "archived-key"
		if _, err = a.LinkEnterpriseProjectProduct(ctx, id, "922", "PROD-LINK", permit); err == nil {
			t.Fatal("archived project accepted")
		}
		id.IdempotencyKey = "wrong-actor"
		id.ActorUID = "U4"
		if _, err = a.LinkEnterpriseProjectProduct(ctx, id, "920", "PROD-LINK", permit); err == nil {
			t.Fatal("non-manager accepted")
		}
	})

	t.Run("weekly report submit rechecks project scope before projection write", func(t *testing.T) {
		query := url.Values{"current_user": {"U1"}, "current_user_can_submit_weekly_report": {"1"}}
		permit := func(codes []string, expiry int64) context.Context {
			return WithEnterpriseProjectCommandScope(ctx, EnterpriseProjectUpdateIdentity{
				ActorUID: "U1", CommandScope: &EnterpriseProjectCommandScope{
					Projection: projectscope.Projection{Version: 1, ProjectCodes: codes, Masks: []int{0, 65535}},
					ExpiresAt:  expiry,
				},
			})
		}
		future := time.Now().Add(15 * time.Second).UnixMilli()
		_, err := a.saveProjectWeeklyReport(permit([]string{"P2"}, future), "1", query, map[string]any{"reportYear": 2026, "reportWeek": 37, "entries": []any{}})
		var denied httperror.Error
		if !errors.As(err, &denied) || denied.Status != 403 || denied.Code != "enterprise_project_command_scope_denied" {
			t.Fatalf("cross-project weekly draft was not denied by scope: %v", err)
		}
		_, err = a.submitProjectWeeklyReportPeriod(permit([]string{"P2"}, future), "1", "2026-W37", query, nil)
		if !errors.As(err, &denied) || denied.Status != 403 || denied.Code != "enterprise_project_command_scope_denied" {
			t.Fatalf("cross-project weekly report submission was not denied by scope: %v", err)
		}
		_, err = a.submitProjectWeeklyReportPeriod(permit([]string{"P1"}, time.Now().Add(-time.Second).UnixMilli()), "1", "2026-W37", query, nil)
		if !errors.As(err, &denied) || denied.Status != 403 || denied.Code != "enterprise_project_command_scope_expired" {
			t.Fatalf("expired weekly report scope was accepted: %v", err)
		}
		_, err = a.submitProjectWeeklyReportPeriod(permit([]string{"P1"}, future), "1", "2026-W37", query, nil)
		if errors.As(err, &denied) && strings.HasPrefix(denied.Code, "enterprise_project_command_scope_") {
			t.Fatalf("valid project scope rejected: %v", err)
		}
		var versions int
		if err = db.QueryRow("SELECT COUNT(*) FROM project_weekly_report_versions").Scan(&versions); err != nil || versions != 0 {
			t.Fatalf("denied submission wrote a version: %d %v", versions, err)
		}
		if _, err = a.saveProjectWeeklyReport(permit([]string{"P1"}, future), "1", query, map[string]any{"reportYear": 2026, "reportWeek": 37, "entries": []any{}, "mainWork": "scoped weekly draft"}); err != nil {
			t.Fatalf("valid scoped weekly draft failed: %v", err)
		}
		var drafts int
		if err = db.QueryRow("SELECT COUNT(*) FROM project_weekly_reports WHERE project_id=1 AND report_year=2026 AND report_week=37 AND main_work='scoped weekly draft'").Scan(&drafts); err != nil || drafts != 1 {
			t.Fatalf("valid scoped weekly draft missing: %d %v", drafts, err)
		}
	})
	t.Run("batch patch checks every owning project in one transaction", func(t *testing.T) {
		exec(db, "INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,lifecycle_status) VALUES(940,'BATCH-A','BatchA','BA','U1','U1','active'),(941,'BATCH-B','BatchB','BB','U1','U1','active')")
		exec(db, "INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status,priority) VALUES(9400,940,1,'BA-1','matter','task','Batch A','todo','P2'),(9410,941,1,'BB-1','matter','task','Batch B','todo','P2')")
		context := WithEnterpriseProjectCommandScope(ctx, EnterpriseProjectUpdateIdentity{ActorUID: "U1", CommandScope: &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, ProjectCodes: []string{"BATCH-A"}, Masks: []int{0, 65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}})
		query := url.Values{"current_user": {"U1"}}
		body := map[string]any{"ids": []any{float64(9400), float64(9410)}, "changes": map[string]any{"priority": "P0"}}
		_, err := a.batchUpdateWorkItems(context, query, body)
		var denied httperror.Error
		if !errors.As(err, &denied) || denied.Status != 403 || denied.Code != "enterprise_project_command_scope_denied" {
			t.Fatalf("cross-project batch was not denied: %v", err)
		}
		var untouched int
		if err := db.QueryRow("SELECT COUNT(*) FROM work_items WHERE id IN (9400,9410) AND priority='P2'").Scan(&untouched); err != nil || untouched != 2 {
			t.Fatalf("cross-project batch mutated items: %d %v", untouched, err)
		}
		if err := db.QueryRow("SELECT COUNT(*) FROM work_item_changelog WHERE work_item_id IN (9400,9410)").Scan(&untouched); err != nil || untouched != 0 {
			t.Fatalf("cross-project batch wrote changelog: %d %v", untouched, err)
		}
		body["ids"] = []any{float64(9400)}
		if _, err := a.batchUpdateWorkItems(context, query, body); err != nil {
			t.Fatalf("authorized batch failed: %v", err)
		}
		if err := db.QueryRow("SELECT COUNT(*) FROM work_items WHERE id=9400 AND priority='P0'").Scan(&untouched); err != nil || untouched != 1 {
			t.Fatalf("authorized batch missing: %d %v", untouched, err)
		}
	})
	t.Run("destructive commands reject outside project scope before mutation", func(t *testing.T) {
		exec(db, "INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,lifecycle_status) VALUES(950,'DELETE-P','DeleteP','DP','U1','U1','draft')")
		exec(db, "INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status) VALUES(9500,950,1,'DP-1','matter','task','Delete item','todo')")
		_, version, err := a.EnterpriseWorkItemEditableSnapshot(ctx, "9500")
		if err != nil {
			t.Fatal(err)
		}
		blocked := identity
		blocked.IdempotencyKey = uuid.NewString()
		blocked.CommandScope = &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, ProjectCodes: []string{"OTHER"}, Masks: []int{0, 65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
		_, err = a.DeleteEnterpriseWorkItem(ctx, blocked, "950", "9500", map[string]any{"expectedVersion": version})
		var denied httperror.Error
		if !errors.As(err, &denied) || denied.Status != 403 || denied.Code != "enterprise_project_command_scope_denied" {
			t.Fatalf("work item deletion scope denial = %v", err)
		}
		var count int
		if err := db.QueryRow("SELECT COUNT(*) FROM work_items WHERE id=9500").Scan(&count); err != nil || count != 1 {
			t.Fatalf("work item was deleted: %d %v", count, err)
		}
		if err := db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key=?", blocked.IdempotencyKey).Scan(&count); err != nil || count != 0 {
			t.Fatalf("denied deletion left receipt: %d %v", count, err)
		}
		deleteContext := WithEnterpriseProjectCommandScope(ctx, EnterpriseProjectUpdateIdentity{ActorUID: "U1", CommandScope: blocked.CommandScope})
		_, err = a.hardDeleteProject(deleteContext, 950)
		if !errors.As(err, &denied) || denied.Status != 403 || denied.Code != "enterprise_project_command_scope_denied" {
			t.Fatalf("project deletion scope denial = %v", err)
		}
		if err := db.QueryRow("SELECT COUNT(*) FROM aims_projects WHERE id=950").Scan(&count); err != nil || count != 1 {
			t.Fatalf("project was deleted: %d %v", count, err)
		}
		allowed := WithEnterpriseProjectCommandScope(ctx, EnterpriseProjectUpdateIdentity{ActorUID: "U1", CommandScope: &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, ProjectCodes: []string{"DELETE-P"}, Masks: []int{0, 65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}})
		if _, err := a.hardDeleteProject(allowed, 950); err != nil {
			t.Fatalf("authorized draft project deletion failed: %v", err)
		}
		if err := db.QueryRow("SELECT COUNT(*) FROM aims_projects WHERE id=950").Scan(&count); err != nil || count != 0 {
			t.Fatalf("authorized project deletion missing: %d %v", count, err)
		}
	})
}
