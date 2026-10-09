package productcenter

import (
	"context"
	"database/sql"
)

type RICEModelCreate struct {
	ExpectedRevision uint64              `json:"expected_revision"`
	Title            string              `json:"title"`
	Reason           string              `json:"reason"`
	Model            RICEAssessmentModel `json:"model"`
}

// Publishing a definition does not assert that a particular Reach observation
// is trustworthy. That gate belongs to cycle activation and assessment evidence.
func CreateRICEModelVersion(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input RICEModelCreate) (CommandResult, error) {
	if err := input.Model.Validate(); err != nil {
		return CommandResult{}, err
	}
	configuration := map[string]any{
		"version":                    input.Model.Version,
		"reach_unit":                 input.Model.ReachUnit,
		"reach_definition":           input.Model.ReachDefinition,
		"reach_starts_on":            input.Model.ReachStartsOn,
		"reach_ends_on":              input.Model.ReachEndsOn,
		"source_definition":          input.Model.SourceDefinition,
		"effort_unit":                "person_day",
		"minimum_effort_person_days": "0.50",
		"impact_values":              []string{"0.25", "0.50", "1.00", "2.00", "3.00"},
		"confidence_values":          []string{"0.50", "0.80", "1.00"},
		"priority_decimal_places":    8,
		"rounding":                   "half_up",
	}
	return createPriorityModelVersion(ctx, db, identity, permit, input, input.ExpectedRevision, input.Title, input.Reason, input.Model.Version, "rice", configuration)
}
