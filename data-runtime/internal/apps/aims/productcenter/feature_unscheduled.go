package productcenter

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
)

type FeatureUnscheduledQuery struct {
	FeatureBizID string `json:"feature_biz_id"`
	Page         int    `json:"page"`
	PageSize     int    `json:"page_size"`
}

func ListFeatureUnscheduled(ctx context.Context, db *sql.DB, code, uid string, planningPermit, featurePermit AuthorizationPermit, q FeatureUnscheduledQuery) (PlanningPage, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return PlanningPage{}, err
	}
	defer tx.Rollback()
	out, err := ListFeatureUnscheduledInTransaction(ctx, tx, code, uid, planningPermit, featurePermit, q)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func ListFeatureUnscheduledInTransaction(ctx context.Context, tx *sql.Tx, code, uid string, planningPermit, featurePermit AuthorizationPermit, q FeatureUnscheduledQuery) (PlanningPage, error) {
	var out PlanningPage
	id, err := uuid.Parse(q.FeatureBizID)
	if err != nil || id.String() != q.FeatureBizID {
		return out, invalid("product_feature_id_invalid", "功能标识无效")
	}
	if err := ValidatePlanningPageQuery(PlanningPageQuery{Page: q.Page, PageSize: q.PageSize}); err != nil {
		return out, err
	}
	if tx == nil {
		return out, invalid("product_transaction_required", "事务不可用")
	}
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", planningPermit); err != nil {
		return out, err
	}
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_features", "view", featurePermit); err != nil {
		return out, err
	}
	var featureID int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM product_features WHERE product_code=? AND biz_id=?`, code, q.FeatureBizID).Scan(&featureID); err != nil {
		return out, err
	}
	where := ` FROM product_planning_items WHERE product_code=? AND feature_id=? AND NOT EXISTS (SELECT 1 FROM product_planning_cycle_items ci WHERE ci.product_code=product_planning_items.product_code AND ci.planning_item_id=product_planning_items.id)`
	args := []any{code, featureID}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, args...).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,biz_id,product_code,title,scope_summary,feature_id,urgency_level,DATE_FORMAT(deadline,'%Y-%m-%d'),investment_category,lifecycle,scope_revision,evidence_revision,revision`+where+` ORDER BY id DESC LIMIT ? OFFSET ?`, append(args, q.PageSize, (q.Page-1)*q.PageSize)...)
	if err != nil {
		return out, err
	}
	out.Items = []PlanningItemRecord{}
	for rows.Next() {
		var item PlanningItemRecord
		if err := rows.Scan(&item.ID, &item.BizID, &item.ProductCode, &item.Title, &item.ScopeSummary, &item.FeatureID, &item.UrgencyLevel, &item.Deadline, &item.InvestmentCategory, &item.Lifecycle, &item.ScopeRevision, &item.EvidenceRevision, &item.Revision); err != nil {
			rows.Close()
			return out, err
		}
		out.Items = append(out.Items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	out.Page, out.PageSize, out.WorkspaceRevision = q.Page, q.PageSize, planningPermit.Facts.Revision
	return out, nil
}
