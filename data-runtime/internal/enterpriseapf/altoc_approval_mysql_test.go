package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/workflow"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
)

func TestAPFApprovalFormalWorkflowMySQL(t *testing.T) {
	s, db := customerFixture(t)
	ctx := context.Background()
	if _, e := s.PendingAltocApprovals(ctx); e == nil {
		t.Fatal("disabled scheduler read allowed")
	}
	binding := s.binding
	binding.Domains = map[string]enterprise.DomainBinding{}
	for key, value := range s.binding.Domains {
		binding.Domains[key] = value
	}
	domain := binding.Domains["altoc"]
	domain.Scheduler = enterprise.PathUnified
	binding.Domains["altoc"] = domain
	registry := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e := registry.Register(ctx, binding); e != nil {
		t.Fatal(e)
	}
	s, e := New(registry, binding)
	if e != nil {
		t.Fatal(e)
	}
	cfg := mysql.NewConfig()
	cfg.User = "root"
	cfg.Net = "unix"
	cfg.Addr = os.Getenv("HZY_DOMAIN_INSTALL_SOCKET")
	cfg.ParseTime = true
	name := "apf12_workflow_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e := db.Exec("CREATE DATABASE " + name); e != nil {
		t.Fatal(e)
	}
	defer db.Exec("DROP DATABASE " + name)
	cfg.DBName = name
	wdb, e := sql.Open("mysql", cfg.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	defer wdb.Close()
	exec := func(db *sql.DB, q string, args ...any) {
		t.Helper()
		if _, e := db.Exec(q, args...); e != nil {
			t.Fatal(q, e)
		}
	}
	schema, e := os.ReadFile("../../../workflow/docs/workflow_schema.sql")
	if e != nil {
		t.Fatal(e)
	}
	wdb.SetMaxOpenConns(1)
	exec(wdb, "SET FOREIGN_KEY_CHECKS=0")
	for _, ddl := range regexp.MustCompile("(?ms)^CREATE TABLE(?: IF NOT EXISTS)? `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(schema), -1) {
		if strings.HasPrefix(ddl[1], "flow_") {
			exec(wdb, ddl[0])
		}
	}
	exec(wdb, "SET FOREIGN_KEY_CHECKS=1")
	wdb.SetMaxOpenConns(8)
	wa := workflow.NewWithDB(wdb)
	s.ConfigureAltocApprovalReader(wa)
	nodes := `[{"name":"Review","type":"approve","approve_mode":"any","assignees":[{"type":"user","uid":"reviewer"}]}]`
	exec(wdb, "INSERT INTO flow_schemas(id,code,name,nodes,config,created_by) VALUES(910,'apf12','APF12',?,JSON_OBJECT('allow_resubmit',true),'fixture')", nodes)
	for n, resource := range []string{"quotation", "contract"} {
		exec(wdb, "INSERT INTO flow_action_defs(id,app_code,resource_code,action_code,name,created_by) VALUES(?,'altoc',?,'approve',?,'fixture')", 910+n, resource, resource)
		exec(wdb, "INSERT INTO flow_routes(id,action_def_id,flow_schema_id,name,is_default,created_by) VALUES(?,?,910,'Default',1,'fixture')", 910+n, 910+n)
	}
	exec(db, "INSERT INTO altoc_customer(id,code,name,owner_uid) VALUES(1,'MARKED-C','Marked','actor')")
	who := Identity{Actor: "actor", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "self"}
	create := func(f *FrozenAltocApproval, def int) workflow.InstanceAPIResponse {
		t.Helper()
		out, e := wa.CreateInstance(ctx, map[string]any{"current_user": f.Actor, "action_def_id": def, "route_id": def, "biz_id": f.BizID, "biz_title": f.Title, "form_data": f.Form, "callback_url": workflowapproval.CallbackPath})
		if e != nil {
			t.Fatal("formal create", e)
		}
		return out
	}
	count := func(db *sql.DB, q string, args ...any) int {
		t.Helper()
		var n int
		if e := db.QueryRow(q, args...).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return n
	}
	for n, resource := range []string{"quotation", "contract"} {
		for j, status := range []string{"approved", "rejected"} {
			t.Run(resource+"/"+status, func(t *testing.T) {
				id := fmt.Sprint(100 + n*10 + j)
				table := "altoc_" + resource
				if resource == "quotation" {
					exec(db, "INSERT INTO altoc_quotation(id,code,customer_id,owner_uid) VALUES(?,?,1,'actor')", id, "MARKED-"+id)
					exec(db, "INSERT INTO altoc_quotation_item(quotation_id,line_no,item_name,quantity,unit_price,amount_tax_inclusive,amount_tax_exclusive) VALUES(?,1,'Marked item',1,1,1,1)", id)
				} else {
					exec(db, "INSERT INTO altoc_contract(id,code,name,customer_id,owner_uid) VALUES(?,?,?,1,'actor')", id, "MARKED-"+id, "Marked contract")
				}
				actor := who
				actor.Key = "submit-" + id
				input := Input{ID: id, RowVersion: 1}
				if _, e := s.AltocApproval(ctx, resource+"-approval-request", input, actor, altoc.BasicReadScope{Access: "none"}); e == nil {
					t.Fatal("unscoped submit")
				}
				out, e := s.AltocApproval(ctx, resource+"-approval-request", input, actor, scope)
				if e != nil {
					t.Fatal("request", e)
				}
				f := out.(*FrozenAltocApproval)
				replay, e := s.AltocApproval(ctx, resource+"-approval-request", input, actor, scope)
				if e != nil || replay.(*FrozenAltocApproval).RequestNo != f.RequestNo {
					t.Fatal("request replay", e)
				}
				if count(db, "SELECT COUNT(*) FROM altoc_integration_operation WHERE operation_key=?", f.RequestNo) != 1 {
					t.Fatal("outbox duplicate")
				}
				changed := input
				changed.RowVersion = 2
				if _, e := s.AltocApproval(ctx, resource+"-approval-request", changed, actor, scope); e == nil {
					t.Fatal("changed intent")
				}
				s.ConfigureAltocApprovalReader(nil)
				if _, e := s.AltocApproval(ctx, resource+"-approval-bind", input, actor, scope); e == nil {
					t.Fatal("missing reader")
				}
				s.ConfigureAltocApprovalReader(wa)
				first := create(f, 910+n)
				again := create(f, 910+n)
				instance := fmt.Sprint(first.Data.(map[string]any)["instance_id"])
				if fmt.Sprint(again.Data.(map[string]any)["instance_id"]) != instance || count(wdb, "SELECT COUNT(*) FROM flow_instances WHERE biz_id=?", id) != 1 {
					t.Fatal("duplicate instance")
				}
				callbackBeforeBind := resource == "quotation" && status == "approved"
				if !callbackBeforeBind {
					if _, e := s.AltocApproval(ctx, resource+"-approval-bind", input, actor, scope); e != nil {
						t.Fatal("bind", e)
					}
					if _, e := s.BindAltocApprovalSystem(ctx, f.RequestNo); e != nil {
						t.Fatal("bind replay", e)
					}
				}
				var task string
				if e := wdb.QueryRow("SELECT id FROM flow_tasks WHERE instance_id=? AND status='pending'", instance).Scan(&task); e != nil {
					t.Fatal(e)
				}
				action := "approve"
				if status == "rejected" {
					action = "reject"
				}
				if _, _, e := wa.HandleRuntime(ctx, http.MethodPost, "/v1/workflow/tasks/"+task+"/"+action, url.Values{}, map[string]any{"current_user": "actor", "comment": "Denied"}); e == nil {
					t.Fatal("self approval")
				}
				if _, _, e := wa.HandleRuntime(ctx, http.MethodPost, "/v1/workflow/tasks/"+task+"/"+action, url.Values{}, map[string]any{"current_user": "reviewer", "comment": "Reviewed"}); e != nil {
					t.Fatal("decision", e)
				}
				var payload string
				if e := wdb.QueryRow("SELECT payload FROM flow_callback_logs WHERE instance_id=?", instance).Scan(&payload); e != nil {
					t.Fatal("durable callback", e)
				}
				var body map[string]any
				if json.Unmarshal([]byte(payload), &body) != nil {
					t.Fatal("payload")
				}
				system := who
				system.Actor = ""
				for _, field := range []string{"app_code", "resource_code", "action_code", "biz_id", "instance_id", "instance_no", "initiator_uid", "status", "approval_operator_uid", "idempotencyKey"} {
					bad := map[string]any{}
					for k, v := range body {
						bad[k] = v
					}
					bad[field] = "wrong"
					if _, e := s.AltocApprovalCallback(ctx, bad, system); e == nil {
						t.Fatal("spoof accepted", field)
					}
				}
				if _, e := s.AltocApprovalCallback(ctx, body, system); e != nil {
					t.Fatal("callback", e)
				}
				if _, e := s.AltocApprovalCallback(ctx, body, system); e != nil {
					t.Fatal("callback replay", e)
				}
				finalVersion := 4
				if callbackBeforeBind {
					finalVersion = 3
					if _, e := s.AltocApproval(ctx, resource+"-approval-bind", input, actor, scope); e != nil {
						t.Fatal("late bind after callback", e)
					}
					if _, e := s.BindAltocApprovalSystem(ctx, f.RequestNo); e != nil {
						t.Fatal("late system bind replay", e)
					}
				}
				if count(db, "SELECT COUNT(*) FROM "+table+" WHERE id=? AND status=? AND row_version=?", id, status, finalVersion) != 1 {
					t.Fatal("state/version")
				}
				if count(db, "SELECT COUNT(*) FROM altoc_audit_log WHERE entity_id=? AND action='approval-result'", id) != 1 {
					t.Fatal("duplicate audit")
				}
				if count(db, "SELECT COUNT(*) FROM altoc_service_command_receipt WHERE operation_code LIKE ?", "altoc.approval."+resource+".%") != (j+1)*3 {
					t.Fatal("request/bind/callback receipts")
				}
				if status == "rejected" {
					next := actor
					next.Key = "resubmit-" + id
					fresh, e := s.AltocApproval(ctx, resource+"-approval-request", Input{ID: id, RowVersion: 4}, next, scope)
					if e != nil {
						t.Fatal("resubmit", e)
					}
					newer := create(fresh.(*FrozenAltocApproval), 910+n)
					if fmt.Sprint(newer.Data.(map[string]any)["instance_id"]) == instance {
						t.Fatal("old round overwritten")
					}
					if _, e := s.AltocApprovalCallback(ctx, body, system); e != nil {
						t.Fatal("old receipt replay", e)
					}
					if count(db, "SELECT COUNT(*) FROM "+table+" WHERE id=? AND status='pending_approval' AND row_version=5", id) != 1 {
						t.Fatal("late callback changed new round")
					}
				}
			})
		}
	}
	// Ordinary Workflow creation does not acquire APF form/key requirements.
	exec(wdb, "INSERT INTO flow_action_defs(id,app_code,resource_code,action_code,name,created_by) VALUES(920,'ordinary','record','approve','Ordinary','fixture')")
	exec(wdb, "INSERT INTO flow_routes(id,action_def_id,flow_schema_id,name,is_default,created_by) VALUES(920,920,910,'Default',1,'fixture')")
	if _, e := wa.CreateInstance(ctx, map[string]any{"current_user": "actor", "action_def_id": 920, "route_id": 920, "biz_id": "ordinary", "biz_title": "Ordinary", "form_data": map[string]any{"free": "unchanged"}}); e != nil {
		t.Fatal("ordinary create changed", e)
	}
}
