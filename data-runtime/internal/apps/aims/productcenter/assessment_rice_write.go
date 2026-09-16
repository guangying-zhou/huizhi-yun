package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
)

func CreatePlanningRICEAssessment(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input PlanningRICEAssessmentCreate) (CommandResult, error) {
	if identity.Action != "product_priorities:rice-assess" {
		return CommandResult{}, invalid("product_command_identity_invalid", "评估命令不匹配")
	}
	if err := ValidatePlanningCycleCandidateAdd(input.PlanningCycleCandidateAdd); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "assess", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "产品空间已归档")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化，请刷新后重试")
		}
		cycle, err := loadPlanningCycle(ctx, tx, identity.ProductCode, input.CycleBizID)
		if err != nil {
			return nil, err
		}
		if cycle.Revision != input.ExpectedCycleRevision {
			return nil, invalid("planning_cycle_revision_conflict", "周期已变化，请刷新后重试")
		}
		if cycle.Status != "open" {
			return nil, invalid("planning_cycle_readonly", "仅开放周期可以追加评估")
		}
		if cycle.ModelVersion != input.Assessment.ModelVersion {
			return nil, invalid("assessment_model_mismatch", "周期评估模型不匹配")
		}
		frozenModel, err := loadFrozenRICEModel(ctx, tx, identity.ProductCode, cycle.ModelVersion, cycle.ModelSnapshot)
		if err != nil {
			return nil, err
		}
		err = validatePlanningRICEAssessment(input, frozenModel)
		if err != nil {
			return nil, err
		}

		item, err := loadPlanningItemDetail(ctx, tx, identity.ProductCode, input.ItemBizID)
		if err != nil {
			return nil, err
		}
		if item.Revision != input.ExpectedItemRevision || item.ScopeRevision != input.ExpectedScopeRevision || item.EvidenceRevision != input.ExpectedEvidenceRevision {
			return nil, invalid("product_planning_revision_conflict", "事项范围或证据已变化，请重新评估")
		}
		if item.Lifecycle != "proposed" && item.Lifecycle != "in_delivery" {
			return nil, invalid("product_planning_readonly", "当前事项不可评估")
		}
		var member int64
		if err = tx.QueryRowContext(ctx, `SELECT planning_item_id FROM product_planning_cycle_items WHERE cycle_id=? AND planning_item_id=? AND product_code=?`, cycle.ID, item.ID, identity.ProductCode).Scan(&member); err != nil {
			return nil, err
		}
		score, observation, err := calculateObservedRICEAssessment(ctx, tx, identity.ProductCode, item, frozenModel, input.Assessment)
		if err != nil {
			return nil, err
		}
		var observationID any
		if observation != nil {
			var id int64
			if err = tx.QueryRowContext(ctx, `SELECT id FROM product_rice_reach_observations WHERE biz_id=? AND planning_item_id=? AND product_code=?`, observation.BizID, item.ID, identity.ProductCode).Scan(&id); err != nil {
				return nil, err
			}
			observationID = id
		}
		rationale, err := json.Marshal(map[string]any{"reasons": input.Rationale, "evidence_references": input.EvidenceReferences})
		if err != nil {
			return nil, err
		}
		evidence, err := json.Marshal(map[string]any{"reach_observation": observation, "manual_observations": input.Evidence, "requests": item.Requests, "scope_summary": item.ScopeSummary, "investment_category": item.InvestmentCategory, "recorded_by": identity.ActorUID})
		if err != nil {
			return nil, err
		}
		model, err := json.Marshal(map[string]any{"cycle_model": cycle.ModelSnapshot, "method": "rice", "priority_decimal_places": 8, "rounding": "half_up", "scope": "same_product_cycle_category", "missing": "null", "effort_includes": []string{"design", "development", "testing", "release_preparation"}})
		if err != nil {
			return nil, err
		}
		var estimator any
		if input.EstimateConfirmed {
			estimator = identity.ActorUID
		}
		var impact, confidence, effort any
		if input.Assessment.Impact != nil {
			impact = input.Assessment.Impact.String()
		}
		if input.Assessment.Confidence != nil {
			confidence = input.Assessment.Confidence.String()
		}
		if input.Assessment.Effort != nil {
			effort = input.Assessment.Effort.String()
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO product_priority_assessments(cycle_id,planning_item_id,scope_revision,evidence_revision,model_version,model_snapshot,model_method,rice_impact,reach_observation_id,confidence,effort_person_days,effort_unit,priority_score,evidence_snapshot,rationale,assessed_by,estimated_by,assessed_at) VALUES (?,?,?,?,?,?,'rice',?,?,?,?,'person_day',?,?,?,?,?,UTC_TIMESTAMP(3))`, cycle.ID, item.ID, item.ScopeRevision, item.EvidenceRevision, cycle.ModelVersion, model, impact, observationID, confidence, effort, score.PriorityDecimal(), evidence, rationale, identity.ActorUID, estimator)
		if err != nil {
			return nil, err
		}
		assessmentID, err := result.LastInsertId()
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_cycle_items SET current_assessment_id=? WHERE cycle_id=? AND planning_item_id=?`, assessmentID, cycle.ID, item.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_cycles SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, identity.ActorUID, cycle.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"assessment_id": assessmentID, "item_biz_id": item.BizID, "cycle_biz_id": cycle.BizID, "score": score, "workspace_revision": root.Revision + 1, "cycle_revision": cycle.Revision + 1, "queue_revision": cycle.QueueRevision}
		changes, err := json.Marshal(map[string]any{"after": out})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'planning_item',?,'rice-assess',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, item.BizID, identity.ActorUID, cycle.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
