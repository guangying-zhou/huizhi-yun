package finance

import (
	"encoding/json"
	"testing"
)

func TestProductCostSourceRevisionTracksCorrections(t *testing.T) {
	s := readyProductCostSnapshot()
	initial, err := productCostSourceRevision(s)
	if err != nil {
		t.Fatal(err)
	}
	s.Rules.Shares[0], s.Rules.Shares[1] = s.Rules.Shares[1], s.Rules.Shares[0]
	var pretty any
	json.Unmarshal(s.Allocations[0].SourceRefs, &pretty)
	s.Allocations[0].SourceRefs, _ = json.MarshalIndent(pretty, "", "  ")
	equivalent, err := productCostSourceRevision(s)
	if err != nil || equivalent != initial {
		t.Fatalf("representation changed revision: %s %s %v", initial, equivalent, err)
	}
	for _, mutate := range []func(*productCostSnapshot){
		func(s *productCostSnapshot) { s.Allocations[0].Amount = "101.00" },
		func(s *productCostSnapshot) { s.Allocations[0].Status = "reversed" },
		func(s *productCostSnapshot) {
			s.DirectExpenses = []productDirectExpenseFact{{Code: "E1", Amount: "1.00"}}
		},
		func(s *productCostSnapshot) { s.Rules.Revision++ },
	} {
		changed := readyProductCostSnapshot()
		mutate(&changed)
		revision, err := productCostSourceRevision(changed)
		if err != nil || revision == initial {
			t.Fatalf("correction not reflected: %s %v", revision, err)
		}
	}
	s.Allocations[0].SourceRefs = json.RawMessage(`{} {}`)
	if _, err := productCostSourceRevision(s); err == nil {
		t.Fatal("accepted invalid JSON")
	}
}
