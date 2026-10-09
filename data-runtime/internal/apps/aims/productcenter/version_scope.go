package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"strconv"
	"strings"
	"unicode/utf8"
)

type ProductVersionScopeDraft struct {
	DeferredFrom *ProductVersionScopeDeferralSource `json:"deferred_from,omitempty"`
	PlanningDeliveryCheck
	VersionID               int64  `json:"version_id"`
	ExpectedVersionRevision uint64 `json:"expected_version_revision"`
	Title                   string `json:"title"`
	Description             string `json:"description"`
	AcceptanceCriteria      string `json:"acceptance_criteria"`
	ChangeType              string `json:"change_type"`
	Reason                  string `json:"reason"`
}

func ValidateProductVersionScopeDraft(v ProductVersionScopeDraft) error {
	if source := v.DeferredFrom; source != nil && (source.VersionID <= 0 || source.ScopeID <= 0 || source.VersionID == v.VersionID || source.ExpectedVersionRevision == 0 || source.ExpectedScopeRevision == 0) {
		return invalid("product_version_deferral_invalid", "延期必须提供另一版本的原范围及完整修订")
	}

	if err := ValidatePlanningDeliveryCheck(v.PlanningDeliveryCheck); err != nil {
		return err
	}
	if v.VersionID <= 0 || v.ExpectedVersionRevision == 0 {
		return invalid("product_version_revision_required", "必须提供目标版本与版本号")
	}
	for _, field := range []struct {
		value    string
		max      int
		required bool
	}{{v.Title, 255, true}, {v.Description, 10000, false}, {v.AcceptanceCriteria, 10000, true}, {v.Reason, 2000, true}} {
		if !utf8.ValidString(field.value) || utf8.RuneCountInString(field.value) > field.max || strings.ContainsRune(field.value, '\x00') || (field.required && strings.TrimSpace(field.value) == "") {
			return invalid("product_version_scope_fields_invalid", "范围标题、验收标准或修改原因无效")
		}
	}
	switch v.ChangeType {
	case "new", "enhancement", "fix", "retirement":
		return nil
	}
	return invalid("product_version_change_type_invalid", "范围变更类型无效")
}

func CreateProductVersionScope(ctx context.Context, db *sql.DB, identity CommandIdentity, versionPermit, planningPermit AuthorizationPermit, input ProductVersionScopeDraft, sourceContext ...integrationoperation.TrustedContext) (CommandResult, error) {
	if identity.Action != "product_versions:scope-create" {
		return CommandResult{}, invalid("product_command_identity_invalid", "版本范围命令不匹配")
	}
	if err := ValidateProductVersionScopeDraft(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		if err := AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_versions", "edit", versionPermit); err != nil {
			return err
		}
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "prioritize", planningPermit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		basis, err := ValidatePlanningDeliveryTx(ctx, tx, identity.ProductCode, input.PlanningDeliveryCheck)
		if err != nil {
			return nil, err
		}
		version, err := loadProductVersion(ctx, tx, identity.ProductCode, input.VersionID)
		if err != nil {
			return nil, err
		}
		if version.Revision != input.ExpectedVersionRevision {
			return nil, invalid("product_version_revision_conflict", "版本已变化，请刷新")
		}
		if version.Status != "planning" && version.Status != "developing" {
			return nil, invalid("product_version_locked", "已发布或归档版本不能新增范围")
		}
		if version.PlanningMode == "simple" {
			return nil, invalid("product_version_plan_locked", "轻量版本范围须通过计划工作区修改")
		}
		var featureID sql.NullInt64
		var featureLifecycle sql.NullString
		err = tx.QueryRowContext(ctx, `SELECT i.feature_id,f.lifecycle FROM product_planning_items i LEFT JOIN product_features f ON f.id=i.feature_id AND f.product_code=i.product_code WHERE i.id=? AND i.product_code=?`, basis.ItemID, identity.ProductCode).Scan(&featureID, &featureLifecycle)
		if err != nil {
			return nil, err
		}
		if featureID.Valid && (!featureLifecycle.Valid || featureLifecycle.String == "deprecated") {
			return nil, invalid("product_version_scope_feature_invalid", "关联功能已弃用或不可用")
		}
		var count int
		if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_version_features WHERE planning_item_id=? OR (version_id=? AND product_feature_id=?)`, basis.ItemID, version.ID, featureID).Scan(&count); err != nil {
			return nil, err
		}
		if count > 0 {
			return nil, invalid("product_version_scope_conflict", "事项已排入版本，或同版本已包含该长期功能；请合并范围后再安排")
		}
		var deferredFrom any
		if input.DeferredFrom != nil {
			if err := prepareVersionScopeDeferral(ctx, tx, identity.ProductCode, input.DeferredFrom); err != nil {
				return nil, err
			}
			deferredFrom = input.DeferredFrom.ScopeID
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO product_version_features(version_id,title,description,status,is_public,sort_order,created_by,created_at,updated_at,product_feature_id,planning_item_id,change_type,acceptance_criteria,deferred_from_feature_id) VALUES(?,?,?,'planned',0,0,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),?,?,?,?,?)`, version.ID, input.Title, input.Description, identity.ActorUID, featureID, basis.ItemID, input.ChangeType, input.AcceptanceCriteria, deferredFrom)
		if err != nil {
			return nil, err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_versions SET revision=revision+1,scope_revision=scope_revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, version.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_items SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, identity.ActorUID, basis.ItemID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"id": id, "version_id": version.ID, "product_code": identity.ProductCode, "planning_item_biz_id": basis.ItemBizID, "status": "planned", "revision": version.Revision + 1, "scope_revision": version.ScopeRevision + 1, "workspace_revision": input.ExpectedRevision + 1, "item_revision": input.ExpectedItemRevision + 1}
		var trusted integrationoperation.TrustedContext
		if len(sourceContext) == 1 {
			trusted = sourceContext[0]
		}
		if err := enqueueProductFeedbackProgressTx(ctx, tx, trusted, identity.ActorUID, identity.ProductCode, input.ExpectedRevision+1); err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"after": out, "input": input, "decision_basis": basis})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'version',?,'scope-create',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(version.ID, 10), identity.ActorUID, version.Revision+1, changes, identity.IdempotencyKey)
		if err != nil {
			return nil, err
		}
		if source := input.DeferredFrom; source != nil {
			_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'version',?,'scope-defer',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(source.VersionID, 10), identity.ActorUID, source.ExpectedVersionRevision+1, changes, identity.IdempotencyKey)
		}
		return out, err
	})
}
