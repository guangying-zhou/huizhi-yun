package people

import "testing"

func TestEnterpriseOnboardingAutomaticBoundary(t *testing.T) {
	for _, r := range []map[string]any{{"provider_code": "manual", "provider_subject": "known"}, {"provider_code": "dingtalk"}, {"provider_code": "DINGTALK", "provider_subject": "real"}} {
		if RequireAutomaticOnboarding(r) == nil {
			t.Fatal("non-real DingTalk accepted", r)
		}
	}
	if e := RequireAutomaticOnboarding(map[string]any{"provider_code": "dingtalk", "provider_subject": "real"}); e != nil {
		t.Fatal(e)
	}
	for op := range ProvisioningOperations {
		base := EnterpriseFactsInput{ID: "1", Payload: map[string]any{"expectedVersion": float64(1)}}
		if op == "onboarding-cancel" {
			base.Payload["reason"] = "批准取消候选身份预留"
		}
		if e := ValidateProvisioningInput(op, base); e != nil {
			t.Fatal(op, e)
		}
		for _, key := range []string{"status", "sourceApp", "uid", "directoryApplied", "approved"} {
			base.Payload[key] = "forged"
			if ValidateProvisioningInput(op, base) == nil {
				t.Fatal("body privilege field accepted", key)
			}
			delete(base.Payload, key)
		}
	}
}
