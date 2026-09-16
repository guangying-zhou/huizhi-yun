package productcenter

import (
	"context"
	"database/sql"
)

// Public assessment values contain only an observation reference, never Reach
// or a caller assertion that an observation was verified.
type RICEObservedAssessmentInput struct {
	ModelVersion     string      `json:"model_version"`
	ObservationBizID string      `json:"observation_biz_id"`
	EffortUnit       string      `json:"effort_unit"`
	Impact           *Hundredths `json:"impact"`
	Confidence       *Hundredths `json:"confidence"`
	Effort           *Hundredths `json:"effort_person_days"`
}

// Must run within an authorized assessment transaction holding the product lock.
// The caller supplies the cycle's validated frozen model and current item.
func calculateObservedRICEAssessment(ctx context.Context, tx *sql.Tx, code string, item PlanningItemDetail, model RICEAssessmentModel, input RICEObservedAssessmentInput) (AssessmentScore, *RICEReachObservation, error) {
	raw := RICEAssessmentInput{ModelVersion: input.ModelVersion, EffortUnit: input.EffortUnit, Impact: input.Impact, Confidence: input.Confidence, Effort: input.Effort}
	if input.ModelVersion != model.Version || item.ProductCode != code {
		return AssessmentScore{}, nil, invalid("assessment_model_mismatch", "RICE 模型或事项产品不匹配")
	}
	if input.ObservationBizID == "" {
		score, err := CalculateRICEAssessment(raw, model)
		return score, nil, err
	}
	observation, err := loadRICEReachObservation(ctx, tx, code, item.BizID, input.ObservationBizID)
	if err != nil {
		return AssessmentScore{}, nil, err
	}
	if err = ValidateRICEReachObservation(model, observation, code, item.BizID, item.ScopeRevision, item.EvidenceRevision); err != nil {
		return AssessmentScore{}, nil, err
	}
	raw.Reach = &observation.Reach
	score, err := CalculateRICEAssessment(raw, model)
	return score, &observation, err
}
