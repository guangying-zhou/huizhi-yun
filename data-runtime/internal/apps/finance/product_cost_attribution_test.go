package finance

import (
	"reflect"
	"testing"
)

func costAttributionRules() productCostAttributionRules {
	return productCostAttributionRules{ProjectCode: "PROJECT-1", PeriodMonth: "2026-09", Revision: 1, EvidenceRef: "approval-1",
		Shares: []productCostShare{{"P2", 2500}, {"P1", 5000}}}
}

func TestProductCostAttributionExactConservation(t *testing.T) {
	rules := costAttributionRules()
	before := append([]productCostShare(nil), rules.Shares...)
	result, err := distributeProductCost("100.03", "CNY", rules)
	if err != nil {
		t.Fatal(err)
	}
	want := productCostDistribution{CurrencyCode: "CNY", RuleRevision: 1,
		Products:              []attributedProductCost{{"P1", 5000, "50.01"}, {"P2", 2500, "25.00"}},
		UnassignedBasisPoints: 2500, UnassignedAmount: "25.00", RoundingAmount: "0.02"}
	if !reflect.DeepEqual(result, want) || !reflect.DeepEqual(before, rules.Shares) {
		t.Fatalf("unexpected distribution or input mutation: %+v", result)
	}
	// A full allocation can still leave a rounding residual. Never silently give
	// it to the last product (which would depend on ordering or visible scope).
	rules.Shares = []productCostShare{{"P1", 5000}, {"P2", 5000}}
	result, err = distributeProductCost("0.01", "USD", rules)
	if err != nil || result.UnassignedAmount != "0.00" || result.RoundingAmount != "0.01" || result.Products[0].Amount != "0.00" {
		t.Fatalf("one cent split: %+v, %v", result, err)
	}
}

func TestProductCostAttributionDecimalRangeAndEmptyRules(t *testing.T) {
	rules := costAttributionRules()
	rules.Shares = []productCostShare{{"P1", 10000}}
	result, err := distributeProductCost("9999999999999999.99", "CNY", rules)
	if err != nil || result.Products[0].Amount != "9999999999999999.99" || result.RoundingAmount != "0.00" {
		t.Fatalf("DECIMAL(18,2) must not overflow: %+v, %v", result, err)
	}
	rules.Shares = nil
	result, err = distributeProductCost("100.03", "EUR", rules)
	if err != nil || result.UnassignedAmount != "100.03" || result.UnassignedBasisPoints != 10000 || len(result.Products) != 0 {
		t.Fatalf("unassigned: %+v, %v", result, err)
	}
}

func TestProductCostAttributionRejectsInvalidFactsAndRules(t *testing.T) {
	for _, amount := range []string{"1", "1.001", "-1.00", "NaN", "1e2", "01.00", "10000000000000000.00"} {
		if _, err := distributeProductCost(amount, "CNY", costAttributionRules()); err == nil {
			t.Errorf("accepted amount %q", amount)
		}
	}
	for _, currency := range []string{"", "cny", "CNY ", "CNY/USD"} {
		if _, err := distributeProductCost("1.00", currency, costAttributionRules()); err == nil {
			t.Errorf("accepted currency %q", currency)
		}
	}
	cases := map[string]func(*productCostAttributionRules){
		"overallocated": func(r *productCostAttributionRules) { r.Shares[0].BasisPoints = 5001 },
		"duplicate":     func(r *productCostAttributionRules) { r.Shares[0].ProductCode = "P1" },
		"negative":      func(r *productCostAttributionRules) { r.Shares[0].BasisPoints = -1 },
		"zero":          func(r *productCostAttributionRules) { r.Shares[0].BasisPoints = 0 },
		"period":        func(r *productCostAttributionRules) { r.PeriodMonth = "2026-13" },
		"revision":      func(r *productCostAttributionRules) { r.Revision = 0 },
		"evidence":      func(r *productCostAttributionRules) { r.EvidenceRef = " " },
		"project":       func(r *productCostAttributionRules) { r.ProjectCode = " " },
		"product":       func(r *productCostAttributionRules) { r.Shares[0].ProductCode = "../P2" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			rules := costAttributionRules()
			mutate(&rules)
			if _, err := distributeProductCost("1.00", "CNY", rules); err == nil {
				t.Fatal("accepted invalid rules")
			}
		})
	}
}
