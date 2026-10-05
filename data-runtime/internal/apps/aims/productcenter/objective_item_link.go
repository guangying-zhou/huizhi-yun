package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"
)

type ProductObjectiveItemLink struct {
	ExpectedRevision          uint64 `json:"expected_revision"`
	PlanningItemID            int64  `json:"planning_item_id"`
	ExpectedPlanningRevision  uint64 `json:"expected_planning_revision"`
	ContributionNote          string `json:"contribution_note"`
	Remove                    bool   `json:"remove"`
	ObjectiveID               int64  `json:"objective_id"`
	ExpectedObjectiveRevision uint64 `json:"expected_objective_revision"`
	Reason                    string `json:"reason"`
}

func LinkProductObjectiveItem(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductObjectiveItemLink) (CommandResult, error) {
	if identity.Action != "product_objectives:item-link" {
		return CommandResult{}, invalid("product_command_identity_invalid", "目标编辑命令不匹配")
	}
	if input.ExpectedRevision < 1 || input.PlanningItemID < 1 || input.ExpectedPlanningRevision < 1 || !utf8.ValidString(input.ContributionNote) || strings.ContainsRune(input.ContributionNote, '\x00') || utf8.RuneCountInString(input.ContributionNote) > 2000 || (!input.Remove && strings.TrimSpace(input.ContributionNote) == "") || (input.Remove && input.ContributionNote != "") || input.ObjectiveID < 1 || input.ExpectedObjectiveRevision < 1 || !utf8.ValidString(input.Reason) || strings.ContainsRune(input.Reason, '\x00') || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 {
		return CommandResult{}, invalid("product_objective_item_link_invalid", "目标、修订或变更原因无效")
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
		var itemRevision uint64
		var lifecycle string
		if err = tx.QueryRowContext(ctx, `SELECT revision,lifecycle FROM product_planning_items WHERE id=? AND BINARY product_code=BINARY ? FOR UPDATE`, input.PlanningItemID, identity.ProductCode).Scan(&itemRevision, &lifecycle); err != nil {
			return nil, err
		}
		if itemRevision != input.ExpectedPlanningRevision {
			return nil, invalid("product_planning_revision_conflict", "规划事项已变化")
		}
		if !input.Remove && (lifecycle == "cancelled" || lifecycle == "merged") {
			return nil, invalid("product_objective_item_link_invalid", "取消或合并的事项不能新增目标关联")
		}
		var previous string
		err = tx.QueryRowContext(ctx, `SELECT contribution_note FROM product_objective_items WHERE objective_id=? AND planning_item_id=? AND BINARY product_code=BINARY ? FOR UPDATE`, before.ID, input.PlanningItemID, identity.ProductCode).Scan(&previous)
		existed := err == nil
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		if input.Remove {
			if !existed {
				return nil, sql.ErrNoRows
			}
			_, err = tx.ExecContext(ctx, `DELETE FROM product_objective_items WHERE objective_id=? AND planning_item_id=? AND BINARY product_code=BINARY ?`, before.ID, input.PlanningItemID, identity.ProductCode)
		} else if existed {
			_, err = tx.ExecContext(ctx, `UPDATE product_objective_items SET contribution_note=? WHERE objective_id=? AND planning_item_id=? AND BINARY product_code=BINARY ?`, input.ContributionNote, before.ID, input.PlanningItemID, identity.ProductCode)
		} else {
			_, err = tx.ExecContext(ctx, `INSERT INTO product_objective_items(objective_id,planning_item_id,product_code,contribution_note,created_by,created_at) VALUES(?,?,?,?,?,UTC_TIMESTAMP(3))`, before.ID, input.PlanningItemID, identity.ProductCode, input.ContributionNote, identity.ActorUID)
		}
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_objectives SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND BINARY product_code=BINARY ?`, identity.ActorUID, before.ID, identity.ProductCode); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"objective_id": before.ID, "planning_item_id": input.PlanningItemID, "linked": !input.Remove, "contribution_note": input.ContributionNote, "objective_revision": before.Revision + 1, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"planning_item_id": input.PlanningItemID, "before": map[string]any{"linked": existed, "contribution_note": previous}, "after": out, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'objective',?,'item-link',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(before.ID, 10), identity.ActorUID, before.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
