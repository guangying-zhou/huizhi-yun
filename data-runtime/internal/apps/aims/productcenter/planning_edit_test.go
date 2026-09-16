package productcenter

import "testing"

func TestPlanningEditRequiresExplicitIdentityAndReason(t *testing.T) {
	valid := PlanningItemEdit{PlanningItemDraft: PlanningItemDraft{ExpectedRevision: 2, Title: "本次范围", ScopeSummary: "范围说明", InvestmentCategory: "usability", UrgencyLevel: "P2", Requests: []PlanningRequestRef{}}, BizID: "00000000-0000-4000-8000-000000000001", ExpectedItemRevision: 1, Reason: "补充边界"}
	if err := ValidatePlanningItemEdit(valid); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*PlanningItemEdit){func(v *PlanningItemEdit) { v.ExpectedItemRevision = 0 }, func(v *PlanningItemEdit) { v.BizID = "1" }, func(v *PlanningItemEdit) { v.Reason = " " }, func(v *PlanningItemEdit) { v.ImpactNote = string([]byte{255}) }, func(v *PlanningItemEdit) { v.ScopeSummary = "" }} {
		bad := valid
		change(&bad)
		if err := ValidatePlanningItemEdit(bad); err == nil {
			t.Fatalf("invalid edit accepted %+v", bad)
		}
	}
}
