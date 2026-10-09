package productcenter

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/google/uuid"
	"time"
)

type QuarterRoadmapQuery struct {
	Year        int    `json:"year"`
	Quarter     int    `json:"quarter"`
	Unscheduled bool   `json:"unscheduled"`
	CycleBizID  string `json:"cycle_biz_id"`
	Page        int    `json:"page"`
	PageSize    int    `json:"page_size"`
}

type QuarterRoadmapItem struct {
	BizID           string  `json:"biz_id"`
	Title           string  `json:"title"`
	ScopeSummary    string  `json:"scope_summary"`
	Lifecycle       string  `json:"lifecycle"`
	SelectionStatus string  `json:"selection_status"`
	RoadmapBucket   string  `json:"roadmap_bucket"`
	DecisionRank    int64   `json:"decision_rank"`
	Revision        uint64  `json:"revision"`
	StartsOn        *string `json:"starts_on"`
	EndsOn          *string `json:"ends_on"`
}

type QuarterRoadmapView struct {
	Year              int                  `json:"year"`
	Quarter           int                  `json:"quarter"`
	Unscheduled       bool                 `json:"unscheduled"`
	CycleBizID        string               `json:"cycle_biz_id"`
	WorkspaceRevision uint64               `json:"workspace_revision"`
	CycleRevision     uint64               `json:"cycle_revision"`
	QueueRevision     uint64               `json:"queue_revision"`
	CycleStatus       string               `json:"cycle_status"`
	Items             []QuarterRoadmapItem `json:"items"`
	Total             int                  `json:"total"`
	ByBucket          map[string]int       `json:"by_bucket"`
	Page              int                  `json:"page"`
	PageSize          int                  `json:"pageSize"`
}

// Quarter windows filter the existing cycle decision queue without changing its order.
func ReadQuarterRoadmap(ctx context.Context, db *sql.DB, code, uid string, planningPermit, roadmapPermit AuthorizationPermit, q QuarterRoadmapQuery) (QuarterRoadmapView, error) {
	var out QuarterRoadmapView
	if err := ValidateQuarterRoadmapQuery(q); err != nil {
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
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_roadmaps", "view", roadmapPermit); err != nil {
		return out, err
	}
	out, err = loadQuarterRoadmap(ctx, tx, code, planningPermit.Facts.Revision, q)
	if err != nil {
		return QuarterRoadmapView{}, err
	}
	return out, tx.Commit()
}

func loadQuarterRoadmap(ctx context.Context, tx *sql.Tx, code string, workspaceRevision uint64, q QuarterRoadmapQuery) (QuarterRoadmapView, error) {
	var out QuarterRoadmapView
	var cycleID int64
	if err := tx.QueryRowContext(ctx, `SELECT id,status,revision,queue_revision FROM product_planning_cycles WHERE BINARY product_code=BINARY ? AND biz_id=?`, code, q.CycleBizID).Scan(&cycleID, &out.CycleStatus, &out.CycleRevision, &out.QueueRevision); err != nil {
		return out, err
	}
	where := ` FROM product_planning_items i JOIN product_planning_cycle_items ci ON ci.planning_item_id=i.id AND ci.product_code=i.product_code WHERE BINARY i.product_code=BINARY ? AND ci.cycle_id=?`
	args := []any{code, cycleID}
	if q.Unscheduled {
		where += ` AND i.roadmap_starts_on IS NULL AND i.roadmap_ends_on IS NULL`
	} else {
		start := time.Date(q.Year, time.Month((q.Quarter-1)*3+1), 1, 0, 0, 0, 0, time.UTC)
		end := start.AddDate(0, 3, -1)
		where += ` AND i.roadmap_starts_on<=? AND i.roadmap_ends_on>=?`
		args = append(args, fmt.Sprintf("%04d-%02d-%02d", end.Year(), end.Month(), end.Day()), start.Format("2006-01-02"))
	}
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
	rows, err := tx.QueryContext(ctx, `SELECT i.biz_id,i.title,i.scope_summary,i.lifecycle,ci.selection_status,ci.roadmap_bucket,ci.decision_rank,i.revision,DATE_FORMAT(i.roadmap_starts_on,'%Y-%m-%d'),DATE_FORMAT(i.roadmap_ends_on,'%Y-%m-%d')`+where+` ORDER BY ci.decision_rank,i.id LIMIT ? OFFSET ?`, append(args, q.PageSize, (q.Page-1)*q.PageSize)...)
	if err != nil {
		return out, err
	}
	out.Items = []QuarterRoadmapItem{}
	for rows.Next() {
		var item QuarterRoadmapItem
		if err = rows.Scan(&item.BizID, &item.Title, &item.ScopeSummary, &item.Lifecycle, &item.SelectionStatus, &item.RoadmapBucket, &item.DecisionRank, &item.Revision, &item.StartsOn, &item.EndsOn); err != nil {
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
	out.Year, out.Quarter, out.Unscheduled = q.Year, q.Quarter, q.Unscheduled
	out.CycleBizID, out.WorkspaceRevision = q.CycleBizID, workspaceRevision
	out.Page, out.PageSize = q.Page, q.PageSize
	return out, nil
}

func ValidateQuarterRoadmapQuery(q QuarterRoadmapQuery) error {
	for _, value := range []string{q.CycleBizID} {
		id, err := uuid.Parse(value)
		if err != nil || id.String() != value {
			return invalid("product_roadmap_query_invalid", "周期标识无效")
		}
	}
	if q.Year < 1000 || q.Year > 9999 || q.Quarter < 1 || q.Quarter > 4 {
		return invalid("product_roadmap_query_invalid", "年份或季度无效")
	}
	if err := ValidatePlanningPageQuery(PlanningPageQuery{Page: q.Page, PageSize: q.PageSize}); err != nil {
		return err
	}
	return nil
}
