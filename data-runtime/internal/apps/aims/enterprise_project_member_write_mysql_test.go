package aims

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/config"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
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
	registry := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return a.DB(), nil })
	if err = registry.Register(ctx, binding); err != nil {
		t.Fatal(err)
	}
	if err = a.ConfigureEnterpriseWrites(ctx, registry, binding, "enterprise-test", "aims-test"); err != nil {
		t.Fatal(err)
	}
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
		exec(db, "INSERT INTO project_counters(project_id,counter) VALUES(900,0)")
		id := identity
		id.IdempotencyKey = "work-create"
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
		_, version, err := a.EnterpriseWorkItemEditableSnapshot(ctx, wid)
		if err != nil {
			t.Fatal(err)
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
		out, err := a.DistributeEnterpriseWorkItem(ctx, update("U1", "distribution-confirm"), "910", "9100", "confirm-distribute", confirm)
		if err != nil {
			t.Fatal(err)
		}
		if children() != "todo,todo" {
			t.Fatal("confirm did not move planned children to todo", children())
		}
		replay, err := a.DistributeEnterpriseWorkItem(ctx, update("U1", "distribution-confirm"), "910", "9100", "confirm-distribute", confirm)
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

}
