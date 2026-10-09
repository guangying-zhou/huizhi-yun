package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type RequestDecision struct {
	BizID                   string `json:"biz_id"`
	ExpectedRevision        uint64 `json:"expected_revision"`
	ExpectedRequestRevision uint64 `json:"expected_request_revision"`
	Status                  string `json:"status"`
	Reason                  string `json:"reason"`
	ImpactNote              string `json:"impact_note"`
}

func ValidateRequestDecision(input RequestDecision) error {
	id, err := uuid.Parse(input.BizID)
	if err != nil || id.String() != input.BizID || input.ExpectedRevision == 0 || input.ExpectedRequestRevision == 0 {
		return invalid("product_request_revision_required", "必须提供需求标识与双版本号")
	}
	switch input.Status {
	case "evaluating", "accepted", "deferred", "rejected":
	default:
		return invalid("product_request_decision_invalid", "不支持的评审决定")
	}
	for _, text := range []string{input.Reason, input.ImpactNote} {
		if !utf8.ValidString(text) || utf8.RuneCountInString(text) > 2000 || strings.ContainsRune(text, '\x00') {
			return invalid("product_request_reason_invalid", "决定说明无效")
		}
	}
	return nil
}

func ValidateRequestTransition(from string, input RequestDecision) error {
	allowed := false
	switch from {
	case "submitted":
		allowed = input.Status == "evaluating"
	case "evaluating":
		allowed = input.Status == "accepted" || input.Status == "deferred" || input.Status == "rejected"
	case "deferred":
		allowed = input.Status == "evaluating"
	case "accepted":
		allowed = input.Status == "evaluating" || input.Status == "rejected"
	}
	if !allowed {
		return invalid("product_request_state_conflict", "当前需求状态不允许此决定")
	}
	if from != "submitted" && strings.TrimSpace(input.Reason) == "" {
		return invalid("product_request_reason_invalid", "请填写决定原因")
	}
	if from == "accepted" && strings.TrimSpace(input.ImpactNote) == "" {
		return invalid("product_request_impact_required", "撤回采纳须说明对已规划或执行工作的影响")
	}
	return nil
}

func DecideProductRequest(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input RequestDecision, sourceContext ...integrationoperation.TrustedContext) (CommandResult, error) {
	return decideProductRequest(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	}, sourceContext...)
}

// DecideProductRequestInTransaction reuses the owning-domain command; the caller owns commit.
func DecideProductRequestInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input RequestDecision, sourceContext ...integrationoperation.TrustedContext) (CommandResult, error) {
	result, err := decideProductRequest(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	}, sourceContext...)
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}

func decideProductRequest(ctx context.Context, identity CommandIdentity, permit AuthorizationPermit, input RequestDecision, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error), sourceContext ...integrationoperation.TrustedContext) (CommandResult, error) {
	if identity.Action != "product_requests:decide" {
		return CommandResult{}, invalid("product_command_identity_invalid", "需求决策命令不匹配")
	}
	if err := ValidateRequestDecision(input); err != nil {
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
		if err := ValidateRequestTransition(before.DecisionStatus, input); err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE product_requests SET decision_status=?,decision_reason=?,decided_by=?,decided_at=UTC_TIMESTAMP(3),revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND id=?`, input.Status, input.Reason, identity.ActorUID, identity.ActorUID, identity.ProductCode, before.ID)
		if err != nil {
			return nil, err
		}

		// Source changes invalidate assessments through their frozen evidence revision;
		// they never silently reorder the queue or rewrite an existing decision.
		_, err = tx.ExecContext(ctx, `UPDATE product_planning_items i JOIN product_planning_item_requests r ON r.planning_item_id=i.id AND r.product_code=i.product_code SET i.evidence_revision=i.evidence_revision+1,i.revision=i.revision+1,i.updated_by=?,i.updated_at=UTC_TIMESTAMP(3) WHERE r.product_code=? AND r.request_id=?`, identity.ActorUID, identity.ProductCode, before.ID)
		if err != nil {
			return nil, err
		}
		if err = invalidateSimplePlanConfirmationsForRequestTx(ctx, tx, identity.ProductCode, before.ID, identity.ActorUID, input.Reason); err != nil {
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
		if err := enqueueFeedbackDecisionTx(ctx, tx, trusted, identity.ActorUID, identity.ProductCode, before.ID, input.BizID, input.Status, root.Revision+1); err != nil {
			return nil, err
		}
		if err := enqueueFeedbackProgressTx(ctx, tx, trusted, identity.ActorUID, identity.ProductCode, before.ID, root.Revision+1); err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"before": before, "after": after, "reason": input.Reason, "impact_note": input.ImpactNote})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'request',?,'decide',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.BizID, identity.ActorUID, after.Revision, changes, identity.IdempotencyKey)
		return map[string]any{"request": after, "workspace_revision": root.Revision + 1}, err
	})
}
