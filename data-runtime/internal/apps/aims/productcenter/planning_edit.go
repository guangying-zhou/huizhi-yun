package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"strings"
	"unicode/utf8"
)

// Editing scope and evidence does not grant authority to reorder a cycle or
// change a version commitment. Those require their explicit decision commands.
type PlanningItemEdit struct {
	PlanningItemDraft
	BizID                string `json:"biz_id"`
	ExpectedItemRevision uint64 `json:"expected_item_revision"`
	Reason               string `json:"reason"`
	ImpactNote           string `json:"impact_note"`
}

func ValidatePlanningItemEdit(input PlanningItemEdit) error {
	if input.Requests == nil {
		return invalid("product_planning_sources_invalid", "修改时必须显式提交完整来源集合")
	}
	if err := ValidatePlanningItemDraft(input.PlanningItemDraft); err != nil {
		return err
	}
	id, err := uuid.Parse(input.BizID)
	if err != nil || id.String() != input.BizID || input.ExpectedItemRevision == 0 {
		return invalid("product_planning_revision_required", "必须提供事项标识和当前版本号")
	}
	if strings.TrimSpace(input.Reason) == "" {
		return invalid("product_planning_reason_required", "修改规划事项必须填写原因")
	}
	for _, value := range []string{input.Reason, input.ImpactNote} {
		if !utf8.ValidString(value) || strings.ContainsRune(value, '\x00') || utf8.RuneCountInString(value) > 2000 {
			return invalid("product_planning_reason_invalid", "修改原因或影响说明无效")
		}
	}
	return nil
}

func EditPlanningItem(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input PlanningItemEdit) (CommandResult, error) {
	if identity.Action != "product_priorities:edit" {
		return CommandResult{}, invalid("product_command_identity_invalid", "规划编辑命令不匹配")
	}
	if err := ValidatePlanningItemEdit(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "edit", permit)
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
		before, err := loadPlanningItemDetail(ctx, tx, identity.ProductCode, input.BizID)
		if err != nil {
			return nil, err
		}
		if before.Revision != input.ExpectedItemRevision {
			return nil, invalid("product_planning_revision_conflict", "规划事项已变化，请刷新后重试")
		}
		if before.Lifecycle == "merged" || before.Lifecycle == "delivered" || before.Lifecycle == "cancelled" {
			return nil, invalid("product_planning_readonly", "已结束或合并事项只读保留")
		}
		if before.RequiresImpactNote && strings.TrimSpace(input.ImpactNote) == "" {
			return nil, invalid("product_planning_impact_required", "已选入或交付中的事项修改须说明影响")
		}
		if err = rejectLegacySimplePlanScopeTx(ctx, tx, identity.ProductCode, before.ID); err != nil {
			return nil, err
		}
		requestIDs := []int64{}
		for _, source := range input.Requests {
			var id int64
			var revision uint64
			var state string
			if err := tx.QueryRowContext(ctx, `SELECT id,revision,decision_status FROM product_requests WHERE product_code=? AND biz_id=?`, identity.ProductCode, source.BizID).Scan(&id, &revision, &state); err != nil {
				return nil, err
			}
			if revision != source.Revision {
				return nil, invalid("product_request_revision_conflict", "来源需求已变化，请刷新后重试")
			}
			if state == "merged" {
				return nil, invalid("product_request_merged_readonly", "请选择合并后的目标需求作为规划来源")
			}
			requestIDs = append(requestIDs, id)
		}
		previous := map[string]bool{}
		for _, source := range before.Requests {
			previous[source.BizID] = true
		}
		next := map[string]bool{}
		for _, source := range input.Requests {
			next[source.BizID] = true
		}
		evidenceDelta := 0
		if len(previous) != len(next) {
			evidenceDelta = 1
		}
		for id := range previous {
			if !next[id] {
				evidenceDelta = 1
			}
		}
		scopeDelta := 0
		if before.ScopeSummary != input.ScopeSummary || before.InvestmentCategory != input.InvestmentCategory || before.UrgencyLevel != input.UrgencyLevel {
			scopeDelta = 1
		}
		if scopeDelta == 0 && evidenceDelta == 0 && before.Title == input.Title {
			before.WorkspaceRevision = root.Revision
			return before, nil
		}
		// Only changed facts invalidate their corresponding assessment inputs.
		_, err = tx.ExecContext(ctx, `UPDATE product_planning_items SET title=?,scope_summary=?,investment_category=?,urgency_level=?,scope_revision=scope_revision+?,evidence_revision=evidence_revision+?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND id=?`, input.Title, input.ScopeSummary, input.InvestmentCategory, input.UrgencyLevel, scopeDelta, evidenceDelta, identity.ActorUID, identity.ProductCode, before.ID)
		if err != nil {
			return nil, err
		}
		for id := range previous {
			if next[id] {
				continue
			}
			if _, err := tx.ExecContext(ctx, `DELETE l FROM product_planning_item_requests l JOIN product_requests r ON r.id=l.request_id AND r.product_code=l.product_code WHERE l.product_code=? AND l.planning_item_id=? AND r.biz_id=?`, identity.ProductCode, before.ID, id); err != nil {
				return nil, err
			}
		}
		for index, id := range requestIDs {
			if previous[input.Requests[index].BizID] {
				continue
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO product_planning_item_requests(product_code,planning_item_id,request_id,created_by,created_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, before.ID, id, identity.ActorUID); err != nil {
				return nil, err
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		after, err := loadPlanningItemDetail(ctx, tx, identity.ProductCode, input.BizID)
		if err != nil {
			return nil, err
		}
		after.WorkspaceRevision = root.Revision + 1
		changes, err := json.Marshal(map[string]any{"before": before, "after": after, "reason": input.Reason, "impact_note": input.ImpactNote})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'planning_item',?,'edit',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.BizID, identity.ActorUID, after.Revision, changes, identity.IdempotencyKey)
		return after, err
	})
}
