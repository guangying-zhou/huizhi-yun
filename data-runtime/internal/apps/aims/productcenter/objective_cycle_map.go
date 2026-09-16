package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"strconv"
	"strings"
	"unicode/utf8"
)

type ProductObjectiveCycleMap struct {
	ObjectiveID               int64  `json:"objective_id"`
	CycleID                   int64  `json:"cycle_id"`
	ExpectedRevision          uint64 `json:"expected_revision"`
	ExpectedObjectiveRevision uint64 `json:"expected_objective_revision"`
	ExpectedCycleRevision     uint64 `json:"expected_cycle_revision"`
	Reason                    string `json:"reason"`
}

func MapProductObjectiveCycle(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductObjectiveCycleMap) (CommandResult, error) {
	if identity.Action != "product_objectives:cycle-map" {
		return CommandResult{}, invalid("product_command_identity_invalid", "目标编辑命令不匹配")
	}
	if input.ExpectedRevision < 1 || input.CycleID < 1 || input.ExpectedCycleRevision < 1 || input.ObjectiveID < 1 || input.ExpectedObjectiveRevision < 1 || !utf8.ValidString(input.Reason) || strings.ContainsRune(input.Reason, '\x00') || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 {
		return CommandResult{}, invalid("product_objective_cycle_map_invalid", "目标、修订或变更原因无效")
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_objectives", "edit", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "产品已归档")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化")
		}
		before, err := scanProductObjective(tx.QueryRowContext(ctx, `SELECT `+objectiveColumns+` FROM product_objectives WHERE id=? AND BINARY product_code=BINARY ? FOR UPDATE`, input.ObjectiveID, identity.ProductCode))
		if err != nil {
			return nil, err
		}
		if before.Revision != input.ExpectedObjectiveRevision {
			return nil, invalid("product_objective_revision_conflict", "目标已变化")
		}
		if before.Status != "draft" && before.Status != "active" {
			return nil, invalid("product_objective_state_conflict", "仅草稿或进行中目标可编辑")
		}
		cycle, err := scanPlanningCycle(tx.QueryRowContext(ctx, `SELECT `+planningCycleColumns+` FROM product_planning_cycles WHERE id=? AND BINARY product_code=BINARY ? FOR UPDATE`, input.CycleID, identity.ProductCode))
		if err != nil {
			return nil, err
		}
		if cycle.Revision != input.ExpectedCycleRevision {
			return nil, invalid("planning_cycle_revision_conflict", "周期已变化")
		}
		var exists bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM product_objective_cycles WHERE objective_id=? AND cycle_id=? AND revoked_at IS NULL)`, before.ID, cycle.ID).Scan(&exists); err != nil {
			return nil, err
		}
		if exists {
			return nil, invalid("product_objective_cycle_mapping_conflict", "该周期已有有效目标映射")
		}
		objectiveSnapshot, err := json.Marshal(before)
		if err != nil {
			return nil, err
		}
		cycleSnapshot, err := json.Marshal(cycle)
		if err != nil {
			return nil, err
		}
		bizID := uuid.NewString()
		inserted, err := tx.ExecContext(ctx, `INSERT INTO product_objective_cycles(biz_id,product_code,objective_id,cycle_id,objective_revision,cycle_revision,objective_snapshot,cycle_snapshot,mapping_note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`, bizID, identity.ProductCode, before.ID, cycle.ID, before.Revision, cycle.Revision, objectiveSnapshot, cycleSnapshot, input.Reason, identity.ActorUID)
		if err != nil {
			return nil, err
		}
		mappingID, err := inserted.LastInsertId()
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_objectives SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND BINARY product_code=BINARY ?`, identity.ActorUID, before.ID, identity.ProductCode); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"id": mappingID, "biz_id": bizID, "objective_id": before.ID, "cycle_id": cycle.ID, "objective_snapshot": before, "cycle_snapshot": cycle, "objective_revision": before.Revision + 1, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"after": out, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'objective_cycle_mapping',?,'create',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(mappingID, 10), identity.ActorUID, 1, changes, identity.IdempotencyKey)
		return out, err
	})
}
