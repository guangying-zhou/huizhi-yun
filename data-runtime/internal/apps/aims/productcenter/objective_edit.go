package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"
)

type ProductObjectiveEdit struct {
	ProductObjectiveDraft
	ObjectiveID               int64  `json:"objective_id"`
	ExpectedObjectiveRevision uint64 `json:"expected_objective_revision"`
	Reason                    string `json:"reason"`
}

func EditProductObjective(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductObjectiveEdit) (CommandResult, error) {
	if identity.Action != "product_objectives:edit" {
		return CommandResult{}, invalid("product_command_identity_invalid", "目标编辑命令不匹配")
	}
	if err := ValidateProductObjectiveDraft(input.ProductObjectiveDraft); err != nil {
		return CommandResult{}, err
	}
	if input.ObjectiveID < 1 || input.ExpectedObjectiveRevision < 1 || !utf8.ValidString(input.Reason) || strings.ContainsRune(input.Reason, '\x00') || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 {
		return CommandResult{}, invalid("product_objective_edit_invalid", "目标、修订或变更原因无效")
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_objectives", "edit", permit)
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
		before, err := scanProductObjective(tx.QueryRowContext(ctx, `SELECT `+objectiveColumns+` FROM product_objectives WHERE id=? AND BINARY product_code=BINARY ? FOR UPDATE`, input.ObjectiveID, identity.ProductCode))
		if err != nil {
			return nil, err
		}
		if before.Revision != input.ExpectedObjectiveRevision {
			return nil, invalid("product_objective_revision_conflict", "目标已变化")
		}
		if before.Status != "draft" && before.Status != "active" {
			return nil, invalid("product_objective_state_conflict", "仅草稿或进行中目标可编辑")
		}
		facts, err := LoadAuthorizationFacts(ctx, tx, identity.ProductCode, input.OwnerUID)
		if err != nil {
			return nil, err
		}
		if !facts.IsMember {
			return nil, invalid("product_objective_owner_unavailable", "请选择当前有效的产品成员作为目标负责人")
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_objectives SET title=?,description=?,starts_on=?,ends_on=?,owner_uid=?,metric_name=?,metric_unit=?,measurement_definition=?,direction=?,baseline_value=?,target_value=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND BINARY product_code=BINARY ?`, input.Title, input.Description, input.StartsOn, input.EndsOn, input.OwnerUID, input.Metric.Name, input.Metric.Unit, input.Metric.MeasurementDefinition, input.Metric.Direction, canonicalCycleMetricValue(input.Metric.BaselineValue), canonicalCycleMetricValue(input.Metric.TargetValue), identity.ActorUID, before.ID, identity.ProductCode); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		metric := input.Metric
		metric.BaselineValue = canonicalCycleMetricValue(metric.BaselineValue)
		metric.TargetValue = canonicalCycleMetricValue(metric.TargetValue)
		after := before
		after.Title = input.Title
		after.Description = input.Description
		after.StartsOn = input.StartsOn
		after.EndsOn = input.EndsOn
		after.OwnerUID = input.OwnerUID
		after.Metric = metric
		after.Revision++
		out := map[string]any{"objective": after, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"before": before, "after": after, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'objective',?,'edit',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(before.ID, 10), identity.ActorUID, after.Revision, changes, identity.IdempotencyKey)
		return out, err
	})
}
