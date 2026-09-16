package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

// PlanningHandoffTarget is supplied only by the Aims adapter, never decoded
// from a request. Both hooks must use tx. Authorization must recheck current
// project requirement-edit access before receipts; ResolveRequirement must
// enforce active product_dev, product binding and version intent, then create
// a draft or validate the existing requirement in that exact project.
type PlanningHandoffTarget struct {
	AuthorizeProject   func(context.Context, *sql.Tx) (int64, error)
	ResolveRequirement func(context.Context, *sql.Tx) (int64, error)
}

type handoffIntent struct {
	RequestBizID            string `json:"request_biz_id"`
	ProjectCode             string `json:"project_code"`
	SliceKey                string `json:"slice_key"`
	Operation               string `json:"operation"`
	RequirementID           int64  `json:"requirement_id"`
	Title                   string `json:"title"`
	ScopeSummary            string `json:"scope_summary"`
	PlannedVersionID        int64  `json:"planned_version_id"`
	PlannedVersionFeatureID int64  `json:"planned_version_feature_id"`
}

func HandoffPlanningItem(ctx context.Context, db *sql.DB, identity CommandIdentity, planningPermit, requestPermit AuthorizationPermit, input PlanningHandoffInput, target PlanningHandoffTarget) (CommandResult, error) {
	if identity.Action != "product_priorities:handoff" {
		return CommandResult{}, invalid("product_command_identity_invalid", "规划转交命令不匹配")
	}
	if err := ValidatePlanningHandoffInput(input); err != nil {
		return CommandResult{}, err
	}
	if target.AuthorizeProject == nil || target.ResolveRequirement == nil {
		return CommandResult{}, invalid("product_command_configuration", "转交缺少项目授权或需求事务处理器")
	}
	var projectID int64
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		if err := AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "handoff", planningPermit); err != nil {
			return err
		}
		if input.RequestBizID != "" {
			if err := AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_requests", "handoff", requestPermit); err != nil {
				return err
			}
		}
		var err error
		projectID, err = target.AuthorizeProject(ctx, tx)
		if err != nil {
			return err
		}
		if projectID <= 0 {
			return invalid("planning_handoff_project_invalid", "目标项目授权无效")
		}
		return nil
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		var basis PlanningDeliveryBasis
		var err error
		isSimple := false
		if input.PlannedVersionFeatureID > 0 {
			var mode string
			if err = tx.QueryRowContext(ctx, `SELECT planning_mode FROM product_versions WHERE id=? AND product_code=?`, input.PlannedVersionID, identity.ProductCode).Scan(&mode); err != nil {
				return nil, err
			}
			isSimple = mode == "simple"
		}
		if isSimple {
			if input.CycleBizID != "" || input.ExpectedCycleRevision != 0 || input.ExpectedQueueRevision != 0 {
				return nil, invalid("planning_handoff_version_invalid", "轻量版本转交不能提交周期决定")
			}
			basis, err = ValidateLightweightPlanningDeliveryTx(ctx, tx, identity.ProductCode, input)
		} else {
			basis, err = ValidatePlanningDeliveryTx(ctx, tx, identity.ProductCode, input.PlanningDeliveryCheck)
		}
		if err != nil {
			return nil, err
		}
		source, err := ResolvePlanningHandoffSourceTx(ctx, tx, identity.ProductCode, input)
		if err != nil {
			return nil, err
		}
		intent := handoffIntent{input.RequestBizID, input.ProjectCode, input.SliceKey, input.Operation, input.RequirementID, input.Title, input.ScopeSummary, input.PlannedVersionID, input.PlannedVersionFeatureID}
		var linkID, requirementID int64
		var previous []byte
		err = tx.QueryRowContext(ctx, `SELECT id,requirement_id,scope_snapshot FROM product_request_delivery_links WHERE product_code=? AND planning_item_id=? AND project_id=? AND delivery_slice_key=?`, identity.ProductCode, basis.ItemID, projectID, input.SliceKey).Scan(&linkID, &requirementID, &previous)
		if err == nil {
			var stored struct {
				Intent *handoffIntent `json:"intent"`
			}
			if json.Unmarshal(previous, &stored) != nil || stored.Intent == nil || *stored.Intent != intent {
				return nil, invalid("planning_handoff_slice_conflict", "该交付切片已有不同范围，请使用新切片或原请求重试")
			}
			return map[string]any{"link_id": linkID, "project_id": projectID, "requirement_id": requirementID, "existing": true, "workspace_revision": input.ExpectedRevision, "item_revision": input.ExpectedItemRevision}, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		requirementID, err = target.ResolveRequirement(ctx, tx)
		if err != nil {
			return nil, err
		}
		if requirementID <= 0 || (input.Operation == "link" && requirementID != input.RequirementID) {
			return nil, invalid("planning_handoff_requirement_invalid", "项目需求结果与转交操作不一致")
		}
		var sourceID any
		if source != nil {
			sourceID = source.ID
		}
		snapshot, err := json.Marshal(map[string]any{"version": 1, "intent": intent, "decision_basis": basis, "source": source, "item_revision": input.ExpectedItemRevision, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		nullableID := func(id int64) any {
			if id == 0 {
				return nil
			}
			return id
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO product_request_delivery_links(product_code,planning_item_id,request_id,project_id,requirement_id,source_revision,scope_snapshot,delivery_slice_key,planned_version_id,planned_version_feature_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, basis.ItemID, sourceID, projectID, requirementID, input.ExpectedItemRevision, snapshot, input.SliceKey, nullableID(input.PlannedVersionID), nullableID(input.PlannedVersionFeatureID), identity.ActorUID)
		if err != nil {
			return nil, err
		}
		linkID, err = result.LastInsertId()
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_items SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND product_code=?`, identity.ActorUID, basis.ItemID, identity.ProductCode); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"link_id": linkID, "project_code": input.ProjectCode, "requirement_id": requirementID, "scope_snapshot": json.RawMessage(snapshot)})
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'planning_item',?,'handoff',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.ItemBizID, identity.ActorUID, input.ExpectedItemRevision+1, changes, identity.IdempotencyKey); err != nil {
			return nil, err
		}
		return map[string]any{"link_id": linkID, "project_id": projectID, "requirement_id": requirementID, "existing": false, "workspace_revision": input.ExpectedRevision + 1, "item_revision": input.ExpectedItemRevision + 1}, nil
	})
}
