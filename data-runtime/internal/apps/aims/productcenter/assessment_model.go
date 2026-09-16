package productcenter

import (
	"strings"
	"unicode/utf8"
)

// WeightedAssessmentModel is a frozen business model version. Five-point
// percentage increments preserve the existing integer 0–100 value scale.
// Effort, confidence and precision remain explicit fixed rules of this method.
type WeightedAssessmentModel struct {
	Version   string `json:"version"`
	Strategic int    `json:"strategic"`
	UserValue int    `json:"user_value"`
	Business  int    `json:"business"`
	Risk      int    `json:"risk"`
}

func DefaultWeightedAssessmentModel() WeightedAssessmentModel {
	return WeightedAssessmentModel{Version: AssessmentModel, Strategic: 30, UserValue: 30, Business: 20, Risk: 20}
}

func (m WeightedAssessmentModel) Validate() error {
	if !utf8.ValidString(m.Version) || m.Version == "" || m.Version != strings.TrimSpace(m.Version) || utf8.RuneCountInString(m.Version) > 64 {
		return invalid("assessment_model_invalid", "模型版本标识无效")
	}
	for _, r := range m.Version {
		if r < 32 || r == 127 || r == '/' {
			return invalid("assessment_model_invalid", "模型版本标识无效")
		}
	}
	total := 0
	for _, weight := range []int{m.Strategic, m.UserValue, m.Business, m.Risk} {
		if weight < 0 || weight > 100 || weight%5 != 0 {
			return invalid("assessment_model_weights_invalid", "权重须为 0～100 的整数，按 5% 调整")
		}
		total += weight
	}
	if total != 100 {
		return invalid("assessment_model_weights_invalid", "四个维度权重之和必须为 100%")
	}
	if m.Version == AssessmentModel && m != DefaultWeightedAssessmentModel() {
		return invalid("assessment_model_reserved", "内置模型版本的权重不可改写")
	}
	return nil
}
