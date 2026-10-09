package workflow

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	aims "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	directory "github.com/huizhi-yun/data-runtime/internal/apps/directory"
	"github.com/huizhi-yun/data-runtime/internal/config"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
)

// This fixture accepts only the repository harness's disposable /tmp server.
// It never reads runtime configuration, credentials, or any live environment.
func TestWorkflowUnifiedCompletionLaneMySQL(t *testing.T) {
	socket := os.Getenv("HZY_AIMS_WORKFLOW_UNIFIED_SOCKET")
	if socket == "" {
		t.Skip("isolated MySQL required; run test-aims-workflow-unified-mysql.mjs")
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
	name := "hzy_b3_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:16]
	if _, err = root.Exec("CREATE DATABASE `" + name + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE `" + name + "`")
	mc.DBName = name
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatalf("fixture SQL: %v", err)
		}
	}
	count := func(q string, args ...any) int {
		t.Helper()
		var n int
		if err := db.QueryRow(q, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	ctx := context.Background()
	ddlRE := regexp.MustCompile("(?ms)^CREATE TABLE(?: IF NOT EXISTS)? `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;")
	maps := map[string]map[string]string{"aims": {}, "workflow": {}}
	db.SetMaxOpenConns(1)
	exec("SET FOREIGN_KEY_CHECKS=0")
	for _, domain := range []string{"aims", "workflow"} {
		path := "../../../../" + domain + "/docs/" + domain + "_schema.sql"
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		statements := ddlRE.FindAllStringSubmatch(string(raw), -1)
		if len(statements) < 10 {
			t.Fatal("canonical schema incomplete", domain)
		}
		// Prefix every physical table; preserve and use real compatibility views.
		for _, ddl := range statements {
			logical := ddl[1]
			maps[domain][logical] = domain + "_" + logical
		}
		for _, ddl := range statements {
			q := ddl[0]
			logical := ddl[1]
			physical := maps[domain][logical]
			q = strings.Replace(q, "`"+logical+"`", "`"+physical+"`", 1)
			if !strings.Contains(q, "CREATE TABLE IF NOT EXISTS `"+physical+"`") && !strings.Contains(q, "CREATE TABLE `"+physical+"`") {
				q = strings.Replace(q, "CREATE TABLE IF NOT EXISTS "+logical+" (", "CREATE TABLE IF NOT EXISTS `"+physical+"` (", 1)
			}
			// FK reference names follow the same physical mapping. Constraint symbols
			// are schema-global, so domain-prefix them too.
			for l, p := range maps[domain] {
				q = strings.ReplaceAll(q, "REFERENCES `"+l+"`", "REFERENCES `"+p+"`")
			}
			q = regexp.MustCompile("CONSTRAINT `([^`]+)`").ReplaceAllString(q, "CONSTRAINT `"+domain+"_$1`")
			q = strings.ReplaceAll(q, "chk_scr_", domain+"_chk_scr_")
			exec(q)
		}
	}
	exec("SET FOREIGN_KEY_CHECKS=1")
	// B1 deliberately retains the unprefixed canonical parameter name.
	if physical, ok := maps["workflow"]["workflow_system_parameters"]; ok {
		exec("RENAME TABLE `" + physical + "` TO workflow_system_parameters")
		maps["workflow"]["workflow_system_parameters"] = "workflow_system_parameters"
	}
	exec("CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(100),environment_code VARCHAR(100),runtime_deployment VARCHAR(100),schema_version VARCHAR(100),generation BIGINT UNSIGNED) ENGINE=InnoDB")
	exec("INSERT INTO enterprise_schema_registry VALUES(1,'T1','test','RUNTIME','v1',0)")
	var instance string
	var port int
	if err = db.QueryRow("SELECT @@server_uuid,@@port").Scan(&instance, &port); err != nil {
		t.Fatal(err)
	}
	binding := e.Binding{Key: e.BindingKey{Tenant: "T1", Environment: "test", RuntimeDeployment: "RUNTIME"}, Storage: e.Storage{InstanceID: instance, Address: fmt.Sprintf("127.0.0.1:%d", port), Database: name}, SchemaVersion: "v1", Generation: 1, Domains: map[string]e.DomainBinding{}}
	for domain, tables := range maps {
		owner := "AIMS"
		if domain == "workflow" {
			owner = "WORKFLOW"
		}
		binding.Domains[domain] = e.DomainBinding{OwnerDeployment: owner, Tables: tables, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathDisabled}
		var names []string
		for l, p := range tables {
			if !e.IsSharedPhysicalName(l) && l != p {
				names = append(names, l)
			}
		}
		sort.Strings(names)
		plan, err := e.PlanCompatibilityViews(ctx, db, binding, domain, names)
		if err != nil {
			t.Fatal(err)
		}
		if err = e.ApplyCompatibilityViews(ctx, db, binding, domain, names, plan.ReviewHash); err != nil {
			t.Fatal(err)
		}
	}
	exec("UPDATE enterprise_schema_registry SET generation=1")
	db.SetMaxOpenConns(16)
	user := "b3_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	secret := uuid.NewString()
	if _, err = root.Exec("CREATE USER '" + user + "'@'127.0.0.1' IDENTIFIED BY '" + secret + "'"); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP USER '" + user + "'@'127.0.0.1'")
	if _, err = root.Exec("GRANT ALL ON `" + name + "`.* TO '" + user + "'@'127.0.0.1'"); err != nil {
		t.Fatal(err)
	}
	a, err := aims.New(config.AimsConfig{DB: config.DBConfig{Host: "127.0.0.1", Port: port, User: user, Password: secret, Database: name, ConnectionLimit: 16}})
	if err != nil {
		t.Fatal(err)
	}
	defer a.DB().Close()
	// Registry's authoritative pool is the same pool used by both adapters.
	registry := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return a.DB(), nil })
	if err = registry.Register(ctx, binding); err != nil {
		t.Fatal(err)
	}
	if err = a.ConfigureEnterpriseWrites(ctx, registry, binding, "ENTERPRISE", "AIMS"); err != nil {
		t.Fatal(err)
	}
	w, err := NewEnterprise(ctx, registry, binding, e.ResolveRequest{Key: binding.Key, Domain: "workflow", Operation: e.Write, OwnerDeployment: "WORKFLOW", SchemaVersion: "v1", Generation: 1})
	if err != nil {
		t.Fatal(err)
	}
	// Directory is an independent pre-read pool, never retained under business locks.
	exec("CREATE TABLE directory_users(id BIGINT PRIMARY KEY,uid VARCHAR(64),status VARCHAR(30),user_type VARCHAR(30),real_name VARCHAR(100),display_name VARCHAR(100),nickname VARCHAR(100),primary_dept_code VARCHAR(100),updated_at DATETIME) ENGINE=InnoDB")
	exec("CREATE TABLE directory_departments(id BIGINT PRIMARY KEY,dept_code VARCHAR(100),dept_name VARCHAR(100),org_type VARCHAR(30),status VARCHAR(30),level_no INT,manager_uid VARCHAR(64),leader_uid VARCHAR(64),parent_dept_code VARCHAR(100),updated_at DATETIME) ENGINE=InnoDB")
	exec("CREATE TABLE directory_user_departments(id BIGINT PRIMARY KEY,uid VARCHAR(64),dept_code VARCHAR(100),status VARCHAR(30),is_primary INT,relation_type VARCHAR(30),updated_at DATETIME) ENGINE=InnoDB")
	exec("INSERT INTO directory_users VALUES(1,'U1','active','employee','员工1',NULL,NULL,'D',UTC_TIMESTAMP()),(2,'U2','active','employee','员工2',NULL,NULL,'D',UTC_TIMESTAMP()),(3,'Service','active','service',NULL,NULL,NULL,NULL,UTC_TIMESTAMP())")
	exec("INSERT INTO directory_departments VALUES(1,'D','部门','department','active',1,'U2','U2',NULL,UTC_TIMESTAMP())")
	exec("INSERT INTO directory_user_departments VALUES(1,'U1','D','active',1,'member',UTC_TIMESTAMP()),(2,'U2','D','active',1,'member',UTC_TIMESTAMP())")
	if err = w.ConfigureCompletionLane(registry, binding, "ENTERPRISE", "AIMS", "WORKFLOW", a, directory.NewWithDB(db, "T1", "", "")); err != nil {
		t.Fatal(err)
	}
	nodes := `[{"name":"审核","type":"approve","approve_mode":"any","assignees":[{"type":"user","uid":"U2"}]}]`
	exec("INSERT INTO flow_schemas(id,code,name,nodes,config,created_by) VALUES(1,'b3','B3',?,JSON_OBJECT('allow_withdraw',true,'allow_resubmit',true),'U1')", nodes)
	exec("INSERT INTO flow_action_defs(id,app_code,resource_code,action_code,name,created_by) VALUES(1,'aims','tasks','complete','完成','U1')")
	exec("INSERT INTO flow_routes(id,action_def_id,flow_schema_id,name,is_default,created_by) VALUES(1,1,1,'Default',1,'U1')")
	exec("INSERT INTO aims_projects(id,project_code,name,short_name,category,leader_uid,lifecycle_status,created_by) VALUES(1,'P1','试点','P1','routine','U1','active','U1')")
	exec("INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(1,'U1','manager','active'),(1,'U2','member','active')")
	// Operation IDs must be lowercase UUIDv4; one stable UUID per label keeps same-key replays.
	keys := map[string]string{}
	var keysMu sync.Mutex
	identity := func(label string) aims.EnterpriseProjectUpdateIdentity {
		keysMu.Lock()
		key, ok := keys[label]
		if !ok {
			key = uuid.NewString()
			keys[label] = key
		}
		keysMu.Unlock()
		return aims.EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "ENTERPRISE", TargetDeployment: "RUNTIME", ActorUID: "U1", ServiceClientID: "enterprise.runtime", RequestID: key, IdempotencyKey: key, CommandScope: &aims.EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, Masks: []int{65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}}
	}
	seed := func(n int, kind string) {
		t.Helper()
		exec("INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status,assignee_uid) VALUES(?,1,?,?,?,'task','标记事项','in_progress','U1')", n, n, fmt.Sprint("P1-", n), kind)
		if kind == "target" {
			exec("INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status,parent_id) VALUES(?,1,?,?,'matter','task','标记子项','completed',?)", n+1, n+1, fmt.Sprint("P1-", n+1), n)
		} else {
			exec("INSERT INTO time_entries(project_id,work_item_id,uid,entry_date,hours,description) VALUES(1,?,'U1','2026-10-01',0.1,'B3 isolated')", n)
		}
	}
	body := func(n int) map[string]any {
		t.Helper()
		_, v, err := a.EnterpriseWorkItemEditableSnapshot(ctx, fmt.Sprint(n))
		if err != nil {
			t.Fatal(err)
		}
		return map[string]any{"expectedVersion": v}
	}
	pendingTask := func(n int) string {
		t.Helper()
		var id string
		if err := db.QueryRow("SELECT t.id FROM flow_tasks t JOIN flow_instances i ON i.id=t.instance_id WHERE i.biz_id=? ORDER BY t.id DESC LIMIT 1", fmt.Sprint(n)).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	decision := func(task, action, key string) error {
		body := map[string]any{"current_user": "U2", "idempotency_key": key, "hzy_runtime_service_client_id": "workflow.runtime"}
		if action == "reject" {
			body["comment"] = "B3 隔离驳回"
		}
		_, _, handled, err := w.decideCompletion(ctx, task, action, body)
		if !handled && err == nil {
			return errors.New("not handled")
		}
		return err
	}
	expect403 := func(err error) {
		t.Helper()
		var h httperror.Error
		if !errors.As(err, &h) || h.Status != 403 {
			t.Fatalf("expected 403, got %v", err)
		}
	}
	concurrent := func(fs ...func() error) {
		t.Helper()
		start := make(chan struct{})
		errs := make(chan error, len(fs))
		var wg sync.WaitGroup
		for _, f := range fs {
			wg.Add(1)
			go func(f func() error) { defer wg.Done(); <-start; errs <- f() }(f)
		}
		close(start)
		wg.Wait()
		close(errs)
		for err := range errs {
			if err != nil {
				t.Fatal("concurrent transaction", err)
			}
		}
	}
	for n := 100; n < 112; n += 2 {
		seed(n, "target")
		id := identity(fmt.Sprint("b3-target-", n))
		input := body(n)
		call := func() error { _, err := w.RequestCompletion(ctx, id, "1", fmt.Sprint(n), "target", input); return err }
		concurrent(call, call)
		if count("SELECT COUNT(*) FROM flow_instances WHERE biz_id=?", fmt.Sprint(n)) != 1 || count("SELECT COUNT(*) FROM work_item_completion_requests WHERE work_item_id=?", n) != 1 {
			t.Fatal("same-key duplicate")
		}
		task := pendingTask(n)
		key := "decision-" + task
		concurrent(func() error { return decision(task, "approve", key) }, func() error { return decision(task, "approve", key) })
		if count("SELECT COUNT(*) FROM work_items WHERE id=? AND status='completed'", n) != 1 || count("SELECT COUNT(*) FROM flow_actions WHERE task_id=? AND action='approve'", task) != 1 {
			t.Fatal("half approval or duplicate action")
		}
	}
	t.Run("matter-snapshot-and-no-network-callback", func(t *testing.T) {
		seed(200, "matter")
		input := body(200)
		id := identity("b3-matter")
		first, err := w.RequestCompletion(ctx, id, "1", "200", "matter", input)
		if err != nil {
			t.Fatal(err)
		}
		replay, err := w.RequestCompletion(ctx, id, "1", "200", "matter", input)
		if first["effects"] != nil {
			t.Fatal("internal effects exposed to Host/browser")
		}
		if err != nil || first["receiptId"] != replay["receiptId"] {
			t.Fatal("receipt replay", err)
		}
		if err = decision(pendingTask(200), "reject", "reject-matter"); err != nil {
			t.Fatal(err)
		}
		if count("SELECT COUNT(*) FROM work_items WHERE id=200 AND status='in_progress'") != 1 {
			t.Fatal("reject not atomic")
		}
		if count("SELECT COUNT(*) FROM flow_callback_logs") != 0 || count("SELECT COUNT(*) FROM aims_integration_operation WHERE operation_code='aims.work-item.completion.workflow-submit.v1'") != 0 {
			t.Fatal("internal effect also externally queued")
		}
		// A fresh adapter (response lost/restart) can recover the same durable
		// notification rows without rerunning the business command.
		recovered, _, recoveryErr := (&Adapter{db: a.DB()}).pendingWorkflowNotificationOutbox(ctx, 200)
		if recoveryErr != nil || len(recovered.Data.([]WorkflowNotificationEffect)) == 0 {
			t.Fatal("notification outbox recovery", recoveryErr)
		}
		if count("SELECT COUNT(*) FROM flow_notification_outbox WHERE delivery_status='pending'") < 1 || count("SELECT COUNT(*) FROM flow_actionable_outbox WHERE delivery_status='pending'") < 1 {
			t.Fatal("durable external effects missing")
		}
		var req, inst string
		if err = db.QueryRow("SELECT snapshot_json FROM work_item_completion_requests WHERE work_item_id=200").Scan(&req); err != nil {
			t.Fatal(err)
		}
		if err = db.QueryRow("SELECT biz_context FROM flow_instances WHERE biz_id='200'").Scan(&inst); err != nil {
			t.Fatal(err)
		}
		var r, i map[string]any
		json.Unmarshal([]byte(req), &r)
		json.Unmarshal([]byte(inst), &i)
		if r["workflowDirectory"] == nil || !strings.Contains(inst, "workflow_directory_snapshot") || i == nil {
			t.Fatal("immutable Directory not frozen in both domains")
		}
	})
	t.Run("matter-approved-and-withdrawal", func(t *testing.T) {
		seed(202, "matter")
		if _, err = w.RequestCompletion(ctx, identity("b3-matter-approved"), "1", "202", "matter", body(202)); err != nil {
			t.Fatal(err)
		}
		if err = decision(pendingTask(202), "approve", "approve-matter"); err != nil {
			t.Fatal(err)
		}
		if count("SELECT COUNT(*) FROM work_items WHERE id=202 AND status='completed'") != 1 {
			t.Fatal("matter not completed")
		}
		seed(204, "matter")
		created, err := w.RequestCompletion(ctx, identity("b3-withdraw"), "1", "204", "matter", body(204))
		if err != nil {
			t.Fatal(err)
		}
		instance := fmt.Sprint(created["workflowInstanceId"])
		withdraw := func() error {
			_, _, _, err := w.decideCompletion(ctx, instance, "cancel", map[string]any{"current_user": "U1", "idempotency_key": "withdraw-once"})
			return err
		}
		if err = withdraw(); err != nil {
			t.Fatal(err)
		}
		if err = withdraw(); err != nil {
			t.Fatal("withdraw response-loss replay", err)
		}
		if count("SELECT COUNT(*) FROM work_items WHERE id=204 AND status='in_progress'") != 1 || count("SELECT COUNT(*) FROM flow_callback_logs") != 0 {
			t.Fatal("withdraw not internally applied")
		}
	})
	// Submission and decision requests really overlap on the same project,
	// not just two identical operations in separate sequential phases.
	t.Run("departed-initiator-does-not-block-decisions", func(t *testing.T) {
		for index, change := range []string{"status='inactive'", "user_type='external'"} {
			for actionIndex, action := range []string{"approve", "reject"} {
				id := 210 + index*2 + actionIndex
				seed(id, "matter")
				if _, err := w.RequestCompletion(ctx, identity(fmt.Sprintf("departed-%d", id)), "1", fmt.Sprint(id), "matter", body(id)); err != nil {
					t.Fatal(err)
				}
				exec("UPDATE directory_users SET " + change + " WHERE uid='U1'")
				if err := decision(pendingTask(id), action, fmt.Sprintf("departed-decision-%d", id)); err != nil {
					t.Fatal(err)
				}
				want := "completed"
				flow := "approved"
				if action == "reject" {
					want = "in_progress"
					flow = "rejected"
				}
				if count("SELECT COUNT(*) FROM work_items WHERE id=? AND status=?", id, want) != 1 || count("SELECT COUNT(*) FROM flow_instances WHERE biz_id=? AND status=?", fmt.Sprint(id), flow) != 1 {
					t.Fatal("departed initiator blocked closeout")
				}
				exec("UPDATE directory_users SET status='active',user_type='employee' WHERE uid='U1'")
			}
		}
		if count("SELECT COUNT(*) FROM workflow_service_command_receipt WHERE service_client_id='aims.lane' AND operation_code LIKE 'aims.completion.request.lane.%'") == 0 || count("SELECT COUNT(*) FROM aims_service_command_receipt WHERE service_client_id='workflow.lane' AND operation_code LIKE 'workflow.tasks.%.lane'") == 0 {
			t.Fatal("lane provenance missing")
		}
		if count("SELECT COUNT(*) FROM workflow_service_command_receipt WHERE service_client_id='aims.runtime'") != 0 {
			t.Fatal("internal lane masquerades as external service")
		}
	})
	t.Run("cross-submit-decision-six-rounds", func(t *testing.T) {
		previous := 700
		seed(previous, "target")
		if _, err = w.RequestCompletion(ctx, identity("cross-first"), "1", fmt.Sprint(previous), "target", body(previous)); err != nil {
			t.Fatal(err)
		}
		for n := 702; n < 714; n += 2 {
			seed(n, "target")
			id := identity(fmt.Sprint("cross-", n))
			input := body(n)
			task := pendingTask(previous)
			create := func() error { _, err := w.RequestCompletion(ctx, id, "1", fmt.Sprint(n), "target", input); return err }
			decide := func() error { return decision(task, "approve", "cross-decide-"+task) }
			concurrent(create, decide, create, decide)
			if count("SELECT COUNT(*) FROM flow_instances WHERE biz_id=?", fmt.Sprint(n)) != 1 || count("SELECT COUNT(*) FROM work_items WHERE id=? AND status='completed'", previous) != 1 {
				t.Fatal("cross-request half state")
			}
			previous = n
		}
		if err = decision(pendingTask(previous), "reject", "cross-cleanup"); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("aims-failure-rolls-back-workflow-decision", func(t *testing.T) {
		seed(300, "target")
		if _, err = w.RequestCompletion(ctx, identity("b3-failure"), "1", "300", "target", body(300)); err != nil {
			t.Fatal(err)
		}
		task := pendingTask(300)
		exec("UPDATE work_items SET title='changed after freeze' WHERE id=301")
		if err = decision(task, "approve", "fails-atomically"); err == nil {
			t.Fatal("changed child accepted")
		}
		if count("SELECT COUNT(*) FROM flow_tasks WHERE id=? AND status='pending'", task) != 1 || count("SELECT COUNT(*) FROM flow_actions WHERE task_id=?", task) != 0 || count("SELECT COUNT(*) FROM aims_service_command_receipt WHERE idempotency_key='fails-atomically'") != 0 || count("SELECT COUNT(*) FROM work_items WHERE id=300 AND status='in_review'") != 1 {
			t.Fatal("half decision leaked")
		}
	})
	t.Run("permit-revocation-expiry-and-body-injection", func(t *testing.T) {
		seed(400, "target")
		input := body(400)
		id := identity("b3-scopes")
		if _, err = w.RequestCompletion(ctx, id, "1", "400", "target", input); err != nil {
			t.Fatal(err)
		}
		for _, mutation := range []func(*aims.EnterpriseProjectUpdateIdentity){func(i *aims.EnterpriseProjectUpdateIdentity) { i.CommandScope.Projection.Masks = []int{0} }, func(i *aims.EnterpriseProjectUpdateIdentity) {
			i.CommandScope.ExpiresAt = time.Now().Add(-time.Second).UnixMilli()
		}, func(i *aims.EnterpriseProjectUpdateIdentity) { i.CommandScope = nil }, func(i *aims.EnterpriseProjectUpdateIdentity) { i.SourceDeployment = "OTHER" }} {
			denied := identity("b3-scopes")
			mutation(&denied)
			_, err = w.RequestCompletion(ctx, denied, "1", "400", "target", input)
			expect403(err)
		}
		forged := map[string]any{"expectedVersion": input["expectedVersion"], "completionInProcess": true}
		_, err = w.RequestCompletion(ctx, id, "1", "400", "target", forged)
		var h httperror.Error
		if !errors.As(err, &h) || h.Status != 400 {
			t.Fatal("body selected internal mode", err)
		}
		// The original receiver is rechecked before a receipt even on replay.
		task := pendingTask(400)
		if err = decision(task, "reject", "b3-revoke-replay"); err != nil {
			t.Fatal(err)
		}
		exec("UPDATE flow_tasks SET assignee_uid='U1' WHERE id=?", task)
		expect403(decision(task, "reject", "b3-revoke-replay"))
	})
	t.Run("employee-and-self-candidate-boundary", func(t *testing.T) {
		for n, uid := range map[int]string{500: "Service", 502: "U1"} {
			seed(n, "target")
			exec("UPDATE flow_schemas SET nodes=? WHERE id=1", fmt.Sprintf(`[{"name":"审批","type":"approve","approve_mode":"any","assignees":[{"type":"user","uid":%q}]}]`, uid))
			_, err = w.RequestCompletion(ctx, identity(fmt.Sprint("b3-person-", n)), "1", fmt.Sprint(n), "target", body(n))
			expect403(err)
			if count("SELECT COUNT(*) FROM flow_instances WHERE biz_id=?", fmt.Sprint(n)) != 0 || count("SELECT COUNT(*) FROM work_item_completion_requests WHERE work_item_id=?", n) != 0 || count("SELECT COUNT(*) FROM work_items WHERE id=? AND status='in_progress'", n) != 1 {
				t.Fatal("denied candidate leaked mutation")
			}
		}
		exec("UPDATE flow_schemas SET nodes=? WHERE id=1", nodes)
	})
	t.Run("submit-and-membership-change-interleaving", func(t *testing.T) {
		// Both contenders obey the project-first order; exact schedules may choose
		// either authorized pre-change commit or post-change 403, never partial state.
		for n := 600; n < 608; n += 2 {
			seed(n, "target")
			input := body(n)
			id := identity(fmt.Sprint("b3-membership-", n))
			start := make(chan struct{})
			errs := make(chan error, 2)
			go func() {
				<-start
				_, err := w.RequestCompletion(ctx, id, "1", fmt.Sprint(n), "target", input)
				errs <- err
			}()
			go func() {
				<-start
				tx, err := db.BeginTx(ctx, nil)
				if err != nil {
					errs <- err
					return
				}
				defer tx.Rollback()
				var x int
				err = tx.QueryRow("SELECT id FROM aims_projects WHERE id=1 FOR UPDATE").Scan(&x)
				if err == nil {
					_, err = tx.Exec("UPDATE aims_projects SET leader_uid='U2' WHERE id=1")
				}
				if err == nil {
					err = tx.Commit()
				}
				errs <- err
			}()
			close(start)
			for k := 0; k < 2; k++ {
				err := <-errs
				if err != nil {
					expect403(err)
				}
			}
			if count("SELECT COUNT(*) FROM flow_instances WHERE biz_id=?", fmt.Sprint(n)) != count("SELECT COUNT(*) FROM work_item_completion_requests WHERE work_item_id=?", n) {
				t.Fatal("interleaving half request")
			}
			_, err = w.RequestCompletion(ctx, id, "1", fmt.Sprint(n), "target", input)
			expect403(err)
			exec("UPDATE aims_projects SET leader_uid='U1' WHERE id=1")
		}
	})
}
