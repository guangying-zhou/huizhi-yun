package people

import (
	"encoding/json"
	"math"
	"testing"
)

func TestEnterpriseMasterClosedInput(t *testing.T) {
	base := EnterpriseMasterInput{Payload: map[string]any{"position_code": "POS", "position_name": "岗位"}, CostScope: EnterpriseMasterScope{Access: "none"}}
	if e := ValidateEnterpriseMasterInput("positions-create", base); e != nil {
		t.Fatal(e)
	}
	for _, key := range []string{"employee_uid", "monthly_standard_cost", "sourceApp", "approval_status", "costAllowed"} {
		b := base
		b.Payload = map[string]any{"position_code": "POS", "position_name": "岗位", key: "forged"}
		if ValidateEnterpriseMasterInput("positions-create", b) == nil {
			t.Fatal("unowned field", key)
		}
	}
	for _, v := range []any{math.Inf(1), math.NaN(), float64(1.1), "1", float64(-1)} {
		b := base
		b.Payload = map[string]any{"position_code": "POS", "position_name": "岗位", "enabled": v}
		if ValidateEnterpriseMasterInput("positions-create", b) == nil {
			t.Fatal("invalid numeric", v)
		}
	}
	for _, op := range []string{"employees-create", "assignments-update", "private-profile-view", "rank-settings-current"} {
		if ValidateEnterpriseMasterInput(op, base) == nil {
			t.Fatal("unregistered write", op)
		}
	}
	b := EnterpriseMasterInput{ID: "Person", Payload: map[string]any{}, CostScope: EnterpriseMasterScope{Access: "none"}}
	if e := ValidateEnterpriseMasterInput("employees-profile", b); e != nil {
		t.Fatal(e)
	}
	b.CostAllowed = true
	b.CostScope.Access = "forged"
	if ValidateEnterpriseMasterInput("employees-profile", b) == nil {
		t.Fatal("forged cost scope")
	}
	a, _ := json.Marshal(EnterpriseMasterIntent(base))
	base.CostAllowed = true
	base.CostScope.Access = "all"
	changed, _ := json.Marshal(EnterpriseMasterIntent(base))
	if string(a) == string(changed) {
		t.Fatal("cost mask not bound")
	}
}
