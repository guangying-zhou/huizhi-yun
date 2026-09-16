package productcenter

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
)

type PlanningCommentQuery struct {
	ItemBizID string `json:"item_biz_id"`
	Page      int    `json:"page"`
	PageSize  int    `json:"page_size"`
}
type PlanningCommentRecord struct {
	CycleID        *int64 `json:"cycle_id"`
	Readonly       bool   `json:"readonly"`
	ReadonlyReason string `json:"readonly_reason"`
	ID             int64  `json:"id"`
	AuthorUID      string `json:"author_uid"`
	Body           string `json:"body"`
	Revision       uint64 `json:"revision"`
	Deleted        bool   `json:"deleted"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}
type PlanningCommentPage struct {
	Readonly          bool                    `json:"readonly"`
	ReadonlyReason    string                  `json:"readonly_reason"`
	Items             []PlanningCommentRecord `json:"items"`
	Total             int                     `json:"total"`
	Page              int                     `json:"page"`
	PageSize          int                     `json:"pageSize"`
	ItemBizID         string                  `json:"item_biz_id"`
	WorkspaceRevision uint64                  `json:"workspace_revision"`
}

func ListPlanningComments(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, q PlanningCommentQuery) (PlanningCommentPage, error) {
	var out PlanningCommentPage
	id, err := uuid.Parse(q.ItemBizID)
	if err != nil || id.String() != q.ItemBizID {
		return out, invalid("product_planning_id_invalid", "规划事项标识无效")
	}
	if err = ValidatePlanningPageQuery(PlanningPageQuery{Page: q.Page, PageSize: q.PageSize}); err != nil {
		return out, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", permit); err != nil {
		return out, err
	}
	item, err := loadPlanningItemDetail(ctx, tx, code, q.ItemBizID)
	if err != nil {
		return out, err
	}
	out = PlanningCommentPage{Items: []PlanningCommentRecord{}, Page: q.Page, PageSize: q.PageSize, ItemBizID: item.BizID, WorkspaceRevision: permit.Facts.Revision}
	cycleID, err := currentPlanningCommentCycle(ctx, tx, item.ID)
	if err != nil {
		return out, err
	}
	rule, reason, err := planningCommentReadonly(ctx, tx, item.ID, item.Lifecycle, cycleID)
	if err != nil {
		return out, err
	}
	out.Readonly, out.ReadonlyReason = rule != "", reason
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_planning_comments WHERE planning_item_id=?`, item.ID).Scan(&out.Total); err != nil {
		return out, err
	}
	// Tombstones retain discussion order without exposing the removed body.
	rows, err := tx.QueryContext(ctx, `SELECT cycle_id,id,author_uid,IF(deleted_at IS NULL,body,''),revision,deleted_at IS NOT NULL,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ'),DATE_FORMAT(updated_at,'%Y-%m-%dT%H:%i:%s.%fZ') FROM product_planning_comments WHERE planning_item_id=? ORDER BY id DESC LIMIT ? OFFSET ?`, item.ID, q.PageSize, (q.Page-1)*q.PageSize)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var r PlanningCommentRecord
		if err = rows.Scan(&r.CycleID, &r.ID, &r.AuthorUID, &r.Body, &r.Revision, &r.Deleted, &r.CreatedAt, &r.UpdatedAt); err != nil {
			rows.Close()
			return out, err
		}
		out.Items = append(out.Items, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	for i := range out.Items {
		rule, reason, err := planningCommentReadonly(ctx, tx, item.ID, item.Lifecycle, out.Items[i].CycleID)
		if err != nil {
			return out, err
		}
		out.Items[i].Readonly = rule != ""
		out.Items[i].ReadonlyReason = reason
	}
	return out, tx.Commit()
}
