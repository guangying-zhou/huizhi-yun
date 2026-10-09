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
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"sync"
)

func financeSpendFixture(t *testing.T) (*Service, *sql.DB) {
	t.Helper()
	s, db := financeLedgerFixture(t)
	for _, table := range append(domaininstall.Finance13aTables(), domaininstall.Finance13bTables()...) {
		if _, e := db.Exec(table.DDL); e != nil {
			t.Fatal(table.Logical, e)
		}
	}
	b, e := domaininstall.WithFinance13a(s.binding)
	if e != nil {
		t.Fatal(e)
	}
	b, e = domaininstall.WithFinance13b(b)
	if e != nil {
		t.Fatal(e)
	}
	d := b.Domains["finance"]
	d.Scheduler = enterprise.PathUnified
	b.Domains["finance"] = d
	registry := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e = registry.Register(context.Background(), b); e != nil {
		t.Fatal(e)
	}
	s, e = New(registry, b)
	if e != nil {
		t.Fatal(e)
	}
	return s, db
}
func TestAPF13aFinanceSpendWorkflowMySQL(t *testing.T) {
	s, db := financeSpendFixture(t)
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
	name := "apf13a_workflow_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	for n, action := range []string{"claim", "project_expense", "payment"} {
		id := 920 + n
		exec(wdb, "INSERT INTO flow_schemas(id,code,name,nodes,config,created_by) VALUES(?,?, 'APF13a',?,JSON_OBJECT('allow_resubmit',true),'fixture')", id, fmt.Sprint("apf13a-", action), nodes)
		exec(wdb, "INSERT INTO flow_action_defs(id,app_code,resource_code,action_code,name,created_by) VALUES(?,'finance','expenses',?,'APF13a','fixture')", id, action)
		exec(wdb, "INSERT INTO flow_routes(id,action_def_id,flow_schema_id,name,is_default,created_by) VALUES(?,?,?,'Default',1,'fixture')", id, id, id)
	}
	who := Identity{Actor: "maker", Tenant: s.binding.Key.Tenant, Deployment: "host-test", Client: "enterprise.runtime", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "all"}
	run := func(op, code, key, actor string, p map[string]any) map[string]any {
		t.Helper()
		u := who
		u.Actor = actor
		u.Key = key
		out, e := s.FinanceLedger(ctx, op, FinanceInput{Code: code, Payload: p}, u, scope)
		if e != nil {
			t.Fatal(op, e)
		}
		return out.(map[string]any)["data"].(map[string]any)
	}
	version := func(table, code string) float64 {
		t.Helper()
		var n int
		if e := db.QueryRow("SELECT row_version FROM "+table+" WHERE code=?", code).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return float64(n)
	}
	count := func(q string, args ...any) int {
		t.Helper()
		var n int
		if e := db.QueryRow(q, args...).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return n
	}
	for n, kind := range []string{"claims", "project-requests", "payment-requests"} {
		for _, status := range []string{"approved", "rejected"} {
			t.Run(kind+"/"+status, func(t *testing.T) {
				table := map[string]string{"claims": "finance_expense_claim", "project-requests": "finance_project_expense_request", "payment-requests": "finance_payment_request"}[kind]
				action := map[string]string{"claims": "claim", "project-requests": "project_expense", "payment-requests": "payment"}[kind]
				p := map[string]any{"title": "Marked", "currencyCode": "CNY", "projectCode": "P1", "items": []any{map[string]any{"description": "Travel", "amount": "10.01"}, map[string]any{"description": "Work", "amount": "0.02"}}}
				if kind == "payment-requests" {
					delete(p, "items")
					p["requestedAmount"] = "10.03"
					p["paymentType"] = "supplier"
					p["payeeName"] = "Marked payee"
				}
				row := run(kind+"-create", "", kind+status, "maker", p)
				code := ledgerText(row["code"])
				amount := row["total_amount"]
				if kind == "payment-requests" {
					amount = row["requested_amount"]
				}
				if amount != "10.03" {
					t.Fatal("owning total", row)
				}
				replay := run(kind+"-create", "", kind+status, "maker", p)
				if replay["code"] != code {
					t.Fatal("create replay")
				}
				row = run(kind+"-update", code, "update-"+code, "maker", map[string]any{"expectedVersion": version(table, code), "remark": "Updated"})
				other := who
				other.Actor = "outsider"
				if _, e := s.FinanceLedger(ctx, kind+"-detail", FinanceInput{Code: code}, other, altoc.BasicReadScope{Access: "self"}); e == nil {
					t.Fatal("detail scope")
				}
				who.Key = "submit-" + code
				input := FinanceInput{Code: code, Payload: map[string]any{"expectedVersion": version(table, code)}}
				fraw, e := s.FinanceApproval(ctx, kind+"-submit", input, who, scope)
				if e != nil {
					t.Fatal("freeze", e)
				}
				f := fraw.(*FrozenFinanceApproval)
				refreshed := who
				refreshed.Key = "fresh-browser-" + code
				recoverInput := FinanceInput{Code: code, Payload: map[string]any{"expectedVersion": version(table, code), "phase": "recover"}}
				recovered, e := s.FinanceApproval(ctx, kind+"-submit", recoverInput, refreshed, scope)
				if e != nil || recovered.(*FrozenFinanceApproval).Key != f.Key || recovered.(*FrozenFinanceApproval).RequestNo != f.RequestNo {
					t.Fatal("refresh recovery original intent", e)
				}
				if _, e = s.FinanceApproval(ctx, kind+"-submit", recoverInput, other, scope); e == nil {
					t.Fatal("other applicant recovery")
				}
				if _, e = s.FinanceApproval(ctx, kind+"-submit", recoverInput, refreshed, altoc.BasicReadScope{Access: "none"}); e == nil {
					t.Fatal("scope-free recovery")
				}

				if _, e = s.FinanceLedger(ctx, kind+"-update", FinanceInput{Code: code, Payload: map[string]any{"expectedVersion": version(table, code), "remark": "mutated"}}, who, scope); e == nil {
					t.Fatal("pending editable")
				}
				pending, e := s.PendingFinanceApprovals(ctx)
				if e != nil || len(pending) < 1 {
					t.Fatal("recovery candidate", e)
				}
				path := "/api/v1/finance/workflow/callback"
				if status == "rejected" {
					path = "/finance/api/v1/finance/workflow/callback"
				}
				create := func() int64 {
					t.Helper()
					out, e := wa.CreateInstance(ctx, map[string]any{"current_user": f.Actor, "action_def_id": 920 + n, "route_id": 920 + n, "biz_id": f.BizID, "biz_title": f.Title, "form_data": f.Form, "callback_url": path})
					if e != nil {
						t.Fatal("create workflow", e)
					}
					return out.Data.(map[string]any)["instance_id"].(int64)
				}
				id := create()
				if create() != id {
					t.Fatal("workflow replay")
				}
				if _, e = s.BindFinanceApprovalSystem(ctx, f.RequestNo); e != nil {
					t.Fatal("bind recovery", e)
				}
				var task string
				if e = wdb.QueryRow("SELECT id FROM flow_tasks WHERE instance_id=? AND status='pending'", id).Scan(&task); e != nil {
					t.Fatal(e)
				}
				decision := "approve"
				if status == "rejected" {
					decision = "reject"
				}
				if _, _, e = wa.HandleRuntime(ctx, http.MethodPost, "/v1/workflow/tasks/"+task+"/"+decision, url.Values{}, map[string]any{"current_user": "maker"}); e == nil {
					t.Fatal("self review")
				}
				if _, _, e = wa.HandleRuntime(ctx, http.MethodPost, "/v1/workflow/tasks/"+task+"/"+decision, url.Values{}, map[string]any{"current_user": "reviewer", "comment": "Reviewed"}); e != nil {
					t.Fatal("review", e)
				}
				var payload string
				if e = wdb.QueryRow("SELECT payload FROM flow_callback_logs WHERE instance_id=?", id).Scan(&payload); e != nil {
					t.Fatal(e)
				}
				body := map[string]any{}
				if e = json.Unmarshal([]byte(payload), &body); e != nil {
					t.Fatal(e)
				}
				system := who
				system.Actor = ""
				for _, field := range []string{"resource_code", "action_code", "status", "instance_id", "initiator_uid", "approval_operator_uid", "idempotencyKey"} {
					bad := map[string]any{}
					for k, v := range body {
						bad[k] = v
					}
					bad[field] = "wrong"
					if _, e = s.FinanceApprovalCallback(ctx, bad, system); e == nil {
						t.Fatal("forged callback", field)
					}
				}
				if _, e = s.FinanceApprovalCallback(ctx, body, system); e != nil {
					t.Fatal("callback", action, e)
				}
				if _, e = s.FinanceApprovalCallback(ctx, body, system); e != nil {
					t.Fatal("callback replay", e)
				}
				if count("SELECT COUNT(*) FROM finance_expense WHERE source_request_code=?", code) != 0 {
					t.Fatal("approval generated expense")
				}
				if status == "approved" {
					pay := FinanceInput{Code: code, Payload: map[string]any{"expectedVersion": version(table, code)}}
					who.Key = "same-maker-pay-" + code
					if _, e = s.FinanceLedger(ctx, kind+"-confirm", pay, who, scope); e == nil {
						t.Fatal("maker paid")
					}
					exec(db, "UPDATE "+table+" SET handler_uid='handler' WHERE code=?", code)
					handler := who
					handler.Actor = "handler"
					if _, e = s.FinanceLedger(ctx, kind+"-confirm", pay, handler, scope); e == nil {
						t.Fatal("handler paid")
					}
					row = run(kind+"-confirm", code, "pay-"+code, "cashier", pay.Payload)
					if row["status"] != "paid" {
						t.Fatal(row)
					}
					run(kind+"-confirm", code, "pay-"+code, "cashier", pay.Payload)
					if count("SELECT COUNT(*) FROM finance_expense WHERE source_request_code=? AND status='confirmed' AND confirmed_by='cashier'", code) != 1 {
						t.Fatal("payment duplicate or actor")
					}
				} else {
					row = run(kind+"-update", code, "rejected-edit-"+code, "maker", map[string]any{"expectedVersion": version(table, code), "remark": "Draft retained"})
					run(kind+"-cancel", code, "cancel-"+code, "maker", map[string]any{"expectedVersion": version(table, code)})
				}
			})
		}
	}
	// Manual expense remains draft; actor identity is not a caller-controlled field.
	p := map[string]any{"expenseDate": "2026-10-03", "expenseAmount": "1.01", "currencyCode": "CNY", "description": "Marked manual"}
	row := run("expenses-create", "", "manual", "maker", p)
	code := ledgerText(row["code"])
	u := who
	u.Key = "wrong-confirm"
	if _, e = s.FinanceLedger(ctx, "expenses-confirm", FinanceInput{Code: code, Payload: map[string]any{"expectedVersion": version("finance_expense", code)}}, u, scope); e == nil {
		t.Fatal("manual maker confirmed")
	}
	run("expenses-confirm", code, "manual-confirm", "cashier", map[string]any{"expectedVersion": version("finance_expense", code)})
	row = run("expenses-create", "", "delete-manual", "maker", p)
	code = ledgerText(row["code"])
	payload := map[string]any{"expectedVersion": version("finance_expense", code)}
	run("expenses-delete", code, "delete", "maker", payload)
	run("expenses-delete", code, "delete", "maker", payload)
	// Two different confirmation intents race; only one can create a real ledger.
	p2 := map[string]any{"title": "Concurrent", "currencyCode": "CNY", "items": []any{map[string]any{"description": "Marked", "amount": "1.00"}}}
	row = run("claims-create", "", "concurrent", "maker", p2)
	code = ledgerText(row["code"])
	exec(db, "UPDATE finance_expense_claim SET status='approved',workflow_instance_id='isolated-prerequisite' WHERE code=?", code)
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, key := range []string{"a", "b"} {
		wg.Add(1)
		go func(key string) {
			defer wg.Done()
			u := who
			u.Actor = "cashier"
			u.Key = "concurrent-" + key
			_, e := s.FinanceLedger(ctx, "claims-confirm", FinanceInput{Code: code, Payload: map[string]any{"expectedVersion": float64(1)}}, u, scope)
			results <- e
		}(key)
	}
	wg.Wait()
	close(results)
	success := 0
	for e := range results {
		if e == nil {
			success++
		}
	}
	if success != 1 || count("SELECT COUNT(*) FROM finance_expense WHERE source_request_code=?", code) != 1 {
		t.Fatal("concurrency", success)
	}
	// Ordinary Workflow creation still does not require the APF frozen form.
	if _, e = wa.CreateInstance(ctx, map[string]any{"current_user": "maker", "action_def_id": 920, "route_id": 920, "biz_id": "LEGACY", "biz_title": "Legacy", "form_data": map[string]any{"amount": 1}, "callback_url": "/api/v1/finance/workflow/callback"}); e != nil {
		t.Fatal("legacy create", e)
	}
}

