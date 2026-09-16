package productcenter

import "github.com/google/uuid"

type PlanningRICEAssessmentCreate struct {
	PlanningCycleCandidateAdd
	ExpectedScopeRevision    uint64                      `json:"expected_scope_revision"`
	ExpectedEvidenceRevision uint64                      `json:"expected_evidence_revision"`
	Assessment               RICEObservedAssessmentInput `json:"assessment"`
	EvidenceReferences       map[string][]string         `json:"evidence_references"`
	Rationale                map[string]string           `json:"rationale"`
	Evidence                 []AssessmentEvidence        `json:"evidence"`
	EstimateConfirmed        bool                        `json:"estimate_confirmed"`
}

func validatePlanningRICEAssessment(input PlanningRICEAssessmentCreate, model RICEAssessmentModel) error {
	if err := ValidatePlanningCycleCandidateAdd(input.PlanningCycleCandidateAdd); err != nil {
		return err
	}
	if input.ExpectedScopeRevision == 0 || input.ExpectedEvidenceRevision == 0 {
		return invalid("assessment_revision_required", "必须提供范围与证据版本")
	}
	if input.Assessment.ObservationBizID != "" {
		parsed, err := uuid.Parse(input.Assessment.ObservationBizID)
		if err != nil || parsed.String() != input.Assessment.ObservationBizID {
			return invalid("rice_observation_invalid", "Reach 观测引用无效")
		}
	}
	// Validate editable numerical dimensions without trusting a caller Reach count.
	_, err := CalculateRICEAssessment(RICEAssessmentInput{ModelVersion: input.Assessment.ModelVersion, EffortUnit: input.Assessment.EffortUnit, Impact: input.Assessment.Impact, Confidence: input.Assessment.Confidence, Effort: input.Assessment.Effort}, model)
	if err != nil {
		return err
	}
	dimensions := map[string]bool{"impact": input.Assessment.Impact != nil, "confidence": input.Assessment.Confidence != nil, "effort_person_days": input.Assessment.Effort != nil}
	return validateAssessmentEvidence(dimensions, input.Rationale, input.EvidenceReferences, input.Evidence, input.Assessment.Effort != nil, input.EstimateConfirmed)
}
