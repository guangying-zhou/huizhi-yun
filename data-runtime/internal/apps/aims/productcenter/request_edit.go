package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

type RequestEdit struct {
	RequestDraft
	BizID                   string `json:"biz_id"`
	ExpectedRequestRevision uint64 `json:"expected_request_revision"`
	Reason                  string `json:"reason"`
}

func ValidateRequestEdit(input RequestEdit) error {
	if err := ValidateRequestDraft(input.RequestDraft); err != nil {
		return err
	}
	id, err := uuid.Parse(input.BizID)
	if err != nil || id.String() != input.BizID || input.ExpectedRequestRevision == 0 {
		return invalid("product_request_revision_required", "必须提供需求标识与需求版本号")
	}
	if !utf8.ValidString(input.Reason) || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 || strings.ContainsRune(input.Reason, '\x00') {
		return invalid("product_request_reason_invalid", "请填写有效的修改原因")
	}
	return nil
}

func EditProductRequest(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input RequestEdit) (CommandResult, error) {
	if identity.Action != "product_requests:edit" {
		return CommandResult{}, invalid("product_command_identity_invalid", "需求修改命令不匹配")
	}
	if err := ValidateRequestEdit(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_requests", "edit", permit)
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
		if before.DecisionStatus == "merged" {
			return nil, invalid("product_request_merged_readonly", "已合并需求只读保留")
		}
		if err = validateRequestComponentTx(ctx, tx, identity.ProductCode, input.ComponentID); err != nil {
			return nil, err
		}
		componentID := before.ComponentID
		if input.ComponentID != nil {
			componentID = input.ComponentID
		}
		_, err = tx.ExecContext(ctx, `UPDATE product_requests SET component_id=?,title=?,problem_statement=?,source_type=?,urgency_level=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND id=?`, nullableRequestComponent(componentID), input.Title, input.ProblemStatement, input.SourceType, input.UrgencyLevel, identity.ActorUID, identity.ProductCode, before.ID)
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
		changes, err := json.Marshal(map[string]any{"before": before, "after": after, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'request',?,'edit',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.BizID, identity.ActorUID, after.Revision, changes, identity.IdempotencyKey)
		return map[string]any{"request": after, "workspace_revision": root.Revision + 1}, err
	})
}
