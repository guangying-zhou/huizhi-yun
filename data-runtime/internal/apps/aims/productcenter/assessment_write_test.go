package productcenter

import "testing"

func assessmentDraft() PlanningAssessmentCreate {
	s, u, b, r := 5, 4, 4, 2
	c, e := Hundredths(80), Hundredths(800)
	return PlanningAssessmentCreate{PlanningCycleCandidateAdd: PlanningCycleCandidateAdd{CycleBizID: "00000000-0000-4000-8000-000000000001", ItemBizID: "00000000-0000-4000-8000-000000000002", ExpectedRevision: 1, ExpectedCycleRevision: 1, ExpectedItemRevision: 1}, ExpectedScopeRevision: 1, ExpectedEvidenceRevision: 1, Assessment: AssessmentInput{ModelVersion: AssessmentModel, EffortUnit: "person_day", Strategic: &s, UserValue: &u, Business: &b, Risk: &r, Confidence: &c, Effort: &e}, Rationale: map[string]string{"strategic": "目标前提", "user_value": "减少登录阻断", "business": "准入要求", "risk": "减少配置故障", "confidence": "技术验证", "effort_person_days": "设计研发测试发布共八人日"}, EvidenceReferences: map[string][]string{"strategic": {"trial"}, "user_value": {"trial"}, "business": {"trial"}, "risk": {"trial"}, "confidence": {"trial"}, "effort_person_days": {"trial"}}, Evidence: []AssessmentEvidence{{Key: "trial", Summary: "已在隔离试点验证", ObservedOn: "2026-09-07", Kind: "fact", Polarity: "supporting"}}, EstimateConfirmed: true}
}
func TestPlanningAssessmentValidation(t *testing.T) {
	input := assessmentDraft()
	score, err := ValidatePlanningAssessmentCreate(input)
	if err != nil || score.PriorityDecimal() == nil || *score.PriorityDecimal() != "7.80000000" {
		t.Fatalf("score %+v %v", score, err)
	}
	for name, mutate := range map[string]func(*PlanningAssessmentCreate){"scope": func(p *PlanningAssessmentCreate) { p.ExpectedScopeRevision = 0 }, "rationale": func(p *PlanningAssessmentCreate) { delete(p.Rationale, "risk") }, "extra": func(p *PlanningAssessmentCreate) { p.Rationale["priority_score"] = "100" }, "confirmation": func(p *PlanningAssessmentCreate) { p.EstimateConfirmed = false }, "evidence": func(p *PlanningAssessmentCreate) { p.Evidence = nil }, "date": func(p *PlanningAssessmentCreate) { p.Evidence[0].ObservedOn = "2026-02-30" }, "kind": func(p *PlanningAssessmentCreate) { p.Evidence[0].Kind = "verified_external" }} {
		t.Run(name, func(t *testing.T) {
			p := assessmentDraft()
			mutate(&p)
			if _, err := ValidatePlanningAssessmentCreate(p); err == nil {
				t.Fatal("invalid accepted")
			}
		})
	}
	input = assessmentDraft()
	input.Assessment = AssessmentInput{ModelVersion: AssessmentModel, EffortUnit: "person_day"}
	input.Rationale = map[string]string{}
	input.EvidenceReferences = map[string][]string{}
	input.Evidence = []AssessmentEvidence{}
	input.EstimateConfirmed = false
	score, err = ValidatePlanningAssessmentCreate(input)
	if err != nil || score.PriorityDecimal() != nil || len(score.Missing) != 6 {
		t.Fatalf("unknown %+v %v", score, err)
	}
}

func TestPlanningAssessmentEvidenceReferences(t *testing.T) {
	for name, mutate := range map[string]func(*PlanningAssessmentCreate){
		"missing_dimension":   func(p *PlanningAssessmentCreate) { delete(p.EvidenceReferences, "risk") },
		"dangling":            func(p *PlanningAssessmentCreate) { p.EvidenceReferences["risk"] = []string{"missing"} },
		"duplicate_reference": func(p *PlanningAssessmentCreate) { p.EvidenceReferences["risk"] = []string{"trial", "trial"} },
		"duplicate_key":       func(p *PlanningAssessmentCreate) { p.Evidence = append(p.Evidence, p.Evidence[0]) },
		"invalid_key":         func(p *PlanningAssessmentCreate) { p.Evidence[0].Key = "../trial" },
		"unknown_dimension":   func(p *PlanningAssessmentCreate) { p.EvidenceReferences["score"] = []string{"trial"} },
	} {
		t.Run(name, func(t *testing.T) {
			p := assessmentDraft()
			mutate(&p)
			if _, err := ValidatePlanningAssessmentCreate(p); err == nil {
				t.Fatal("invalid reference accepted")
			}
		})
	}
	p := assessmentDraft()
	p.Evidence = append(p.Evidence, AssessmentEvidence{Key: "counter", Summary: "一名试点用户仍遇到登录阻断", ObservedOn: "2026-09-07", Kind: "fact", Polarity: "opposing"})
	p.EvidenceReferences["user_value"] = []string{"trial", "counter"}
	if _, err := ValidatePlanningAssessmentCreate(p); err != nil {
		t.Fatal(err)
	}
}
