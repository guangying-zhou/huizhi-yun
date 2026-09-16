package productcenter

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
)

type FeatureRoadmapQuery struct {
	FeatureBizID string `json:"feature_biz_id"`
	CycleBizID   string `json:"cycle_biz_id"`
	Page         int    `json:"page"`
	PageSize     int    `json:"page_size"`
}

type FeatureRoadmapItem struct {
	BizID           string `json:"biz_id"`
	Title           string `json:"title"`
	ScopeSummary    string `json:"scope_summary"`
	Lifecycle       string `json:"lifecycle"`
	SelectionStatus string `json:"selection_status"`
	RoadmapBucket   string `json:"roadmap_bucket"`
	DecisionRank    int64  `json:"decision_rank"`
	Revision        uint64 `json:"revision"`
}

type FeatureRoadmapView struct {
	FeatureBizID      string               `json:"feature_biz_id"`
	CycleBizID        string               `json:"cycle_biz_id"`
	WorkspaceRevision uint64               `json:"workspace_revision"`
	CycleRevision     uint64               `json:"cycle_revision"`
	QueueRevision     uint64               `json:"queue_revision"`
	CycleStatus       string               `json:"cycle_status"`
	Items             []FeatureRoadmapItem `json:"items"`
	Total             int                  `json:"total"`
	ByBucket          map[string]int       `json:"by_bucket"`
	Page              int                  `json:"page"`
	PageSize          int                  `json:"pageSize"`
}

// Roadmap arrangement is projected from cycle decisions, never written on features.
func ReadFeatureRoadmap(ctx context.Context, db *sql.DB, code, uid string, planningPermit, featurePermit AuthorizationPermit, q FeatureRoadmapQuery) (FeatureRoadmapView, error) {
	var out FeatureRoadmapView
	for _, value := range []string{q.FeatureBizID, q.CycleBizID} {
		id, err := uuid.Parse(value)
		if err != nil || id.String() != value {
			return out, invalid("product_feature_roadmap_query_invalid", "功能或周期标识无效")
		}
	}
	if err := ValidatePlanningPageQuery(PlanningPageQuery{Page: q.Page, PageSize: q.PageSize}); err != nil {
		return out, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", planningPermit); err != nil {
		return out, err
	}
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_features", "view", featurePermit); err != nil {
		return out, err
	}
	var featureID, cycleID int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM product_features WHERE product_code=? AND biz_id=?`, code, q.FeatureBizID).Scan(&featureID); err != nil {
		return out, err
	}
	if err := tx.QueryRowContext(ctx, `SELECT id,status,revision,queue_revision FROM product_planning_cycles WHERE product_code=? AND biz_id=?`, code, q.CycleBizID).Scan(&cycleID, &out.CycleStatus, &out.CycleRevision, &out.QueueRevision); err != nil {
		return out, err
	}
	where := ` FROM product_planning_items i JOIN product_planning_cycle_items ci ON ci.planning_item_id=i.id AND ci.product_code=i.product_code WHERE i.product_code=? AND i.feature_id=? AND ci.cycle_id=?`
	args := []any{code, featureID, cycleID}
	out.ByBucket = map[string]int{"now": 0, "next": 0, "later": 0}
	totals, err := tx.QueryContext(ctx, `SELECT ci.roadmap_bucket,COUNT(*)`+where+` GROUP BY ci.roadmap_bucket`, args...)
	if err != nil {
		return out, err
	}
	for totals.Next() {
		var bucket string
		var count int
		if err = totals.Scan(&bucket, &count); err != nil {
			totals.Close()
			return out, err
		}
		out.ByBucket[bucket] = count
		out.Total += count
	}
	err = totals.Err()
	totals.Close()
	if err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT i.biz_id,i.title,i.scope_summary,i.lifecycle,ci.selection_status,ci.roadmap_bucket,ci.decision_rank,i.revision`+where+` ORDER BY ci.decision_rank,i.id LIMIT ? OFFSET ?`, append(args, q.PageSize, (q.Page-1)*q.PageSize)...)
	if err != nil {
		return out, err
	}
	out.Items = []FeatureRoadmapItem{}
	for rows.Next() {
		var item FeatureRoadmapItem
		if err = rows.Scan(&item.BizID, &item.Title, &item.ScopeSummary, &item.Lifecycle, &item.SelectionStatus, &item.RoadmapBucket, &item.DecisionRank, &item.Revision); err != nil {
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
	out.FeatureBizID, out.CycleBizID, out.WorkspaceRevision = q.FeatureBizID, q.CycleBizID, planningPermit.Facts.Revision
	out.Page, out.PageSize = q.Page, q.PageSize
	return out, tx.Commit()
}
