package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"
)

type ProductObjectiveCycleRevoke struct {
	ObjectiveID               int64  `json:"objective_id"`
	MappingID                 int64  `json:"mapping_id"`
	ExpectedRevision          uint64 `json:"expected_revision"`
	ExpectedObjectiveRevision uint64 `json:"expected_objective_revision"`
	Reason                    string `json:"reason"`
}

func RevokeProductObjectiveCycle(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductObjectiveCycleRevoke) (CommandResult, error) {
	if identity.Action != "product_objectives:cycle-revoke" {
		return CommandResult{}, invalid("product_command_identity_invalid", "目标编辑命令不匹配")
	}
	if input.ExpectedRevision < 1 || input.MappingID < 1 || input.ObjectiveID < 1 || input.ExpectedObjectiveRevision < 1 || !utf8.ValidString(input.Reason) || strings.ContainsRune(input.Reason, '\x00') || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 {
		return CommandResult{}, invalid("product_objective_cycle_revoke_invalid", "目标、修订或变更原因无效")
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
		var cycleID int64
		var bizID string
		var revoked bool
		var objectiveSnapshot, cycleSnapshot []byte
		if err = tx.QueryRowContext(ctx, `SELECT cycle_id,biz_id,(revoked_at IS NOT NULL),objective_snapshot,cycle_snapshot FROM product_objective_cycles WHERE id=? AND objective_id=? AND BINARY product_code=BINARY ? FOR UPDATE`, input.MappingID, before.ID, identity.ProductCode).Scan(&cycleID, &bizID, &revoked, &objectiveSnapshot, &cycleSnapshot); err != nil {
			return nil, err
		}
		if revoked {
			return nil, invalid("product_objective_cycle_mapping_conflict", "映射已撤销")
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_objective_cycles SET revoked_by=?,revoked_at=UTC_TIMESTAMP(3),revocation_reason=? WHERE id=? AND objective_id=? AND BINARY product_code=BINARY ?`, identity.ActorUID, input.Reason, input.MappingID, before.ID, identity.ProductCode); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_objectives SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND BINARY product_code=BINARY ?`, identity.ActorUID, before.ID, identity.ProductCode); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"id": input.MappingID, "biz_id": bizID, "objective_id": before.ID, "cycle_id": cycleID, "revoked": true, "objective_revision": before.Revision + 1, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"before": map[string]any{"objective_snapshot": json.RawMessage(objectiveSnapshot), "cycle_snapshot": json.RawMessage(cycleSnapshot), "revoked": false}, "after": out, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'objective_cycle_mapping',?,'revoke',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(input.MappingID, 10), identity.ActorUID, 2, changes, identity.IdempotencyKey)
		return out, err
	})
}
