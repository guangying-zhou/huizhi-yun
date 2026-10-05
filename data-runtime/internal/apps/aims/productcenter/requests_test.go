package productcenter

import (
	"strings"
	"testing"
)

func TestRequestDraftValidation(t *testing.T) {
	valid := RequestDraft{ExpectedRevision: 1, Title: "统一登录", ProblemStatement: "用户需要重复登录多个应用", SourceType: "customer", UrgencyLevel: "P2"}
	if err := ValidateRequestDraft(valid); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*RequestDraft){
		func(v *RequestDraft) { v.ExpectedRevision = 0 }, func(v *RequestDraft) { v.Title = " \n" }, func(v *RequestDraft) { v.Title = strings.Repeat("字", 501) },
		func(v *RequestDraft) { v.ProblemStatement = "" }, func(v *RequestDraft) { v.ProblemStatement = strings.Repeat("字", 10001) },
		func(v *RequestDraft) { v.SourceType = "project" }, func(v *RequestDraft) { v.UrgencyLevel = "critical" }, func(v *RequestDraft) { v.Title = "bad\x00title" }, func(v *RequestDraft) { v.Title = string([]byte{0xff}) },
	} {
		candidate := valid
		mutate(&candidate)
		if ValidateRequestDraft(candidate) == nil {
			t.Fatalf("accepted invalid draft: %#v", candidate)
		}
	}
	valid.Title = strings.Repeat("字", 500)
	valid.ProblemStatement = strings.Repeat("字", 10000)
	if err := ValidateRequestDraft(valid); err != nil {
		t.Fatal(err)
	}
	for _, urgency := range []string{"P0", "P1", "P2", "P3"} {
		valid.UrgencyLevel = urgency
		if err := ValidateRequestDraft(valid); err != nil {
			t.Fatal(err)
		}
	}
}
