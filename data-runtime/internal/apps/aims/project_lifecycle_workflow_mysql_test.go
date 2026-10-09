package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
)

// ProjectLifecycleWorkflowCreate is wired by the external test package to avoid
// the existing Workflow -> Aims production import cycle. It calls real CreateInstance.
var ProjectLifecycleWorkflowCreate func(context.Context, *sql.DB, map[string]any) (map[string]any, error)
var ProjectLifecycleWorkflowReaderForDB func(*sql.DB) AimsWorkflowInstanceReader

// Uses only the disposable database and registered U writer supplied by the
// project-members runner; no runtime or configured application database is used.
func testProjectLifecycleWorkflowMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	t.Run("unified Workflow store", func(t *testing.T) { testProjectLifecycleWorkflowMySQLOn(t, a, db, db, 0) })
	t.Run("independent Workflow database", func(t *testing.T) {
		socket := os.Getenv("HZY_PROJECT_MEMBER_SOCKET")
		if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
			t.Fatal("unsafe isolated socket")
		}
		name := "hzy_r3_workflow_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		if _, err := db.Exec("CREATE DATABASE " + name); err != nil {
			t.Fatal(err)
		}
		defer db.Exec("DROP DATABASE " + name)
		cfg := mysql.NewConfig()
		cfg.User = "root"
		cfg.Net = "unix"
		cfg.Addr = socket
		cfg.DBName = name
		cfg.ParseTime = true
		workflowDB, err := sql.Open("mysql", cfg.FormatDSN())
		if err != nil {
			t.Fatal(err)
		}
		defer workflowDB.Close()
		original, reader := a.enterpriseWrites, a.workflowInstanceReader
		independent := *original
		independent.binding = original.binding
		independent.binding.Domains = map[string]e.DomainBinding{"aims": original.binding.Domains["aims"]}
		a.enterpriseWrites = &independent
		defer func() { a.enterpriseWrites = original; a.workflowInstanceReader = reader }()
		if ProjectLifecycleWorkflowReaderForDB == nil {
			t.Fatal("real Workflow read bridge missing")
		}
		a.ConfigureWorkflowInstanceReader(ProjectLifecycleWorkflowReaderForDB(workflowDB))
		testProjectLifecycleWorkflowMySQLOn(t, a, db, workflowDB, 100)
	})
}

