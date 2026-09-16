package productcenter

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
)

type PlanningPredecessor struct {
	BizID     string `json:"biz_id"`
	Title     string `json:"title"`
	Lifecycle string `json:"lifecycle"`
	Revision  uint64 `json:"revision"`
}

type PlanningDependenciesView struct {
	ItemBizID          string                `json:"item_biz_id"`
	WorkspaceRevision  uint64                `json:"workspace_revision"`
	ItemRevision       uint64                `json:"item_revision"`
	ScopeRevision      uint64                `json:"scope_revision"`
	RequiresImpactNote bool                  `json:"requires_impact_note"`
	Predecessors       []PlanningPredecessor `json:"predecessors"`
}

// ReadPlanningDependencies returns the entire editable relation, never a page
// that a client might mistake for the replacement set. Historical target states
// remain visible even though adding cancelled/merged targets is prohibited.
func ReadPlanningDependencies(ctx context.Context, db *sql.DB, code, uid, itemID string, permit AuthorizationPermit) (PlanningDependenciesView, error) {
	var out PlanningDependenciesView
	id, err := uuid.Parse(itemID)
	if err != nil || id.String() != itemID {
		return out, invalid("product_planning_id_invalid", "规划事项标识无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", permit); err != nil {
		return out, err
	}
	item, err := loadPlanningItemDetail(ctx, tx, code, itemID)
	if err != nil {
		return out, err
	}
	out = PlanningDependenciesView{ItemBizID: itemID, WorkspaceRevision: permit.Facts.Revision, ItemRevision: item.Revision, ScopeRevision: item.ScopeRevision, RequiresImpactNote: item.RequiresImpactNote, Predecessors: []PlanningPredecessor{}}
	rows, err := tx.QueryContext(ctx, `SELECT p.biz_id,p.title,p.lifecycle,p.revision FROM product_planning_dependencies d JOIN product_planning_items p ON p.id=d.predecessor_id AND p.product_code=d.product_code WHERE d.product_code=? AND d.planning_item_id=? ORDER BY p.biz_id LIMIT 101`, code, item.ID)
	if err != nil {
		return PlanningDependenciesView{}, err
	}
	for rows.Next() {
		var entry PlanningPredecessor
		if err = rows.Scan(&entry.BizID, &entry.Title, &entry.Lifecycle, &entry.Revision); err != nil {
			rows.Close()
			return PlanningDependenciesView{}, err
		}
		out.Predecessors = append(out.Predecessors, entry)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return PlanningDependenciesView{}, err
	}
	if len(out.Predecessors) > 100 {
		return PlanningDependenciesView{}, invalid("planning_dependency_limit", "前置关系超过编辑上限，未返回部分集合")
	}
	return out, tx.Commit()
}
