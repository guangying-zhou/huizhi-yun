package productcenter

import "testing"

func TestRequestEditValidation(t *testing.T) {
	valid := RequestEdit{RequestDraft: RequestDraft{ExpectedRevision: 2, Title: "标题", ProblemStatement: "问题", SourceType: "internal", UrgencyLevel: "P2"}, BizID: "b5eb7544-0695-4dc1-bc60-107d3e204742", ExpectedRequestRevision: 1, Reason: "补充信息"}
	if err := ValidateRequestEdit(valid); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*RequestEdit){
		func(v *RequestEdit) { v.BizID = "1" }, func(v *RequestEdit) { v.ExpectedRequestRevision = 0 }, func(v *RequestEdit) { v.ExpectedRevision = 0 },
		func(v *RequestEdit) { v.Reason = " " }, func(v *RequestEdit) { v.Reason = "bad\x00" }, func(v *RequestEdit) { v.Reason = string([]byte{0xff}) },
		func(v *RequestEdit) { v.SourceType = "project" }, func(v *RequestEdit) { v.Title = "" },
	} {
		v := valid
		mutate(&v)
		if err := ValidateRequestEdit(v); err == nil {
			t.Fatalf("accepted invalid edit: %+v", v)
		}
	}
}