func testProjectLifecycleWorkflowMySQLOn(t *testing.T, a *Adapter, db, workflowDB *sql.DB, offset int) {
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
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
	workflowCount := func(q string, args ...any) int {
		t.Helper()
		var n int
		if err := workflowDB.QueryRow(q, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	workflowExec := func(q string, args ...any) {
		t.Helper()
		if _, err := workflowDB.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	schema, err := os.ReadFile("../../../../workflow/docs/workflow_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	ddl := regexp.MustCompile("(?ms)^CREATE TABLE(?: IF NOT EXISTS)? `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(schema), -1)
	workflowDB.SetMaxOpenConns(1)
	workflowExec("SET FOREIGN_KEY_CHECKS=0")
	for _, s := range ddl {
		if len(s[1]) >= 5 && s[1][:5] == "flow_" {
			workflowExec(regexp.MustCompile(`^CREATE TABLE(?: IF NOT EXISTS)?`).ReplaceAllString(s[0], "CREATE TABLE IF NOT EXISTS"))
		}
	}
	workflowExec("SET FOREIGN_KEY_CHECKS=1")
	workflowDB.SetMaxOpenConns(8)
	nodes := `[{"name":"Review","type":"approve","approve_mode":"any","assignees":[{"type":"user","uid":"REVIEWER"}]}]`
	workflowExec("INSERT INTO flow_schemas(id,code,name,nodes,config,created_by) VALUES(8700,'r3-lifecycle','Lifecycle',?,JSON_OBJECT('allow_resubmit',true),'ADMIN')", nodes)
	for i, action := range []string{"pause", "resume", "finish"} {
		id := 8700 + i
		workflowExec("INSERT INTO flow_action_defs(id,app_code,resource_code,action_code,name,created_by) VALUES(?,'aims','projects',?,?,'ADMIN')", id, action, action)
		workflowExec("INSERT INTO flow_routes(id,action_def_id,flow_schema_id,name,is_default,created_by) VALUES(?,?,8700,'Default',1,'ADMIN')", id, id)
	}
	if ProjectLifecycleWorkflowCreate == nil {
		t.Fatal("real Workflow test bridge missing")
	}
	requireConflict := func(err error) {
		t.Helper()
		var h httperror.Error
		if !errors.As(err, &h) || h.Status != 409 {
			t.Fatalf("expected409, got %v", err)
		}
	}
	for n, tc := range []struct{ name, action, status string }{
		{"pause approved", "pause", "approved"}, {"resume approved", "resume", "approved"}, {"finish approved", "finish", "approved"}, {"rejected", "pause", "rejected"}, {"cancelled", "pause", "cancelled"}, {"state changed", "pause", "approved"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			project := strconv.Itoa(8800 + offset + n)
			from, to, _ := projectLifecycleTransition(tc.action)
			exec("INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,lifecycle_status) VALUES(?,?,?,?,'U1','U1',?)", project, "R3-"+project, "R3", project, from)
			exec("INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(?,'U1','manager','active')", project)
			_, version, err := enterpriseProjectSnapshot(ctx, db, project, false)
			if err != nil {
				t.Fatal(err)
			}
			identity := EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "U1", ServiceClientID: "enterprise.runtime", RequestID: "r3-" + project, IdempotencyKey: "r3-" + project, CommandScope: &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, Masks: []int{65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}}
			input := map[string]any{"actionCode": tc.action, "comment": "frozen reason", "expectedVersion": version}
			request, err := a.RequestEnterpriseProjectLifecycle(ctx, identity, project, input, false)
			if err != nil {
				t.Fatal(err)
			}
			replay, err := a.RequestEnterpriseProjectLifecycle(ctx, identity, project, input, false)
			if err != nil || replay["requestNo"] != request["requestNo"] {
				t.Fatalf("request replay %v %v", replay, err)
			}
			if count("SELECT COUNT(*) FROM approval_records WHERE request_no=?", request["requestNo"]) != 1 {
				t.Fatal("duplicate request")
			}
			snap := request["snapshot"].(projectLifecycleSnapshot)
			form := map[string]any{}
			raw, _ := json.Marshal(snap)
			if err = json.Unmarshal(raw, &form); err != nil {
				t.Fatal(err)
			}
			form["requestNo"] = request["requestNo"]
			actionID := map[string]int{"pause": 8700, "resume": 8701, "finish": 8702}[tc.action]
			body := map[string]any{"action_def_id": actionID, "route_id": actionID, "biz_id": project, "biz_title": "R3", "current_user": "U1", "form_data": form}
			create := func() string {
				t.Helper()
				out, err := ProjectLifecycleWorkflowCreate(ctx, workflowDB, body)
				if err != nil {
					t.Fatal(err)
				}
				return fmt.Sprint(out["instance_id"])
			}
			// Concurrent first creates exercise the action-definition serialization lock.
			type creationResult struct {
				out map[string]any
				err error
			}
			results := make(chan creationResult, 2)
			for i := 0; i < 2; i++ {
				go func() {
					out, err := ProjectLifecycleWorkflowCreate(ctx, workflowDB, body)
					results <- creationResult{out, err}
				}()
			}
			first, second := <-results, <-results
			if first.err != nil || second.err != nil {
				t.Fatalf("concurrent create: %v / %v", first.err, second.err)
			}
			instance := fmt.Sprint(first.out["instance_id"])
			if fmt.Sprint(second.out["instance_id"]) != instance {
				t.Fatal("concurrent frozen request created two instances")
			}
			changed := form["comment"]
			form["comment"] = "changed intent"
			_, err = ProjectLifecycleWorkflowCreate(ctx, workflowDB, body)
			requireConflict(err)
			form["comment"] = changed
			if create() != instance {
				t.Fatal("PLC creation replay created another instance")
			}
			if workflowCount("SELECT COUNT(*) FROM flow_instances WHERE biz_id=?", project) != 1 {
				t.Fatal("duplicate instance")
			}
			callback := map[string]any{"event": "flow_completed", "app_code": "aims", "resource_code": "projects", "action_code": tc.action, "biz_id": project, "instance_id": instance, "status": tc.status, "form_data": form}
			verified := url.Values{"workflow_callback_verified": {"true"}}
			_, err = a.applyProjectLifecycleWorkflowCallback(ctx, verified, callback)
			requireConflict(err) // before bind: durable retry can recover
			bind := map[string]any{"actionCode": tc.action, "requestNo": request["requestNo"], "instanceId": instance, "instanceNo": fmt.Sprint(first.out["instance_no"])}
			if offset != 0 {
				reader := a.workflowInstanceReader
				a.ConfigureWorkflowInstanceReader(nil)
				_, err = a.RequestEnterpriseProjectLifecycle(ctx, identity, project, bind, true)
				var failure httperror.Error
				if !errors.As(err, &failure) || failure.Status != 503 {
					t.Fatalf("unavailable reader %v", err)
				}
				if count("SELECT COUNT(*) FROM approval_records WHERE request_no=? AND status='pending' AND workflow_instance_id IS NULL", request["requestNo"]) != 1 {
					t.Fatal("unavailable reader corrupted pending intent")
				}
				a.ConfigureWorkflowInstanceReader(reader)
				// Tamper each independent-store identity field, then restore the
				// immutable fixture. Every mismatch must leave the request unbound.
				for _, field := range []string{"instance_no", "biz_id", "initiator_uid", "app_code", "resource_code", "action_code"} {
					original := map[string]any{"instance_no": first.out["instance_no"], "biz_id": project, "initiator_uid": "U1", "app_code": "aims", "resource_code": "projects", "action_code": tc.action}[field]
					workflowExec("UPDATE flow_instances SET "+field+"=? WHERE id=?", "wrong", instance)
					_, err = a.RequestEnterpriseProjectLifecycle(ctx, identity, project, bind, true)
					workflowExec("UPDATE flow_instances SET "+field+"=? WHERE id=?", original, instance)
					requireConflict(err)
				}
				for _, field := range []string{"requestNo", "projectId", "requestedBy", "actionCode"} {
					original := form[field]
					form[field] = "wrong"
					raw, _ := json.Marshal(form)
					workflowExec("UPDATE flow_instances SET form_data=? WHERE id=?", string(raw), instance)
					_, err = a.RequestEnterpriseProjectLifecycle(ctx, identity, project, bind, true)
					form[field] = original
					raw, _ = json.Marshal(form)
					workflowExec("UPDATE flow_instances SET form_data=? WHERE id=?", string(raw), instance)
					requireConflict(err)
				}
				if count("SELECT COUNT(*) FROM approval_records WHERE request_no=? AND workflow_instance_id IS NULL", request["requestNo"]) != 1 {
					t.Fatal("ownership mismatch left binding")
				}
			}
			bind["instanceNo"] = "WRONG-NUMBER"
			_, err = a.RequestEnterpriseProjectLifecycle(ctx, identity, project, bind, true)
			requireConflict(err)
			if count("SELECT COUNT(*) FROM approval_records WHERE request_no=? AND workflow_instance_id IS NULL", request["requestNo"]) != 1 {
				t.Fatal("wrong number bound request")
			}
			bind["instanceNo"] = fmt.Sprint(first.out["instance_no"])
			for i := 0; i < 2; i++ {
				if _, err = a.RequestEnterpriseProjectLifecycle(ctx, identity, project, bind, true); err != nil {
					t.Fatal(err)
				}
			}
			bind["instanceId"] = "999999"
			_, err = a.RequestEnterpriseProjectLifecycle(ctx, identity, project, bind, true)
			requireConflict(err)
			bind["instanceId"] = instance
			_, err = a.applyProjectLifecycleWorkflowCallback(ctx, nil, callback)
			if err == nil {
				t.Fatal("unverified callback accepted")
			}
			for _, field := range []string{"instance_id", "biz_id", "action_code"} {
				original := callback[field]
				callback[field] = map[string]string{"instance_id": "999999", "biz_id": "2", "action_code": "finish"}[field]
				if field == "action_code" && tc.action == "finish" {
					callback[field] = "pause"
				}
				_, err = a.applyProjectLifecycleWorkflowCallback(ctx, verified, callback)
				requireConflict(err)
				callback[field] = original
			}
			// Coherent forged form/business fields must still fail the persisted owner/action match.
			callback["biz_id"] = "2"
			form["projectId"] = "2"
			_, err = a.applyProjectLifecycleWorkflowCallback(ctx, verified, callback)
			requireConflict(err)
			callback["biz_id"] = project
			form["projectId"] = project
			otherAction := "finish"
			if tc.action == "finish" {
				otherAction = "pause"
			}
			callback["action_code"] = otherAction
			form["actionCode"] = otherAction
			_, err = a.applyProjectLifecycleWorkflowCallback(ctx, verified, callback)
			requireConflict(err)
			callback["action_code"] = tc.action
			form["actionCode"] = tc.action
			if count("SELECT COUNT(*) FROM project_lifecycle_events WHERE project_id=?", project) != 0 {
				t.Fatal("negative callback wrote event")
			}
			if tc.name == "state changed" {
				exec("UPDATE aims_projects SET lifecycle_status='completed' WHERE id=?", project)
				_, err = a.applyProjectLifecycleWorkflowCallback(ctx, verified, callback)
				requireConflict(err)
				exec("UPDATE aims_projects SET lifecycle_status=? WHERE id=?", from, project)
			}
			// Stale registry generation must reject before changing any business fact.
			exec("UPDATE enterprise_schema_registry SET generation=2 WHERE id=1")
			_, err = a.applyProjectLifecycleWorkflowCallback(ctx, verified, callback)
			exec("UPDATE enterprise_schema_registry SET generation=1 WHERE id=1")
			if err == nil {
				t.Fatal("stale generation callback accepted")
			}
			if count("SELECT COUNT(*) FROM approval_records WHERE request_no=? AND status='pending'", request["requestNo"]) != 1 || count("SELECT COUNT(*) FROM project_lifecycle_events WHERE project_id=?", project) != 0 || count("SELECT COUNT(*) FROM aims_projects WHERE id=? AND lifecycle_status=?", project, from) != 1 {
				t.Fatal("stale callback wrote business facts")
			}
			if _, err = a.applyProjectLifecycleWorkflowCallback(ctx, verified, callback); err != nil {
				t.Fatal(err)
			}
			if _, err = a.applyProjectLifecycleWorkflowCallback(ctx, verified, callback); err != nil {
				t.Fatal(err)
			}
			want := from
			events := 0
			if tc.status == "approved" {
				want = to
				events = 1
			}
			var actual, status string
			if err = db.QueryRow("SELECT lifecycle_status FROM aims_projects WHERE id=?", project).Scan(&actual); err != nil {
				t.Fatal(err)
			}
			if err = db.QueryRow("SELECT status FROM approval_records WHERE request_no=?", request["requestNo"]).Scan(&status); err != nil {
				t.Fatal(err)
			}
			if actual != want || status != tc.status || count("SELECT COUNT(*) FROM project_lifecycle_events WHERE project_id=?", project) != events {
				t.Fatalf("state=%s approval=%s expected=%s/%s", actual, status, want, tc.status)
			}
		})
	}
	t.Run("initiation callback generation fence leaves state and events untouched", func(t *testing.T) {
		exec("INSERT INTO aims_projects(id,project_code,name,short_name,category,leader_uid,created_by,lifecycle_status) VALUES(?, ?,'Initiation','INIT','custom_dev','U1','U1','approval_pending')", 8899+offset, fmt.Sprint("R3-INIT-", offset))
		body := projectInitiationCallbackBody("approved")
		body["biz_id"] = strconv.Itoa(8899 + offset)
		body["form_data"] = map[string]any{"projectId": strconv.Itoa(8899 + offset)}
		exec("UPDATE enterprise_schema_registry SET generation=2 WHERE id=1")
		_, err := a.applyProjectInitiationWorkflowCallback(ctx, url.Values{"workflow_callback_verified": {"true"}}, body)
		exec("UPDATE enterprise_schema_registry SET generation=1 WHERE id=1")
		if err == nil {
			t.Fatal("stale initiation accepted")
		}
		if count("SELECT COUNT(*) FROM aims_projects WHERE id=? AND lifecycle_status='approval_pending'", 8899+offset) != 1 || count("SELECT COUNT(*) FROM project_lifecycle_events WHERE project_id=?", 8899+offset) != 0 {
			t.Fatal("stale initiation wrote state or event")
		}
	})
	t.Run("ordinary Workflow active conflict and rejected-instance reuse remain unchanged", func(t *testing.T) {
		body := map[string]any{"action_def_id": 8700, "route_id": 8700, "biz_id": "legacy-r3", "biz_title": "Legacy", "current_user": "U1", "form_data": map[string]any{"reason": "ordinary"}}
		out, err := ProjectLifecycleWorkflowCreate(ctx, workflowDB, body)
		if err != nil {
			t.Fatal(err)
		}
		instance := fmt.Sprint(out["instance_id"])
		_, err = ProjectLifecycleWorkflowCreate(ctx, workflowDB, body)
		requireConflict(err)
		workflowExec("UPDATE flow_instances SET status='rejected' WHERE id=?", instance)
		out, err = ProjectLifecycleWorkflowCreate(ctx, workflowDB, body)
		if err != nil {
			t.Fatal(err)
		}
		if fmt.Sprint(out["instance_id"]) != instance || workflowCount("SELECT COUNT(*) FROM flow_instances WHERE biz_id='legacy-r3'") != 1 {
			t.Fatal("ordinary rejected instance no longer reused")
		}
	})
}
