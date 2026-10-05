package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"strings"
	"unicode/utf8"
)

type PlanningCommentInput struct {
	ItemBizID               string `json:"item_biz_id"`
	CommentID               int64  `json:"comment_id"`
	ExpectedRevision        uint64 `json:"expected_revision"`
	ExpectedCommentRevision uint64 `json:"expected_comment_revision"`
	Body                    string `json:"body"`
}

// Comments are discussion only. No item, score, evidence or queue revision changes.
func ChangePlanningComment(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, action string, input PlanningCommentInput) (CommandResult, error) {
	if action != "create" && action != "edit" && action != "delete" {
		return CommandResult{}, invalid("planning_comment_input_invalid", "评论动作无效")
	}
	if identity.Action != "product_priorities:comment-"+action {
		return CommandResult{}, invalid("product_command_identity_invalid", "评论命令不匹配")
	}
	id, err := uuid.Parse(input.ItemBizID)
	if err != nil || id.String() != input.ItemBizID || input.ExpectedRevision == 0 || (action == "create" && (input.CommentID != 0 || input.ExpectedCommentRevision != 0)) || (action != "create" && (input.CommentID <= 0 || input.ExpectedCommentRevision == 0)) || (action == "delete" && input.Body != "") || (action != "delete" && (strings.TrimSpace(input.Body) == "" || !utf8.ValidString(input.Body) || strings.ContainsRune(input.Body, '\x00') || utf8.RuneCountInString(input.Body) > 10000)) {
		return CommandResult{}, invalid("planning_comment_input_invalid", "评论正文或版本信息无效")
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "comment", permit)
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
		item, err := loadPlanningItemDetail(ctx, tx, identity.ProductCode, input.ItemBizID)
		if err != nil {
			return nil, err
		}
		cycleID, err := currentPlanningCommentCycle(ctx, tx, item.ID)
		if err != nil {
			return nil, err
		}
		rule, message, err := planningCommentReadonly(ctx, tx, item.ID, item.Lifecycle, cycleID)
		if err != nil {
			return nil, err
		}
		if rule != "" && action == "create" {
			return nil, invalid(rule, message)
		}
		var before any
		commentID := input.CommentID
		revision := uint64(1)
		if action == "create" {
			result, err := tx.ExecContext(ctx, `INSERT INTO product_planning_comments(planning_item_id,cycle_id,author_uid,body,created_at,updated_at) VALUES(?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, item.ID, cycleID, identity.ActorUID, input.Body)
			if err != nil {
				return nil, err
			}
			commentID, err = result.LastInsertId()
			if err != nil {
				return nil, err
			}
		} else {
			var author, body string
			var deleted sql.NullString
			err = tx.QueryRowContext(ctx, `SELECT author_uid,body,revision,deleted_at,cycle_id FROM product_planning_comments WHERE id=? AND planning_item_id=? FOR UPDATE`, commentID, item.ID).Scan(&author, &body, &revision, &deleted, &cycleID)
			if err == sql.ErrNoRows {
				return nil, invalid("planning_comment_not_found", "评论不存在")
			}
			if err != nil {
				return nil, err
			}
			if author != identity.ActorUID {
				return nil, invalid("planning_comment_author_required", "只能修改本人评论")
			}
			rule, message, err = planningCommentReadonly(ctx, tx, item.ID, item.Lifecycle, cycleID)
			if err != nil {
				return nil, err
			}
			if rule != "" {
				return nil, invalid(rule, message)
			}
			if deleted.Valid {
				return nil, invalid("planning_comment_deleted", "评论已删除")
			}
			if revision != input.ExpectedCommentRevision {
				return nil, invalid("planning_comment_revision_conflict", "评论已变化，请刷新")
			}
			before = map[string]any{"body": body, "revision": revision}
			revision++
			if action == "delete" {
				_, err = tx.ExecContext(ctx, `UPDATE product_planning_comments SET deleted_at=UTC_TIMESTAMP(3),revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, commentID)
			} else {
				_, err = tx.ExecContext(ctx, `UPDATE product_planning_comments SET body=?,revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, input.Body, commentID)
			}
			if err != nil {
				return nil, err
			}
		}
		out := map[string]any{"comment_id": commentID, "item_biz_id": item.BizID, "revision": revision, "deleted": action == "delete", "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"before": before, "body": input.Body, "result": out})
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'planning_item',?,?,?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, item.BizID, "comment-"+action, identity.ActorUID, revision, changes, identity.IdempotencyKey); err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode)
		return out, err
	})
}

// Called with the authorized product root lock held by both reads and writes.
func planningCommentReadonly(ctx context.Context, tx *sql.Tx, itemID int64, lifecycle string, cycleID *int64) (string, string, error) {
	if lifecycle == "merged" || lifecycle == "cancelled" {
		return "product_planning_readonly", "已合并或取消事项不能修改讨论", nil
	}
	if cycleID != nil {
		var status string
		if err := tx.QueryRowContext(ctx, `SELECT status FROM product_planning_cycles WHERE id=?`, *cycleID).Scan(&status); err != nil {
			return "", "", err
		}
		if status == "closed" {
			return "planning_cycle_closed", "闭期事项讨论已冻结", nil
		}
		return "", "", nil
	}
	var closed int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_planning_cycle_items i JOIN product_planning_cycles c ON c.id=i.cycle_id WHERE i.planning_item_id=? AND c.status='closed'`, itemID).Scan(&closed); err != nil {
		return "", "", err
	}
	if closed > 0 {
		return "planning_cycle_closed", "闭期事项讨论已冻结", nil
	}
	return "", "", nil
}

func currentPlanningCommentCycle(ctx context.Context, tx *sql.Tx, itemID int64) (*int64, error) {
	var id int64
	err := tx.QueryRowContext(ctx, `SELECT c.id FROM product_planning_cycles c JOIN product_planning_cycle_items i ON i.cycle_id=c.id WHERE i.planning_item_id=? AND c.status='open' LIMIT 1`, itemID).Scan(&id)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}
