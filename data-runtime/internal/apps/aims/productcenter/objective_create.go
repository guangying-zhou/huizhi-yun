package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type ProductObjectiveDraft struct {
	Title            string                 `json:"title"`
	Description      string                 `json:"description"`
	StartsOn         string                 `json:"starts_on"`
	EndsOn           string                 `json:"ends_on"`
	OwnerUID         string                 `json:"owner_uid"`
	Metric           ProductObjectiveMetric `json:"metric"`
	ExpectedRevision uint64                 `json:"expected_revision"`
}

func ValidateProductObjectiveDraft(input ProductObjectiveDraft) error {
	for _, field := range []struct {
		value    string
		max      int
		required bool
	}{
		{input.Title, 255, true}, {input.Description, 10000, false}, {input.OwnerUID, 64, true},
	} {
		if !utf8.ValidString(field.value) || strings.ContainsRune(field.value, '\x00') || utf8.RuneCountInString(field.value) > field.max || (field.required && strings.TrimSpace(field.value) == "") {
			return invalid("product_objective_draft_invalid", "目标标题、说明或负责人无效")
		}
	}
	start, err := time.Parse("2006-01-02", input.StartsOn)
	if err != nil || start.Year() < 1000 {
		return invalid("product_objective_period_invalid", "目标开始日期无效")
	}
	end, err := time.Parse("2006-01-02", input.EndsOn)
	if err != nil || end.Before(start) {
		return invalid("product_objective_period_invalid", "目标结束日期须不早于开始日期")
	}
	if input.ExpectedRevision < 1 || input.OwnerUID != strings.TrimSpace(input.OwnerUID) {
		return invalid("product_objective_draft_invalid", "产品修订或负责人无效")
	}
	return ValidateProductObjectiveMetric(input.Metric)
}

func CreateProductObjective(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductObjectiveDraft) (CommandResult, error) {
	if identity.Action != "product_objectives:create" {
		return CommandResult{}, invalid("product_command_identity_invalid", "目标创建命令不匹配")
	}
	if err := ValidateProductObjectiveDraft(input); err != nil {
		return CommandResult{}, err
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
		facts, err := LoadAuthorizationFacts(ctx, tx, identity.ProductCode, input.OwnerUID)
		if err != nil {
			return nil, err
		}
		if !facts.IsMember {
			return nil, invalid("product_objective_owner_unavailable", "请选择当前有效的产品成员作为目标负责人")
		}
		bizID := uuid.NewString()
		inserted, err := tx.ExecContext(ctx, `INSERT INTO product_objectives(biz_id,product_code,title,description,starts_on,ends_on,owner_uid,metric_name,metric_unit,measurement_definition,direction,baseline_value,target_value,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, bizID, identity.ProductCode, input.Title, input.Description, input.StartsOn, input.EndsOn, input.OwnerUID, input.Metric.Name, input.Metric.Unit, input.Metric.MeasurementDefinition, input.Metric.Direction, canonicalCycleMetricValue(input.Metric.BaselineValue), canonicalCycleMetricValue(input.Metric.TargetValue), identity.ActorUID, identity.ActorUID)
		if err != nil {
			return nil, err
		}
		id, err := inserted.LastInsertId()
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		metric := input.Metric
		metric.BaselineValue = canonicalCycleMetricValue(metric.BaselineValue)
		metric.TargetValue = canonicalCycleMetricValue(metric.TargetValue)
		out := map[string]any{"id": id, "biz_id": bizID, "product_code": identity.ProductCode, "title": input.Title, "description": input.Description, "starts_on": input.StartsOn, "ends_on": input.EndsOn, "owner_uid": input.OwnerUID, "metric": metric, "status": "draft", "revision": 1, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"after": out})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'objective',?,'create',?,1,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(id, 10), identity.ActorUID, changes, identity.IdempotencyKey)
		return out, err
	})
}
