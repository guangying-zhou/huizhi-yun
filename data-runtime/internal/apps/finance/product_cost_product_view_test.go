package finance

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestProductCostViewDoesNotExposeOtherProductsOrSalaryFacts(t *testing.T) {
	snapshot := readyProductCostSnapshot()
	view, err := projectProductCostView(snapshot, "P1", "PRJ-1", "2026-09")
	if err != nil || !view.Ready || *view.BasisPoints != 5000 || len(view.Costs) != 1 || view.Costs[0].Amount != "50.00" || view.RevenueReady {
		t.Fatalf("%+v %v", view, err)
	}
	encoded, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"P2", "U1", "financeCostParameters", "allocationSourceRefs", "UnassignedAmount", "InputHash"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatalf("unexpected field or data %s", secret)
		}
	}
	other, err := projectProductCostView(snapshot, "P3", "PRJ-1", "2026-09")
	if err != nil || other.Ready || other.BasisPoints != nil || len(other.Costs) != 0 {
		t.Fatalf("unattributed product: %+v %v", other, err)
	}
	if _, err := projectProductCostView(snapshot, "P1", "OTHER", "2026-09"); err == nil {
		t.Fatal("scope mismatch accepted")
	}
	snapshot.ReadinessStatus = "not_ready"
	view, err = projectProductCostView(snapshot, "P1", "PRJ-1", "2026-09")
	if err != nil || view.Ready || len(view.Costs) != 0 {
		t.Fatalf("unready cost exposed: %+v %v", view, err)
	}
}
