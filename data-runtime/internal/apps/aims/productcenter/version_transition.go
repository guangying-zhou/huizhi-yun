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

type ProductVersionTransitionInput struct {
	VersionID               int64  `json:"version_id"`
	ExpectedRevision        uint64 `json:"expected_revision"`
	ExpectedVersionRevision uint64 `json:"expected_version_revision"`
	ToStatus                string `json:"to_status"`
	Reason                  string `json:"reason"`
}

func TransitionProductVersion(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionTransitionInput, sourceContext ...integrationoperation.TrustedContext) (CommandResult, error) {
	return transitionProductVersion(ctx, identity, permit, input, sourceContext, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}
func TransitionProductVersionInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionTransitionInput, sourceContext ...integrationoperation.TrustedContext) (CommandResult, error) {
	result, err := transitionProductVersion(ctx, identity, permit, input, sourceContext, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}
func transitionProductVersion(ctx context.Context, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionTransitionInput, sourceContext []integrationoperation.TrustedContext, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {

	if identity.Action != "product_versions:transition" {
		return CommandResult{}, invalid("product_command_identity_invalid", "版本状态命令不匹配")
	}
	if input.VersionID <= 0 || input.ExpectedRevision == 0 || input.ExpectedVersionRevision == 0 || input.ToStatus != "developing" || !utf8.ValidString(input.Reason) || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 || strings.ContainsRune(input.Reason, '\x00') {
		return CommandResult{}, invalid("product_version_transition_invalid", "只能明确记录原因后进入开发")
	}
	return execute(func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_versions", "edit", permit)
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
		version, err := loadProductVersion(ctx, tx, identity.ProductCode, input.VersionID)
		if err != nil {
			return nil, err
		}
		if version.Revision != input.ExpectedVersionRevision {
			return nil, invalid("product_version_revision_conflict", "版本已变化")
		}
		if version.Status != "planning" || version.CurrentReleaseRecordID != nil {
			return nil, invalid("product_version_locked", "只有规划中版本可以进入开发")
		}
		if version.PlanningMode == "simple" {
			var planRevision, scopeRevision uint64
			var plan lightweightPlanRow
			if err = tx.QueryRowContext(ctx, `SELECT goal,DATE_FORMAT(starts_on,'%Y-%m-%d'),available_person_days,reserve_person_days,revision,scope_revision FROM product_version_plans WHERE version_id=? FOR UPDATE`, version.ID).Scan(&plan.Goal, &plan.StartsOn, &plan.Available, &plan.Reserve, &planRevision, &scopeRevision); err != nil {
				return nil, err
			}
			var count int
			if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_version_plan_confirmations WHERE version_id=? AND plan_revision=? AND scope_revision=? AND invalidated_at IS NULL`, version.ID, planRevision, scopeRevision).Scan(&count); err != nil {
				return nil, err
			}
			if count == 0 {
				return nil, invalid("product_version_plan_confirmation_required", "轻量版本须先完成当前有效计划确认")
			}
			plan.Revision, plan.ScopeRevision = planRevision, scopeRevision
			if summary, e := planSummaryTx(ctx, tx, version.ID, plan); e != nil {
				return nil, e
			} else if len(summary.Issues) > 0 {
				return nil, invalid("product_version_plan_confirmation_required", "轻量计划确认已不再满足当前条件")
			}
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_versions SET status='developing',revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, version.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"version_id": version.ID, "product_code": identity.ProductCode, "status": "developing", "revision": version.Revision + 1, "workspace_revision": root.Revision + 1}
		var trusted integrationoperation.TrustedContext
		if len(sourceContext) == 1 {
			trusted = sourceContext[0]
		}
		if err := enqueueProductFeedbackProgressTx(ctx, tx, trusted, identity.ActorUID, identity.ProductCode, root.Revision+1); err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"result": out, "reason": input.Reason, "from_status": version.Status})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'version',?,'transition',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(version.ID, 10), identity.ActorUID, version.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
