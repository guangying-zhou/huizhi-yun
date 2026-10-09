package productcenter

import "testing"

func TestFeatureLifecycleEvidenceAndTransition(t *testing.T) {
	id := "00000000-0000-4000-8000-000000000001"
	valid := FeatureLifecycleChange{ExpectedRevision: 1, ExpectedFeatureRevision: 1, BizID: id, Target: "active", Reason: "确认存量能力", Evidence: &FeatureActivationEvidence{Kind: "legacy", Description: "企业用户已使用单点登录"}}
	if err := ValidateFeatureLifecycleChange(valid); err != nil {
		t.Fatal(err)
	}
	for _, evidence := range []*FeatureActivationEvidence{nil, {Kind: "legacy"}, {Kind: "legacy", Description: "证据", ReleaseBizID: id}, {Kind: "release", ReleaseBizID: "bad"}, {Kind: "release", ReleaseBizID: id, Description: "不能混用"}, {Kind: "unknown", Description: "证据"}} {
		input := valid
		input.Evidence = evidence
		if ValidateFeatureLifecycleChange(input) == nil {
			t.Fatalf("accepted evidence: %+v", evidence)
		}
	}
	valid.Evidence = &FeatureActivationEvidence{Kind: "release", ReleaseBizID: id}
	if err := ValidateFeatureLifecycleChange(valid); err != nil {
		t.Fatal(err)
	}
	valid.Target = "deprecated"
	if ValidateFeatureLifecycleChange(valid) == nil {
		t.Fatal("deprecation replaced evidence")
	}
	valid.Evidence = nil
	if err := ValidateFeatureLifecycleChange(valid); err != nil {
		t.Fatal(err)
	}
	for _, current := range []string{"candidate", "active", "deprecated"} {
		for _, target := range []string{"candidate", "active", "deprecated"} {
			allowed := (current == "candidate" && target == "active") || (current == "active" && target == "deprecated") || (current == "deprecated" && target == "active")
			if err := ValidateFeatureLifecycleTransition(current, target, true); (err == nil) != allowed {
				t.Fatalf("%s -> %s: %v", current, target, err)
			}
			if ValidateFeatureLifecycleTransition(current, target, false) == nil {
				t.Fatal("nonmanager accepted")
			}
		}
	}
}
