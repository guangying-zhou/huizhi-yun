package productcenter

import "testing"

func TestManualSourceValidation(t *testing.T) {
	valid := ManualRequestSource{BizID: "b5eb7544-0695-4dc1-bc60-107d3e204742", ExpectedRevision: 1, ExpectedRequestRevision: 1, Note: "客户原话", Kind: "fact", Direction: "opposing"}
	if err := ValidateManualRequestSource(valid); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*ManualRequestSource){func(v *ManualRequestSource) { v.Note = " " }, func(v *ManualRequestSource) { v.Note = "bad\x00" }, func(v *ManualRequestSource) { v.ExpectedRequestRevision = 0 }, func(v *ManualRequestSource) { v.Kind = "verified" }, func(v *ManualRequestSource) { v.Direction = "positive" }, func(v *ManualRequestSource) { d := "2026-02-30"; v.EvidenceDate = &d }, func(v *ManualRequestSource) { v.BizID = "1" }} {
		v := valid
		mutate(&v)
		if err := ValidateManualRequestSource(v); err == nil {
			t.Fatalf("accepted invalid source: %+v", v)
		}
	}
}
