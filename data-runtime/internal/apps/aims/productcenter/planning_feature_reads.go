package productcenter

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
)

type PlanningFeatureView struct {
	ItemBizID          string         `json:"item_biz_id"`
	ItemTitle          string         `json:"item_title"`
	Lifecycle          string         `json:"lifecycle"`
	WorkspaceRevision  uint64         `json:"workspace_revision"`
	ItemRevision       uint64         `json:"item_revision"`
	ScopeRevision      uint64         `json:"scope_revision"`
	RequiresImpactNote bool           `json:"requires_impact_note"`
	Feature            *FeatureRecord `json:"feature"`
}

func ReadPlanningFeature(ctx context.Context, db *sql.DB, code, uid, itemID string, planningPermit, featurePermit AuthorizationPermit) (PlanningFeatureView, error) {
	var out PlanningFeatureView
	id, err := uuid.Parse(itemID)
	if err != nil || id.String() != itemID {
		return out, invalid("product_planning_id_invalid", "规划事项标识无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", planningPermit); err != nil {
		return out, err
	}
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_features", "view", featurePermit); err != nil {
		return out, err
	}
	item, err := loadPlanningItemDetail(ctx, tx, code, itemID)
	if err != nil {
		return out, err
	}
	out = PlanningFeatureView{ItemBizID: itemID, ItemTitle: item.Title, Lifecycle: item.Lifecycle, WorkspaceRevision: planningPermit.Facts.Revision, ItemRevision: item.Revision, ScopeRevision: item.ScopeRevision, RequiresImpactNote: item.RequiresImpactNote}
	var featureID sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT feature_id FROM product_planning_items WHERE product_code=? AND id=?`, code, item.ID).Scan(&featureID); err != nil {
		return PlanningFeatureView{}, err
	}
	if featureID.Valid {
		feature, err := scanFeature(tx.QueryRowContext(ctx, `SELECT `+featureColumns+` FROM product_features WHERE product_code=? AND id=?`, code, featureID.Int64))
		if err != nil {
			return PlanningFeatureView{}, err
		}
		out.Feature = &feature
	}
	return out, tx.Commit()
}
