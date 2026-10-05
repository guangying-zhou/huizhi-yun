package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
)

// A RICE definition alone cannot enable planning: require an attributed,
// current observation for this product and definition. Each assessment still
// verifies its own item's observation; this is not external-source verification.
func validatePlanningCycleModelReady(ctx context.Context, tx *sql.Tx, code, version string, snapshot json.RawMessage) error {
	if version == AssessmentModel {
		_, err := loadFrozenWeightedModel(ctx, tx, code, version, snapshot)
		return err
	}
	var method string
	if err := tx.QueryRowContext(ctx, `SELECT method FROM product_priority_model_versions WHERE BINARY product_code=BINARY ? AND BINARY version=BINARY ?`, code, version).Scan(&method); err != nil {
		return err
	}
	if method == "weighted-value-effort" {
		_, err := loadFrozenWeightedModel(ctx, tx, code, version, snapshot)
		return err
	}
	model, err := loadFrozenRICEModel(ctx, tx, code, version, snapshot)
	if err != nil {
		return err
	}
	var observationID, itemID string
	err = tx.QueryRowContext(ctx, `SELECT o.biz_id,i.biz_id FROM product_rice_reach_observations o JOIN product_planning_items i ON i.id=o.planning_item_id AND BINARY i.product_code=BINARY o.product_code WHERE BINARY o.product_code=BINARY ? AND BINARY o.model_version=BINARY ? AND o.scope_revision=i.scope_revision AND o.evidence_revision=i.evidence_revision AND i.lifecycle IN ('proposed','in_delivery') ORDER BY o.id DESC LIMIT 1`, code, version).Scan(&observationID, &itemID)
	if err == sql.ErrNoRows {
		return invalid("rice_model_data_not_ready", "RICE 模型至少需要一条与当前事项修订一致的 Reach 观测")
	}
	if err != nil {
		return err
	}
	observation, err := loadRICEReachObservation(ctx, tx, code, itemID, observationID)
	if err != nil {
		return err
	}
	return ValidateRICEReachObservation(model, observation, code, itemID, observation.ScopeRevision, observation.EvidenceRevision)
}
