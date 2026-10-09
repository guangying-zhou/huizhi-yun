package enterpriseapf

import (
	"encoding/json"
	"testing"
	"time"
)

func TestAPF16gSummaryAuthorization(t *testing.T) {
	who := Identity{Actor: "actor", Tenant: "tenant", Deployment: "host"}
	p := ServiceSummaryAuthorization{ActorUID: who.Actor, Tenant: who.Tenant, Deployment: who.Deployment, ExpiresAt: time.Now().UnixMilli() + 10000, Invoices: "none", Receipts: "none", Reconciliation: "none", CostAccess: "none", ProjectCodes: []string{}}
	encode := func(p ServiceSummaryAuthorization) string { b, _ := json.Marshal(p); return string(b) }
	if _, e := decodeSummaryAuthorization(encode(p), who); e != nil {
		t.Fatal(e)
	}
	for _, change := range []func(*ServiceSummaryAuthorization){func(p *ServiceSummaryAuthorization) { p.ActorUID = "Actor" }, func(p *ServiceSummaryAuthorization) { p.Tenant = "other" }, func(p *ServiceSummaryAuthorization) { p.Deployment = "other" }, func(p *ServiceSummaryAuthorization) { p.ExpiresAt = 1 }, func(p *ServiceSummaryAuthorization) { p.Invoices = "admin" }, func(p *ServiceSummaryAuthorization) { p.CostAccess = "projects" }} {
		bad := p
		change(&bad)
		if _, e := decodeSummaryAuthorization(encode(bad), who); e == nil {
			t.Fatal("invalid disclosure accepted", bad)
		}
	}
	for _, op := range []string{"customer-service-finance-summary", "service-cost-summary-view"} {
		payload := map[string]any{"financeAuthorization": encode(p)}
		if op == "service-cost-summary-view" {
			payload["periodMonth"] = "2026-10"
		}
		if e := ValidateSalesInput(op, SalesInput{ID: "1", Payload: payload}); e != nil {
			t.Fatal(e)
		}
		payload["access"] = "all"
		if e := ValidateSalesInput(op, SalesInput{ID: "1", Payload: payload}); e == nil {
			t.Fatal("body authority accepted")
		}
	}
}
