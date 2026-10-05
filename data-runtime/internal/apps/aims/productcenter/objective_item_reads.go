package productcenter

import (
	"context"
	"database/sql"
)

type ProductObjectiveItemRecord struct {
	PlanningItemID   int64  `json:"planning_item_id"`
	BizID            string `json:"biz_id"`
	ProductCode      string `json:"product_code"`
	Title            string `json:"title"`
	Lifecycle        string `json:"lifecycle"`
	PlanningRevision uint64 `json:"planning_revision"`
	ContributionNote string `json:"contribution_note"`
	CreatedBy        string `json:"created_by"`
	CreatedAt        string `json:"created_at"`
}

type ProductObjectiveItemPage struct {
	Items             []ProductObjectiveItemRecord `json:"items"`
	Total             int                          `json:"total"`
	Page              int                          `json:"page"`
	PageSize          int                          `json:"pageSize"`
	ObjectiveID       int64                        `json:"objective_id"`
	ObjectiveRevision uint64                       `json:"objective_revision"`
	WorkspaceRevision uint64                       `json:"workspace_revision"`
}

func ListProductObjectiveItems(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, objectiveID int64, page, pageSize int) (ProductObjectiveItemPage, error) {
	out := ProductObjectiveItemPage{Items: []ProductObjectiveItemRecord{}, ObjectiveID: objectiveID, Page: page, PageSize: pageSize}
	if objectiveID < 1 || page < 1 || page > 1000000 || pageSize < 1 || pageSize > 100 {
		return out, invalid("product_objective_item_list_invalid", "目标标识或分页无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_objectives", "view", permit); err != nil {
		return out, err
	}
	root, err := loadWorkspace(ctx, tx, code)
	if err != nil {
		return out, err
	}
	out.WorkspaceRevision = root.Revision
	if err = tx.QueryRowContext(ctx, `SELECT revision FROM product_objectives WHERE id=? AND BINARY product_code=BINARY ?`, objectiveID, code).Scan(&out.ObjectiveRevision); err != nil {
		return out, err
	}
	where := ` FROM product_objective_items o JOIN product_planning_items p ON p.id=o.planning_item_id AND BINARY p.product_code=BINARY o.product_code WHERE o.objective_id=? AND BINARY o.product_code=BINARY ?`
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, objectiveID, code).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT p.id,p.biz_id,p.product_code,p.title,p.lifecycle,p.revision,o.contribution_note,o.created_by,DATE_FORMAT(o.created_at,'%Y-%m-%dT%H:%i:%s.%fZ')`+where+` ORDER BY o.created_at DESC,p.id DESC LIMIT ? OFFSET ?`, objectiveID, code, pageSize, (page-1)*pageSize)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var item ProductObjectiveItemRecord
		if err = rows.Scan(&item.PlanningItemID, &item.BizID, &item.ProductCode, &item.Title, &item.Lifecycle, &item.PlanningRevision, &item.ContributionNote, &item.CreatedBy, &item.CreatedAt); err != nil {
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
	return out, tx.Commit()
}
