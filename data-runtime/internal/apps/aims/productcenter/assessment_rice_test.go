package productcenter

import "testing"

func riceModel() RICEAssessmentModel {
	return RICEAssessmentModel{Version: "rice-person-day-v1", ReachUnit: "unique_users", ReachDefinition: "按产品用户 UID 去重，排除测试账号", ReachStartsOn: "2026-10-01", ReachEndsOn: "2026-12-31", SourceDefinition: "产品活跃用户事件汇总，按上述期间和对象范围统计"}
}
func TestRICEAssessmentExactScores(t *testing.T) {
	reach := int64(450)
	impact, confidence, effort := Hundredths(200), Hundredths(80), Hundredths(800)
	input := RICEAssessmentInput{ModelVersion: riceModel().Version, EffortUnit: "person_day", Reach: &reach, Impact: &impact, Confidence: &confidence, Effort: &effort}
	score, err := CalculateRICEAssessment(input, riceModel())
	if err != nil || score.PriorityDecimal() == nil || *score.PriorityDecimal() != "90.00000000" || score.Value != nil {
		t.Fatalf("%+v %v", score, err)
	}
	reach = 1
	impact = 25
	confidence = 50
	effort = 300
	score, err = CalculateRICEAssessment(input, riceModel())
	if err != nil || *score.PriorityDecimal() != "0.04166667" {
		t.Fatalf("%+v %v", score, err)
	}
	reach = 1_000_000_000
	impact = 300
	confidence = 100
	effort = 50
	score, err = CalculateRICEAssessment(input, riceModel())
	if err != nil || *score.PriorityDecimal() != "6000000000.00000000" {
		t.Fatalf("bounds %+v %v", score, err)
	}
	reach = 0
	score, err = CalculateRICEAssessment(input, riceModel())
	if err != nil || *score.PriorityDecimal() != "0.00000000" {
		t.Fatal("zero reach is known zero")
	}
	input.Reach = nil
	score, err = CalculateRICEAssessment(input, riceModel())
	if err != nil || score.PriorityUnits != nil || len(score.Missing) != 1 || score.Missing[0] != "reach" {
		t.Fatal("unknown reach must not be zero")
	}
}
func TestRICERequiresComparableReachDefinitions(t *testing.T) {
	for _, change := range []func(*RICEAssessmentModel){
		func(m *RICEAssessmentModel) { m.ReachUnit = "customers_or_users" },
		func(m *RICEAssessmentModel) { m.ReachDefinition = "" },
		func(m *RICEAssessmentModel) { m.SourceDefinition = "" },
		func(m *RICEAssessmentModel) { m.ReachStartsOn = "2026-02-30" },
		func(m *RICEAssessmentModel) { m.ReachEndsOn = "2026-09-30" },
		func(m *RICEAssessmentModel) { m.ReachEndsOn = "2028-12-31" },
		func(m *RICEAssessmentModel) { m.Version = AssessmentModel },
	} {
		m := riceModel()
		change(&m)
		if m.Validate() == nil {
			t.Fatalf("accepted %+v", m)
		}
	}
	input := RICEAssessmentInput{ModelVersion: riceModel().Version, EffortUnit: "person_day"}
	score, err := CalculateRICEAssessment(input, riceModel())
	if err != nil || len(score.Missing) != 4 || score.PriorityUnits != nil {
		t.Fatalf("missing %+v %v", score, err)
	}
	invalidImpact := Hundredths(75)
	input.Impact = &invalidImpact
	if _, err = CalculateRICEAssessment(input, riceModel()); err == nil {
		t.Fatal("invalid impact accepted")
	}
}
