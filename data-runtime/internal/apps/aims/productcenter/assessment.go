// Package productcenter owns Aims product planning rules. Persistence and
// authorization are supplied by the Aims adapter; this package never calls
// another application's database or infers permissions from product relations.
package productcenter

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

const AssessmentModel = "weighted-value-effort-v1"
const ScoreScale int64 = 100_000_000

// Hundredths stores decimal input without converting through binary floats.
// JSON accepts a number or a decimal string, with at most two decimal places.
type Hundredths int64

func ParseHundredths(raw string) (Hundredths, error) {
	if raw == "" || strings.TrimSpace(raw) != raw || len(raw) > 16 {
		return 0, invalid("invalid_decimal", "请输入最多两位小数的非负数")
	}
	parts := strings.Split(raw, ".")
	if len(parts) > 2 || parts[0] == "" || len(parts[0]) > 9 {
		return 0, invalid("invalid_decimal", "请输入最多两位小数的非负数")
	}
	for _, part := range parts {
		if part == "" {
			return 0, invalid("invalid_decimal", "小数格式无效")
		}
		for _, c := range part {
			if c < '0' || c > '9' {
				return 0, invalid("invalid_decimal", "不支持负数、指数或非数值输入")
			}
		}
	}
	whole, _ := strconv.ParseInt(parts[0], 10, 64)
	var fraction int64
	if len(parts) == 2 {
		if len(parts[1]) > 2 {
			return 0, invalid("invalid_decimal", "最多保留两位小数")
		}
		fraction, _ = strconv.ParseInt(parts[1]+strings.Repeat("0", 2-len(parts[1])), 10, 64)
	}
	return Hundredths(whole*100 + fraction), nil
}

func (v *Hundredths) UnmarshalJSON(data []byte) error {
	if bytes.Equal(data, []byte("null")) {
		return invalid("invalid_decimal", "缺失数值必须使用可空字段")
	}
	raw := string(data)
	if len(data) > 0 && data[0] == '"' {
		if err := json.Unmarshal(data, &raw); err != nil {
			return invalid("invalid_decimal", "小数格式无效")
		}
	}
	parsed, err := ParseHundredths(raw)
	if err == nil {
		*v = parsed
	}
	return err
}

func (v Hundredths) String() string {
	whole, fraction := v/100, v%100
	if fraction < 0 {
		fraction = -fraction
	}
	if v < 0 && whole == 0 {
		return fmt.Sprintf("-0.%02d", fraction)
	}
	return fmt.Sprintf("%d.%02d", whole, fraction)
}
func (v Hundredths) MarshalJSON() ([]byte, error) { return json.Marshal(v.String()) }

type RuleError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *RuleError) Error() string       { return e.Message }
func invalid(code, message string) error { return &RuleError{Code: code, Message: message} }

type AssessmentInput struct {
	ModelVersion string      `json:"model_version"`
	EffortUnit   string      `json:"effort_unit"`
	Strategic    *int        `json:"strategic"`
	UserValue    *int        `json:"user_value"`
	Business     *int        `json:"business"`
	Risk         *int        `json:"risk"`
	Confidence   *Hundredths `json:"confidence"`
	Effort       *Hundredths `json:"effort_person_days"`
}

// AssessmentScore is an immutable numerical result for one input snapshot.
// PriorityUnits uses eight decimal places, independently of UI's two places.
type AssessmentScore struct {
	Value         *int     `json:"value_score"`
	PriorityUnits *int64   `json:"-"`
	Missing       []string `json:"missing"`
}

func (s AssessmentScore) PriorityDecimal() *string {
	if s.PriorityUnits == nil {
		return nil
	}
	value := fmt.Sprintf("%d.%08d", *s.PriorityUnits/ScoreScale, *s.PriorityUnits%ScoreScale)
	return &value
}

func (s AssessmentScore) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Value    *int     `json:"value_score"`
		Priority *string  `json:"priority_score"`
		Missing  []string `json:"missing"`
	}{s.Value, s.PriorityDecimal(), s.Missing})
}

func CalculateAssessment(input AssessmentInput) (AssessmentScore, error) {
	return CalculateAssessmentWithModel(input, DefaultWeightedAssessmentModel())
}

// Model is loaded from trusted version storage, never from assessment input.
func CalculateAssessmentWithModel(input AssessmentInput, model WeightedAssessmentModel) (AssessmentScore, error) {
	result := AssessmentScore{Missing: []string{}}
	if err := model.Validate(); err != nil {
		return result, err
	}
	if input.ModelVersion != model.Version {
		return result, invalid("assessment_model_mismatch", "评估模型版本不匹配")
	}
	if input.EffortUnit != "person_day" {
		return result, invalid("assessment_unit_mismatch", "评估投入必须统一使用人日")
	}
	value := 0
	for _, dimension := range []struct {
		name   string
		score  *int
		weight int
	}{
		{"strategic", input.Strategic, model.Strategic / 5}, {"user_value", input.UserValue, model.UserValue / 5},
		{"business", input.Business, model.Business / 5}, {"risk", input.Risk, model.Risk / 5},
	} {
		if dimension.score == nil {
			result.Missing = append(result.Missing, dimension.name)
		} else if *dimension.score < 0 || *dimension.score > 5 {
			return result, invalid("assessment_dimension_invalid", "价值维度必须为 0～5 的整数")
		} else {
			value += *dimension.score * dimension.weight
		}
	}
	if len(result.Missing) == 0 {
		result.Value = &value
	}
	if input.Confidence == nil {
		result.Missing = append(result.Missing, "confidence")
	} else if *input.Confidence != 50 && *input.Confidence != 80 && *input.Confidence != 100 {
		return result, invalid("assessment_confidence_invalid", "置信度必须为 0.5、0.8 或 1.0")
	}
	if input.Effort == nil {
		result.Missing = append(result.Missing, "effort_person_days")
	} else if *input.Effort < 50 || *input.Effort > 100_000_000 {
		return result, invalid("assessment_effort_invalid", "投入须为 0.5～1000000 人日")
	}
	if len(result.Missing) != 0 {
		return result, nil
	}
	// V * (C/100) / (E/100). The upper bounds above prevent int64 overflow.
	numerator := int64(value) * int64(*input.Confidence) * ScoreScale
	denominator := int64(*input.Effort)
	units := (numerator + denominator/2) / denominator
	result.PriorityUnits = &units
	return result, nil
}

// EvidenceFingerprint is compared at the decision boundary, not only in UI.
type EvidenceFingerprint struct {
	ScopeRevision    int64  `json:"scope_revision"`
	EvidenceRevision int64  `json:"evidence_revision"`
	ModelVersion     string `json:"model_version"`
}

func (snapshot EvidenceFingerprint) Current(actual EvidenceFingerprint) bool {
	return snapshot.ScopeRevision > 0 && snapshot.EvidenceRevision > 0 &&
		snapshot.ModelVersion != "" && snapshot == actual
}
