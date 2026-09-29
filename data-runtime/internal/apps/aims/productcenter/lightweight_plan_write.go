package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"strconv"
	"strings"
)

func requireSimpleWritable(v ProductVersionRecord) error {
	if v.Status != "planning" && v.Status != "developing" {
		return invalid("product_version_plan_locked", "已发布或归档版本不能修改计划")
	}
	return nil
}
func invalidateSimplePlanTx(ctx context.Context, tx *sql.Tx, versionID int64, uid, reason string) error {
	_, e := tx.ExecContext(ctx, `UPDATE product_version_plan_confirmations SET invalidated_by=?,invalidated_at=UTC_TIMESTAMP(3),invalidation_reason=? WHERE version_id=? AND invalidated_at IS NULL`, uid, reason, versionID)
	return e
}
func EditLightweightVersionPlan(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input LightweightVersionPlanEdit) (CommandResult, error) {
	return editLightweightVersionPlan(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}

// EditLightweightVersionPlanInTransaction shares the owning-domain command with a caller-owned transaction.
func EditLightweightVersionPlanInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input LightweightVersionPlanEdit) (CommandResult, error) {
	result, err := editLightweightVersionPlan(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}

func editLightweightVersionPlan(ctx context.Context, identity CommandIdentity, permit AuthorizationPermit, input LightweightVersionPlanEdit, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {
	if identity.Action != "product_versions:plan-edit" {
		return CommandResult{}, invalid("product_command_identity_invalid", "计划编辑命令不匹配")
	}
	if input.VersionID < 1 || !validPlanText(input.Goal, 10000, false) || parsePlanDate(input.StartsOn) != nil || parsePlanDate(input.PlannedReleaseDate) != nil {
		return CommandResult{}, invalid("product_version_plan_invalid", "计划字段无效")
	}
	if input.AvailablePersonDays != nil && *input.AvailablePersonDays < 0 || input.ReservePersonDays != nil && *input.ReservePersonDays < 0 {
		return CommandResult{}, invalid("product_version_plan_invalid", "人日不能为负")
	}
	return execute(func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_versions", "edit", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, e := loadWorkspace(ctx, tx, identity.ProductCode)
		if e != nil {
			return nil, e
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化")
		}
		v, p, e := loadSimplePlanTx(ctx, tx, identity.ProductCode, input.VersionID)
		if e != nil {
			return nil, e
		}
		if e = requireSimpleWritable(v); e != nil {
			return nil, e
		}
		if e = planExpected(v, p, input.ExpectedRevision, input.ExpectedVersionRevision, input.ExpectedPlanRevision); e != nil {
			return nil, e
		}
		confirmed, e := planConfirmationTx(ctx, tx, input.VersionID, p)
		if e != nil {
			return nil, e
		}
		if confirmed != nil && strings.TrimSpace(input.Reason) == "" {
			return nil, invalid("product_version_plan_reason_required", "已确认计划变更须说明原因")
		}
		if input.AvailablePersonDays != nil && input.ReservePersonDays != nil && *input.ReservePersonDays > *input.AvailablePersonDays {
			return nil, invalid("product_version_plan_invalid", "预留不能大于可用人日")
		}
		if e = invalidateSimplePlanTx(ctx, tx, input.VersionID, identity.ActorUID, input.Reason); e != nil {
			return nil, e
		}
		_, e = tx.ExecContext(ctx, `UPDATE product_version_plans SET goal=?,starts_on=?,available_person_days=?,reserve_person_days=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE version_id=?`, nullablePlanText(input.Goal), nullablePlanDate(input.StartsOn), nullablePlanAmount(input.AvailablePersonDays), nullablePlanAmount(input.ReservePersonDays), identity.ActorUID, input.VersionID)
		if e != nil {
			return nil, e
		}
		_, e = tx.ExecContext(ctx, `UPDATE product_versions SET planned_release_date=?,revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, nullablePlanDate(input.PlannedReleaseDate), input.VersionID)
		if e != nil {
			return nil, e
		}
		_, e = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode)
		if e != nil {
			return nil, e
		}
		out := map[string]any{"version_id": input.VersionID, "workspace_revision": root.Revision + 1, "version_revision": v.Revision + 1, "plan_revision": p.Revision + 1, "scope_revision": p.ScopeRevision}
		return out, lightweightPlanAudit(ctx, tx, identity, input.VersionID, "plan-edit", v.Revision+1, map[string]any{"input": input, "result": out})
	})
}
func nullablePlanText(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}
func nullablePlanDate(s string) any {
	if s == "" {
		return nil
	}
	return s
}
func nullablePlanAmount(v *Hundredths) any {
	if v == nil {
		return nil
	}
	return v.String()
}

func ListLightweightVersionPlanItems(ctx context.Context, db *sql.DB, code, uid string, versionID int64, permit, requestPermit AuthorizationPermit, q LightweightVersionPlanItemQuery) (LightweightVersionPlanItemPage, error) {
	out := LightweightVersionPlanItemPage{Items: []LightweightVersionPlanItemRecord{}, Page: q.Page, PageSize: q.PageSize}
	if q.Page < 1 || q.PageSize < 1 || q.PageSize > 100 || !validPlanText(q.Keyword, 200, false) {
		return out, invalid("product_version_plan_scope_invalid", "范围分页或搜索无效")
	}
	tx, e := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	out, e = ListLightweightVersionPlanItemsInTransaction(ctx, tx, code, uid, versionID, permit, requestPermit, q)
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}

// ListLightweightVersionPlanItemsInTransaction uses the caller's generation-fenced transaction.
// The owning authorization and query semantics are shared with the legacy entry.
func ListLightweightVersionPlanItemsInTransaction(ctx context.Context, tx *sql.Tx, code, uid string, versionID int64, permit, requestPermit AuthorizationPermit, q LightweightVersionPlanItemQuery) (LightweightVersionPlanItemPage, error) {
	out := LightweightVersionPlanItemPage{Items: []LightweightVersionPlanItemRecord{}, Page: q.Page, PageSize: q.PageSize}
	if q.Page < 1 || q.PageSize < 1 || q.PageSize > 100 || !validPlanText(q.Keyword, 200, false) {
		return out, invalid("product_version_plan_scope_invalid", "范围分页或搜索无效")
	}
	if tx == nil {
		return out, invalid("product_command_configuration", "缺少产品读取事务")
	}
	var e error
	if e = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_versions", "view", permit); e != nil {
		return out, e
	}
	if e = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_requests", "view", requestPermit); e != nil {
		return out, e
	}
	v, p, e := loadSimplePlanTx(ctx, tx, code, versionID)
	if e != nil {
		return out, e
	}
	where := ` FROM product_version_plan_scopes s JOIN product_version_features f ON f.id=s.version_feature_id JOIN product_planning_items i ON i.id=s.planning_item_id JOIN product_requests r ON r.id=s.request_id LEFT JOIN product_components c ON c.id=r.component_id AND c.product_code=r.product_code WHERE s.version_id=? AND (?='' OR LOCATE(?,r.title)>0 OR LOCATE(?,s.scope_summary)>0)`
	if e = tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, versionID, q.Keyword, q.Keyword, q.Keyword).Scan(&out.Total); e != nil {
		return out, e
	}
	// Version features predate lightweight plans and have no public biz_id.
	// Keep the legacy response field as a deterministic display key instead of
	// minting a UUID on every read. Mutations use the numeric id.
	rows, e := tx.QueryContext(ctx, `SELECT f.id,CONCAT('version-feature:',f.id),s.version_id,i.biz_id,r.biz_id,r.title,r.component_id,c.name,s.scope_summary,s.estimate_person_days,f.acceptance_criteria,f.sort_order,f.status,s.revision,(SELECT COUNT(*) FROM product_request_delivery_links l WHERE l.planned_version_feature_id=f.id)`+where+` ORDER BY f.sort_order,f.id LIMIT ? OFFSET ?`, versionID, q.Keyword, q.Keyword, q.Keyword, q.PageSize, (q.Page-1)*q.PageSize)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		var x LightweightVersionPlanItemRecord
		var estimate sql.NullString
		if e = rows.Scan(&x.ID, &x.BizID, &x.VersionID, &x.PlanningItemBizID, &x.RequestBizID, &x.RequestTitle, &x.ComponentID, &x.ComponentName, &x.ScopeSummary, &estimate, &x.AcceptanceCriteria, &x.SortOrder, &x.Status, &x.Revision, &x.HandoffCount); e != nil {
			rows.Close()
			return out, e
		}
		x.EstimatePersonDays, e = parsePlanNumber(estimate)
		if e != nil {
			rows.Close()
			return out, e
		}
		out.Items = append(out.Items, x)
	}
	if e = rows.Err(); e != nil {
		return out, e
	}
	rows.Close()
	out.WorkspaceRevision = permit.Facts.Revision
	out.VersionRevision = v.Revision
	out.PlanRevision = p.Revision
	out.ScopeRevision = p.ScopeRevision
	return out, nil
}

func CreateLightweightVersionPlanItem(ctx context.Context, db *sql.DB, identity CommandIdentity, versionPermit, requestViewPermit, requestDecisionPermit, planningPermit AuthorizationPermit, input LightweightVersionPlanItemCreate, sourceContext ...integrationoperation.TrustedContext) (CommandResult, error) {
	return createLightweightVersionPlanItem(ctx, identity, versionPermit, requestViewPermit, requestDecisionPermit, planningPermit, input, sourceContext, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}

// CreateLightweightVersionPlanItemInTransaction shares the owning-domain command with a caller-owned transaction.
func CreateLightweightVersionPlanItemInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, versionPermit, requestViewPermit, requestDecisionPermit, planningPermit AuthorizationPermit, input LightweightVersionPlanItemCreate, sourceContext ...integrationoperation.TrustedContext) (CommandResult, error) {
	result, err := createLightweightVersionPlanItem(ctx, identity, versionPermit, requestViewPermit, requestDecisionPermit, planningPermit, input, sourceContext, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}

func createLightweightVersionPlanItem(ctx context.Context, identity CommandIdentity, versionPermit, requestViewPermit, requestDecisionPermit, planningPermit AuthorizationPermit, input LightweightVersionPlanItemCreate, sourceContext []integrationoperation.TrustedContext, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {
	if identity.Action != "product_versions:plan-item-create" {
		return CommandResult{}, invalid("product_command_identity_invalid", "计划范围命令不匹配")
	}
	if input.VersionID < 1 || input.ExpectedRequestRevision == 0 || input.ExpectedPlanRevision == 0 || !validPlanText(input.ScopeSummary, 10000, false) || !validPlanText(input.AcceptanceCriteria, 10000, false) {
		return CommandResult{}, invalid("product_version_plan_scope_invalid", "范围字段或修订无效")
	}
	if _, e := uuid.Parse(input.RequestBizID); e != nil {
		return CommandResult{}, invalid("product_version_plan_scope_invalid", "来源需求标识无效")
	}
	if input.EstimatePersonDays != nil && *input.EstimatePersonDays <= 0 {
		return CommandResult{}, invalid("product_version_plan_scope_invalid", "估算必须大于零")
	}
	return execute(func(ctx context.Context, tx *sql.Tx) error {
		if e := AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_versions", "edit", versionPermit); e != nil {
			return e
		}
		if e := AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_requests", "view", requestViewPermit); e != nil {
			return e
		}
		if input.AdoptRequest {
			if e := AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_requests", "decide", requestDecisionPermit); e != nil {
				return e
			}
		}
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "edit", planningPermit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, e := loadWorkspace(ctx, tx, identity.ProductCode)
		if e != nil {
			return nil, e
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化")
		}
		v, p, e := loadSimplePlanTx(ctx, tx, identity.ProductCode, input.VersionID)
		if e != nil {
			return nil, e
		}
		if e = requireSimpleWritable(v); e != nil {
			return nil, e
		}
		if e = planExpected(v, p, input.ExpectedRevision, input.ExpectedVersionRevision, input.ExpectedPlanRevision); e != nil {
			return nil, e
		}
		var requestID int64
		var title, status string
		var requestRevision uint64
		e = tx.QueryRowContext(ctx, `SELECT id,title,decision_status,revision FROM product_requests WHERE product_code=? AND biz_id=? FOR UPDATE`, identity.ProductCode, input.RequestBizID).Scan(&requestID, &title, &status, &requestRevision)
		if e != nil {
			return nil, e
		}
		if requestRevision != input.ExpectedRequestRevision {
			return nil, invalid("product_request_revision_conflict", "来源需求已变化")
		}
		if input.AdoptRequest && (status == "submitted" || status == "evaluating") {
			beforeStatus := status
			const decisionReason = "本次计划采纳"
			_, e = tx.ExecContext(ctx, `UPDATE product_requests SET decision_status='accepted',decision_reason=?,decided_by=?,decided_at=UTC_TIMESTAMP(3),revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, decisionReason, identity.ActorUID, identity.ActorUID, requestID)
			if e != nil {
				return nil, e
			}
			requestRevision++
			status = "accepted"
			changes, me := json.Marshal(map[string]any{"before": map[string]any{"decision_status": beforeStatus, "revision": requestRevision - 1}, "after": map[string]any{"decision_status": status, "revision": requestRevision, "decision_reason": decisionReason}, "reason": decisionReason, "planned_version_id": input.VersionID})
			if me != nil {
				return nil, me
			}
			if _, e = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'request',?,'decide',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.RequestBizID, identity.ActorUID, requestRevision, changes, identity.IdempotencyKey); e != nil {
				return nil, e
			}
		}
		if status != "accepted" {
			return nil, invalid("product_version_plan_request_not_accepted", "只能安排已采纳需求")
		}
		var exists int
		if e = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_version_plan_scopes WHERE version_id=? AND request_id=?`, input.VersionID, requestID).Scan(&exists); e != nil {
			return nil, e
		}
		if exists > 0 {
			return nil, invalid("product_version_plan_scope_conflict", "该来源已在版本范围中")
		}
		itemBiz := uuid.NewString()
		r, e := tx.ExecContext(ctx, `INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,'growth',?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, itemBiz, identity.ProductCode, title, input.ScopeSummary, identity.ActorUID, identity.ActorUID)
		if e != nil {
			return nil, e
		}
		itemID, e := r.LastInsertId()
		if e != nil {
			return nil, e
		}
		if _, e = tx.ExecContext(ctx, `INSERT INTO product_planning_item_requests(product_code,planning_item_id,request_id,created_by,created_at) VALUES(?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, itemID, requestID, identity.ActorUID); e != nil {
			return nil, e
		}
		r, e = tx.ExecContext(ctx, `INSERT INTO product_version_features(version_id,title,description,status,is_public,sort_order,created_by,created_at,updated_at,planning_item_id,change_type,acceptance_criteria) VALUES(?,?,?,'planned',0,?, ?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),?,'enhancement',?)`, input.VersionID, title, input.ScopeSummary, input.SortOrder, identity.ActorUID, itemID, nullablePlanText(input.AcceptanceCriteria))
		if e != nil {
			return nil, e
		}
		scopeID, e := r.LastInsertId()
		if e != nil {
			return nil, e
		}
		_, e = tx.ExecContext(ctx, `INSERT INTO product_version_plan_scopes(version_feature_id,version_id,product_code,request_id,planning_item_id,scope_summary,estimate_person_days,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?, ?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, scopeID, input.VersionID, identity.ProductCode, requestID, itemID, input.ScopeSummary, nullablePlanAmount(input.EstimatePersonDays), identity.ActorUID, identity.ActorUID)
		if e != nil {
			return nil, e
		}
		if confirmed, ce := planConfirmationTx(ctx, tx, input.VersionID, p); ce != nil {
			return nil, ce
		} else if confirmed != nil && !validPlanText(input.Reason, 2000, true) {
			return nil, invalid("product_version_plan_reason_required", "已确认计划变更须说明原因")
		}
		if e = invalidateSimplePlanTx(ctx, tx, input.VersionID, identity.ActorUID, input.Reason); e != nil {
			return nil, e
		}
		_, e = tx.ExecContext(ctx, `UPDATE product_version_plans SET scope_revision=scope_revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE version_id=?`, identity.ActorUID, input.VersionID)
		if e != nil {
			return nil, e
		}
		_, e = tx.ExecContext(ctx, `UPDATE product_versions SET revision=revision+1,scope_revision=scope_revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, input.VersionID)
		if e != nil {
			return nil, e
		}
		_, e = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode)
		if e != nil {
			return nil, e
		}

		var trusted integrationoperation.TrustedContext
		if len(sourceContext) > 0 {
			trusted = sourceContext[0]
		}
		if e = enqueueFeedbackDecisionTx(ctx, tx, trusted, identity.ActorUID, identity.ProductCode, requestID, input.RequestBizID, "accepted", root.Revision+1); e != nil {
			return nil, e
		}
		if e = enqueueFeedbackProgressTx(ctx, tx, trusted, identity.ActorUID, identity.ProductCode, requestID, root.Revision+1); e != nil {
			return nil, e
		}
		out := map[string]any{"id": scopeID, "planning_item_biz_id": itemBiz, "request_biz_id": input.RequestBizID, "workspace_revision": root.Revision + 1, "version_revision": v.Revision + 1, "plan_revision": p.Revision, "scope_revision": p.ScopeRevision + 1}
		return out, lightweightPlanAudit(ctx, tx, identity, input.VersionID, "plan-item-create", v.Revision+1, map[string]any{"input": input, "result": out})
	})
}
func lightweightPlanAudit(ctx context.Context, tx *sql.Tx, id CommandIdentity, versionID int64, action string, revision uint64, out any) error {
	changes, e := json.Marshal(out)
	if e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'version',?,?,?,?,?,?,UTC_TIMESTAMP(3))`, id.ProductCode, strconv.FormatInt(versionID, 10), action, id.ActorUID, revision, changes, id.IdempotencyKey)
	return e
}

