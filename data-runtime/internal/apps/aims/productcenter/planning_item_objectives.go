package productcenter

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
)

type PlanningItemObjectiveRecord struct {
	ObjectiveID       int64  `json:"objective_id"`
	BizID             string `json:"biz_id"`
	ProductCode       string `json:"product_code"`
	Title             string `json:"title"`
	Status            string `json:"status"`
	ObjectiveRevision uint64 `json:"objective_revision"`
	ContributionNote  string `json:"contribution_note"`
	CreatedBy         string `json:"created_by"`
	CreatedAt         string `json:"created_at"`
}

type PlanningItemObjectivePage struct {
	Items             []PlanningItemObjectiveRecord `json:"items"`
	Total             int                           `json:"total"`
	Page              int                           `json:"page"`
	PageSize          int                           `json:"pageSize"`
	ItemBizID         string                        `json:"item_biz_id"`
	ItemRevision      uint64                        `json:"item_revision"`
	WorkspaceRevision uint64                        `json:"workspace_revision"`
}

func ListPlanningItemObjectives(ctx context.Context, db *sql.DB, code, uid string, permit, planningPermit AuthorizationPermit, itemBizID string, page, pageSize int) (PlanningItemObjectivePage, error) {
	out := PlanningItemObjectivePage{Items: []PlanningItemObjectiveRecord{}, ItemBizID: itemBizID, Page: page, PageSize: pageSize}
	parsed, parseErr := uuid.Parse(itemBizID)
	if parseErr != nil || parsed.String() != itemBizID || page < 1 || page > 1000000 || pageSize < 1 || pageSize > 100 {
		return out, invalid("product_planning_item_objectives_invalid", "事项标识或分页无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_objectives", "view", permit); err != nil {
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
	var itemID int64
	if err = tx.QueryRowContext(ctx, `SELECT id,revision FROM product_planning_items WHERE biz_id=? AND BINARY product_code=BINARY ?`, itemBizID, code).Scan(&itemID, &out.ItemRevision); err != nil {
		return out, err
	}
	where := ` FROM product_objective_items o JOIN product_objectives p ON p.id=o.objective_id AND BINARY p.product_code=BINARY o.product_code WHERE o.planning_item_id=? AND BINARY o.product_code=BINARY ?`
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, itemID, code).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT p.id,p.biz_id,p.product_code,p.title,p.status,p.revision,o.contribution_note,o.created_by,DATE_FORMAT(o.created_at,'%Y-%m-%dT%H:%i:%s.%fZ')`+where+` ORDER BY o.created_at DESC,p.id DESC LIMIT ? OFFSET ?`, itemID, code, pageSize, (page-1)*pageSize)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var item PlanningItemObjectiveRecord
		if err = rows.Scan(&item.ObjectiveID, &item.BizID, &item.ProductCode, &item.Title, &item.Status, &item.ObjectiveRevision, &item.ContributionNote, &item.CreatedBy, &item.CreatedAt); err != nil {
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
