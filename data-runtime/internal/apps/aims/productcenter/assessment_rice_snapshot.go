package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"reflect"
)

// This resolves a published definition, not the authenticity of Reach evidence.
func loadFrozenRICEModel(ctx context.Context, tx *sql.Tx, code, version string, snapshot json.RawMessage) (RICEAssessmentModel, error) {
	var model RICEAssessmentModel
	var method string
	var expected json.RawMessage
	if err := tx.QueryRowContext(ctx, `SELECT method,configuration FROM product_priority_model_versions WHERE BINARY product_code=BINARY ? AND BINARY version=BINARY ?`, code, version).Scan(&method, &expected); err != nil {
		return model, err
	}
	if method != "rice" {
		return model, invalid("assessment_model_mismatch", "当前 RICE 入口不支持此模型方法")
	}
	var actualValue, expectedValue any
	if json.Unmarshal(snapshot, &actualValue) != nil || json.Unmarshal(expected, &expectedValue) != nil || !reflect.DeepEqual(actualValue, expectedValue) {
		return model, invalid("assessment_model_mismatch", "周期模型快照与原模型版本不一致")
	}
	var config struct {
		RICEAssessmentModel
		EffortUnit    string   `json:"effort_unit"`
		MinimumEffort string   `json:"minimum_effort_person_days"`
		Impact        []string `json:"impact_values"`
		Confidence    []string `json:"confidence_values"`
		DecimalPlaces int      `json:"priority_decimal_places"`
		Rounding      string   `json:"rounding"`
	}
	if json.Unmarshal(expected, &config) != nil || config.Version != version || config.EffortUnit != "person_day" || config.MinimumEffort != "0.50" || config.DecimalPlaces != 8 || config.Rounding != "half_up" || !reflect.DeepEqual(config.Impact, []string{"0.25", "0.50", "1.00", "2.00", "3.00"}) || !reflect.DeepEqual(config.Confidence, []string{"0.50", "0.80", "1.00"}) {
		return model, invalid("assessment_model_mismatch", "RICE 计算规则不完整或不受支持")
	}
	model = config.RICEAssessmentModel
	return model, model.Validate()
}
