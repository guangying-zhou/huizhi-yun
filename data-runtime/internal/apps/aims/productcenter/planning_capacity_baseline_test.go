package productcenter

import (
	"encoding/json"
	"testing"
)

func TestPlanningCapacityBaselineRequiresExplicitEffort(t *testing.T) {
	const item = "00000000-0000-4000-8000-000000000001"
	for _, tc := range []struct {
		name, capacity string
		valid          bool
		unknown        bool
	}{
		{"missing", `{"version":1,"item_biz_id":"` + item + `","investment_category":"growth"}`, false, false},
		{"unknown", `{"version":1,"item_biz_id":"` + item + `","investment_category":"growth","effort_person_days":null}`, true, true},
		{"known", `{"version":1,"item_biz_id":"` + item + `","investment_category":"growth","effort_person_days":"8.00"}`, true, false},
		{"null capacity", `null`, false, false},
		{"invalid effort", `{"version":1,"item_biz_id":"` + item + `","investment_category":"growth","effort_person_days":"unknown"}`, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			baseline, err := decodePlanningCapacityBaseline([]byte(`{"capacity":`+tc.capacity+`}`), item)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v error=%v", tc.valid, err)
			}
			if !tc.valid {
				return
			}
			if (baseline.Effort == nil) != tc.unknown {
				t.Fatalf("unexpected effort: %v", baseline.Effort)
			}
			raw, err := json.Marshal(map[string]any{"capacity": baseline})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = decodePlanningCapacityBaseline(raw, item); err != nil {
				t.Fatalf("round trip: %v", err)
			}
		})
	}
}
