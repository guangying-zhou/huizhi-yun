package productcenter

import "testing"

func TestRICEAssessmentRequiresEvidenceAndEstimateConfirmation(t *testing.T) {
	base := assessmentDraft()
	impact := Hundredths(200)
	makeInput := func() PlanningRICEAssessmentCreate {
		return PlanningRICEAssessmentCreate{PlanningCycleCandidateAdd: base.PlanningCycleCandidateAdd, ExpectedScopeRevision: 1, ExpectedEvidenceRevision: 1, Assessment: RICEObservedAssessmentInput{ModelVersion: riceModel().Version, ObservationBizID: "00000000-0000-4000-8000-000000000003", EffortUnit: "person_day", Impact: &impact, Confidence: base.Assessment.Confidence, Effort: base.Assessment.Effort}, Rationale: map[string]string{"impact": "减少关键路径阻断", "confidence": "试点结果", "effort_person_days": "设计研发测试共八人日"}, EvidenceReferences: map[string][]string{"impact": {"trial"}, "confidence": {"trial"}, "effort_person_days": {"trial"}}, Evidence: base.Evidence, EstimateConfirmed: true}
	}
	if err := validatePlanningRICEAssessment(makeInput(), riceModel()); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*PlanningRICEAssessmentCreate){
		func(p *PlanningRICEAssessmentCreate) { delete(p.Rationale, "impact") },
		func(p *PlanningRICEAssessmentCreate) { delete(p.EvidenceReferences, "confidence") },
		func(p *PlanningRICEAssessmentCreate) { p.EvidenceReferences["impact"] = []string{"missing"} },
		func(p *PlanningRICEAssessmentCreate) { p.Rationale["reach"] = "伪造来源确认" },
		func(p *PlanningRICEAssessmentCreate) { p.EstimateConfirmed = false },
		func(p *PlanningRICEAssessmentCreate) { p.Assessment.ObservationBizID = "bad" },
		func(p *PlanningRICEAssessmentCreate) { p.ExpectedScopeRevision = 0 },
	} {
		input := makeInput()
		change(&input)
		if validatePlanningRICEAssessment(input, riceModel()) == nil {
			t.Fatal("invalid RICE assessment accepted")
		}
	}
	input := makeInput()
	input.Assessment.ObservationBizID = ""
	input.Assessment.Impact = nil
	input.Assessment.Confidence = nil
	input.Assessment.Effort = nil
	input.EstimateConfirmed = false
	input.Rationale = map[string]string{}
	input.EvidenceReferences = map[string][]string{}
	input.Evidence = []AssessmentEvidence{}
	if err := validatePlanningRICEAssessment(input, riceModel()); err != nil {
		t.Fatal("explicit unknown assessment rejected", err)
	}
}
