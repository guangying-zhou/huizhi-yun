package productcenter

import (
	"reflect"
	"testing"
)

func TestQueueMovePreservesOffPageItems(t *testing.T) {
	original := []string{"a", "b", "c", "d", "e"}
	got, err := MoveQueue(original, 7, 7, Move{ItemID: "d", BeforeID: "b"})
	if err != nil || !reflect.DeepEqual(got, []string{"a", "d", "b", "c", "e"}) {
		t.Fatalf("%v %v", got, err)
	}
	if !reflect.DeepEqual(original, []string{"a", "b", "c", "d", "e"}) {
		t.Fatal("preview mutated original queue")
	}
	got, err = MoveQueue(original, 7, 7, Move{ItemID: "a", AfterID: "e"})
	if err != nil || !reflect.DeepEqual(got, []string{"b", "c", "d", "e", "a"}) {
		t.Fatalf("%v %v", got, err)
	}
}

func TestQueueMoveRejectsConflictsAndForgedAnchors(t *testing.T) {
	for name, test := range map[string]struct {
		queue    []string
		revision int64
		move     Move
	}{
		"stale":          {[]string{"a", "b"}, 2, Move{"a", "b", ""}},
		"missing-item":   {[]string{"a", "b"}, 3, Move{"x", "b", ""}},
		"missing-anchor": {[]string{"a", "b"}, 3, Move{"a", "x", ""}},
		"self":           {[]string{"a", "b"}, 3, Move{"a", "a", ""}},
		"two-anchors":    {[]string{"a", "b"}, 3, Move{"a", "b", "b"}},
		"no-anchor":      {[]string{"a", "b"}, 3, Move{"a", "", ""}},
		"duplicate":      {[]string{"a", "b", "b"}, 3, Move{"a", "b", ""}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := MoveQueue(test.queue, 3, test.revision, test.move); err == nil {
				t.Fatal("invalid move accepted")
			}
		})
	}
}

func TestDependencyGraphRejectsCyclesAndCrossProductNodes(t *testing.T) {
	for name, graph := range map[string]map[string][]string{
		"self": {"a": {"a"}}, "cycle": {"a": {"b"}, "b": {"c"}, "c": {"a"}},
		"unknown": {"a": {"x"}}, "duplicate": {"a": {"b", "b"}, "b": {}},
	} {
		t.Run(name, func(t *testing.T) {
			if err := ValidateDependencies(graph); err == nil {
				t.Fatal("invalid graph accepted")
			}
		})
	}
	if err := ValidateDependencies(map[string][]string{"a": {}, "b": {"a"}, "c": {"a", "b"}}); err != nil {
		t.Fatal(err)
	}
}

func capacityFixture() Capacity {
	return Capacity{Total: 2000, Reserve: 200, Categories: map[InvestmentCategory]Hundredths{Reliability: 600, Usability: 600, Growth: 600}}
}

func itemFixture(id string, effort Hundredths) DecisionItem {
	return DecisionItem{ID: id, Category: Growth, Selected: true, Effort: ptr(effort), AssessmentCurrent: true}
}

func TestCapacityRejectsHiddenBudgetOverallocation(t *testing.T) {
	capacity := capacityFixture()
	capacity.Categories[Growth] = 601
	if err := capacity.Validate(); err == nil {
		t.Fatal("overallocated category budgets accepted")
	}
	capacity = capacityFixture()
	delete(capacity.Categories, Growth)
	if err := capacity.Validate(); err == nil {
		t.Fatal("unknown budget implicitly treated as zero")
	}
	capacity = capacityFixture()
	capacity.Reserve = -1
	if err := capacity.Validate(); err == nil {
		t.Fatal("negative reserve accepted")
	}
}

func TestDecisionShowsOvercapacityAndDoesNotClampNegativeRemainder(t *testing.T) {
	items := []DecisionItem{itemFixture("a", 1000), itemFixture("b", 900)}
	report, err := InspectDecision(capacityFixture(), items)
	if err != nil || report.SelectedEffort != 1900 || report.Remaining != -100 || len(report.Issues) != 2 {
		t.Fatalf("%+v %v", report, err)
	}
	if err := ConfirmDecision(report, nil); err == nil {
		t.Fatal("overcapacity confirmed without exception")
	}
	exceptions := []DecisionException{
		{Code: "capacity_exceeded", Reason: "应急修复", ResponsibleUID: "pm", Impact: "延后一项既有安排"},
		{Code: "category_capacity_exceeded", Category: Growth, Reason: "已确认专项投入", ResponsibleUID: "pm", Impact: "压缩本期预留"},
	}
	if err := ConfirmDecision(report, exceptions); err != nil {
		t.Fatal(err)
	}
	if len(report.Issues) != 2 {
		t.Fatal("exception erased unresolved diagnostics")
	}
}

