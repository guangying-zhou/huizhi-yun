package productcenter

import (
	"context"
	"database/sql"
	"math"
)

type planningQueueEntry struct {
	ID              int64
	BizID           string
	Title           string
	SelectionStatus string
	Rank            uint64
}

// Shared by preview and command so neither operates on a filtered page.
func loadPlanningQueue(ctx context.Context, tx *sql.Tx, code string, cycleID int64) ([]planningQueueEntry, uint64, error) {
	rows, err := tx.QueryContext(ctx, `SELECT i.biz_id,i.id,i.title,c.selection_status,c.decision_rank FROM product_planning_cycle_items c JOIN product_planning_items i ON i.id=c.planning_item_id AND i.product_code=c.product_code WHERE c.product_code=? AND c.cycle_id=? ORDER BY c.decision_rank,i.id LIMIT 10001`, code, cycleID)
	if err != nil {
		return nil, 0, err
	}
	entries := []planningQueueEntry{}
	var maxRank uint64
	for rows.Next() {
		var entry planningQueueEntry
		if err = rows.Scan(&entry.BizID, &entry.ID, &entry.Title, &entry.SelectionStatus, &entry.Rank); err != nil {
			rows.Close()
			return nil, 0, err
		}
		entries = append(entries, entry)
		if entry.Rank > maxRank {
			maxRank = entry.Rank
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, 0, err
	}
	if len(entries) > 10000 || maxRank > math.MaxInt64-uint64(len(entries)) {
		return nil, 0, invalid("priority_queue_limit", "队列超过当前支持上限，不能按截断结果调整")
	}
	return entries, maxRank, nil
}

type PlanningQueueImpact struct {
	ItemBizID       string `json:"item_biz_id"`
	Title           string `json:"title"`
	SelectionStatus string `json:"selection_status"`
	BeforePosition  int    `json:"before_position"`
	AfterPosition   int    `json:"after_position"`
}
type PlanningQueuePreview struct {
	CycleBizID        string                `json:"cycle_biz_id"`
	WorkspaceRevision uint64                `json:"workspace_revision"`
	CycleRevision     uint64                `json:"cycle_revision"`
	QueueRevision     uint64                `json:"queue_revision"`
	Total             int                   `json:"total"`
	Affected          []PlanningQueueImpact `json:"affected"`
}

func PreviewPlanningQueueMove(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, input PlanningQueueMove) (PlanningQueuePreview, error) {
	var out PlanningQueuePreview
	if err := ValidatePlanningQueueMove(input); err != nil {
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
	root, err := loadWorkspace(ctx, tx, code)
	if err != nil {
		return out, err
	}
	if root.Revision != input.ExpectedRevision {
		return out, invalid("product_revision_conflict", "产品已变化，请刷新")
	}
	cycle, err := loadPlanningCycle(ctx, tx, code, input.CycleBizID)
	if err != nil {
		return out, err
	}
	if cycle.Revision != input.ExpectedCycleRevision {
		return out, invalid("planning_cycle_revision_conflict", "周期已变化，请刷新")
	}
	if cycle.Status != "open" || root.Status != "active" {
		return out, invalid("planning_cycle_readonly", "当前周期不可调序")
	}
	if cycle.QueueRevision > math.MaxInt64 {
		return out, invalid("priority_queue_conflict", "队列版本超出支持范围")
	}
	entries, _, err := loadPlanningQueue(ctx, tx, code, cycle.ID)
	if err != nil {
		return out, err
	}
	before := make([]string, 0, len(entries))
	positions := map[string]int{}
	byID := map[string]planningQueueEntry{}
	for index, entry := range entries {
		before = append(before, entry.BizID)
		positions[entry.BizID] = index + 1
		byID[entry.BizID] = entry
	}
	after, err := MoveQueue(before, int64(cycle.QueueRevision), int64(input.ExpectedQueueRevision), input.Move)
	if err != nil {
		return out, err
	}
	out = PlanningQueuePreview{CycleBizID: cycle.BizID, WorkspaceRevision: root.Revision, CycleRevision: cycle.Revision, QueueRevision: cycle.QueueRevision, Total: len(entries), Affected: []PlanningQueueImpact{}}
	for index, biz := range after {
		if positions[biz] != index+1 {
			entry := byID[biz]
			out.Affected = append(out.Affected, PlanningQueueImpact{ItemBizID: biz, Title: entry.Title, SelectionStatus: entry.SelectionStatus, BeforePosition: positions[biz], AfterPosition: index + 1})
		}
	}
	return out, tx.Commit()
}
