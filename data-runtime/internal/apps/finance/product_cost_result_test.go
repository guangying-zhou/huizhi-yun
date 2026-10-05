package finance

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

func readyProductCostSnapshot() productCostSnapshot {
	rules := costAttributionRules()
	rules.ProjectCode = "PRJ-1"
	return productCostSnapshot{Rules: &rules, SummaryExists: true, ReadinessStatus: "ready", InputHash: strings.Repeat("a", 64), CheckedAt: "2026-09-09T12:00:00Z", DirectExpenseAmount: "0.00", LaborCostAmount: "100.00", AllocatedCostAmount: "0.00", Allocations: []productCostAllocationFact{productLaborCurrencyFact()}}
}

func TestProductProjectCostResultCurrencyIsolation(t *testing.T) {
	snapshot := readyProductCostSnapshot()
	usd := productLaborCurrencyFact()
	usd.Code = "COST-2"
	usd.SourceRefs = json.RawMessage(strings.ReplaceAll(string(usd.SourceRefs), "CNY", "USD"))
	snapshot.Allocations = append(snapshot.Allocations, usd)
	snapshot.LaborCostAmount = "200.00"
	result := aggregateProductProjectCost(snapshot)
	if !result.Ready || len(result.Distributions) != 2 {
		t.Fatalf("%+v", result)
	}
	for i, currency := range []string{"CNY", "USD"} {
		d := result.Distributions[i]
		if d.CurrencyCode != currency || d.Products[0].Amount != "50.00" || d.Products[1].Amount != "25.00" || d.UnassignedAmount != "25.00" {
			t.Fatalf("currency aggregation: %+v", d)
		}
	}
}

func TestProductProjectCostResultIncludesDirectExpenseLedger(t *testing.T) {
	snapshot := readyProductCostSnapshot()
	snapshot.DirectExpenseAmount = "20.00"
	snapshot.DirectExpenses = []productDirectExpenseFact{{Code: "E1", ProjectCode: "PRJ-1", PeriodMonth: "2026-09", Amount: "20.00", Currency: "CNY", Status: "draft"}}
	result := aggregateProductProjectCost(snapshot)
	if !result.Ready || result.Distributions[0].Products[0].Amount != "60.00" {
		t.Fatalf("expense excluded: %+v", result)
	}
	snapshot.DirectExpenses[0].Currency = ""
	result = aggregateProductProjectCost(snapshot)
	if result.Ready || len(result.Distributions) != 0 || !slices.Contains(result.Reasons, "missing_direct_expense_currency") {
		t.Fatalf("missing currency accepted: %+v", result)
	}
}

func TestProductProjectCostResultRejectsIncompleteTotals(t *testing.T) {
	cases := []struct {
		reason string
		mutate func(*productCostSnapshot)
	}{
		{"missing_attribution_rules", func(s *productCostSnapshot) { s.Rules = nil }},
		{"project_cost_not_ready", func(s *productCostSnapshot) { s.ReadinessStatus = "not_ready" }},
		{"missing_cost_source_revision", func(s *productCostSnapshot) { s.InputHash = "" }},
		{"missing_cost_readiness_check", func(s *productCostSnapshot) { s.CheckedAt = "" }},
		{"missing_cost_summary_amount", func(s *productCostSnapshot) { s.DirectExpenseAmount = "" }},
		{"direct_expense_summary_mismatch", func(s *productCostSnapshot) { s.DirectExpenseAmount = "1.00" }},
		{"cost_summary_allocation_mismatch", func(s *productCostSnapshot) { s.LaborCostAmount = "101.00" }},
		{"cost_summary_allocation_mismatch", func(s *productCostSnapshot) { s.Allocations[0].Status = "reversed" }},
		{"duplicate_cost_allocation", func(s *productCostSnapshot) { s.Allocations = append(s.Allocations, s.Allocations[0]) }},
		{"cost_allocation_scope_mismatch", func(s *productCostSnapshot) { s.Rules.ProjectCode = "OTHER" }},
		{"missing_cost_currency", func(s *productCostSnapshot) {
			s.Allocations[0].SourceRefs = json.RawMessage(strings.ReplaceAll(string(s.Allocations[0].SourceRefs), `"CNY"`, `null`))
		}},
	}
	for _, tc := range cases {
		t.Run(tc.reason, func(t *testing.T) {
			s := readyProductCostSnapshot()
			tc.mutate(&s)
			result := aggregateProductProjectCost(s)
			if result.Ready || len(result.Distributions) != 0 || !slices.Contains(result.Reasons, tc.reason) {
				t.Fatalf("partial costs exposed: %+v", result)
			}
		})
	}
}

func TestProductCostExplicitNonLaborCurrency(t *testing.T) {
	for _, kind := range []string{"asset", "shared_expense", "other"} {
		t.Run(kind, func(t *testing.T) {
			snapshot := readyProductCostSnapshot()
			snapshot.AllocatedCostAmount = "20.00"
			snapshot.Allocations = append(snapshot.Allocations, productCostAllocationFact{
				Code: "NON-LABOR", ProjectCode: "PRJ-1", PeriodMonth: "2026-09",
				AllocationType: kind, Status: "active", Amount: "20.00", CurrencyCode: "USD",
			})
			result := aggregateProductProjectCost(snapshot)
			if !result.Ready || len(result.Distributions) != 2 || result.Distributions[1].CurrencyCode != "USD" || result.Distributions[1].Products[0].Amount != "10.00" {
				t.Fatalf("explicit currency not independently attributed: %+v", result)
			}
			previousRevision := result.SourceRevision
			snapshot.Allocations[1].CurrencyCode = "EUR"
			if changed := aggregateProductProjectCost(snapshot); !changed.Ready || changed.SourceRevision == previousRevision {
				t.Fatalf("currency correction did not change source revision: %+v", changed)
			}
			snapshot.Allocations[1].CurrencyCode = ""
			missing := aggregateProductProjectCost(snapshot)
			if missing.Ready || len(missing.Distributions) != 0 || !slices.Contains(missing.Reasons, "missing_cost_currency") {
				t.Fatalf("unknown currency became ready: %+v", missing)
			}
		})
	}
}