func TestUnknownEffortAndStaleAssessmentRemainVisible(t *testing.T) {
	item := itemFixture("a", 100)
	item.Effort = nil
	item.AssessmentCurrent = false
	report, err := InspectDecision(capacityFixture(), []DecisionItem{item})
	if err != nil || report.UnknownEstimates != 1 || len(report.Issues) != 2 {
		t.Fatalf("%+v %v", report, err)
	}
	if err := ConfirmDecision(report, []DecisionException{{Code: "assessment_required", ItemID: "a", Reason: "P0", ResponsibleUID: "pm", Impact: "紧急"}}); err == nil {
		t.Fatal("P0 label bypassed stale assessment")
	}
}

func TestDependencyMustBeEarlierSelectedOrAlreadyDelivered(t *testing.T) {
	a, b := itemFixture("a", 100), itemFixture("b", 100)
	b.Dependencies = []string{"a"}
	for name, items := range map[string][]DecisionItem{"correct": {a, b}, "reversed": {b, a}} {
		report, err := InspectDecision(capacityFixture(), items)
		if err != nil {
			t.Fatal(err)
		}
		if (len(report.Issues) == 0) != (name == "correct") {
			t.Fatalf("%s: %+v", name, report)
		}
	}
	a.Selected = false
	a.Delivered = true
	report, err := InspectDecision(capacityFixture(), []DecisionItem{b, a})
	if err != nil || len(report.Issues) != 0 || report.SelectedEffort != 100 {
		t.Fatalf("delivered predecessor: %+v %v", report, err)
	}
}

func TestDecisionCannotDoubleCountSamePlanningItem(t *testing.T) {
	a := itemFixture("a", 100)
	if _, err := InspectDecision(capacityFixture(), []DecisionItem{a, a}); err == nil {
		t.Fatal("duplicate item counted twice")
	}
}

func TestDecisionExceptionCannotWaiveDifferentIssue(t *testing.T) {
	report := CapacityReport{Issues: []DecisionIssue{{Code: "dependency_unresolved", ItemID: "a", PredecessorID: "b"}}}
	for _, exception := range []DecisionException{
		{Code: "dependency_unresolved", ItemID: "a", PredecessorID: "other", Reason: "x", ResponsibleUID: "pm", Impact: "x"},
		{Code: "dependency_unresolved", ItemID: "a", PredecessorID: "b", Reason: "", ResponsibleUID: "pm", Impact: "x"},
	} {
		if err := ConfirmDecision(report, []DecisionException{exception}); err == nil {
			t.Fatal("invalid exception accepted")
		}
	}
}

func TestDeliveredSelectedWorkRetainsCycleCapacityConsumption(t *testing.T) {
	completed := itemFixture("completed", 900)
	completed.Delivered = true
	completed.AssessmentCurrent = false
	pending := itemFixture("pending", 1000)
	report, err := InspectDecision(capacityFixture(), []DecisionItem{completed, pending})
	if err != nil || report.SelectedEffort != 1900 || report.Remaining != -100 {
		t.Fatalf("completed work released budget %+v %v", report, err)
	}
	for _, issue := range report.Issues {
		if issue.ItemID == "completed" && issue.Code == "assessment_required" {
			t.Fatal("delivered item requires new assessment")
		}
	}
	completed.Selected = false
	report, err = InspectDecision(capacityFixture(), []DecisionItem{completed, pending})
	if err != nil || report.SelectedEffort != 1000 {
		t.Fatalf("historical delivered prerequisite consumed budget %+v %v", report, err)
	}
	completed.Selected = true
	completed.Effort = nil
	report, err = InspectDecision(capacityFixture(), []DecisionItem{completed, pending})
	if err != nil || report.UnknownEstimates != 1 {
		t.Fatalf("unknown historical effort became zero %+v %v", report, err)
	}
}

func TestCrossDependencyDecisionNeedsExplicitCoordination(t *testing.T) {
	effort := Hundredths(100)
	items := []DecisionItem{{ID: "source", Category: Growth, Selected: true, AssessmentCurrent: true, Effort: &effort, CrossDependencyUnresolved: true}}
	report, err := InspectDecision(capacityFixture(), items)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(report.Issues, []DecisionIssue{{Code: "cross_dependency_unresolved", ItemID: "source"}}) {
		t.Fatalf("issues %+v", report.Issues)
	}
	requireProductRule(t, ConfirmDecision(report, nil), "decision_issues_unresolved")
	if err = ConfirmDecision(report, []DecisionException{{Code: "cross_dependency_unresolved", ItemID: "source", Reason: "联合排期", ResponsibleUID: "pm", Impact: "前置交付延后将调整本事项安排"}}); err != nil {
		t.Fatal(err)
	}
	if len(report.Issues) != 1 {
		t.Fatal("exception hid unresolved dependency")
	}
	items[0].Delivered = true
	report, err = InspectDecision(capacityFixture(), items)
	if err != nil || len(report.Issues) != 0 {
		t.Fatalf("delivered %+v %v", report, err)
	}
}
