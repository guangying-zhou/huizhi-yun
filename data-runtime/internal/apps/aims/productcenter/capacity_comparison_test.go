package productcenter

import "testing"

func TestCapacityComparisonPreservesCompletedConsumptionAndFrozenEstimate(t *testing.T) {
	completed, pending := itemFixture("completed", 900), itemFixture("pending", 1000)
	completed.Delivered = true
	latest := Hundredths(1200)
	report, err := CompareDecisionCapacity(capacityFixture(), []DecisionItem{completed, pending}, map[string]LatestCapacityEstimate{"pending": {Category: pending.Category, Effort: &latest}})
	if err != nil || report.Confirmed.SelectedEffort != 1900 || report.Confirmed.Remaining != -100 || report.Latest.SelectedEffort != 2100 || report.Latest.Remaining != -300 {
		t.Fatalf("budget comparison: %+v %v", report, err)
	}
	if len(report.Changes) != 1 || *report.Changes[0].Delta != 200 || *pending.Effort != 1000 {
		t.Fatalf("frozen estimate changed: %+v", report)
	}
	latest = 1500
	if *report.Changes[0].Latest != 1200 {
		t.Fatal("result aliases mutable input")
	}
}

func TestCapacityComparisonUnknownIsNotZero(t *testing.T) {
	pending := itemFixture("pending", 1000)
	report, err := CompareDecisionCapacity(capacityFixture(), []DecisionItem{pending}, map[string]LatestCapacityEstimate{"pending": {Category: pending.Category}})
	if err != nil || report.Latest.UnknownEstimates != 1 || len(report.Changes) != 1 || report.Changes[0].Delta != nil || report.Changes[0].Latest != nil {
		t.Fatalf("unknown became zero: %+v %v", report, err)
	}
	if err := ConfirmDecision(report.Latest, nil); err == nil {
		t.Fatal("unknown estimate silently confirmed")
	}
}

func TestCapacityComparisonRejectsIncompleteOrUnrelatedEstimates(t *testing.T) {
	pending := itemFixture("pending", 1000)
	negative := Hundredths(-100)
	for _, latest := range []map[string]LatestCapacityEstimate{
		{}, {"pending": {Category: pending.Category, Effort: pending.Effort}, "other": {}}, {"pending": {Category: pending.Category, Effort: &negative}},
	} {
		if _, err := CompareDecisionCapacity(capacityFixture(), []DecisionItem{pending}, latest); err == nil {
			t.Fatalf("accepted invalid estimate set %+v", latest)
		}
	}
}

func TestCapacityComparisonTracksCategoryChangeWithUnchangedEffort(t *testing.T) {
	pending := itemFixture("pending", 500)
	pending.Category = Growth
	report, err := CompareDecisionCapacity(capacityFixture(), []DecisionItem{pending}, map[string]LatestCapacityEstimate{"pending": {Category: Reliability, Effort: pending.Effort}})
	if err != nil || report.Confirmed.ByCategory[Growth] != 500 || report.Latest.ByCategory[Reliability] != 500 || report.Latest.ByCategory[Growth] != 0 {
		t.Fatalf("category shift lost: %+v %v", report, err)
	}
	if len(report.Changes) != 1 || report.Changes[0].ConfirmedCategory != Growth || report.Changes[0].LatestCategory != Reliability || *report.Changes[0].Delta != 0 {
		t.Fatalf("category-only change hidden %+v", report)
	}
	if pending.Category != Growth {
		t.Fatal("frozen category overwritten")
	}
	if _, err = CompareDecisionCapacity(capacityFixture(), []DecisionItem{pending}, map[string]LatestCapacityEstimate{"pending": {Category: "invalid", Effort: pending.Effort}}); err == nil {
		t.Fatal("invalid category accepted")
	}
}

func TestCapacityComparisonPreservesWithdrawnConsumption(t *testing.T) {
	spent := Hundredths(400)
	withdrawn := DecisionItem{ID: "withdrawn", Category: Growth, RetainedEffort: &spent}
	selected := itemFixture("selected", 1500)
	selected.Dependencies = []string{"withdrawn"}
	latest := Hundredths(1600)
	report, err := CompareDecisionCapacity(capacityFixture(), []DecisionItem{withdrawn, selected}, map[string]LatestCapacityEstimate{"selected": {Category: Growth, Effort: &latest}})
	if err != nil {
		t.Fatal(err)
	}
	if report.Confirmed.SelectedEffort != 1500 || report.Confirmed.RetainedEffort != 400 || report.Confirmed.OccupiedEffort != 1900 || report.Confirmed.Remaining != -100 || report.Latest.OccupiedEffort != 2000 || report.Latest.Remaining != -200 || report.Latest.ByCategory[Growth] != 2000 {
		t.Fatalf("retained consumption lost %+v", report)
	}
	dependency := false
	for _, issue := range report.Latest.Issues {
		if issue.Code == "dependency_unresolved" && issue.PredecessorID == withdrawn.ID {
			dependency = true
		}
	}
	if !dependency {
		t.Fatal("consumption treated as delivered dependency")
	}
	if len(report.Changes) != 1 || report.Changes[0].ItemID != selected.ID {
		t.Fatalf("retained consumption re-estimated %+v", report.Changes)
	}
	for _, value := range []Hundredths{0, 1, 49, 100_000_000} {
		withdrawn.RetainedEffort = &value
		result, e := InspectDecision(capacityFixture(), []DecisionItem{withdrawn})
		if e != nil || result.RetainedEffort != value || result.UnknownEstimates != 0 {
			t.Fatalf("confirmed consumption %d: %+v %v", value, result, e)
		}
	}
	for _, value := range []Hundredths{-1, 100_000_001} {
		withdrawn.RetainedEffort = &value
		_, e := InspectDecision(capacityFixture(), []DecisionItem{withdrawn})
		requireProductRule(t, e, "planning_retained_effort_invalid")
	}
	withdrawn.RetainedEffort = &spent
	withdrawn.Selected = true
	_, err = InspectDecision(capacityFixture(), []DecisionItem{withdrawn})
	requireProductRule(t, err, "planning_retained_effort_invalid")
}
