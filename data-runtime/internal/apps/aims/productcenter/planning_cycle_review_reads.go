package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
)

type PlanningCycleReviewRecord struct {
	ID         int64               `json:"id"`
	ActorUID   string              `json:"actor_uid"`
	ReviewedAt string              `json:"reviewed_at"`
	Revision   uint64              `json:"revision"`
	Conclusion string              `json:"conclusion"`
	Before     PlanningCycleRecord `json:"before"`
	After      PlanningCycleRecord `json:"after"`
}
type PlanningCycleReviewPage struct {
	Items      []PlanningCycleReviewRecord `json:"items"`
	Total      int                         `json:"total"`
	Page       int                         `json:"page"`
	PageSize   int                         `json:"pageSize"`
	CycleBizID string                      `json:"cycle_biz_id"`
}

func ListPlanningCycleReviews(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, q PlanningObservationQuery) (PlanningCycleReviewPage, error) {
	out := PlanningCycleReviewPage{Items: []PlanningCycleReviewRecord{}, Page: q.Page, PageSize: q.PageSize, CycleBizID: q.CycleBizID}
	if err := ValidatePlanningObservationQuery(q); err != nil {
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
	if _, err = loadPlanningCycle(ctx, tx, code, q.CycleBizID); err != nil {
		return out, err
	}
	where := ` FROM product_activity_logs WHERE BINARY product_code=BINARY ? AND object_type='planning_cycle' AND object_id=? AND action='review'`
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, code, q.CycleBizID).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,actor_uid,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ'),revision,changes`+where+` ORDER BY id DESC LIMIT ? OFFSET ?`, code, q.CycleBizID, q.PageSize, (q.Page-1)*q.PageSize)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var r PlanningCycleReviewRecord
		var raw []byte
		if err = rows.Scan(&r.ID, &r.ActorUID, &r.ReviewedAt, &r.Revision, &raw); err != nil {
			rows.Close()
			return out, err
		}
		var saved struct {
			Before PlanningCycleRecord `json:"before"`
			After  PlanningCycleRecord `json:"after"`
			Reason string              `json:"reason"`
		}
		if err = json.Unmarshal(raw, &saved); err != nil {
			rows.Close()
			return out, err
		}
		if saved.Before.ProductCode != code || saved.After.ProductCode != code || saved.Before.BizID != q.CycleBizID || saved.After.BizID != q.CycleBizID {
			rows.Close()
			return out, invalid("planning_cycle_data_invalid", "复评历史归属异常")
		}
		r.Before, r.After, r.Conclusion = saved.Before, saved.After, saved.Reason
		out.Items = append(out.Items, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
