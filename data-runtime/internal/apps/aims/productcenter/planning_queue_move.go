package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"math"
	"reflect"
	"strings"
	"unicode/utf8"
)

type PlanningQueueMove struct {
	CycleBizID            string `json:"cycle_biz_id"`
	ExpectedRevision      uint64 `json:"expected_revision"`
	ExpectedCycleRevision uint64 `json:"expected_cycle_revision"`
	ExpectedQueueRevision uint64 `json:"expected_queue_revision"`
	Move                  Move   `json:"move"`
	Reason                string `json:"reason"`
}

func ValidatePlanningQueueMove(input PlanningQueueMove) error {
	for _, value := range []string{input.CycleBizID, input.Move.ItemID} {
		id, err := uuid.Parse(value)
		if err != nil || id.String() != value {
			return invalid("priority_move_invalid", "周期和事项标识无效")
		}
	}
	if (input.Move.BeforeID == "") == (input.Move.AfterID == "") {
		return invalid("priority_move_invalid", "必须指定唯一相邻事项")
	}
	anchor := input.Move.BeforeID
	if anchor == "" {
		anchor = input.Move.AfterID
	}
	id, err := uuid.Parse(anchor)
	if err != nil || id.String() != anchor || anchor == input.Move.ItemID {
		return invalid("priority_move_invalid", "相邻事项标识无效")
	}
	if input.ExpectedRevision == 0 || input.ExpectedCycleRevision == 0 || input.ExpectedQueueRevision == 0 || input.ExpectedQueueRevision > math.MaxInt64 {
		return invalid("priority_queue_conflict", "必须提供有效产品、周期和队列版本")
	}
	if strings.TrimSpace(input.Reason) == "" || !utf8.ValidString(input.Reason) || strings.ContainsRune(input.Reason, '\x00') || utf8.RuneCountInString(input.Reason) > 2000 {
		return invalid("priority_reason_required", "调整顺序必须填写理由，最多 2000 字")
	}
	return nil
}
func MovePlanningQueue(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input PlanningQueueMove) (CommandResult, error) {
	if identity.Action != "product_priorities:move" {
		return CommandResult{}, invalid("product_command_identity_invalid", "调序命令不匹配")
	}
	if err := ValidatePlanningQueueMove(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "prioritize", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "产品已归档")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化，请刷新")
		}
		cycle, err := loadPlanningCycle(ctx, tx, identity.ProductCode, input.CycleBizID)
		if err != nil {
			return nil, err
		}
		if cycle.Status != "open" {
			return nil, invalid("planning_cycle_readonly", "仅开放周期允许调整顺序")
		}
		if cycle.Revision != input.ExpectedCycleRevision {
			return nil, invalid("planning_cycle_revision_conflict", "周期已变化，请刷新")
		}
		if cycle.QueueRevision > math.MaxInt64 || cycle.QueueRevision != input.ExpectedQueueRevision {
			return nil, invalid("priority_queue_conflict", "队列已变化，请刷新")
		}
		entries, maxRank, err := loadPlanningQueue(ctx, tx, identity.ProductCode, cycle.ID)
		if err != nil {
			return nil, err
		}
		before := make([]string, 0, len(entries))
		ids := map[string]int64{}
		for _, entry := range entries {
			before = append(before, entry.BizID)
			ids[entry.BizID] = entry.ID
		}
		after, err := MoveQueue(before, int64(cycle.QueueRevision), int64(input.ExpectedQueueRevision), input.Move)
		if err != nil {
			return nil, err
		}
		out := map[string]any{"cycle_biz_id": cycle.BizID, "workspace_revision": root.Revision, "cycle_revision": cycle.Revision, "queue_revision": cycle.QueueRevision, "changed": false}
		if reflect.DeepEqual(before, after) {
			return out, nil
		}
		// Move all rows out of the final rank range before assigning compact positions.
		for index, biz := range after {
			if _, err = tx.ExecContext(ctx, `UPDATE product_planning_cycle_items SET decision_rank=? WHERE cycle_id=? AND planning_item_id=?`, maxRank+uint64(index)+1, cycle.ID, ids[biz]); err != nil {
				return nil, err
			}
		}
		for index, biz := range after {
			if _, err = tx.ExecContext(ctx, `UPDATE product_planning_cycle_items SET decision_rank=? WHERE cycle_id=? AND planning_item_id=?`, index+1, cycle.ID, ids[biz]); err != nil {
				return nil, err
			}
		}
		var invalidDependency bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM product_planning_cycle_items child JOIN product_planning_dependencies d ON d.planning_item_id=child.planning_item_id AND d.product_code=child.product_code JOIN product_planning_items predecessor ON predecessor.id=d.predecessor_id AND predecessor.product_code=d.product_code LEFT JOIN product_planning_cycle_items parent ON parent.cycle_id=child.cycle_id AND parent.planning_item_id=d.predecessor_id WHERE child.cycle_id=? AND child.selection_status='selected' AND predecessor.lifecycle<>'delivered' AND (parent.planning_item_id IS NULL OR parent.selection_status<>'selected' OR parent.decision_rank>=child.decision_rank))`, cycle.ID).Scan(&invalidDependency); err != nil {
			return nil, err
		}
		if invalidDependency {
			return nil, invalid("planning_dependency_order_invalid", "调整后已选事项的前置条件不满足，请先处理依赖")
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_cycles SET revision=revision+1,queue_revision=queue_revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, identity.ActorUID, cycle.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out["workspace_revision"] = root.Revision + 1
		out["cycle_revision"] = cycle.Revision + 1
		out["queue_revision"] = cycle.QueueRevision + 1
		out["changed"] = true
		changes, err := json.Marshal(map[string]any{"before": before, "after": after, "reason": input.Reason, "move": input.Move})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'planning_cycle',?,'move',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, cycle.BizID, identity.ActorUID, cycle.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
