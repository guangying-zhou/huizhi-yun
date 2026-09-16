package productcenter

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
)

type CrossDependencyTargets struct {
	ProductCode       string   `json:"product_code"`
	ItemBizID         string   `json:"item_biz_id"`
	WorkspaceRevision uint64   `json:"workspace_revision"`
	ItemRevision      uint64   `json:"item_revision"`
	ProductCodes      []string `json:"product_codes"`
}

// Internal authorization discovery only. The BFF must check each target's view
// permission before returning any target identity or dependency to the browser.
func DiscoverCrossDependencyTargets(ctx context.Context, db *sql.DB, code, uid, itemBizID string, permit AuthorizationPermit) (CrossDependencyTargets, error) {
	out := CrossDependencyTargets{ProductCode: code, ItemBizID: itemBizID, ProductCodes: []string{}}
	id, err := uuid.Parse(itemBizID)
	if err != nil || id.String() != itemBizID {
		return out, invalid("planning_cross_dependency_invalid", "事项标识无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if _, err = lockProductDependencyGraph(ctx, tx); err != nil {
		return out, err
	}
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", permit); err != nil {
		return out, err
	}
	root, err := loadWorkspace(ctx, tx, code)
	if err != nil {
		return out, err
	}
	out.WorkspaceRevision = root.Revision
	var itemID int64
	if err = tx.QueryRowContext(ctx, `SELECT id,revision FROM product_planning_items WHERE biz_id=? AND BINARY product_code=BINARY ?`, itemBizID, code).Scan(&itemID, &out.ItemRevision); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT DISTINCT predecessor_product_code FROM product_cross_dependencies WHERE planning_item_id=? AND BINARY product_code=BINARY ? ORDER BY predecessor_product_code LIMIT 101`, itemID, code)
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
		return CrossDependencyTargets{}, invalid("planning_dependency_limit", "关联产品范围超过支持上限")
	}
	return out, tx.Commit()
}
