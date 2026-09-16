package productcenter

import (
	"context"
	"strings"
	"testing"
)

func TestFeatureDraftValidation(t *testing.T) {
	valid := FeatureDraft{ExpectedRevision: 1, Title: "统一身份"}
	if err := ValidateFeatureDraft(valid); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*FeatureDraft){
		func(v *FeatureDraft) { v.ExpectedRevision = 0 },
		func(v *FeatureDraft) { v.Title = " \n" },
		func(v *FeatureDraft) { v.Title = strings.Repeat("字", 501) },
		func(v *FeatureDraft) { v.Description = strings.Repeat("字", 10001) },
		func(v *FeatureDraft) { v.Title = "bad\x00title" },
		func(v *FeatureDraft) { v.Description = "bad\x00description" },
		func(v *FeatureDraft) { v.Title = string([]byte{0xff}) },
		func(v *FeatureDraft) { v.Description = string([]byte{0xff}) },
	} {
		candidate := valid
		mutate(&candidate)
		if ValidateFeatureDraft(candidate) == nil {
			t.Fatalf("accepted invalid feature: %#v", candidate)
		}
	}
	valid.Title = strings.Repeat("字", 500)
	valid.Description = strings.Repeat("字", 10000)
	if err := ValidateFeatureDraft(valid); err != nil {
		t.Fatal(err)
	}
}

func TestFeatureCreateRejectsWrongCommandBeforeDatabase(t *testing.T) {
	_, err := CreateProductFeature(context.Background(), nil, CommandIdentity{Action: "product_requests:create"}, AuthorizationPermit{}, FeatureDraft{ExpectedRevision: 1, Title: "功能"})
	if err == nil {
		t.Fatal("accepted unrelated command identity")
	}
}
