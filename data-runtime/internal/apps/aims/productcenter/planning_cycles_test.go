package productcenter

import "testing"

func TestPlanningCycleDraftValidation(t *testing.T) {
	valid := PlanningCycleDraft{ExpectedRevision: 1, Title: "九月规划", StartsOn: "2026-09-01", EndsOn: "2026-09-30", GoalSummary: "改善首次使用体验", ReviewIntervalDays: 14}
	if err := ValidatePlanningCycleDraft(valid); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*PlanningCycleDraft){
		func(v *PlanningCycleDraft) { v.ExpectedRevision = 0 },
		func(v *PlanningCycleDraft) { v.Title = " " },
		func(v *PlanningCycleDraft) { v.GoalSummary = "\x00" },
		func(v *PlanningCycleDraft) { v.StartsOn = "2026-02-30" },
		func(v *PlanningCycleDraft) { v.EndsOn = "2026-08-31" },
		func(v *PlanningCycleDraft) { v.ReviewIntervalDays = 0 },
		func(v *PlanningCycleDraft) { v.ReviewIntervalDays = 367 },
		func(v *PlanningCycleDraft) { v.Budget = &PlanningCycleBudget{} },
	} {
		v := valid
		change(&v)
		if ValidatePlanningCycleDraft(v) == nil {
			t.Fatalf("accepted invalid draft %+v", v)
		}
	}
	zero, total, part := Hundredths(0), Hundredths(100), Hundredths(50)
	valid.Budget = &PlanningCycleBudget{Total: &total, Reserve: &zero, Reliability: &part, Usability: &part, Growth: &zero}
	if err := ValidatePlanningCycleDraft(valid); err != nil {
		t.Fatal(err)
	}
	valid.Budget.Growth = &part
	requireProductRule(t, ValidatePlanningCycleDraft(valid), "planning_capacity_overallocated")
}

func TestPlanningCyclePageQueryValidation(t *testing.T) {
	for _, q := range []PlanningCyclePageQuery{{Page: 0, PageSize: 10}, {Page: 1, PageSize: 101}, {Page: 1000001, PageSize: 10}, {Page: 1, PageSize: 10, Status: "active"}, {Page: 1, PageSize: 10, Keyword: "\x00"}} {
		if ValidatePlanningCyclePageQuery(q) == nil {
			t.Fatalf("invalid query %+v", q)
		}
	}
	if err := ValidatePlanningCyclePageQuery(PlanningCyclePageQuery{Page: 1, PageSize: 100, Status: "closed", Keyword: "%_"}); err != nil {
		t.Fatal(err)
	}
}

func TestPlanningCycleEditRequiresExplicitBudgetIntent(t *testing.T) {
	input := PlanningCycleEdit{PlanningCycleDraft: PlanningCycleDraft{ExpectedRevision: 1, Title: "周期", StartsOn: "2026-09-01", EndsOn: "2026-09-30", GoalSummary: "目标", ReviewIntervalDays: 14}, BizID: "00000000-0000-4000-8000-000000000001", ExpectedCycleRevision: 1, Reason: "修改", BudgetMode: "keep"}
	if err := ValidatePlanningCycleEdit(input); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*PlanningCycleEdit){
		func(v *PlanningCycleEdit) { v.BudgetMode = "" },
		func(v *PlanningCycleEdit) { v.BudgetMode = "set" },
		func(v *PlanningCycleEdit) { v.ExpectedCycleRevision = 0 },
		func(v *PlanningCycleEdit) { v.BizID = "other" },
		func(v *PlanningCycleEdit) { v.Reason = " " },
		func(v *PlanningCycleEdit) { v.Reason = "\xff" },
	} {
		v := input
		change(&v)
		if ValidatePlanningCycleEdit(v) == nil {
			t.Fatalf("invalid edit %+v", v)
		}
	}
	zero := Hundredths(0)
	input.Budget = &PlanningCycleBudget{Total: &zero, Reserve: &zero, Reliability: &zero, Usability: &zero, Growth: &zero}
	requireProductRule(t, ValidatePlanningCycleEdit(input), "planning_cycle_budget_mode_invalid")
	input.BudgetMode = "set"
	if err := ValidatePlanningCycleEdit(input); err != nil {
		t.Fatal(err)
	}
}
