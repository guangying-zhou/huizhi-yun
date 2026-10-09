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
	"time"
)

func TestAPF11bFinanceFormalWorkflowMySQL(t *testing.T) {
	s, db := financeLedgerFixture(t)
	ctx := context.Background()
	exec := func(db *sql.DB, q string, args ...any) {
		t.Helper()
		if _, e := db.Exec(q, args...); e != nil {
			t.Fatal(q, e)
		}
	}
	binding := s.binding
	d := binding.Domains["finance"]
	d.Scheduler = enterprise.PathUnified
	binding.Domains["finance"] = d
	registry := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e := registry.Register(ctx, binding); e != nil {
		t.Fatal(e)
	}
	var e error
	s, e = New(registry, binding)
	if e != nil {
		t.Fatal(e)
	}
	cfg := mysql.NewConfig()
	cfg.User = "root"
	cfg.Net = "unix"
	cfg.Addr = os.Getenv("HZY_DOMAIN_INSTALL_SOCKET")
	cfg.ParseTime = true
	name := "apf11b_workflow_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	s.ConfigureFinanceApprovalReader(wa)

	nodes := `[{"name":"Review","type":"approve","approve_mode":"any","assignees":[{"type":"user","uid":"reviewer"}]}]`
	exec(wdb, "INSERT INTO flow_schemas(id,code,name,nodes,config,created_by) VALUES(911,'apf11b','APF11b',?,JSON_OBJECT('allow_resubmit',true),'fixture')", nodes)
	exec(wdb, "INSERT INTO flow_action_defs(id,app_code,resource_code,action_code,name,created_by) VALUES(911,'finance','invoices','request','Invoice request','fixture')")
	exec(wdb, "INSERT INTO flow_routes(id,action_def_id,flow_schema_id,name,is_default,created_by) VALUES(911,911,911,'Default',1,'fixture')")
	who := Identity{Actor: "maker", Tenant: s.binding.Key.Tenant, Deployment: "host-test", Client: "enterprise.runtime", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "all"}
	count := func(q string, args ...any) int {
		t.Helper()
		var n int
		if e := db.QueryRow(q, args...).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return n
	}
	create := func(f *FrozenFinanceApproval, path string) int64 {
		t.Helper()
		out, e := wa.CreateInstance(ctx, map[string]any{"current_user": f.Actor, "action_def_id": 911, "route_id": 911, "biz_id": f.BizID, "biz_title": f.Title, "form_data": f.Form, "callback_url": path})
		if e != nil {
			t.Fatal("create", e)
		}
		return out.Data.(map[string]any)["instance_id"].(int64)
	}
	for n, status := range []string{"approved", "rejected"} {
		t.Run(status, func(t *testing.T) {
			actor := who
			actor.Key = fmt.Sprint("submit-", n)
			code := fmt.Sprint("IR-FIX-", n)
			exec(db, "INSERT INTO finance_invoice_request(code,requested_by,requested_amount,currency_code,invoice_item,status) VALUES(?,'maker',10,'CNY','Marked','draft')", code)
			input := FinanceInput{Code: code, Payload: map[string]any{"expectedVersion": float64(1)}}
			if _, e := s.FinanceApproval(ctx, "invoice-approval-request", input, actor, altoc.BasicReadScope{Access: "none"}); e == nil {
				t.Fatal("no scope")
			}
			wrong := actor
			wrong.Actor = "other"
			if _, e := s.FinanceApproval(ctx, "invoice-approval-request", input, wrong, scope); e == nil {
				t.Fatal("non applicant")
			}
			out, e := s.FinanceApproval(ctx, "invoice-approval-request", input, actor, scope)
			if e != nil {
				t.Fatal("freeze", e)
			}
			f := out.(*FrozenFinanceApproval)
			resume := FinanceInput{Code: code, Payload: map[string]any{"expectedVersion": float64(2), "phase": "recover"}}
			refreshed := actor
			refreshed.Key = "new-browser-key"
			recovered, e := s.FinanceApproval(ctx, "invoice-approval-request", resume, refreshed, scope)
			if e != nil || recovered.(*FrozenFinanceApproval).Key != f.Key || recovered.(*FrozenFinanceApproval).RequestNo != f.RequestNo {
				t.Fatal("recover original frozen intent", e)
			}
			if _, e = s.FinanceApproval(ctx, "invoice-approval-request", resume, wrong, scope); e == nil {
				t.Fatal("recover other applicant")
			}
			if _, e = s.FinanceApproval(ctx, "invoice-approval-request", resume, refreshed, altoc.BasicReadScope{Access: "none"}); e == nil {
				t.Fatal("recover without scope")
			}
			resume.Payload["expectedVersion"] = float64(1)
			if _, e = s.FinanceApproval(ctx, "invoice-approval-request", resume, refreshed, scope); e == nil {
				t.Fatal("recover stale version")
			}
			if count("SELECT COUNT(*) FROM finance_audit_log WHERE entity_code=? AND action='invoice-approval-request'", code) != 1 {
				t.Fatal("recovery froze another command")
			}

			replay, e := s.FinanceApproval(ctx, "invoice-approval-request", input, actor, scope)
			if e != nil || replay.(*FrozenFinanceApproval).RequestNo != f.RequestNo {
				t.Fatal("freeze replay", e)
			}
			if _, e := s.FinanceApproval(ctx, "invoice-approval-bind", input, actor, scope); e == nil {
				t.Fatal("missing instance")
			}
			queue, e := s.PendingFinanceApprovals(ctx)
			if e != nil || len(queue) != 1 {
				t.Fatal("queue", e, len(queue))
			}
			path := "/api/v1/finance/workflow/callback"
			if n == 1 {
				path = "/finance/api/v1/finance/workflow/callback"
			}
			instance := create(f, path)
			if create(f, path) != instance {
				t.Fatal("create replay")
			}
			if n == 0 {
				if _, e := s.BindFinanceApprovalSystem(ctx, f.RequestNo); e != nil {
					t.Fatal("recover bind", e)
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
			if _, _, e := wa.HandleRuntime(ctx, http.MethodPost, "/v1/workflow/tasks/"+task+"/"+action, url.Values{}, map[string]any{"current_user": "maker", "comment": "self"}); e == nil {
				t.Fatal("self review")
			}
			if _, _, e := wa.HandleRuntime(ctx, http.MethodPost, "/v1/workflow/tasks/"+task+"/"+action, url.Values{}, map[string]any{"current_user": "reviewer", "comment": "Reviewed"}); e != nil {
				t.Fatal("decision", e)
			}
			var payload string
			if e := wdb.QueryRow("SELECT payload FROM flow_callback_logs WHERE instance_id=?", instance).Scan(&payload); e != nil {
				t.Fatal(e)
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
				if _, e := s.FinanceApprovalCallback(ctx, bad, system); e == nil {
					t.Fatal("forgery", field)
				}
			}
			if _, e := s.FinanceApprovalCallback(ctx, body, system); e != nil {
				t.Fatal("callback", e)
			}
			if _, e := s.FinanceApprovalCallback(ctx, body, system); e != nil {
				t.Fatal("callback replay", e)
			}
			if _, e := s.FinanceApproval(ctx, "invoice-approval-bind", input, actor, scope); e != nil {
				t.Fatal("late bind", e)
			}
			if count("SELECT COUNT(*) FROM finance_invoice_request WHERE code=? AND status=?", code, status) != 1 {
				t.Fatal("final state")
			}
			if count("SELECT COUNT(*) FROM finance_invoice WHERE invoice_request_id=(SELECT id FROM finance_invoice_request WHERE code=?)", code) != 0 {
				t.Fatal("approval created invoice")
			}
			if count("SELECT COUNT(*) FROM finance_audit_log WHERE entity_code=? AND action='invoice-approval-result'", code) != 1 {
				t.Fatal("duplicate audit")
			}
			if status == "rejected" {
				var version float64
				db.QueryRow("SELECT row_version FROM finance_invoice_request WHERE code=?", code).Scan(&version)
				next := actor
				next.Key = "next-round"
				fresh, e := s.FinanceApproval(ctx, "invoice-approval-request", FinanceInput{Code: code, Payload: map[string]any{"expectedVersion": version}}, next, scope)
				if e != nil || fresh.(*FrozenFinanceApproval).RequestNo == f.RequestNo {
					t.Fatal("new round", e)
				}
				if _, e := s.FinanceApprovalCallback(ctx, body, system); e != nil {
					t.Fatal("old duplicate ack", e)
				}
				if count("SELECT COUNT(*) FROM finance_invoice_request WHERE code=? AND status='pending_approval'", code) != 1 {
					t.Fatal("old callback advanced new round")
				}
				create(fresh.(*FrozenFinanceApproval), path)
				if _, e := s.BindFinanceApprovalSystem(ctx, fresh.(*FrozenFinanceApproval).RequestNo); e != nil {
					t.Fatal("new round bind", e)
				}
			}
		})
	}
	// Legacy ordinary Finance Workflow remains independent of frozen APF forms.
	if _, e := wa.CreateInstance(ctx, map[string]any{"current_user": "maker", "action_def_id": 911, "route_id": 911, "biz_id": "LEGACY", "biz_title": "Legacy", "form_data": map[string]any{"amount": 1}, "callback_url": "/finance/api/v1/finance/workflow/callback"}); e != nil {
		t.Fatal("legacy create changed", e)
	}
	// Source creates verify both scopes and receipt replay survives renewed grants.
	who.Key = "source-original"
	revision := int64(1)
	permit := FinanceAltocPermit{ActorUID: who.Actor, Tenant: who.Tenant, Deployment: who.Deployment, Resource: "contract", Action: "edit", Operation: "save", ObjectID: "1", Allowed: true, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "hash", PolicyRevision: &revision, Scope: altoc.BasicReadScope{Access: "self"}}
	raw, _ := json.Marshal(permit)
	source := FinanceInput{Payload: map[string]any{"contractId": "1", "billingScheduleCode": "BS1", "expectedContractVersion": float64(1), "scheduleVersion": float64(1), "requestedAmount": "10.00", "invoiceItem": "Source marked", "altocAuthorization": string(raw)}}
	if _, e := s.FinanceApproval(ctx, "invoice-requests-from-altoc", source, who, altoc.BasicReadScope{Access: "none"}); e == nil {
		t.Fatal("finance source permission")
	}
	wrong := who
	wrong.Actor = "other"
	if _, e := s.FinanceApproval(ctx, "invoice-requests-from-altoc", source, wrong, scope); e == nil {
		t.Fatal("secondary actor")
	}
	// Owner scope is checked against locked Altoc facts, independently of Finance scope.
	exec(db, "UPDATE altoc_contract SET owner_uid='someone-else' WHERE id=1")
	if _, e := s.FinanceApproval(ctx, "invoice-requests-from-altoc", source, who, scope); e == nil {
		t.Fatal("Altoc current owner scope")
	}
	exec(db, "UPDATE altoc_contract SET owner_uid='maker' WHERE id=1")
	source.Payload["scheduleVersion"] = float64(999)
	if _, e := s.FinanceApproval(ctx, "invoice-requests-from-altoc", source, who, scope); e == nil {
		t.Fatal("stale source version")
	}
	source.Payload["scheduleVersion"] = float64(1)
	result, e := s.FinanceApproval(ctx, "invoice-requests-from-altoc", source, who, scope)
	if e != nil {
		t.Fatal("source create", e)
	}
	row := result.(map[string]any)["data"].(map[string]any)
	if row["source_app"] != "altoc" || row["source_biz_code"] != "BS1" || row["customer_name"] != "Marked customer" {
		t.Fatal("source snapshot", row)
	}
	permit.ExpiresAt = time.Now().Add(11 * time.Second).UnixMilli()
	raw, _ = json.Marshal(permit)
	source.Payload["altocAuthorization"] = string(raw)
	replay, e := s.FinanceApproval(ctx, "invoice-requests-from-altoc", source, who, scope)
	if e != nil || replay.(map[string]any)["data"].(map[string]any)["code"] != row["code"] {
		t.Fatal("source original key", e)
	}
	// Caller-Tx rollback: no owning request/receipt survives a summary write failure.
	beforeRequests := count("SELECT COUNT(*) FROM finance_invoice_request")
	beforeReceipts := count("SELECT COUNT(*) FROM finance_service_command_receipt")
	fault := who
	fault.Key = "source-summary-rollback"
	input := FinanceInput{Payload: map[string]any{}}
	for k, v := range source.Payload {
		input.Payload[k] = v
	}
	var cv, bv float64
	db.QueryRow("SELECT row_version FROM altoc_contract WHERE id=1").Scan(&cv)
	db.QueryRow("SELECT row_version FROM altoc_billing_schedule WHERE id=1").Scan(&bv)
	input.Payload["expectedContractVersion"] = cv
	input.Payload["scheduleVersion"] = bv
	exec(db, "CREATE TRIGGER apf11b_summary_fault BEFORE UPDATE ON finance_contract_summary FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated summary fault'")
	if _, e := s.FinanceApproval(ctx, "invoice-requests-from-altoc", input, fault, scope); e == nil {
		t.Fatal("fault injected")
	}
	exec(db, "DROP TRIGGER apf11b_summary_fault")
	if count("SELECT COUNT(*) FROM finance_invoice_request") != beforeRequests || count("SELECT COUNT(*) FROM finance_service_command_receipt") != beforeReceipts {
		t.Fatal("caller transaction leaked")
	}
	if _, e := s.FinanceApproval(ctx, "invoice-requests-from-altoc", input, fault, scope); e != nil {
		t.Fatal("rollback original-key retry", e)
	}
	source.Payload["requestedAmount"] = "11.00"
	if _, e := s.FinanceApproval(ctx, "invoice-requests-from-altoc", source, who, scope); e == nil {
		t.Fatal("source changed intent")
	}
	// Rejected requests release reservation. Resubmission must recheck capacity
	// under the same Altoc-parent-before-Finance lock order as competing creates.
	exec(db, "INSERT INTO altoc_billing_schedule(id,code,contract_id,name,trigger_type,amount,status,billable_at) VALUES(2,'BS2',1,'Capacity','manual',100,'billable',NOW())")
	exec(db, "INSERT INTO finance_invoice_request(code,contract_code,billing_schedule_code,requested_by,requested_amount,currency_code,invoice_item,status) VALUES('IR-RETRY','CT1','BS2','maker',20,'CNY','retry','rejected'),('IR-USED','CT1','BS2','maker',90,'CNY','used','draft')")
	retry := who
	retry.Key = "capacity-retry"
	input = FinanceInput{Code: "IR-RETRY", Payload: map[string]any{"expectedVersion": float64(1)}}
	if _, e := s.FinanceApproval(ctx, "invoice-approval-request", input, retry, scope); e == nil {
		t.Fatal("resubmission overbooked plan")
	}
	if count("SELECT COUNT(*) FROM finance_invoice_request WHERE code='IR-RETRY' AND status='rejected' AND row_version=1") != 1 {
		t.Fatal("failed resubmission mutated request")
	}
	exec(db, "UPDATE finance_invoice_request SET status='canceled' WHERE code='IR-USED'")
	if _, e := s.FinanceApproval(ctx, "invoice-approval-request", input, retry, scope); e != nil {
		t.Fatal("capacity retry", e)
	}
	if _, e := s.FinanceLedger(ctx, "invoice-requests-detail", FinanceInput{Code: "IR-RETRY"}, who, altoc.BasicReadScope{Access: "self"}); e != nil {
		t.Fatal("applicant tracking pending", e)
	}
	wrong = who
	wrong.Actor = "outsider"
	if _, e := s.FinanceLedger(ctx, "invoice-requests-detail", FinanceInput{Code: "IR-RETRY"}, wrong, altoc.BasicReadScope{Access: "self"}); e == nil {
		t.Fatal("tracking leaked to outsider")
	}

}
