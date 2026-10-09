package finance

import (
	"encoding/json"
	"strings"
	"testing"
)

func productLaborCurrencyFact() productCostAllocationFact {
	return productCostAllocationFact{
		Code: "COST-1", ProjectCode: "PRJ-1", PeriodMonth: "2026-09", EmployeeUID: "U1",
		AllocationType: "labor", SourceTable: managedLaborSourceTable, RuleCode: managedLaborRuleCode,
		Status: "active", Amount: "100.00",
		SourceRefs: json.RawMessage(`{"sourceApp":"finance","projectCode":"PRJ-1","periodMonth":"2026-09","costBasis":"standard","calculationRule":"aims_workload_standard_cost_calendar_hours_v1","people":{"employeeUid":"U1","standardRateCode":"RATE-1","standardRateCurrencyCode":"CNY"},"financeCostParameters":{"code":"PARAM-1","currencyCode":"CNY","effectiveDate":"2026-09-01"}}`),
	}
}

func TestProductCostAllocationCurrencyEvidence(t *testing.T) {
	fact := productLaborCurrencyFact()
	if currency, reason := productCostAllocationCurrency(fact); currency != "CNY" || reason != "" {
		t.Fatalf("%s %s", currency, reason)
	}
	cases := []struct {
		name, reason string
		mutate       func(*productCostAllocationFact)
	}{
		{"reversed", "allocation_reversed", func(f *productCostAllocationFact) { f.Status = "reversed" }},
		{"unknown status", "invalid_allocation_fact", func(f *productCostAllocationFact) { f.Status = "draft" }},
		{"negative", "invalid_allocation_fact", func(f *productCostAllocationFact) { f.Amount = "-1.00" }},
		{"asset", "unsupported_cost_currency_source", func(f *productCostAllocationFact) { f.AllocationType = "asset" }},
		{"wrong rule", "unsupported_cost_currency_source", func(f *productCostAllocationFact) { f.RuleCode = "manual" }},
		{"wrong project", "cost_source_evidence_mismatch", func(f *productCostAllocationFact) { f.ProjectCode = "PRJ-2" }},
		{"wrong employee", "cost_source_evidence_mismatch", func(f *productCostAllocationFact) { f.EmployeeUID = "U2" }},
		{"wrong period", "cost_source_evidence_mismatch", func(f *productCostAllocationFact) { f.PeriodMonth = "2026-10" }},
		{"missing evidence", "invalid_cost_source_evidence", func(f *productCostAllocationFact) { f.SourceRefs = nil }},
		{"null evidence", "cost_source_evidence_mismatch", func(f *productCostAllocationFact) { f.SourceRefs = json.RawMessage(`null`) }},
		{"legacy currency", "missing_cost_currency", func(f *productCostAllocationFact) {
			f.SourceRefs = json.RawMessage(strings.ReplaceAll(string(f.SourceRefs), `"CNY"`, `null`))
		}},
		{"mixed currencies", "mixed_cost_source_currencies", func(f *productCostAllocationFact) {
			f.SourceRefs = json.RawMessage(strings.Replace(string(f.SourceRefs), `"CNY"`, `"USD"`, 1))
		}},
		{"conflicting ledger currency", "mixed_cost_source_currencies", func(f *productCostAllocationFact) { f.CurrencyCode = "USD" }},
		{"explicit currency cannot replace labor evidence", "invalid_cost_source_evidence", func(f *productCostAllocationFact) {
			f.CurrencyCode, f.SourceRefs = "USD", nil
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := productLaborCurrencyFact()
			tc.mutate(&f)
			currency, reason := productCostAllocationCurrency(f)
			if currency != "" || reason != tc.reason {
				t.Fatalf("currency=%q reason=%q", currency, reason)
			}
		})
	}
}
