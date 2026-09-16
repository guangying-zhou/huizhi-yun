package finance

import "testing"

func TestProductCostCommandRejectsScopeAndActorOverrides(t *testing.T) {
	valid := func() map[string]any {
		return map[string]any{"actorUid": "U1", "productCode": "P1", "projectCode": "PRJ-1", "periodMonth": "2026-09", "action": "read"}
	}
	command, err := parseProductCostReadCommand(valid())
	if err != nil || command.ActorUID != "U1" || command.ProjectCode != "PRJ-1" {
		t.Fatalf("%+v %v", command, err)
	}
	for _, override := range []map[string]any{
		{"actorUid": nil}, {"actorUid": "client:finance.runtime"}, {"actorUid": "@all"},
		{"actorUid": " U1"}, {"actorUid": 123}, {"action": "write"}, {"projectCode": "../P1"},
		{"productCode": "P1\x00"}, {"periodMonth": "2026-13"}, {"periodMonth": "2026-09-01"},
		{"scope": "all"}, {"current_user_project_finance_access": "all"}, {"currency": "CNY"},
	} {
		input := valid()
		for key, value := range override {
			input[key] = value
		}
		if _, err := parseProductCostReadCommand(input); err == nil {
			t.Fatalf("accepted %v", override)
		}
	}
	input := valid()
	delete(input, "projectCode")
	if _, err := parseProductCostReadCommand(input); err == nil {
		t.Fatal("missing project accepted")
	}
}
