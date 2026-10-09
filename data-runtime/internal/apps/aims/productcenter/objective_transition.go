package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"
)

type ProductObjectiveTransition struct {
	ObjectiveID               int64  `json:"objective_id"`
	ExpectedRevision          uint64 `json:"expected_revision"`
	ExpectedObjectiveRevision uint64 `json:"expected_objective_revision"`
	Action                    string `json:"action"`
	Reason                    string `json:"reason"`
}

func objectiveTransition(status, action string) (string, error) {
	switch {
	case status == "draft" && action == "activate":
		return "active", nil
	case status == "active" && action == "close":
		return "closed", nil
	case status == "closed" && action == "reopen":
		return "active", nil
	case (status == "draft" || status == "closed") && action == "archive":
		return "archived", nil
	default:
		return "", invalid("product_objective_state_conflict", "当前目标状态不允许此操作")
	}
}

func TransitionProductObjective(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductObjectiveTransition) (CommandResult, error) {
	if identity.Action != "product_objectives:"+input.Action {
		return CommandResult{}, invalid("product_command_identity_invalid", "目标状态命令不匹配")
	}
	if input.ObjectiveID < 1 || input.ExpectedRevision < 1 || input.ExpectedObjectiveRevision < 1 || !utf8.ValidString(input.Reason) || strings.ContainsRune(input.Reason, '\x00') || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 {
		return CommandResult{}, invalid("product_objective_transition_invalid", "目标、修订或变更原因无效")
	}
	switch input.Action {
	case "activate", "close", "reopen", "archive":
	default:
		return CommandResult{}, invalid("product_objective_transition_invalid", "目标状态动作无效")
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_objectives", input.Action, permit)
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
		objective, err := scanProductObjective(tx.QueryRowContext(ctx, `SELECT `+objectiveColumns+` FROM product_objectives WHERE BINARY product_code=BINARY ? AND id=? FOR UPDATE`, identity.ProductCode, input.ObjectiveID))
		if err != nil {
			return nil, err
		}
		if objective.Revision != input.ExpectedObjectiveRevision {
			return nil, invalid("product_objective_revision_conflict", "目标已变化")
		}
		status, err := objectiveTransition(objective.Status, input.Action)
		if err != nil {
			return nil, err
		}
		if status == "active" {
			facts, e := LoadAuthorizationFacts(ctx, tx, identity.ProductCode, objective.OwnerUID)
			if e != nil {
				return nil, e
			}
			if !facts.IsMember {
				return nil, invalid("product_objective_owner_unavailable", "目标负责人已不是有效产品成员")
			}
			if e = ValidateProductObjectiveMetric(objective.Metric); e != nil {
				return nil, e
			}
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_objectives SET status=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND BINARY product_code=BINARY ?`, status, identity.ActorUID, objective.ID, identity.ProductCode); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		after := objective
		after.Status = status
		after.Revision++
		out := map[string]any{"objective": after, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"before": objective, "after": after, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'objective',?,?,?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(objective.ID, 10), input.Action, identity.ActorUID, after.Revision, changes, identity.IdempotencyKey)
		return out, err
	})
}
