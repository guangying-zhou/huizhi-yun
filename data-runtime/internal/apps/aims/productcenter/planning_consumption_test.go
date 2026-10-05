package productcenter

import (
	"encoding/json"
	"testing"
)

func TestPlanningRetainedConsumptionSnapshot(t *testing.T) {
	cycle, item := "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"
	spent := Hundredths(325)
	valid := PlanningRetainedConsumption{Version: 1, CycleBizID: cycle, ItemBizID: item, ScopeRevision: 2, Category: Growth, Spent: &spent, ConfirmedBy: "engineer", ConfirmedAt: "2026-09-08T12:00:00Z", Reason: "确认已发生投入"}
	encode := func(v PlanningRetainedConsumption) []byte {
		b, e := json.Marshal(map[string]any{"retained_consumption": v})
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	decoded, err := decodePlanningRetainedConsumption(encode(valid), cycle, item, "deferred")
	if err != nil || decoded == nil || *decoded.Spent != 325 || decoded.ScopeRevision != 2 {
		t.Fatalf("decode %+v %v", decoded, err)
	}
	for name, mutate := range map[string]func(*PlanningRetainedConsumption){
		"missing amount": func(v *PlanningRetainedConsumption) { v.Spent = nil },
		"wrong item":     func(v *PlanningRetainedConsumption) { v.ItemBizID = cycle },
		"wrong cycle":    func(v *PlanningRetainedConsumption) { v.CycleBizID = item },
		"scope":          func(v *PlanningRetainedConsumption) { v.ScopeRevision = 0 },
		"actor":          func(v *PlanningRetainedConsumption) { v.ConfirmedBy = " engineer" },
		"time":           func(v *PlanningRetainedConsumption) { v.ConfirmedAt = "yesterday" },
		"reason":         func(v *PlanningRetainedConsumption) { v.Reason = "" },
		"category":       func(v *PlanningRetainedConsumption) { v.Category = "other" },
	} {
		t.Run(name, func(t *testing.T) {
			v := valid
			mutate(&v)
			_, e := decodePlanningRetainedConsumption(encode(v), cycle, item, "deferred")
			requireProductRule(t, e, "planning_consumption_snapshot_invalid")
		})
	}
	for _, status := range []string{"selected", "candidate"} {
		_, e := decodePlanningRetainedConsumption(encode(valid), cycle, item, status)
		requireProductRule(t, e, "planning_consumption_snapshot_invalid")
	}
	for _, raw := range []string{`{"retained_consumption":null}`, `{"retained_consumption":{}}`, `null`, `{`} {
		_, e := decodePlanningRetainedConsumption([]byte(raw), cycle, item, "deferred")
		requireProductRule(t, e, "planning_consumption_snapshot_invalid")
	}
	for _, raw := range [][]byte{nil, []byte(`{"action":"withdraw"}`)} {
		v, e := decodePlanningRetainedConsumption(raw, cycle, item, "deferred")
		if e != nil || v != nil {
			t.Fatalf("legacy snapshot %+v %v", v, e)
		}
	}
	zero := Hundredths(0)
	valid.Spent = &zero
	v, e := decodePlanningRetainedConsumption(encode(valid), cycle, item, "deferred")
	if e != nil || v == nil || *v.Spent != 0 {
		t.Fatalf("explicit zero %+v %v", v, e)
	}
}
