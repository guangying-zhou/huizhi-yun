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

type FeatureRequestChange struct {
	ExpectedRevision        uint64 `json:"expected_revision"`
	FeatureBizID            string `json:"feature_biz_id"`
	RequestBizID            string `json:"request_biz_id"`
	ExpectedFeatureRevision uint64 `json:"expected_feature_revision"`
	ExpectedRequestRevision uint64 `json:"expected_request_revision"`
	Operation               string `json:"operation"`
	Reason                  string `json:"reason"`
}

func ValidateFeatureRequestChange(input FeatureRequestChange) error {
	if input.ExpectedRevision == 0 || input.ExpectedFeatureRevision == 0 || input.ExpectedRequestRevision == 0 {
		return invalid("product_revision_required", "必须提供产品、功能和需求版本号")
	}
	for _, value := range []string{input.FeatureBizID, input.RequestBizID} {
		id, err := uuid.Parse(value)
		if err != nil || id.String() != value {
			return invalid("product_feature_request_id_invalid", "功能或需求标识无效")
		}
	}
	if input.Operation != "link" && input.Operation != "unlink" {
		return invalid("product_feature_request_operation_invalid", "请选择关联或解除关联")
	}
	if !utf8.ValidString(input.Reason) || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 || strings.ContainsRune(input.Reason, '\x00') {
		return invalid("product_feature_reason_invalid", "请填写有效的关联变更原因")
	}
	return nil
}

// The relation is maintained as request evidence; it does not select delivery scope.
func ChangeFeatureRequest(ctx context.Context, db *sql.DB, identity CommandIdentity, requestPermit, featurePermit AuthorizationPermit, input FeatureRequestChange, sourceContext ...integrationoperation.TrustedContext) (CommandResult, error) {
	return changeFeatureRequest(ctx, identity, requestPermit, featurePermit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	}, sourceContext...)
}
func ChangeFeatureRequestInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, requestPermit, featurePermit AuthorizationPermit, input FeatureRequestChange, sourceContext ...integrationoperation.TrustedContext) (CommandResult, error) {
	result, err := changeFeatureRequest(ctx, identity, requestPermit, featurePermit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	}, sourceContext...)
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}
func changeFeatureRequest(ctx context.Context, identity CommandIdentity, requestPermit, featurePermit AuthorizationPermit, input FeatureRequestChange, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error), sourceContext ...integrationoperation.TrustedContext) (CommandResult, error) {
	if identity.Action != "product_features:request-link" {
		return CommandResult{}, invalid("product_command_identity_invalid", "功能需求关联命令不匹配")
	}
	if err := ValidateFeatureRequestChange(input); err != nil {
		return CommandResult{}, err
	}
	return execute(func(ctx context.Context, tx *sql.Tx) error {
		if err := AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_requests", "edit", requestPermit); err != nil {
			return err
		}
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_features", "view", featurePermit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "产品空间已归档")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品空间已变化，请重新读取")
		}
		feature, err := scanFeature(tx.QueryRowContext(ctx, `SELECT `+featureColumns+` FROM product_features WHERE product_code=? AND biz_id=?`, identity.ProductCode, input.FeatureBizID))
		if err != nil {
			return nil, err
		}
		request, err := scanRequest(tx.QueryRowContext(ctx, `SELECT `+requestColumns+` FROM product_requests WHERE product_code=? AND biz_id=?`, identity.ProductCode, input.RequestBizID))
		if err != nil {
			return nil, err
		}
		if feature.Revision != input.ExpectedFeatureRevision {
			return nil, invalid("product_feature_revision_conflict", "功能已变化，请重新读取")
		}
		if request.Revision != input.ExpectedRequestRevision {
			return nil, invalid("product_request_revision_conflict", "需求已变化，请重新读取")
		}
		if request.DecisionStatus == "merged" {
			return nil, invalid("product_request_merged_readonly", "已合并需求只读保留")
		}
		if input.Operation == "link" && feature.Lifecycle == "deprecated" {
			return nil, invalid("product_feature_request_state_invalid", "不能新关联已弃用功能")
		}
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_request_features WHERE request_id=? AND product_feature_id=? AND product_code=?`, request.ID, feature.ID, identity.ProductCode).Scan(&count); err != nil {
			return nil, err
		}
		linked := input.Operation == "link"
		if linked == (count != 0) {
			return nil, invalid("product_feature_request_state_conflict", "关联状态已变化，请重新读取")
		}
		if linked {
			_, err = tx.ExecContext(ctx, `INSERT INTO product_request_features(product_code,request_id,product_feature_id,created_by,created_at) VALUES(?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, request.ID, feature.ID, identity.ActorUID)
		} else {
			_, err = tx.ExecContext(ctx, `DELETE FROM product_request_features WHERE product_code=? AND request_id=? AND product_feature_id=?`, identity.ProductCode, request.ID, feature.ID)
		}
		if err != nil {
			return nil, err
		}
		for _, statement := range []struct {
			sql  string
			args []any
		}{
			{`UPDATE product_requests SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, []any{identity.ActorUID, request.ID}},
			{`UPDATE product_features SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, []any{identity.ActorUID, feature.ID}},
			{`UPDATE product_planning_items i JOIN product_planning_item_requests r ON r.planning_item_id=i.id AND r.product_code=i.product_code SET i.evidence_revision=i.evidence_revision+1,i.revision=i.revision+1,i.updated_by=?,i.updated_at=UTC_TIMESTAMP(3) WHERE r.product_code=? AND r.request_id=?`, []any{identity.ActorUID, identity.ProductCode, request.ID}},
			{`UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, []any{identity.ActorUID, identity.ProductCode}},
		} {
			if _, err = tx.ExecContext(ctx, statement.sql, statement.args...); err != nil {
				return nil, err
			}
		}
		var trusted integrationoperation.TrustedContext
		if len(sourceContext) == 1 {
			trusted = sourceContext[0]
		}
		if err := enqueueFeedbackProgressTx(ctx, tx, trusted, identity.ActorUID, identity.ProductCode, request.ID, root.Revision+1); err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"feature_biz_id": feature.BizID, "request_biz_id": request.BizID, "before_linked": count != 0, "after_linked": linked, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'feature',?,'request-link',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, feature.BizID, identity.ActorUID, feature.Revision+1, changes, identity.IdempotencyKey)
		return map[string]any{"feature_biz_id": feature.BizID, "request_biz_id": request.BizID, "linked": linked, "workspace_revision": root.Revision + 1, "feature_revision": feature.Revision + 1, "request_revision": request.Revision + 1}, err
	})
}
