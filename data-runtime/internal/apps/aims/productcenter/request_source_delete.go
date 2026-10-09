package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"strings"
	"unicode/utf8"
)

type RequestSourceDelete struct {
	BizID                   string `json:"biz_id"`
	SourceID                int64  `json:"source_id"`
	ExpectedRevision        uint64 `json:"expected_revision"`
	ExpectedRequestRevision uint64 `json:"expected_request_revision"`
	ExpectedSourceRevision  uint64 `json:"expected_source_revision"`
	Reason                  string `json:"reason"`
}

func ValidateRequestSourceDelete(input RequestSourceDelete) error {
	id, err := uuid.Parse(input.BizID)
	if err != nil || id.String() != input.BizID || input.SourceID < 1 || input.ExpectedRevision == 0 || input.ExpectedRequestRevision == 0 || input.ExpectedSourceRevision == 0 {
		return invalid("product_source_revision_required", "必须提供需求、证据标识与版本号")
	}
	if !utf8.ValidString(input.Reason) || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 || strings.ContainsRune(input.Reason, '\x00') {
		return invalid("product_source_reason_invalid", "请填写有效删除原因")
	}
	return nil
}
func DeleteManualRequestSource(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input RequestSourceDelete) (CommandResult, error) {
	return deleteManualRequestSource(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}

// DeleteManualRequestSourceInTransaction reuses the owning-domain command; the caller owns commit.
func DeleteManualRequestSourceInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input RequestSourceDelete) (CommandResult, error) {
	result, err := deleteManualRequestSource(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}

func deleteManualRequestSource(ctx context.Context, identity CommandIdentity, permit AuthorizationPermit, input RequestSourceDelete, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {
	if identity.Action != "product_requests:source-delete" {
		return CommandResult{}, invalid("product_command_identity_invalid", "来源删除命令不匹配")
	}
	if err := ValidateRequestSourceDelete(input); err != nil {
		return CommandResult{}, err
	}
	return execute(func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_requests", "delete", permit)
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
		request, err := scanRequest(tx.QueryRowContext(ctx, `SELECT `+requestColumns+` FROM product_requests WHERE product_code=? AND biz_id=?`, identity.ProductCode, input.BizID))
		if err != nil {
			return nil, err
		}
		if request.Revision != input.ExpectedRequestRevision {
			return nil, invalid("product_request_revision_conflict", "需求已变化，请刷新后重试")
		}
		if request.DecisionStatus == "merged" {
			return nil, invalid("product_request_merged_readonly", "已合并需求只读保留")
		}
		var before RequestSourceRecord
		err = tx.QueryRowContext(ctx, `SELECT id,source_app,source_type,source_biz_id,source_note,DATE_FORMAT(evidence_date,'%Y-%m-%d'),evidence_kind,direction,verification_status,revision,created_by,CONCAT(LEFT(DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%f'),23),'Z') FROM product_request_sources WHERE request_id=? AND id=?`, request.ID, input.SourceID).Scan(&before.ID, &before.SourceApp, &before.SourceType, &before.SourceBizID, &before.Note, &before.EvidenceDate, &before.Kind, &before.Direction, &before.VerificationStatus, &before.Revision, &before.CreatedBy, &before.CreatedAt)
		if err != nil {
			return nil, err
		}
		if before.Revision != input.ExpectedSourceRevision {
			return nil, invalid("product_source_revision_conflict", "证据已变化，请刷新后重试")
		}
		if before.SourceType != "manual" || before.SourceApp != nil || before.SourceBizID != nil || before.VerificationStatus != "unverified" {
			return nil, invalid("product_source_external_contract_required", "外部或已验证引用须通过其集成契约维护")
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM product_request_sources WHERE request_id=? AND id=?`, request.ID, input.SourceID)
		if err != nil {
			return nil, err
		}

		_, err = tx.ExecContext(ctx, `UPDATE product_requests SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND product_code=?`, identity.ActorUID, request.ID, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE product_planning_items i JOIN product_planning_item_requests r ON r.planning_item_id=i.id AND r.product_code=i.product_code SET i.evidence_revision=i.evidence_revision+1,i.revision=i.revision+1,i.updated_by=?,i.updated_at=UTC_TIMESTAMP(3) WHERE r.product_code=? AND r.request_id=?`, identity.ActorUID, identity.ProductCode, request.ID)
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"before": before, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'request_source',?,'delete',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.SourceID, identity.ActorUID, before.Revision+1, changes, identity.IdempotencyKey)
		return map[string]any{"source_id": input.SourceID, "deleted": true, "request_revision": request.Revision + 1, "workspace_revision": root.Revision + 1}, err
	})
}
