package productcenter

import (
	"strings"
	"testing"
)

func TestPlanningSelectionExceptionStructure(t *testing.T) {
	draft := assessmentDraft()
	input := PlanningSelection{PlanningCycleCandidateAdd: draft.PlanningCycleCandidateAdd, ExpectedQueueRevision: 1, ExpectedAssessmentID: 1, Reason: "安排本周期", Exceptions: []DecisionException{}}
	base := DecisionException{Code: "category_capacity_exceeded", Category: Growth, Reason: "确认取舍", ResponsibleUID: "pm", Impact: "本类超预算"}
	input.Exceptions = []DecisionException{base}
	if err := ValidatePlanningSelection(input); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*DecisionException){
		"unknown":                func(e *DecisionException) { e.Code = "override" },
		"assessment":             func(e *DecisionException) { e.Code = "assessment_required" },
		"category":               func(e *DecisionException) { e.Category = "other" },
		"extra object":           func(e *DecisionException) { e.ItemID = draft.ItemBizID },
		"responsible length":     func(e *DecisionException) { e.ResponsibleUID = strings.Repeat("x", 65) },
		"responsible whitespace": func(e *DecisionException) { e.ResponsibleUID = " pm " },
		"reason utf8":            func(e *DecisionException) { e.Reason = string([]byte{255}) },
	} {
		t.Run(name, func(t *testing.T) {
			value := base
			mutate(&value)
			input.Exceptions = []DecisionException{value}
			if err := ValidatePlanningSelection(input); err == nil {
				t.Fatal("invalid exception accepted")
			}
		})
	}
	input.Exceptions = []DecisionException{base, base}
	if err := ValidatePlanningSelection(input); err == nil {
		t.Fatal("duplicate accepted")
	}
	dep := DecisionException{Code: "dependency_unresolved", ItemID: draft.ItemBizID, PredecessorID: draft.CycleBizID, Reason: "并行处理", ResponsibleUID: "tech", Impact: "依赖仍未解除"}
	input.Exceptions = []DecisionException{dep}
	if err := ValidatePlanningSelection(input); err != nil {
		t.Fatal(err)
	}
	input.Exceptions[0].PredecessorID = dep.ItemID
	if err := ValidatePlanningSelection(input); err == nil {
		t.Fatal("self dependency accepted")
	}
}
