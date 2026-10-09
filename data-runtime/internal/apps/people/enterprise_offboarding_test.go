package people

import "testing"

func TestOffboardingIntentClosedActionsAndExplicitArrangement(t *testing.T) {
	if _, _, ok := OffboardingPermission("offboarding-force-success"); ok {
		t.Fatal("unknown action")
	}
	for _, op := range []string{"offboarding-confirm", "offboarding-cancel"} {
		_, action, _ := OffboardingPermission(op)
		if action == "admin" {
			t.Fatal("sensitive action inherited")
		}
	}
	input := EnterpriseFactsInput{ID: "1", EmployeeUID: "departed", Payload: map[string]any{"expectedVersion": float64(1), "handoverResponsibleUid": "HR", "handoverDueAt": "2026-10-10T00:00:00Z", "assetRecoveryResponsibleUid": "Assets", "assetRecoveryDueAt": "2026-10-11T00:00:00Z"}}
	if err := ValidateOffboardingInput("offboarding-arrange", input); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"handoverResponsibleUid", "handoverDueAt", "assetRecoveryResponsibleUid", "assetRecoveryDueAt"} {
		old := input.Payload[field]
		delete(input.Payload, field)
		if ValidateOffboardingInput("offboarding-arrange", input) == nil {
			t.Fatalf("defaulted %s", field)
		}
		input.Payload[field] = old
	}
	input.Payload["assetRecoveryResponsibleUid"] = "departed"
	if ValidateOffboardingInput("offboarding-arrange", input) == nil {
		t.Fatal("leaver responsible")
	}
	input.Payload["assetRecoveryResponsibleUid"] = "Assets"
	input.Payload["trusted"] = true
	if ValidateOffboardingInput("offboarding-arrange", input) == nil {
		t.Fatal("browser trust")
	}
	a := OffboardingCode("U1", "2026-10-03")
	if a != OffboardingCode("U1", "2026-10-03") || a == OffboardingCode("U1", "2026-10-04") || a == OffboardingCode("U2", "2026-10-03") {
		t.Fatal("unstable lifecycle identity")
	}
}
