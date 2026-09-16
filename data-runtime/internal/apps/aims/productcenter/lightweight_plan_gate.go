package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
)

// ValidateLightweightPlanningDeliveryTx is deliberately separate from the
// cycle gate. It accepts only an immutable current confirmation for the exact
// persisted version scope and source planning item.
func ValidateLightweightPlanningDeliveryTx(ctx context.Context, tx *sql.Tx, code string, input PlanningHandoffInput) (PlanningDeliveryBasis, error) {
	var out PlanningDeliveryBasis
	root, e := loadWorkspace(ctx, tx, code)
	if e != nil {
		return out, e
	}
	if root.Status != "active" {
		return out, invalid("product_archived", "产品已归档")
	}
	if root.Revision != input.ExpectedRevision {
		return out, invalid("product_revision_conflict", "产品已变化")
	}
	var itemRevision uint64
	var itemID int64
	var persistedItemBizID string
	var planRevision, scopeRevision uint64
	var requestID int64
	var status string
	e = tx.QueryRowContext(ctx, `SELECT s.planning_item_id,i.biz_id,i.revision,p.revision,p.scope_revision,s.request_id,v.status FROM product_version_plan_scopes s JOIN product_planning_items i ON i.id=s.planning_item_id AND i.product_code=s.product_code JOIN product_version_plans p ON p.version_id=s.version_id JOIN product_versions v ON v.id=s.version_id WHERE s.version_id=? AND s.version_feature_id=? AND s.product_code=? FOR UPDATE`, input.PlannedVersionID, input.PlannedVersionFeatureID, code).Scan(&itemID, &persistedItemBizID, &itemRevision, &planRevision, &scopeRevision, &requestID, &status)
	if e != nil {
		return out, e
	}
	if itemRevision != input.ExpectedItemRevision {
		return out, invalid("product_planning_revision_conflict", "事项已变化")
	}
	if persistedItemBizID != input.ItemBizID {
		return out, invalid("planning_handoff_version_invalid", "版本范围与规划事项不匹配")
	}
	if status != "planning" && status != "developing" {
		return out, invalid("product_version_plan_locked", "版本不可转交")
	}
	var scopeStatus, lifecycle string
	if e = tx.QueryRowContext(ctx, `SELECT f.status,i.lifecycle FROM product_version_features f JOIN product_planning_items i ON i.id=? WHERE f.id=?`, itemID, input.PlannedVersionFeatureID).Scan(&scopeStatus, &lifecycle); e != nil {
		return out, e
	}
	if scopeStatus != "planned" || (lifecycle != "proposed" && lifecycle != "in_delivery") {
		return out, invalid("product_version_plan_locked", "范围或规划事项已不再可交付")
	}
	var confirmationID int64
	e = tx.QueryRowContext(ctx, `SELECT id FROM product_version_plan_confirmations WHERE version_id=? AND plan_revision=? AND scope_revision=? AND invalidated_at IS NULL ORDER BY id DESC LIMIT 1`, input.PlannedVersionID, planRevision, scopeRevision).Scan(&confirmationID)
	if e == sql.ErrNoRows {
		return out, invalid("product_version_plan_confirmation_required", "版本范围尚未确认或确认已失效")
	}
	if e != nil {
		return out, e
	}
	planRow := lightweightPlanRow{Revision: planRevision, ScopeRevision: scopeRevision}
	if e = tx.QueryRowContext(ctx, `SELECT goal,DATE_FORMAT(starts_on,'%Y-%m-%d'),available_person_days,reserve_person_days FROM product_version_plans WHERE version_id=?`, input.PlannedVersionID).Scan(&planRow.Goal, &planRow.StartsOn, &planRow.Available, &planRow.Reserve); e != nil {
		return out, e
	}
	if summary, e := planSummaryTx(ctx, tx, input.PlannedVersionID, planRow); e != nil {
		return out, e
	} else if len(summary.Issues) > 0 {
		return out, invalid("product_version_plan_confirmation_required", "计划确认已不再满足当前条件")
	}
	var decision string
	e = tx.QueryRowContext(ctx, `SELECT decision_status FROM product_requests WHERE id=? AND product_code=?`, requestID, code).Scan(&decision)
	if e != nil {
		return out, e
	}
	if decision != "accepted" {
		return out, invalid("product_version_plan_request_not_accepted", "来源需求已不再采纳，不能转交")
	}
	snapshot, _ := json.Marshal(map[string]any{"mode": "simple", "version_id": input.PlannedVersionID, "scope_id": input.PlannedVersionFeatureID, "confirmation_id": confirmationID, "plan_revision": planRevision, "scope_revision": scopeRevision})
	out = PlanningDeliveryBasis{ItemID: itemID, ItemBizID: input.ItemBizID, Decision: snapshot}
	return out, nil
}

func invalidateSimplePlanConfirmationsForRequestTx(ctx context.Context, tx *sql.Tx, code string, requestID int64, uid, reason string) error {
	_, err := tx.ExecContext(ctx, `UPDATE product_version_plan_confirmations c JOIN product_version_plan_scopes s ON s.version_id=c.version_id SET c.invalidated_by=?,c.invalidated_at=UTC_TIMESTAMP(3),c.invalidation_reason=? WHERE s.product_code=? AND s.request_id=? AND c.invalidated_at IS NULL`, uid, reason, code, requestID)
	return err
}

func rejectLegacySimplePlanScopeTx(ctx context.Context, tx *sql.Tx, code string, planningItemID int64) error {
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_version_plan_scopes WHERE product_code=? AND planning_item_id=?`, code, planningItemID).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return invalid("product_version_plan_locked", "轻量版本范围须通过计划工作区修改")
	}
	return nil
}

func invalidateSimplePlanConfirmationsForPlanningItemTx(ctx context.Context, tx *sql.Tx, code string, planningItemID int64, uid, reason string) error {
	_, err := tx.ExecContext(ctx, `UPDATE product_version_plan_confirmations c JOIN product_version_plan_scopes s ON s.version_id=c.version_id SET c.invalidated_by=?,c.invalidated_at=UTC_TIMESTAMP(3),c.invalidation_reason=? WHERE s.product_code=? AND s.planning_item_id=? AND c.invalidated_at IS NULL`, uid, reason, code, planningItemID)
	return err
}
