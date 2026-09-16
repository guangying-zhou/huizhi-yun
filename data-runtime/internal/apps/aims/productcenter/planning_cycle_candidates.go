package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"

	"github.com/google/uuid"
)

type PlanningCycleCandidateAdd struct {
	CycleBizID            string `json:"cycle_biz_id"`
	ItemBizID             string `json:"item_biz_id"`
	ExpectedRevision      uint64 `json:"expected_revision"`
	ExpectedCycleRevision uint64 `json:"expected_cycle_revision"`
	ExpectedItemRevision  uint64 `json:"expected_item_revision"`
}

func ValidatePlanningCycleCandidateAdd(input PlanningCycleCandidateAdd) error {
	for _, value := range []string{input.CycleBizID, input.ItemBizID} {
		id, err := uuid.Parse(value)
		if err != nil || id.String() != value {
			return invalid("planning_candidate_input_invalid", "必须提供规范的周期和事项标识")
		}
	}
	if input.ExpectedRevision == 0 || input.ExpectedCycleRevision == 0 || input.ExpectedItemRevision == 0 {
		return invalid("planning_candidate_input_invalid", "必须提供产品、周期和事项版本")
	}
	return nil
}

func AddPlanningCycleCandidate(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input PlanningCycleCandidateAdd) (CommandResult, error) {
	if identity.Action != "product_priorities:candidate-add" {
		return CommandResult{}, invalid("product_command_identity_invalid", "候选添加命令不匹配")
	}
	if err := ValidatePlanningCycleCandidateAdd(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "edit", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "产品空间已归档，请先恢复")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品空间已变化，请刷新后重试")
		}
		cycle, err := loadPlanningCycle(ctx, tx, identity.ProductCode, input.CycleBizID)
		if err != nil {
			return nil, err
		}
		if cycle.Revision != input.ExpectedCycleRevision {
			return nil, invalid("planning_cycle_revision_conflict", "周期已变化，请刷新后重试")
		}
		if cycle.Status != "draft" && cycle.Status != "open" {
			return nil, invalid("planning_cycle_readonly", "已关闭周期不能添加候选")
		}
		var itemID int64
		var revision uint64
		var lifecycle string
		if err = tx.QueryRowContext(ctx, `SELECT id,revision,lifecycle FROM product_planning_items WHERE product_code=? AND biz_id=?`, identity.ProductCode, input.ItemBizID).Scan(&itemID, &revision, &lifecycle); err != nil {
			return nil, err
		}
		if revision != input.ExpectedItemRevision {
			return nil, invalid("product_planning_revision_conflict", "事项已变化，请刷新后重试")
		}
		if lifecycle != "proposed" && lifecycle != "in_delivery" {
			return nil, invalid("product_planning_readonly", "已结束或合并事项不能加入候选")
		}
		var selection, bucket string
		var rank uint64
		err = tx.QueryRowContext(ctx, `SELECT selection_status,roadmap_bucket,decision_rank FROM product_planning_cycle_items WHERE product_code=? AND cycle_id=? AND planning_item_id=?`, identity.ProductCode, cycle.ID, itemID).Scan(&selection, &bucket, &rank)
		value := map[string]any{"product_code": identity.ProductCode, "cycle_biz_id": cycle.BizID, "item_biz_id": input.ItemBizID, "cycle_revision": cycle.Revision, "queue_revision": cycle.QueueRevision, "workspace_revision": root.Revision}
		if err == nil {
			value["selection_status"] = selection
			value["roadmap_bucket"] = bucket
			value["decision_rank"] = rank
			value["already_present"] = true
			return value, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if err = tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(decision_rank),0) FROM product_planning_cycle_items WHERE product_code=? AND cycle_id=?`, identity.ProductCode, cycle.ID).Scan(&rank); err != nil {
			return nil, err
		}
		if rank >= math.MaxInt64 {
			return nil, invalid("priority_queue_rank_exhausted", "队列顺序空间不足，请先整理队列")
		}
		rank++
		if _, err = tx.ExecContext(ctx, `INSERT INTO product_planning_cycle_items(cycle_id,planning_item_id,product_code,selection_status,decision_rank,roadmap_bucket) VALUES (?,?,?,'candidate',?,'later')`, cycle.ID, itemID, identity.ProductCode, rank); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_cycles SET revision=revision+1,queue_revision=queue_revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND id=?`, identity.ActorUID, identity.ProductCode, cycle.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		value["selection_status"] = "candidate"
		value["roadmap_bucket"] = "later"
		value["decision_rank"] = rank
		value["already_present"] = false
		value["cycle_revision"] = cycle.Revision + 1
		value["queue_revision"] = cycle.QueueRevision + 1
		value["workspace_revision"] = root.Revision + 1
		changes, err := json.Marshal(map[string]any{"after": value})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'planning_cycle',?,'candidate-add',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, cycle.BizID, identity.ActorUID, cycle.Revision+1, changes, identity.IdempotencyKey)
		return value, err
	})
}
