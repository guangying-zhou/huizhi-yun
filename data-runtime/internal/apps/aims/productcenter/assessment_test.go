package productcenter

import (
	"encoding/json"
	"math/big"
	"testing"
)

func ptr[T any](value T) *T { return &value }

func sampleInput() AssessmentInput {
	return AssessmentInput{AssessmentModel, "person_day", ptr(5), ptr(4), ptr(4), ptr(2), ptr(Hundredths(80)), ptr(Hundredths(800))}
}

func TestAssessmentPlanExamples(t *testing.T) {
	for _, sample := range []struct {
		name  string
		input AssessmentInput
		value int
		score string
	}{
		{"oidc", sampleInput(), 78, "7.80000000"},
		{"export", AssessmentInput{AssessmentModel, "person_day", ptr(3), ptr(3), ptr(2), ptr(1), ptr(Hundredths(80)), ptr(Hundredths(300))}, 48, "12.80000000"},
		{"zero-is-known", AssessmentInput{AssessmentModel, "person_day", ptr(0), ptr(0), ptr(0), ptr(0), ptr(Hundredths(50)), ptr(Hundredths(50))}, 0, "0.00000000"},
		{"maximum", AssessmentInput{AssessmentModel, "person_day", ptr(5), ptr(5), ptr(5), ptr(5), ptr(Hundredths(100)), ptr(Hundredths(50))}, 100, "200.00000000"},
	} {
		t.Run(sample.name, func(t *testing.T) {
			got, err := CalculateAssessment(sample.input)
			if err != nil || got.Value == nil || *got.Value != sample.value || got.PriorityDecimal() == nil || *got.PriorityDecimal() != sample.score {
				t.Fatalf("got %+v (%v), expected %d/%s", got, err, sample.value, sample.score)
			}
		})
	}
}

func TestAssessmentMissingDoesNotBecomeZero(t *testing.T) {
	input := sampleInput()
	input.Effort, input.Risk = nil, nil
	got, err := CalculateAssessment(input)
	if err != nil || got.Value != nil || got.PriorityUnits != nil || len(got.Missing) != 2 {
		t.Fatalf("missing assessment = %+v, err %v", got, err)
	}
	data, err := json.Marshal(got)
	if err != nil || string(data) != `{"value_score":null,"priority_score":null,"missing":["risk","effort_person_days"]}` {
		t.Fatalf("missing JSON: %s %v", data, err)
	}
}

func TestAssessmentRejectsInvalidInputsEvenWhenOthersMissing(t *testing.T) {
	for name, change := range map[string]func(*AssessmentInput){
		"wrong-model":        func(i *AssessmentInput) { i.ModelVersion = "rice" },
		"wrong-unit":         func(i *AssessmentInput) { i.EffortUnit = "story_point" },
		"negative-value":     func(i *AssessmentInput) { i.Strategic = ptr(-1) },
		"large-value":        func(i *AssessmentInput) { i.Risk = ptr(6) },
		"unknown-confidence": func(i *AssessmentInput) { i.Confidence = ptr(Hundredths(70)) },
		"zero-effort":        func(i *AssessmentInput) { i.Effort = ptr(Hundredths(0)) },
		"negative-effort":    func(i *AssessmentInput) { i.Effort = ptr(Hundredths(-100)) },
		"tiny-effort":        func(i *AssessmentInput) { i.Effort = ptr(Hundredths(49)) },
		"huge-effort":        func(i *AssessmentInput) { i.Effort = ptr(Hundredths(100_000_001)) },
	} {
		t.Run(name, func(t *testing.T) {
			input := sampleInput()
			input.Business = nil
			change(&input)
			if _, err := CalculateAssessment(input); err == nil {
				t.Fatal("invalid input accepted")
			}
		})
	}
}

func TestHundredthsJSON(t *testing.T) {
	for input, expected := range map[string]string{`0.5`: "0.50", `"0.80"`: "0.80", `1`: "1.00", `"1000000.00"`: "1000000.00"} {
		var got Hundredths
		if err := json.Unmarshal([]byte(input), &got); err != nil || got.String() != expected {
			t.Fatalf("%s => %s (%v)", input, got, err)
		}
	}
	for _, input := range []string{`null`, `"NaN"`, `"Infinity"`, `-1`, `1e2`, `"0.001"`, `" 1"`, `"1."`, `".5"`, `"999999999999999999"`, `true`, `{}`} {
		var got Hundredths
		if err := json.Unmarshal([]byte(input), &got); err == nil {
			t.Errorf("accepted %s", input)
		}
	}
	for value, expected := range map[Hundredths]string{-50: "-0.50", -101: "-1.01", 0: "0.00"} {
		if got := value.String(); got != expected {
			t.Fatalf("%d => %s", value, got)
		}
	}
}

func TestScorePrecisionAgreesWithIndependentRationalOracle(t *testing.T) {
	for _, effort := range []int64{50, 51, 75, 299, 301, 1300, 99999999, 100000000} {
		input := sampleInput()
		input.Effort = ptr(Hundredths(effort))
		got, err := CalculateAssessment(input)
		if err != nil {
			t.Fatal(err)
		}
		rational := new(big.Rat).SetFrac(big.NewInt(78*80), big.NewInt(effort))
		if *got.PriorityDecimal() != rational.FloatString(8) {
			t.Fatalf("effort=%d got %s want %s", effort, *got.PriorityDecimal(), rational.FloatString(8))
		}
	}
}

func TestEvidenceFingerprintRequiresAllCurrentVersions(t *testing.T) {
	current := EvidenceFingerprint{2, 3, AssessmentModel}
	for _, old := range []EvidenceFingerprint{{1, 3, AssessmentModel}, {2, 2, AssessmentModel}, {2, 3, "old"}, {0, 3, AssessmentModel}, {}} {
		if old.Current(current) {
			t.Fatalf("stale fingerprint accepted: %+v", old)
		}
	}
	if !current.Current(current) {
		t.Fatal("current fingerprint rejected")
	}
}
