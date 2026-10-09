package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"testing"
	"time"
)

func TestAPF16gServiceSummaryMySQL(t *testing.T) {
	s, db := costFixture(t)
	b := s.binding
	d := b.Domains["altoc"]
	for _, table := range append(domaininstall.AltocSalesTables(), domaininstall.AltocServicesTables()...) {
		if _, e := db.Exec(table.DDL); e != nil {
			t.Fatal(e)
		}
		d.Tables[table.Logical] = table.Physical
	}
	b.Domains["altoc"] = d
	r := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e := r.Register(context.Background(), b); e != nil {
		t.Fatal(e)
	}
	s, e := New(r, b)
	if e != nil {
		t.Fatal(e)
	}
	for _, q := range []string{"INSERT INTO altoc_service_agreement(id,code,name,contract_id) VALUES(1,'SA1','Fixture',1)", "INSERT INTO altoc_service_agreement_project_rel(service_agreement_id,project_code) VALUES(1,'P1'),(1,'P2')"} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	who := Identity{Actor: "maker", Client: "enterprise.runtime", Tenant: b.Key.Tenant, Deployment: b.Domains["altoc"].OwnerDeployment}
	p := ServiceSummaryAuthorization{ActorUID: who.Actor, Tenant: who.Tenant, Deployment: who.Deployment, ExpiresAt: time.Now().UnixMilli() + 14000, Invoices: "none", Receipts: "none", Reconciliation: "none", CostAccess: "none", ProjectCodes: []string{}}
	run := func(op string, p ServiceSummaryAuthorization, scope altoc.BasicReadScope) (map[string]any, error) {
		raw, _ := json.Marshal(p)
		payload := map[string]any{"financeAuthorization": string(raw)}
		if op == "service-cost-summary-view" {
			payload["periodMonth"] = "2026-10"
		}
		out, e := s.ServiceSummary(context.Background(), op, SalesInput{ID: "1", Payload: payload}, who, scope)
		if e != nil {
			return nil, e
		}
		return out.(map[string]any), nil
	}
	all := altoc.BasicReadScope{Access: "all"}
	for _, op := range []string{"customer-service-finance-summary", "service-cost-summary-view"} {
		out, e := run(op, p, all)
		if e != nil || len(out) != 1 || out["access"] != "denied" {
			t.Fatal(op, out, e)
		}
	}
	p.CostAccess = "projects"
	p.ProjectCodes = []string{"P1"}
	out, e := run("service-cost-summary-view", p, all)
	if e != nil {
		t.Fatal(e)
	}
	items := out["items"].([]map[string]any)
	if len(items) != 1 || items[0]["projectCode"] != "P1" || items[0]["readiness"] != "not_ready" || items[0]["laborCostAmount"] != nil {
		t.Fatal(out)
	}
	if _, e = db.Exec("INSERT INTO finance_project_summary(project_code,period_month,currency_code,labor_cost_amount,gross_profit_amount,cost_readiness_status,cost_missing_inputs_json) VALUES('P1','2026-10','CNY',12,3,'ready',JSON_ARRAY()),('P2','2026-10',NULL,NULL,NULL,'not_ready',JSON_ARRAY('missing'))"); e != nil {
		t.Fatal(e)
	}
	out, e = run("service-cost-summary-view", p, all)
	if e != nil {
		t.Fatal(e)
	}
	items = out["items"].([]map[string]any)
	if len(items) != 1 || items[0]["laborCostAmount"] != "12.00" {
		t.Fatal(out)
	}
	if _, e = run("service-cost-summary-view", p, altoc.BasicReadScope{Access: "self"}); e != nil {
		t.Fatal("owner positive", e)
	}
	other := who
	other.Actor = "other"
	raw, _ := json.Marshal(p)
	if _, e = s.ServiceSummary(context.Background(), "service-cost-summary-view", SalesInput{ID: "1", Payload: map[string]any{"financeAuthorization": string(raw), "periodMonth": "2026-10"}}, other, all); e == nil {
		t.Fatal("actor mismatch")
	}
	p.CostAccess = "none"
	p.ProjectCodes = []string{}
	if _, e = db.Exec("INSERT INTO finance_invoice(code,customer_code,contract_code,invoice_amount,currency_code,issued_by) VALUES('I1','C1','CT1',10,'CNY','maker'),('I2','C1','CT1',20,'USD','other'),('I3','C1','OTHER',99,'CNY','maker')"); e != nil {
		t.Fatal(e)
	}
	p.Invoices = "self"
	out, e = run("customer-service-finance-summary", p, all)
	if e != nil || out["receipts"].(map[string]any)["access"] != "denied" {
		t.Fatal(out, e)
	}
	totals := out["invoices"].(map[string]any)["currencyTotals"].([]map[string]any)
	if len(totals) != 1 || totals[0]["amount"] != "10.00" || totals[0]["count"] != int64(1) {
		t.Fatal(out)
	}
	p.Invoices = "all"
	out, e = run("customer-service-finance-summary", p, all)
	if e != nil {
		t.Fatal(e)
	}
	totals = out["invoices"].(map[string]any)["currencyTotals"].([]map[string]any)
	if len(totals) != 2 {
		t.Fatal("currencies must remain separate", out)
	}
}
