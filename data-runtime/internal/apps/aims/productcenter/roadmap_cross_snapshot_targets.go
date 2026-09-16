package productcenter

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
)

type RoadmapCrossSnapshotTargets struct {
	ProductCode       string   `json:"product_code"`
	ItemBizID         string   `json:"item_biz_id"`
	WorkspaceRevision uint64   `json:"workspace_revision"`
	CommitmentBizID   string   `json:"commitment_biz_id"`
	ProductCodes      []string `json:"product_codes"`
}

// Internal authorization discovery only. The BFF must check each target's view
// permission before returning any target identity or dependency to the browser.
func DiscoverRoadmapCrossSnapshotTargets(ctx context.Context, db *sql.DB, code, uid, commitmentBizID string, roadmapPermit, planningPermit AuthorizationPermit) (RoadmapCrossSnapshotTargets, error) {
	out := RoadmapCrossSnapshotTargets{ProductCode: code, CommitmentBizID: commitmentBizID, ProductCodes: []string{}}
	id, err := uuid.Parse(commitmentBizID)
	if err != nil || id.String() != commitmentBizID {
		return out, invalid("planning_cross_dependency_invalid", "承诺标识无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if _, err = lockProductDependencyGraph(ctx, tx); err != nil {
		return out, err
	}
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_roadmaps", "view", roadmapPermit); err != nil {
		return out, err
	}
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", planningPermit); err != nil {
		return out, err
	}
	root, err := loadWorkspace(ctx, tx, code)
	if err != nil {
		return out, err
	}
	out.WorkspaceRevision = root.Revision
	var commitmentID int64
	if err = tx.QueryRowContext(ctx, `SELECT b.id,i.biz_id FROM product_roadmap_commitments b JOIN product_planning_items i ON i.id=b.planning_item_id AND i.product_code=b.product_code WHERE b.biz_id=? AND BINARY b.product_code=BINARY ?`, commitmentBizID, code).Scan(&commitmentID, &out.ItemBizID); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT DISTINCT predecessor_product_code FROM product_roadmap_cross_dependency_snapshots WHERE commitment_id=? ORDER BY predecessor_product_code LIMIT 101`, commitmentID)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var target string
		if err = rows.Scan(&target); err != nil {
			return out, err
		}
		out.ProductCodes = append(out.ProductCodes, target)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	rows.Close()
	if len(out.ProductCodes) > 100 {
		return RoadmapCrossSnapshotTargets{}, invalid("planning_dependency_limit", "关联产品范围超过支持上限")
	}
	return out, tx.Commit()
}
