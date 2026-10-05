package productcenter

import "testing"

func TestConfiguredWeightedModelPreservesScoresAndVersionIdentity(t *testing.T) {
	strategic, user, business, risk := 5, 1, 2, 3
	confidence, effort := Hundredths(80), Hundredths(200)
	input := AssessmentInput{ModelVersion: AssessmentModel, EffortUnit: "person_day", Strategic: &strategic, UserValue: &user, Business: &business, Risk: &risk, Confidence: &confidence, Effort: &effort}
	fixed, err := CalculateAssessment(input)
	if err != nil || *fixed.Value != 56 || *fixed.PriorityDecimal() != "22.40000000" {
		t.Fatalf("fixed %+v %v", fixed, err)
	}
	model := WeightedAssessmentModel{Version: "customer-value-v2", Strategic: 10, UserValue: 60, Business: 20, Risk: 10}
	input.ModelVersion = model.Version
	custom, err := CalculateAssessmentWithModel(input, model)
	if err != nil || *custom.Value != 36 || *custom.PriorityDecimal() != "14.40000000" {
		t.Fatalf("custom %+v %v", custom, err)
	}
	_, err = CalculateAssessment(input)
	requireProductRule(t, err, "assessment_model_mismatch")
	model.Version = AssessmentModel
	_, err = CalculateAssessmentWithModel(input, model)
	requireProductRule(t, err, "assessment_model_reserved")
}

func TestWeightedModelRejectsInvalidWeightsAndKeepsMissingEvidence(t *testing.T) {
	for _, model := range []WeightedAssessmentModel{{Version: "v2", Strategic: 30, UserValue: 30, Business: 20, Risk: 25}, {Version: "v2", Strategic: 31, UserValue: 29, Business: 20, Risk: 20}, {Version: "v2", Strategic: -5, UserValue: 65, Business: 20, Risk: 20}, {Version: " ", Strategic: 30, UserValue: 30, Business: 20, Risk: 20}} {
		if err := model.Validate(); err == nil {
			t.Fatalf("invalid model accepted %+v", model)
		}
	}
	model := DefaultWeightedAssessmentModel()
	model.Version = "v2"
	result, err := CalculateAssessmentWithModel(AssessmentInput{ModelVersion: "v2", EffortUnit: "person_day"}, model)
	if err != nil || result.Value != nil || result.PriorityUnits != nil || len(result.Missing) != 6 {
		t.Fatalf("missing inputs scored %+v %v", result, err)
	}
}
