package finance

import "testing"

func TestProductCostRulesCommandRequiresCompleteExactRevision(t *testing.T) {
	valid := func() map[string]any {
		return map[string]any{"actorUid": "U1", "projectCode": "PRJ1", "periodMonth": "2026-09", "expectedRevision": float64(2), "evidenceRef": "APPROVAL-3", "shares": []any{map[string]any{"productCode": "P1", "basisPoints": float64(6000)}, map[string]any{"productCode": "P2", "basisPoints": float64(4000)}}}
	}
	command, rules, err := parseProductCostRulesCommand(valid())
	if err != nil || command.ActorUID != "U1" || rules.Revision != 3 || len(rules.Shares) != 2 {
		t.Fatalf("%+v %+v %v", command, rules, err)
	}
	for _, override := range []map[string]any{
		{"expectedRevision": 2.5}, {"expectedRevision": "2"}, {"expectedRevision": -1},
		{"actorUid": "client:finance.runtime"}, {"evidenceRef": ""}, {"scope": "all"},
		{"shares": nil}, {"shares": []any{map[string]any{"productCode": "P1", "basisPoints": 10001}}},
		{"shares": []any{map[string]any{"productCode": "P1", "basisPoints": 5000, "amount": "1.00"}}},
	} {
		input := valid()
		for key, value := range override {
			input[key] = value
		}
		if _, _, err := parseProductCostRulesCommand(input); err == nil {
			t.Fatalf("accepted %v", override)
		}
	}
	input := valid()
	input["shares"] = []any{}
	_, rules, err = parseProductCostRulesCommand(input)
	if err != nil || len(rules.Shares) != 0 {
		t.Fatal("explicit empty replacement must remove assignments")
	}
}
