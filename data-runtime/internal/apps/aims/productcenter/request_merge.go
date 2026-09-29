package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"strings"
	"unicode/utf8"
)

type RequestMerge struct {
	BizID                   string `json:"biz_id"`
	TargetBizID             string `json:"target_biz_id"`
	ExpectedRevision        uint64 `json:"expected_revision"`
	ExpectedRequestRevision uint64 `json:"expected_request_revision"`
	ExpectedTargetRevision  uint64 `json:"expected_target_revision"`
	Reason                  string `json:"reason"`
	ImpactNote              string `json:"impact_note"`
}

func ValidateRequestMerge(input RequestMerge) error {
	for _, value := range []string{input.BizID, input.TargetBizID} {
		id, err := uuid.Parse(value)
		if err != nil || id.String() != value {
			return invalid("product_request_revision_required", "必须提供有效需求标识")
		}
	}
	if input.BizID == input.TargetBizID {
		return invalid("product_request_merge_self", "不能合并到自身")
	}
	if input.ExpectedRevision == 0 || input.ExpectedRequestRevision == 0 || input.ExpectedTargetRevision == 0 {
		return invalid("product_request_revision_required", "必须提供产品与两条需求的版本号")
	}
	if strings.TrimSpace(input.Reason) == "" {
		return invalid("product_request_reason_invalid", "请填写合并原因")
	}
	for _, value := range []string{input.Reason, input.ImpactNote} {
		if !utf8.ValidString(value) || utf8.RuneCountInString(value) > 2000 || strings.ContainsRune(value, '\x00') {
			return invalid("product_request_reason_invalid", "原因或影响说明无效")
		}
	}
	return nil
}

func MergeProductRequest(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input RequestMerge, sourceContext ...integrationoperation.TrustedContext) (CommandResult, error) {
	return mergeProductRequest(ctx, identity, permit, input, sourceContext, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}

// MergeProductRequestInTransaction preserves the original merge, feedback and
// receipt semantics. Any error also aborts preceding changes in the shared tx.
func MergeProductRequestInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input RequestMerge, sourceContext ...integrationoperation.TrustedContext) (CommandResult, error) {
	result, err := mergeProductRequest(ctx, identity, permit, input, sourceContext, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}

func mergeProductRequest(ctx context.Context, identity CommandIdentity, permit AuthorizationPermit, input RequestMerge, sourceContext []integrationoperation.TrustedContext, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {
	if identity.Action != "product_requests:merge" {
		return CommandResult{}, invalid("product_command_identity_invalid", "需求决策命令不匹配")
	}
	if err := ValidateRequestMerge(input); err != nil {
		return CommandResult{}, err
	}
	return execute(func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_requests", "decide", permit)
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
		before, err := scanRequest(tx.QueryRowContext(ctx, `SELECT `+requestColumns+` FROM product_requests WHERE product_code=? AND biz_id=?`, identity.ProductCode, input.BizID))
		if err != nil {
			return nil, err
		}
		if before.Revision != input.ExpectedRequestRevision {
			return nil, invalid("product_request_revision_conflict", "需求已变化，请刷新后重试")
		}
		if before.DecisionStatus == "merged" || before.MergedIntoID != nil {
			return nil, invalid("product_request_merged_readonly", "已合并需求只读保留")
		}
		if before.DecisionStatus == "accepted" && strings.TrimSpace(input.ImpactNote) == "" {
			return nil, invalid("product_request_impact_required", "合并已采纳需求须说明对规划及执行的影响")
		}
		target, err := scanRequest(tx.QueryRowContext(ctx, `SELECT `+requestColumns+` FROM product_requests WHERE product_code=? AND biz_id=?`, identity.ProductCode, input.TargetBizID))
		if err != nil {
			return nil, err
		}
		if target.Revision != input.ExpectedTargetRevision {
			return nil, invalid("product_request_revision_conflict", "目标需求已变化，请刷新后重试")
		}
		if target.DecisionStatus == "merged" || target.MergedIntoID != nil {
			return nil, invalid("product_request_merged_readonly", "不能合并到已合并需求")
		}
		// Both endpoints have no outgoing merge edge. Adding this edge cannot
		// create a cycle; archived source records and their evidence stay intact.

		_, err = tx.ExecContext(ctx, `UPDATE product_requests SET decision_status='merged',merged_into_id=?,decision_reason=?,decided_by=?,decided_at=UTC_TIMESTAMP(3),revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND id=?`, target.ID, input.Reason, identity.ActorUID, identity.ActorUID, identity.ProductCode, before.ID)
		if err != nil {
			return nil, err
		}

		_, err = tx.ExecContext(ctx, `UPDATE product_requests SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND id=?`, identity.ActorUID, identity.ProductCode, target.ID)
		if err != nil {
			return nil, err
		}
		// Source changes invalidate assessments through their frozen evidence revision;
		// they never silently reorder the queue or rewrite an existing decision.
		_, err = tx.ExecContext(ctx, `UPDATE product_planning_items i JOIN product_planning_item_requests r ON r.planning_item_id=i.id AND r.product_code=i.product_code SET i.evidence_revision=i.evidence_revision+1,i.revision=i.revision+1,i.updated_by=?,i.updated_at=UTC_TIMESTAMP(3) WHERE r.product_code=? AND r.request_id IN (?,?)`, identity.ActorUID, identity.ProductCode, before.ID, target.ID)
		if err != nil {
			return nil, err
		}
		if err = invalidateSimplePlanConfirmationsForRequestTx(ctx, tx, identity.ProductCode, before.ID, identity.ActorUID, input.Reason); err != nil {
			return nil, err
		}
		if err = invalidateSimplePlanConfirmationsForRequestTx(ctx, tx, identity.ProductCode, target.ID, identity.ActorUID, input.Reason); err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		after, err := scanRequest(tx.QueryRowContext(ctx, `SELECT `+requestColumns+` FROM product_requests WHERE product_code=? AND id=?`, identity.ProductCode, before.ID))
		if err != nil {
			return nil, err
		}
		trusted := integrationoperation.TrustedContext{}
		if len(sourceContext) == 1 {
			trusted = sourceContext[0]
		}
		if err := enqueueFeedbackDecisionTx(ctx, tx, trusted, identity.ActorUID, identity.ProductCode, before.ID, input.TargetBizID, "merged", root.Revision+1); err != nil {
			return nil, err
		}
		if err := enqueueFeedbackProgressTx(ctx, tx, trusted, identity.ActorUID, identity.ProductCode, target.ID, root.Revision+1); err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"before": before, "after": after, "target_before": target, "target_revision": target.Revision + 1, "reason": input.Reason, "impact_note": input.ImpactNote})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'request',?,'merge',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.BizID, identity.ActorUID, after.Revision, changes, identity.IdempotencyKey)
		return map[string]any{"request": after, "target_revision": target.Revision + 1, "workspace_revision": root.Revision + 1}, err
	})
}
