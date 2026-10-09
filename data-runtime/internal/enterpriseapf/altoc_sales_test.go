package enterpriseapf

import (
	"strings"
	"testing"
)

func TestAPFSalesClosedActionsAndIntent(t *testing.T) {
	if len(salesOps) != 15 {
		t.Fatal("operation budget")
	}
	for op := range salesOps {
		i := SalesInput{ID: "1", Payload: map[string]any{"expectedVersion": float64(1), "status": "won"}}
		if ValidateSalesInput(op, i) == nil {
			t.Fatal(op, "accepted caller status")
		}
	}
	p := map[string]any{"expectedVersion": float64(1), "subject": "跟进", "activity_type": "call", "activity_at": "2026-10-03 10:00:00"}
	if e := ValidateSalesInput("lead-activities-create", SalesInput{ID: "1", Payload: p}); e != nil {
		t.Fatal(e)
	}
	i := SalesInput{ID: "1", Payload: map[string]any{"expectedVersion": float64(1), "owner_uid": "person"}}
	if e := ValidateSalesInput("leads-assign", i); e != nil {
		t.Fatal(e)
	}
	i.Payload["owner_uid"] = strings.Repeat("p", 51)
	if ValidateSalesInput("leads-assign", i) == nil {
		t.Fatal("DB length bypass")
	}
	for op, pair := range salesOps {
		r, a, ok := SalesPermission(op)
		if !ok || r != pair[0] || a != pair[1] {
			t.Fatal(op)
		}
	}
}
