package productcenter

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
)

type PlanningItemDetail struct {
	PlanningItemRecord
	Requests           []PlanningRequestRef `json:"requests"`
	RequiresImpactNote bool                 `json:"requires_impact_note"`
	WorkspaceRevision  uint64               `json:"workspace_revision"`
}

func ReadPlanningItem(ctx context.Context, db *sql.DB, code, uid, bizID string, permit AuthorizationPermit) (PlanningItemDetail, error) {
	var out PlanningItemDetail
	parsed, err := uuid.Parse(bizID)
	if err != nil || parsed.String() != bizID {
		return out, invalid("product_planning_id_invalid", "规划事项标识无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", permit); err != nil {
		return out, err
	}
	out, err = loadPlanningItemDetail(ctx, tx, code, bizID)
	if err != nil {
		return out, err
	}
	out.WorkspaceRevision = permit.Facts.Revision
	return out, tx.Commit()
}

// The caller must hold the product root lock and authorize its own action.
func loadPlanningItemDetail(ctx context.Context, tx *sql.Tx, code, bizID string) (PlanningItemDetail, error) {
	var out PlanningItemDetail
	err := tx.QueryRowContext(ctx, `SELECT id,biz_id,product_code,title,scope_summary,feature_id,urgency_level,DATE_FORMAT(deadline,'%Y-%m-%d'),investment_category,lifecycle,scope_revision,evidence_revision,revision FROM product_planning_items WHERE product_code=? AND biz_id=?`, code, bizID).Scan(&out.ID, &out.BizID, &out.ProductCode, &out.Title, &out.ScopeSummary, &out.FeatureID, &out.UrgencyLevel, &out.Deadline, &out.InvestmentCategory, &out.Lifecycle, &out.ScopeRevision, &out.EvidenceRevision, &out.Revision)
	if err != nil {
		return out, err
	}
	var selected bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM product_planning_cycle_items WHERE product_code=? AND planning_item_id=? AND selection_status='selected')`, code, out.ID).Scan(&selected); err != nil {
		return PlanningItemDetail{}, err
	}
	out.RequiresImpactNote = selected || out.Lifecycle == "in_delivery"
	rows, err := tx.QueryContext(ctx, `SELECT r.biz_id,r.revision FROM product_planning_item_requests l JOIN product_requests r ON r.id=l.request_id AND r.product_code=l.product_code WHERE l.product_code=? AND l.planning_item_id=? ORDER BY r.id LIMIT 101`, code, out.ID)
	if err != nil {
		return out, err
	}
	out.Requests = []PlanningRequestRef{}
	for rows.Next() {
		var source PlanningRequestRef
		if err := rows.Scan(&source.BizID, &source.Revision); err != nil {
			rows.Close()
			return PlanningItemDetail{}, err
		}
		out.Requests = append(out.Requests, source)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return PlanningItemDetail{}, err
	}
	if len(out.Requests) > 100 {
		return PlanningItemDetail{}, invalid("product_planning_sources_invalid", "事项来源超过当前支持上限，请核查关联，不能按截断结果编辑")
	}
	return out, nil
}
