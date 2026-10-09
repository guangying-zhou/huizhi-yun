package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"strings"
	"time"
	"unicode/utf8"
)

type PlanningRoadmapWindow struct {
	BizID                string  `json:"biz_id"`
	StartsOn             *string `json:"starts_on"`
	EndsOn               *string `json:"ends_on"`
	ExpectedRevision     uint64  `json:"expected_revision"`
	ExpectedItemRevision uint64  `json:"expected_item_revision"`
	Reason               string  `json:"reason"`
}

func ValidatePlanningRoadmapWindow(input PlanningRoadmapWindow) error {
	id, err := uuid.Parse(input.BizID)
	if err != nil || id.String() != input.BizID || input.ExpectedRevision < 1 || input.ExpectedItemRevision < 1 || !utf8.ValidString(input.Reason) || strings.ContainsRune(input.Reason, '\x00') || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 {
		return invalid("product_roadmap_window_invalid", "事项标识、修订或变更原因无效")
	}
	if (input.StartsOn == nil) != (input.EndsOn == nil) {
		return invalid("product_roadmap_window_invalid", "时间窗口须同时填写或清空")
	}
	if input.StartsOn != nil {
		start, err := time.Parse("2006-01-02", *input.StartsOn)
		if err != nil || start.Year() < 1000 || start.Format("2006-01-02") != *input.StartsOn {
			return invalid("product_roadmap_window_invalid", "开始日期无效")
		}
		end, err := time.Parse("2006-01-02", *input.EndsOn)
		if err != nil || end.Format("2006-01-02") != *input.EndsOn || end.Before(start) {
			return invalid("product_roadmap_window_invalid", "结束日期无效")
		}
	}
	return nil
}
func EditPlanningRoadmapWindow(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input PlanningRoadmapWindow) (CommandResult, error) {
	if identity.Action != "product_roadmaps:window-edit" {
		return CommandResult{}, invalid("product_command_identity_invalid", "路线时间窗口命令不匹配")
	}
	if err := ValidatePlanningRoadmapWindow(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_roadmaps", "edit", permit)
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
		var itemID int64
		var revision uint64
		var lifecycle string
		var beforeStart, beforeEnd *string
		if err = tx.QueryRowContext(ctx, `SELECT id,revision,lifecycle,DATE_FORMAT(roadmap_starts_on,'%Y-%m-%d'),DATE_FORMAT(roadmap_ends_on,'%Y-%m-%d') FROM product_planning_items WHERE biz_id=? AND BINARY product_code=BINARY ? FOR UPDATE`, input.BizID, identity.ProductCode).Scan(&itemID, &revision, &lifecycle, &beforeStart, &beforeEnd); err != nil {
			return nil, err
		}
		if revision != input.ExpectedItemRevision {
			return nil, invalid("product_planning_revision_conflict", "规划事项已变化")
		}
		if lifecycle != "proposed" && lifecycle != "in_delivery" {
			return nil, invalid("product_planning_readonly", "已结束或合并事项只读保留")
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_items SET roadmap_starts_on=?,roadmap_ends_on=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND BINARY product_code=BINARY ?`, input.StartsOn, input.EndsOn, identity.ActorUID, itemID, identity.ProductCode); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"biz_id": input.BizID, "product_code": identity.ProductCode, "starts_on": input.StartsOn, "ends_on": input.EndsOn, "revision": revision + 1, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"before": map[string]any{"starts_on": beforeStart, "ends_on": beforeEnd, "revision": revision}, "after": out, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'planning_item',?,'roadmap-window',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.BizID, identity.ActorUID, revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
