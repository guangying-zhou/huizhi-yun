package productcenter

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
	"sort"
	"strings"
)

type CrossDependencyPage struct {
	Items             []CrossDependencyView `json:"items"`
	Total             int                   `json:"total"`
	Page              int                   `json:"page"`
	PageSize          int                   `json:"pageSize"`
	ItemBizID         string                `json:"item_biz_id"`
	WorkspaceRevision uint64                `json:"workspace_revision"`
	ItemRevision      uint64                `json:"item_revision"`
}

func ListCrossDependencies(ctx context.Context, db *sql.DB, source, uid, itemBizID string, sourcePermit AuthorizationPermit, targetPermits map[string]AuthorizationPermit, page, pageSize int) (CrossDependencyPage, error) {
	out := CrossDependencyPage{Items: []CrossDependencyView{}, Page: page, PageSize: pageSize, ItemBizID: itemBizID}
	id, err := uuid.Parse(itemBizID)
	if err != nil || id.String() != itemBizID || len(targetPermits) > 100 {
		return out, invalid("planning_cross_dependency_invalid", "事项或可见产品范围无效")
	}
	if err = ValidatePlanningPageQuery(PlanningPageQuery{Page: page, PageSize: pageSize}); err != nil {
		return out, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if _, err = lockProductDependencyGraph(ctx, tx); err != nil {
		return out, err
	}
	codes := []string{source}
	for code := range targetPermits {
		if code == source || code == "" {
			return out, invalid("planning_cross_dependency_invalid", "前置产品范围无效")
		}
		codes = append(codes, code)
	}
	sort.Strings(codes)
	for _, code := range codes {
		permit := sourcePermit
		if code != source {
			permit = targetPermits[code]
		}
		if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", permit); err != nil {
			return out, err
		}
	}
	root, err := loadWorkspace(ctx, tx, source)
	if err != nil {
		return out, err
	}
	out.WorkspaceRevision = root.Revision
	var itemID int64
	if err = tx.QueryRowContext(ctx, `SELECT id,revision FROM product_planning_items WHERE biz_id=? AND BINARY product_code=BINARY ?`, itemBizID, source).Scan(&itemID, &out.ItemRevision); err != nil {
		return out, err
	}
	if len(targetPermits) == 0 {
		return out, tx.Commit()
	}
	args := []any{itemID, source}
	placeholders := []string{}
	for _, code := range codes {
		if code != source {
			args = append(args, code)
			placeholders = append(placeholders, "?")
		}
	}
	where := ` FROM product_cross_dependencies d JOIN product_planning_items i ON i.id=d.planning_item_id AND i.product_code=d.product_code JOIN product_planning_items p ON p.id=d.predecessor_id AND p.product_code=d.predecessor_product_code WHERE d.planning_item_id=? AND BINARY d.product_code=BINARY ? AND d.predecessor_product_code IN (` + strings.Join(placeholders, ",") + `)`
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, args...).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT d.biz_id,d.product_code,i.biz_id,i.title,i.revision,d.predecessor_product_code,p.biz_id,p.title,p.lifecycle,p.revision,d.revision,d.reason,d.created_by,DATE_FORMAT(d.created_at,'%Y-%m-%dT%H:%i:%s.%fZ')`+where+` ORDER BY d.id DESC LIMIT ? OFFSET ?`, append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var item CrossDependencyView
		if err = rows.Scan(&item.BizID, &item.ProductCode, &item.ItemBizID, &item.ItemTitle, &item.ItemRevision, &item.PredecessorProductCode, &item.PredecessorBizID, &item.PredecessorTitle, &item.PredecessorLifecycle, &item.PredecessorRevision, &item.Revision, &item.Reason, &item.CreatedBy, &item.CreatedAt); err != nil {
			return out, err
		}
		item.WorkspaceRevision = root.Revision
		item.PredecessorProductRevision = targetPermits[item.PredecessorProductCode].Facts.Revision
		out.Items = append(out.Items, item)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	rows.Close()
	return out, tx.Commit()
}
