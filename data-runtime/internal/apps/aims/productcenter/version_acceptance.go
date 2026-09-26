package productcenter

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"
)

// These are explicit human reviews, not claims that project execution or
// defect coverage has been automatically verified by the product module.
type VersionAcceptanceCheck struct {
	Code     string `json:"code"`
	Evidence string `json:"evidence"`
}
type VersionAcceptanceException struct {
	Code           string `json:"code"`
	Reason         string `json:"reason"`
	ResponsibleUID string `json:"responsible_uid"`
	Impact         string `json:"impact"`
}
type ProductVersionAcceptanceInput struct {
	ExpectedReviewHash      string                       `json:"expected_review_hash"`
	VersionID               int64                        `json:"version_id"`
	ExpectedRevision        uint64                       `json:"expected_revision"`
	ExpectedVersionRevision uint64                       `json:"expected_version_revision"`
	ExpectedScopeRevision   uint64                       `json:"expected_scope_revision"`
	Checks                  []VersionAcceptanceCheck     `json:"checks"`
	Exceptions              []VersionAcceptanceException `json:"exceptions"`
}

func ValidateProductVersionAcceptance(input ProductVersionAcceptanceInput) error {
	if input.VersionID <= 0 || input.ExpectedRevision == 0 || input.ExpectedVersionRevision == 0 || input.ExpectedScopeRevision == 0 {
		return invalid("product_version_acceptance_input_invalid", "验收需要完整版本信息")
	}
	digest, err := hex.DecodeString(input.ExpectedReviewHash)
	if err != nil || len(digest) != 32 || hex.EncodeToString(digest) != input.ExpectedReviewHash {
		return invalid("product_version_review_hash_invalid", "请提供当前验收预览标识")
	}
	text := func(s string, max int) bool {
		return strings.TrimSpace(s) != "" && utf8.ValidString(s) && utf8.RuneCountInString(s) <= max && !strings.ContainsRune(s, '\x00')
	}
	required := map[string]bool{"execution-review": false, "blocking-defects-review": false, "release-readiness": false}
	if len(input.Checks) != len(required) {
		return invalid("product_version_acceptance_checks_required", "必须逐项核验执行计划、阻塞缺陷与发布准备")
	}
	for _, check := range input.Checks {
		seen, ok := required[check.Code]
		if !ok || seen || !text(check.Evidence, 10000) {
			return invalid("product_version_acceptance_checks_required", "核验项缺失、重复或缺少依据")
		}
		required[check.Code] = true
	}
	if input.Exceptions == nil || len(input.Exceptions) > 50 {
		return invalid("product_version_acceptance_exceptions_invalid", "必须明确提交例外清单，最多50项")
	}
	seen := map[string]bool{}
	for _, exception := range input.Exceptions {
		if !text(exception.Code, 64) || seen[exception.Code] || !text(exception.Reason, 2000) || !text(exception.ResponsibleUID, 64) || exception.ResponsibleUID != strings.TrimSpace(exception.ResponsibleUID) || !text(exception.Impact, 2000) {
			return invalid("product_version_acceptance_exceptions_invalid", "例外须包含唯一编号、原因、责任人及影响")
		}
		seen[exception.Code] = true
	}
	return nil
}

type VersionAcceptanceScope struct {
	Category              *string `json:"category"`
	IsPublic              bool    `json:"is_public"`
	SortOrder             int     `json:"sort_order"`
	DeferredFromFeatureID *int64  `json:"deferred_from_feature_id"`
	ID                    int64   `json:"id"`
	Title                 string  `json:"title"`
	Description           *string `json:"description"`
	Status                string  `json:"status"`
	AcceptanceCriteria    *string `json:"acceptance_criteria"`
	ProductFeatureBizID   *string `json:"product_feature_biz_id"`
	PlanningItemBizID     *string `json:"planning_item_biz_id"`
	ChangeType            *string `json:"change_type"`
	LegacyUnscored        bool    `json:"legacy_unscored"`
}