func editPlanScope(ctx context.Context, tx *sql.Tx, identity CommandIdentity, input LightweightVersionPlanItemEdit) (ProductVersionRecord, lightweightPlanRow, error) {
	v, p, e := loadSimplePlanTx(ctx, tx, identity.ProductCode, input.VersionID)
	if e != nil {
		return v, p, e
	}
	if e = requireSimpleWritable(v); e != nil {
		return v, p, e
	}
	if e = planExpected(v, p, input.ExpectedRevision, input.ExpectedVersionRevision, input.ExpectedPlanRevision); e != nil {
		return v, p, e
	}
	if input.ExpectedScopeRevision == 0 || p.ScopeRevision != input.ExpectedScopeRevision {
		return v, p, invalid("product_version_plan_revision_conflict", "范围已变化")
	}
	return v, p, nil
}
func EditLightweightVersionPlanItem(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input LightweightVersionPlanItemEdit) (CommandResult, error) {
	return editLightweightVersionPlanItem(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}

// EditLightweightVersionPlanItemInTransaction shares the owning-domain command with a caller-owned transaction.
func EditLightweightVersionPlanItemInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input LightweightVersionPlanItemEdit) (CommandResult, error) {
	result, err := editLightweightVersionPlanItem(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}

func editLightweightVersionPlanItem(ctx context.Context, identity CommandIdentity, permit AuthorizationPermit, input LightweightVersionPlanItemEdit, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {
	if identity.Action != "product_versions:plan-item-edit" || input.ScopeID < 1 || !validPlanText(input.ScopeSummary, 10000, false) || !validPlanText(input.AcceptanceCriteria, 10000, false) {
		return CommandResult{}, invalid("product_version_plan_scope_invalid", "范围编辑字段无效")
	}
	if input.EstimatePersonDays != nil && *input.EstimatePersonDays <= 0 {
		return CommandResult{}, invalid("product_version_plan_scope_invalid", "估算必须大于零")
	}
	return execute(func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_versions", "edit", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, e := loadWorkspace(ctx, tx, identity.ProductCode)
		if e != nil {
			return nil, e
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化")
		}
		v, p, e := editPlanScope(ctx, tx, identity, input)
		if e != nil {
			return nil, e
		}
		confirmed, e := planConfirmationTx(ctx, tx, input.VersionID, p)
		if e != nil {
			return nil, e
		}
		if confirmed != nil && strings.TrimSpace(input.Reason) == "" {
			return nil, invalid("product_version_plan_reason_required", "已确认计划变更须说明原因")
		}
		var status string
		var scopeRevision uint64
		var oldScope string
		var oldEstimate sql.NullString
		var oldCriteria sql.NullString
		var oldOrder int32
		e = tx.QueryRowContext(ctx, `SELECT f.status,s.revision,s.scope_summary,s.estimate_person_days,f.acceptance_criteria,f.sort_order FROM product_version_plan_scopes s JOIN product_version_features f ON f.id=s.version_feature_id WHERE s.version_id=? AND s.version_feature_id=? FOR UPDATE`, input.VersionID, input.ScopeID).Scan(&status, &scopeRevision, &oldScope, &oldEstimate, &oldCriteria, &oldOrder)
		if e != nil {
			return nil, e
		}
		if status != "planned" {
			return nil, invalid("product_version_plan_locked", "已有执行或发布引用的范围不可直接编辑")
		}
		if e = invalidateSimplePlanTx(ctx, tx, input.VersionID, identity.ActorUID, input.Reason); e != nil {
			return nil, e
		}
		_, e = tx.ExecContext(ctx, `UPDATE product_version_plan_scopes SET scope_summary=?,estimate_person_days=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE version_feature_id=?`, input.ScopeSummary, nullablePlanAmount(input.EstimatePersonDays), identity.ActorUID, input.ScopeID)
		if e != nil {
			return nil, e
		}
		_, e = tx.ExecContext(ctx, `UPDATE product_version_features SET description=?,acceptance_criteria=?,sort_order=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, input.ScopeSummary, nullablePlanText(input.AcceptanceCriteria), input.SortOrder, input.ScopeID)
		if e != nil {
			return nil, e
		}
		_, e = tx.ExecContext(ctx, `UPDATE product_planning_items i JOIN product_version_plan_scopes s ON s.planning_item_id=i.id SET i.scope_summary=?,i.scope_revision=i.scope_revision+1,i.revision=i.revision+1,i.updated_by=?,i.updated_at=UTC_TIMESTAMP(3) WHERE s.version_feature_id=? AND s.version_id=? AND s.product_code=?`, input.ScopeSummary, identity.ActorUID, input.ScopeID, input.VersionID, identity.ProductCode)
		if e != nil {
			return nil, e
		}
		_, e = tx.ExecContext(ctx, `UPDATE product_version_plans SET scope_revision=scope_revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE version_id=?`, identity.ActorUID, input.VersionID)
		if e != nil {
			return nil, e
		}
		_, e = tx.ExecContext(ctx, `UPDATE product_versions SET revision=revision+1,scope_revision=scope_revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, input.VersionID)
		if e != nil {
			return nil, e
		}
		_, e = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode)
		if e != nil {
			return nil, e
		}
		out := map[string]any{"id": input.ScopeID, "workspace_revision": root.Revision + 1, "version_revision": v.Revision + 1, "plan_revision": p.Revision, "scope_revision": p.ScopeRevision + 1, "scope_item_revision": scopeRevision + 1}
		before := map[string]any{"scope_summary": oldScope, "estimate_person_days": nullableSnapshotAmount(oldEstimate), "acceptance_criteria": nullableString(oldCriteria), "sort_order": oldOrder, "scope_revision": scopeRevision}
		return out, lightweightPlanAudit(ctx, tx, identity, input.VersionID, "plan-item-edit", v.Revision+1, map[string]any{"before": before, "input": input, "result": out})
	})
}
func DeleteLightweightVersionPlanItem(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input LightweightVersionPlanItemDelete) (CommandResult, error) {
	return deleteLightweightVersionPlanItem(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}

// DeleteLightweightVersionPlanItemInTransaction shares the owning-domain command with a caller-owned transaction.
func DeleteLightweightVersionPlanItemInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input LightweightVersionPlanItemDelete) (CommandResult, error) {
	result, err := deleteLightweightVersionPlanItem(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}

func deleteLightweightVersionPlanItem(ctx context.Context, identity CommandIdentity, permit AuthorizationPermit, input LightweightVersionPlanItemDelete, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {
	if identity.Action != "product_versions:plan-item-delete" || input.ScopeID < 1 || input.ExpectedScopeRevision == 0 || !validPlanText(input.Reason, 2000, true) {
		return CommandResult{}, invalid("product_version_plan_scope_invalid", "范围删除字段无效")
	}
	return execute(func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_versions", "edit", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, e := loadWorkspace(ctx, tx, identity.ProductCode)
		if e != nil {
			return nil, e
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化")
		}
		v, p, e := editPlanScope(ctx, tx, identity, LightweightVersionPlanItemEdit{VersionID: input.VersionID, ExpectedRevision: input.ExpectedRevision, ExpectedVersionRevision: input.ExpectedVersionRevision, ExpectedPlanRevision: input.ExpectedPlanRevision, ExpectedScopeRevision: input.ExpectedScopeRevision})
		if e != nil {
			return nil, e
		}
		var count int
		e = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_request_delivery_links WHERE planned_version_feature_id=?`, input.ScopeID).Scan(&count)
		if e != nil {
			return nil, e
		}
		if count > 0 {
			return nil, invalid("product_version_plan_locked", "范围已有研发转交，不能移出")
		}
		var itemID int64
		var scopeStatus string
		var oldScope string
		var oldEstimate sql.NullString
		var oldCriteria sql.NullString
		var oldRequestBiz, oldItemBiz string
		e = tx.QueryRowContext(ctx, `SELECT s.planning_item_id,f.status,s.scope_summary,s.estimate_person_days,f.acceptance_criteria,r.biz_id,i.biz_id FROM product_version_plan_scopes s JOIN product_version_features f ON f.id=s.version_feature_id JOIN product_requests r ON r.id=s.request_id JOIN product_planning_items i ON i.id=s.planning_item_id WHERE s.version_id=? AND s.version_feature_id=? FOR UPDATE`, input.VersionID, input.ScopeID).Scan(&itemID, &scopeStatus, &oldScope, &oldEstimate, &oldCriteria, &oldRequestBiz, &oldItemBiz)
		if e != nil {
			return nil, e
		}
		if scopeStatus != "planned" {
			return nil, invalid("product_version_plan_locked", "已交付或顺延范围不可移出")
		}
		if e = invalidateSimplePlanTx(ctx, tx, input.VersionID, identity.ActorUID, input.Reason); e != nil {
			return nil, e
		}
		if _, e = tx.ExecContext(ctx, `DELETE FROM product_version_features WHERE id=?`, input.ScopeID); e != nil {
			return nil, e
		}
		if _, e = tx.ExecContext(ctx, `DELETE FROM product_planning_item_requests WHERE planning_item_id=?`, itemID); e != nil {
			return nil, e
		}
		if _, e = tx.ExecContext(ctx, `DELETE FROM product_planning_items WHERE id=?`, itemID); e != nil {
			return nil, e
		}
		if _, e = tx.ExecContext(ctx, `UPDATE product_version_plans SET scope_revision=scope_revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE version_id=?`, identity.ActorUID, input.VersionID); e != nil {
			return nil, e
		}
		if _, e = tx.ExecContext(ctx, `UPDATE product_versions SET revision=revision+1,scope_revision=scope_revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, input.VersionID); e != nil {
			return nil, e
		}
		if _, e = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); e != nil {
			return nil, e
		}
		out := map[string]any{"id": input.ScopeID, "deleted": true, "workspace_revision": root.Revision + 1, "version_revision": v.Revision + 1, "plan_revision": p.Revision, "scope_revision": p.ScopeRevision + 1}
		deleted := map[string]any{"scope_id": input.ScopeID, "planning_item_biz_id": oldItemBiz, "request_biz_id": oldRequestBiz, "scope_summary": oldScope, "estimate_person_days": nullableSnapshotAmount(oldEstimate), "acceptance_criteria": nullableString(oldCriteria)}
		return out, lightweightPlanAudit(ctx, tx, identity, input.VersionID, "plan-item-delete", v.Revision+1, map[string]any{"deleted": deleted, "reason": input.Reason, "result": out})
	})
}
func ConfirmLightweightVersionPlan(ctx context.Context, db *sql.DB, identity CommandIdentity, versionPermit, planningPermit AuthorizationPermit, input LightweightVersionPlanConfirm) (CommandResult, error) {
	return confirmLightweightVersionPlan(ctx, identity, versionPermit, planningPermit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}

// ConfirmLightweightVersionPlanInTransaction shares the owning-domain command with a caller-owned transaction.
func ConfirmLightweightVersionPlanInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, versionPermit, planningPermit AuthorizationPermit, input LightweightVersionPlanConfirm) (CommandResult, error) {
	result, err := confirmLightweightVersionPlan(ctx, identity, versionPermit, planningPermit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}

func confirmLightweightVersionPlan(ctx context.Context, identity CommandIdentity, versionPermit, planningPermit AuthorizationPermit, input LightweightVersionPlanConfirm, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {
	if identity.Action != "product_versions:plan-confirm" || input.VersionID < 1 || input.ExpectedScopeRevision == 0 {
		return CommandResult{}, invalid("product_version_plan_confirm_invalid", "确认修订无效")
	}
	return execute(func(ctx context.Context, tx *sql.Tx) error {
		if e := AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_versions", "edit", versionPermit); e != nil {
			return e
		}
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "prioritize", planningPermit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, e := loadWorkspace(ctx, tx, identity.ProductCode)
		if e != nil {
			return nil, e
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化")
		}
		v, p, e := loadSimplePlanTx(ctx, tx, identity.ProductCode, input.VersionID)
		if e != nil {
			return nil, e
		}
		if e = requireSimpleWritable(v); e != nil {
			return nil, e
		}
		if e = planExpected(v, p, input.ExpectedRevision, input.ExpectedVersionRevision, input.ExpectedPlanRevision); e != nil {
			return nil, e
		}
		if p.ScopeRevision != input.ExpectedScopeRevision {
			return nil, invalid("product_version_plan_revision_conflict", "范围已变化")
		}
		summary, e := planSummaryTx(ctx, tx, input.VersionID, p)
		if e != nil {
			return nil, e
		}
		if len(summary.Issues) > 0 {
			return nil, invalid("product_version_plan_confirm_invalid", "计划仍有未完成项："+strings.Join(summary.Issues, ","))
		}
		if strings.TrimSpace(valueOrEmpty(p.Goal)) == "" || !p.StartsOn.Valid || v.PlannedReleaseDate == nil {
			return nil, invalid("product_version_plan_confirm_invalid", "目标和计划日期必填")
		}
		if v.BusinessOwnerUID == nil {
			return nil, invalid("product_version_owner_unavailable", "轻量计划确认需要当前有效负责人")
		}
		if e = validateVersionOwnerTx(ctx, tx, identity.ProductCode, *v.BusinessOwnerUID); e != nil {
			return nil, e
		}
		if p.Reserve.Valid && p.Available.Valid {
			a, _ := parsePlanNumber(p.Available)
			r, _ := parsePlanNumber(p.Reserve)
			if *r > *a {
				return nil, invalid("product_version_plan_capacity_exceeded", "预留超过可用人日")
			}
		}
		var blockers int
		e = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_version_plan_scopes s JOIN product_version_features current_scope ON current_scope.id=s.version_feature_id JOIN product_planning_dependencies d ON d.planning_item_id=s.planning_item_id AND d.product_code=s.product_code LEFT JOIN product_version_plan_scopes prior ON prior.version_id=s.version_id AND prior.planning_item_id=d.predecessor_id LEFT JOIN product_version_features predecessor_scope ON predecessor_scope.id=prior.version_feature_id LEFT JOIN product_planning_items pi ON pi.id=d.predecessor_id WHERE s.version_id=? AND pi.lifecycle<>'delivered' AND (prior.version_feature_id IS NULL OR predecessor_scope.sort_order>current_scope.sort_order OR (predecessor_scope.sort_order=current_scope.sort_order AND predecessor_scope.id>=current_scope.id))`, input.VersionID).Scan(&blockers)
		if e != nil {
			return nil, e
		}
		if blockers > 0 {
			return nil, invalid("product_version_plan_dependency_blocked", "存在未解决或顺序不正确的前置依赖")
		}
		rows, e := tx.QueryContext(ctx, `SELECT f.id,r.biz_id,r.revision,r.decision_status,i.biz_id,s.scope_summary,s.estimate_person_days,f.acceptance_criteria,f.sort_order FROM product_version_plan_scopes s JOIN product_version_features f ON f.id=s.version_feature_id JOIN product_requests r ON r.id=s.request_id JOIN product_planning_items i ON i.id=s.planning_item_id WHERE s.version_id=? ORDER BY f.sort_order,f.id`, input.VersionID)
		if e != nil {
			return nil, e
		}
		frozenScopes := []map[string]any{}
		for rows.Next() {
			var estimate sql.NullString
			var scopeID int64
			var requestBiz, itemBiz, decision, scope, criteria string
			var requestRevision uint64
			var order int32
			if e = rows.Scan(&scopeID, &requestBiz, &requestRevision, &decision, &itemBiz, &scope, &estimate, &criteria, &order); e != nil {
				rows.Close()
				return nil, e
			}
			frozenScopes = append(frozenScopes, map[string]any{"scope_id": scopeID, "request_biz_id": requestBiz, "request_revision": requestRevision, "request_decision": decision, "planning_item_biz_id": itemBiz, "scope_summary": scope, "estimate_person_days": nullableSnapshotAmount(estimate), "acceptance_criteria": criteria, "sort_order": order})
		}
		if e = rows.Err(); e != nil {
			rows.Close()
			return nil, e
		}
		rows.Close()
		snapshot, e := json.Marshal(map[string]any{"version": 1, "version_id": v.ID, "version_revision": v.Revision, "business_owner_uid": v.BusinessOwnerUID, "goal": nullableString(p.Goal), "starts_on": nullableString(p.StartsOn), "planned_release_date": v.PlannedReleaseDate, "available_person_days": nullableSnapshotAmount(p.Available), "reserve_person_days": nullableSnapshotAmount(p.Reserve), "plan_revision": p.Revision, "scope_revision": p.ScopeRevision, "summary": summary, "scopes": frozenScopes})
		if e != nil {
			return nil, e
		}
		r, e := tx.ExecContext(ctx, `INSERT INTO product_version_plan_confirmations(version_id,plan_revision,scope_revision,snapshot,confirmed_by,confirmed_at) VALUES(?,?,?,?,?,UTC_TIMESTAMP(3))`, input.VersionID, p.Revision, p.ScopeRevision, snapshot, identity.ActorUID)
		if e != nil {
			return nil, e
		}
		id, _ := r.LastInsertId()
		out := map[string]any{"confirmation_id": id, "version_id": input.VersionID, "plan_status": "confirmed", "plan_revision": p.Revision, "scope_revision": p.ScopeRevision, "version_revision": v.Revision, "workspace_revision": root.Revision}
		return out, lightweightPlanAudit(ctx, tx, identity, input.VersionID, "plan-confirm", v.Revision, map[string]any{"input": input, "snapshot": json.RawMessage(snapshot), "result": out})
	})
}
func valueOrEmpty(s sql.NullString) string {
	if s.Valid {
		return s.String
	}
	return ""
}
func nullableSnapshotAmount(s sql.NullString) any {
	if !s.Valid {
		return nil
	}
	v, e := ParseHundredths(s.String)
	if e != nil {
		return nil
	}
	return v
}
