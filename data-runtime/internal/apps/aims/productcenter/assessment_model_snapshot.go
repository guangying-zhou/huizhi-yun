package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"reflect"
)

// Resolve the frozen cycle configuration against the immutable product version.
// No client-supplied weight is used to score an assessment.
func loadFrozenWeightedModel(ctx context.Context, tx *sql.Tx, code, version string, snapshot json.RawMessage) (WeightedAssessmentModel, error) {
	var expected json.RawMessage
	if version == AssessmentModel {
		encoded, err := json.Marshal(planningCycleModelSnapshot())
		if err != nil {
			return WeightedAssessmentModel{}, err
		}
		expected = encoded
	} else {
		var method string
		if err := tx.QueryRowContext(ctx, `SELECT method,configuration FROM product_priority_model_versions WHERE BINARY product_code=BINARY ? AND BINARY version=BINARY ?`, code, version).Scan(&method, &expected); err != nil {
			return WeightedAssessmentModel{}, err
		}
		if method != "weighted-value-effort" {
			return WeightedAssessmentModel{}, invalid("assessment_model_mismatch", "当前评估入口不支持此模型方法")
		}
	}
	var actualValue, expectedValue any
	if json.Unmarshal(snapshot, &actualValue) != nil || json.Unmarshal(expected, &expectedValue) != nil || !reflect.DeepEqual(actualValue, expectedValue) {
		return WeightedAssessmentModel{}, invalid("assessment_model_mismatch", "周期模型快照与原模型版本不一致")
	}
	var config struct {
		Version       string         `json:"version"`
		Weights       map[string]int `json:"weights"`
		EffortUnit    string         `json:"effort_unit"`
		Confidence    []string       `json:"confidence_values"`
		MinimumEffort string         `json:"minimum_effort_person_days"`
	}
	if json.Unmarshal(expected, &config) != nil || config.Version != version || len(config.Weights) != 4 || config.EffortUnit != "person_day" || config.MinimumEffort != "0.50" || !reflect.DeepEqual(config.Confidence, []string{"0.50", "0.80", "1.00"}) {
		return WeightedAssessmentModel{}, invalid("assessment_model_mismatch", "模型计算规则不完整")
	}
	for _, name := range []string{"strategic", "user_value", "business", "risk"} {
		if _, ok := config.Weights[name]; !ok {
			return WeightedAssessmentModel{}, invalid("assessment_model_mismatch", "模型权重不完整")
		}
	}
	if version != AssessmentModel {
		var precision struct {
			DimensionScale string `json:"dimension_scale"`
			ValueScale     int    `json:"value_scale"`
			DecimalPlaces  int    `json:"priority_decimal_places"`
			Rounding       string `json:"rounding"`
		}
		if json.Unmarshal(expected, &precision) != nil || precision.DimensionScale != "integer_0_to_5" || precision.ValueScale != 100 || precision.DecimalPlaces != 8 || precision.Rounding != "half_up" {
			return WeightedAssessmentModel{}, invalid("assessment_model_mismatch", "模型精度或舍入规则不匹配")
		}
	}
	model := WeightedAssessmentModel{Version: version, Strategic: config.Weights["strategic"], UserValue: config.Weights["user_value"], Business: config.Weights["business"], Risk: config.Weights["risk"]}
	return model, model.Validate()
}
