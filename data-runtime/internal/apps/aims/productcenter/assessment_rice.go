package productcenter

import (
	"math/big"
	"strings"
	"time"
	"unicode/utf8"
)

// RICE uses person-days, matching capacity accounting in this application.
// Reach definitions belong to the immutable model, never to caller score rules.
type RICEAssessmentModel struct {
	Version          string `json:"version"`
	ReachUnit        string `json:"reach_unit"`
	ReachDefinition  string `json:"reach_definition"`
	ReachStartsOn    string `json:"reach_starts_on"`
	ReachEndsOn      string `json:"reach_ends_on"`
	SourceDefinition string `json:"source_definition"`
}

func (m RICEAssessmentModel) Validate() error {
	version := DefaultWeightedAssessmentModel()
	version.Version = m.Version
	if err := version.Validate(); err != nil {
		return err
	}
	if m.Version == AssessmentModel {
		return invalid("assessment_model_invalid", "RICE 不得使用内置加权模型版本")
	}
	if m.ReachUnit != "unique_users" && m.ReachUnit != "unique_customer_organizations" {
		return invalid("rice_reach_unit_invalid", "Reach 必须明确为去重用户数或去重客户企业数")
	}
	for _, value := range []string{m.ReachDefinition, m.SourceDefinition} {
		if strings.TrimSpace(value) == "" || !utf8.ValidString(value) || strings.ContainsRune(value, 0) || utf8.RuneCountInString(value) > 2000 {
			return invalid("rice_definition_required", "RICE 需要明确去重口径和数据来源定义")
		}
	}
	start, e1 := time.Parse("2006-01-02", m.ReachStartsOn)
	end, e2 := time.Parse("2006-01-02", m.ReachEndsOn)
	if e1 != nil || e2 != nil || start.Year() < 1000 || end.Before(start) || end.Sub(start) > 366*24*time.Hour {
		return invalid("rice_window_invalid", "Reach 时间窗口必须明确且不超过 367 个自然日")
	}
	return nil
}

type RICEAssessmentInput struct {
	ModelVersion string      `json:"model_version"`
	EffortUnit   string      `json:"effort_unit"`
	Reach        *int64      `json:"reach"`
	Impact       *Hundredths `json:"impact"`
	Confidence   *Hundredths `json:"confidence"`
	Effort       *Hundredths `json:"effort_person_days"`
}

// No weighted value_score is fabricated: RICE has a different value scale.
func CalculateRICEAssessment(input RICEAssessmentInput, model RICEAssessmentModel) (AssessmentScore, error) {
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
	if input.Reach == nil {
		result.Missing = append(result.Missing, "reach")
	} else if *input.Reach < 0 || *input.Reach > 1_000_000_000 {
		return result, invalid("rice_reach_invalid", "Reach 须为 0～1000000000 的去重对象数")
	}
	if input.Impact == nil {
		result.Missing = append(result.Missing, "impact")
	} else if *input.Impact != 25 && *input.Impact != 50 && *input.Impact != 100 && *input.Impact != 200 && *input.Impact != 300 {
		return result, invalid("rice_impact_invalid", "影响系数须为 0.25、0.50、1、2 或 3")
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
	if len(result.Missing) > 0 {
		return result, nil
	}
	// R * (I/100) * (C/100) / (E/100), eight decimals, half-up.
	// Intermediate products exceed int64 at valid bounds; use exact integers.
	numerator := new(big.Int).SetInt64(*input.Reach)
	numerator.Mul(numerator, big.NewInt(int64(*input.Impact)))
	numerator.Mul(numerator, big.NewInt(int64(*input.Confidence)))
	numerator.Mul(numerator, big.NewInt(ScoreScale))
	denominator := big.NewInt(int64(*input.Effort) * 100)
	numerator.Add(numerator, new(big.Int).Quo(new(big.Int).Set(denominator), big.NewInt(2)))
	numerator.Quo(numerator, denominator)
	if !numerator.IsInt64() {
		return result, invalid("rice_score_overflow", "RICE 分数超出可保存范围")
	}
	units := numerator.Int64()
	result.PriorityUnits = &units
	return result, nil
}