func TestAPF13aFinanceInstallerMySQL(t *testing.T) {
	s, db := financeLedgerFixture(t)
	ctx := context.Background()
	b, e := domaininstall.WithFinance13a(s.binding)
	if e != nil {
		t.Fatal(e)
	}
	installer := domaininstall.ForFinance13a(domaininstall.Expectation{Tenant: b.Key.Tenant, Environment: b.Key.Environment, OwnerDeployment: "host-test", Address: b.Storage.Address})
	plan, e := installer.PlanInstall(ctx, db, b)
	if e != nil {
		t.Fatal(e)
	}
	var receipt domaininstall.Receipt
	save := func(r domaininstall.Receipt) error { receipt = r; return nil }
	off := func(context.Context) error { return nil }
	if e = installer.Apply(ctx, db, plan, off, save); e != nil {
		t.Fatal(e)
	}
	if e = installer.VerifyReceipt(ctx, db, receipt); e != nil {
		t.Fatal(e)
	}
	if len(receipt.Created) != 5 {
		t.Fatal("subset")
	}
	if _, e = db.Exec("INSERT INTO finance_expense(code,expense_date,expense_amount)VALUES('MARKED',CURRENT_DATE(),1.00)"); e != nil {
		t.Fatal(e)
	}
	if installer.Rollback(ctx, db, receipt, off) == nil {
		t.Fatal("nonempty rollback")
	}
	if _, e = db.Exec("DELETE FROM finance_expense WHERE code='MARKED'"); e != nil {
		t.Fatal(e)
	}
	if e = installer.Rollback(ctx, db, receipt, off); e != nil {
		t.Fatal(e)
	}
	var n int
	if e = db.QueryRow("SELECT COUNT(*) FROM finance_invoice_request").Scan(&n); e != nil {
		t.Fatal("B3 touched", e)
	}
}
