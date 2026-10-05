package productcenter

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
	"sort"
)

type CrossDependencyView struct {
	BizID                      string `json:"biz_id"`
	ProductCode                string `json:"product_code"`
	ItemBizID                  string `json:"item_biz_id"`
	ItemTitle                  string `json:"item_title"`
	ItemRevision               uint64 `json:"item_revision"`
	PredecessorProductCode     string `json:"predecessor_product_code"`
	PredecessorBizID           string `json:"predecessor_biz_id"`
	PredecessorTitle           string `json:"predecessor_title"`
	PredecessorLifecycle       string `json:"predecessor_lifecycle"`
	PredecessorRevision        uint64 `json:"predecessor_revision"`
	Revision                   uint64 `json:"revision"`
	WorkspaceRevision          uint64 `json:"workspace_revision"`
	PredecessorProductRevision uint64 `json:"predecessor_product_revision"`
	Reason                     string `json:"reason"`
	CreatedBy                  string `json:"created_by"`
	CreatedAt                  string `json:"created_at"`
}

func ReadCrossDependency(ctx context.Context, db *sql.DB, source, target, uid, bizID string, sourcePermit, targetPermit AuthorizationPermit) (CrossDependencyView, error) {
	var out CrossDependencyView
	id, err := uuid.Parse(bizID)
	if err != nil || id.String() != bizID || source == target {
		return out, invalid("planning_cross_dependency_invalid", "依赖标识或产品无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	// Match all dependency mutations: graph lock first, then ordered product locks.
	if _, err = lockProductDependencyGraph(ctx, tx); err != nil {
		return out, err
	}
	codes := []string{source, target}
	sort.Strings(codes)
	for _, code := range codes {
		permit := sourcePermit
		if code == target {
			permit = targetPermit
		}
		if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", permit); err != nil {
			return out, err
		}
	}
	root, err := loadWorkspace(ctx, tx, source)
	if err != nil {
		return out, err
	}
	other, err := loadWorkspace(ctx, tx, target)
	if err != nil {
		return out, err
	}
	out.WorkspaceRevision, out.PredecessorProductRevision = root.Revision, other.Revision
	err = tx.QueryRowContext(ctx, `SELECT d.biz_id,d.product_code,i.biz_id,i.title,i.revision,d.predecessor_product_code,p.biz_id,p.title,p.lifecycle,p.revision,d.revision,d.reason,d.created_by,DATE_FORMAT(d.created_at,'%Y-%m-%dT%H:%i:%s.%fZ') FROM product_cross_dependencies d JOIN product_planning_items i ON i.id=d.planning_item_id AND i.product_code=d.product_code JOIN product_planning_items p ON p.id=d.predecessor_id AND p.product_code=d.predecessor_product_code WHERE d.biz_id=? AND BINARY d.product_code=BINARY ? AND BINARY d.predecessor_product_code=BINARY ?`, bizID, source, target).Scan(&out.BizID, &out.ProductCode, &out.ItemBizID, &out.ItemTitle, &out.ItemRevision, &out.PredecessorProductCode, &out.PredecessorBizID, &out.PredecessorTitle, &out.PredecessorLifecycle, &out.PredecessorRevision, &out.Revision, &out.Reason, &out.CreatedBy, &out.CreatedAt)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
