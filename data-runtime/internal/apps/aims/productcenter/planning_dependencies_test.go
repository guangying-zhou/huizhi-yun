package productcenter

import "testing"

func TestPlanningDependenciesInputRequiresCompleteBoundedUniqueSet(t *testing.T) {
	draft := assessmentDraft()
	base := PlanningDependenciesEdit{ItemBizID: draft.ItemBizID, ExpectedRevision: 1, ExpectedItemRevision: 1, PredecessorBizIDs: []string{}, Reason: "明确清空前置"}
	if err := ValidatePlanningDependenciesEdit(base); err != nil {
		t.Fatal(err)
	}
	for _, ids := range [][]string{nil, {draft.ItemBizID}, {draft.CycleBizID, draft.CycleBizID}, {"invalid"}, make([]string, 101)} {
		input := base
		input.PredecessorBizIDs = ids
		if err := ValidatePlanningDependenciesEdit(input); err == nil {
			t.Fatalf("invalid set accepted %+v", ids)
		}
	}
}
