package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
)

type PlanningCommentHistoryRecord struct {
	ID        int64           `json:"id"`
	Action    string          `json:"action"`
	ActorUID  string          `json:"actor_uid"`
	Revision  uint64          `json:"revision"`
	Changes   json.RawMessage `json:"changes"`
	CreatedAt string          `json:"created_at"`
}
type PlanningCommentHistory struct {
	Items    []PlanningCommentHistoryRecord `json:"items"`
	Total    int                            `json:"total"`
	Page     int                            `json:"page"`
	PageSize int                            `json:"pageSize"`
}

func ReadPlanningCommentHistory(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, q PlanningCommentQuery, commentID int64) (PlanningCommentHistory, error) {
	out := PlanningCommentHistory{Items: []PlanningCommentHistoryRecord{}, Page: q.Page, PageSize: q.PageSize}
	parsed, parseErr := uuid.Parse(q.ItemBizID)
	if parseErr != nil || parsed.String() != q.ItemBizID {
		return out, invalid("product_planning_id_invalid", "规划事项标识无效")
	}
	if commentID <= 0 {
		return out, invalid("planning_comment_input_invalid", "评论标识无效")
	}
	if err := ValidatePlanningPageQuery(PlanningPageQuery{Page: q.Page, PageSize: q.PageSize}); err != nil {
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
	var exists int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_planning_comments WHERE planning_item_id=? AND id=?`, item.ID, commentID).Scan(&exists); err != nil {
		return out, err
	}
	if exists != 1 {
		return out, invalid("planning_comment_not_found", "评论不存在")
	}
	where := ` FROM product_activity_logs WHERE BINARY product_code=BINARY ? AND object_type='planning_item' AND object_id=? AND action IN ('comment-create','comment-edit','comment-delete') AND JSON_EXTRACT(changes,'$.result.comment_id')=CAST(? AS UNSIGNED)`
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, code, item.BizID, commentID).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,action,actor_uid,revision,changes,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ')`+where+` ORDER BY id DESC LIMIT ? OFFSET ?`, code, item.BizID, commentID, q.PageSize, (q.Page-1)*q.PageSize)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var r PlanningCommentHistoryRecord
		if err = rows.Scan(&r.ID, &r.Action, &r.ActorUID, &r.Revision, &r.Changes, &r.CreatedAt); err != nil {
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
	return out, tx.Commit()
}
