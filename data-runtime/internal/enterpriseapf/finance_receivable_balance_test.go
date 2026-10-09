package enterpriseapf

import "testing"

func TestNetOpeningNeverCountsHistoricalCollections(t *testing.T) {
	// The OA total may be 500, 1000 or imported twice; none is a balance input.
	for _, old := range []string{"500.00", "1000.00", "2000.00"} {
		_ = old
		v, e := netOpeningOutstanding("100.00", "2026-10-01", []ContinuationAllocation{{"60.00", "2026-10-02", true}}, []ContinuationAdjustment{{"10.00", true}})
		if e != nil || v != "30.00" {
			t.Fatalf("%s %v", v, e)
		}
	}
	if _, e := netOpeningOutstanding("100.00", "2026-10-01", []ContinuationAllocation{{"1.00", "2026-10-01", true}}, nil); e == nil {
		t.Fatal("pre-cutover allocation accepted")
	}
}
func TestContinuationCapacityAndReversals(t *testing.T) {
	for _, tc := range []struct {
		alloc, adjust, want string
		bad                 bool
	}{{"60.00", "40.00", "0.00", false}, {"60.00", "50.00", "", true}, {"60.00", "-10.00", "50.00", false}} {
		v, e := netOpeningOutstanding("100.00", "2026-10-01", []ContinuationAllocation{{tc.alloc, "2026-10-02", true}}, []ContinuationAdjustment{{tc.adjust, true}})
		if (e != nil) != tc.bad || !tc.bad && v != tc.want {
			t.Fatalf("%+v: %s %v", tc, v, e)
		}
	}
	v, e := netOpeningOutstanding("100.00", "2026-10-01", []ContinuationAllocation{{"60.00", "2026-10-02", false}}, []ContinuationAdjustment{{"50.00", false}})
	if e != nil || v != "100.00" {
		t.Fatal(v, e)
	}
	if requireAdjustmentSeparation("maker", "maker") == nil || requireAdjustmentSeparation("maker", "director") != nil {
		t.Fatal("separation")
	}
}