func loadVersionAcceptanceScopes(ctx context.Context, tx *sql.Tx, code string, versionID int64) ([]VersionAcceptanceScope, error) {
	rows, err := tx.QueryContext(ctx, `SELECT vf.id,vf.title,vf.description,vf.status,vf.acceptance_criteria,f.biz_id,i.biz_id,vf.change_type,vf.planning_item_id IS NULL,vf.product_feature_id IS NOT NULL,vf.planning_item_id IS NOT NULL,vf.category,vf.is_public,vf.sort_order,vf.deferred_from_feature_id FROM product_version_features vf LEFT JOIN product_features f ON f.id=vf.product_feature_id AND f.product_code=? LEFT JOIN product_planning_items i ON i.id=vf.planning_item_id AND i.product_code=? WHERE vf.version_id=? ORDER BY vf.id FOR UPDATE`, code, code, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []VersionAcceptanceScope{}
	for rows.Next() {
		var item VersionAcceptanceScope
		var hasFeature, hasPlanning bool
		if err = rows.Scan(&item.ID, &item.Title, &item.Description, &item.Status, &item.AcceptanceCriteria, &item.ProductFeatureBizID, &item.PlanningItemBizID, &item.ChangeType, &item.LegacyUnscored, &hasFeature, &hasPlanning, &item.Category, &item.IsPublic, &item.SortOrder, &item.DeferredFromFeatureID); err != nil {
			return nil, err
		}
		if (hasFeature && item.ProductFeatureBizID == nil) || (hasPlanning && item.PlanningItemBizID == nil) {
			return nil, invalid("product_version_scope_binding_invalid", "版本范围存在无效或跨产品关联，请先核对")
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// The immutable checklist freezes the full scope that was reviewed. A later
// scope revision requires a new acceptance, never an update to this record.
func AcceptProductVersion(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionAcceptanceInput, executionReviewHash ...string) (CommandResult, error) {
	return acceptProductVersion(ctx, identity, permit, input, executionReviewHash, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}

// AcceptProductVersionInTransaction leaves successful commit to the caller.
func AcceptProductVersionInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionAcceptanceInput, executionReviewHash ...string) (CommandResult, error) {
	result, err := acceptProductVersion(ctx, identity, permit, input, executionReviewHash, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}

func acceptProductVersion(ctx context.Context, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionAcceptanceInput, executionReviewHash []string, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {
	if identity.Action != "product_versions:accept" {
		return CommandResult{}, invalid("product_command_identity_invalid", "版本验收命令不匹配")
	}
	if err := ValidateProductVersionAcceptance(input); err != nil {
		return CommandResult{}, err
	}
	return execute(func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_versions", "accept", permit)
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
		version, err := loadProductVersion(ctx, tx, identity.ProductCode, input.VersionID)
		if err != nil {
			return nil, err
		}
		if version.Revision != input.ExpectedVersionRevision || version.ScopeRevision != input.ExpectedScopeRevision {
			return nil, invalid("product_version_revision_conflict", "版本或范围已变化，请重新核验")
		}
		if version.BusinessOwnerUID == nil || *version.BusinessOwnerUID != identity.ActorUID {
			return nil, invalid("product_version_owner_required", "须由版本业务负责人记录验收")
		}
		if err := validateVersionOwnerTx(ctx, tx, identity.ProductCode, *version.BusinessOwnerUID); err != nil {
			return nil, err
		}
		if version.Status != "planning" && version.Status != "developing" {
			return nil, invalid("product_version_locked", "已发布或归档版本不能重新验收")
		}
		scopes, err := loadVersionAcceptanceScopes(ctx, tx, identity.ProductCode, version.ID)
		if err != nil {
			return nil, err
		}
		for _, scope := range scopes {
			if scope.Status != "delivered" && scope.Status != "deferred" {
				return nil, invalid("product_version_scope_unresolved", "存在未交付且未明确顺延的版本范围")
			}
		}
		execution, err := loadVersionExecution(ctx, tx, version.ID, scopes)
		if err != nil {
			return nil, err
		}
		reviewHash, err := versionAcceptanceReviewHash(version, scopes, execution)
		if err != nil {
			return nil, err
		}
		if len(executionReviewHash) > 0 && executionReviewHash[0] != "" && executionReviewHash[0] != reviewHash {
			return nil, invalid("product_version_review_changed", "项目查看权限核验后的执行范围已变化，请重新核验")
		}
		if reviewHash != input.ExpectedReviewHash {
			return nil, invalid("product_version_review_changed", "版本范围或执行事实已变化，请重新预览核验")
		}
		if err = requireVersionExecutionExceptions(execution, input.Exceptions); err != nil {
			return nil, err
		}
		checklist, err := json.Marshal(map[string]any{"version": 1, "review_mode": "manual", "reviewed_version": version, "scope_snapshot": scopes, "execution_snapshot": execution, "checks": input.Checks})
		if err != nil {
			return nil, err
		}
		exceptions, err := json.Marshal(input.Exceptions)
		if err != nil {
			return nil, err
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO product_version_acceptances(version_id,scope_revision,accepted_by,accepted_at,checklist,exceptions) VALUES(?,?,?,UTC_TIMESTAMP(3),?,?)`, version.ID, version.ScopeRevision, identity.ActorUID, checklist, exceptions)
		if err != nil {
			return nil, err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_versions SET revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, version.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"acceptance_id": id, "version_id": version.ID, "product_code": identity.ProductCode, "accepted_by": identity.ActorUID, "scope_revision": version.ScopeRevision, "revision": version.Revision + 1, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(out)
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'version',?,'accept',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(version.ID, 10), identity.ActorUID, version.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}

func versionAcceptanceReviewHash(version ProductVersionRecord, scopes []VersionAcceptanceScope, execution VersionExecutionSnapshot) (string, error) {
	content, err := json.Marshal(struct {
		Version   ProductVersionRecord     `json:"version"`
		Scopes    []VersionAcceptanceScope `json:"scopes"`
		Execution VersionExecutionSnapshot `json:"execution"`
	}{version, scopes, execution})
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(content)
	return hex.EncodeToString(digest[:]), nil
}
