package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// A draft may leave its budget unknown. Once supplied, all five amounts must
// be explicit, including zero; a missing budget is never a zero-capacity claim.
type PlanningCycleBudget struct {
	Total       *Hundredths `json:"total_person_days"`
	Reserve     *Hundredths `json:"reserve_person_days"`
	Reliability *Hundredths `json:"reliability_person_days"`
	Usability   *Hundredths `json:"usability_person_days"`
	Growth      *Hundredths `json:"growth_person_days"`
}

func (b PlanningCycleBudget) Validate() error {
	if b.Total == nil || b.Reserve == nil || b.Reliability == nil || b.Usability == nil || b.Growth == nil {
		return invalid("planning_capacity_missing", "预算须明确总量、预留及三个投资类别，可填零")
	}
	return (Capacity{Total: *b.Total, Reserve: *b.Reserve, Categories: map[InvestmentCategory]Hundredths{Reliability: *b.Reliability, Usability: *b.Usability, Growth: *b.Growth}}).Validate()
}

type PlanningCycleDraft struct {
	ExpectedRevision   uint64               `json:"expected_revision"`
	Title              string               `json:"title"`
	StartsOn           string               `json:"starts_on"`
	EndsOn             string               `json:"ends_on"`
	GoalSummary        string               `json:"goal_summary"`
	ReviewIntervalDays int                  `json:"review_interval_days"`
	Budget             *PlanningCycleBudget `json:"budget"`
	Metric             *PlanningCycleMetric `json:"metric"`
}

func ValidatePlanningCycleDraft(input PlanningCycleDraft) error {
	if input.ExpectedRevision == 0 {
		return invalid("product_revision_required", "必须提供产品当前版本")
	}
	for _, field := range []struct {
		value string
		limit int
	}{{input.Title, 255}, {input.GoalSummary, 10000}} {
		if strings.TrimSpace(field.value) == "" || !utf8.ValidString(field.value) || strings.ContainsRune(field.value, '\x00') || utf8.RuneCountInString(field.value) > field.limit {
			return invalid("planning_cycle_text_invalid", "周期标题及目标摘要不能为空且须在长度限制内")
		}
	}
	start, err := time.Parse("2006-01-02", input.StartsOn)
	if err != nil || start.Format("2006-01-02") != input.StartsOn || start.Year() < 1000 {
		return invalid("planning_cycle_dates_invalid", "周期开始日期无效")
	}
	end, err := time.Parse("2006-01-02", input.EndsOn)
	if err != nil || end.Format("2006-01-02") != input.EndsOn || end.Before(start) {
		return invalid("planning_cycle_dates_invalid", "周期结束日期不得早于开始日期")
	}
	if input.ReviewIntervalDays < 1 || input.ReviewIntervalDays > 366 {
		return invalid("planning_cycle_interval_invalid", "复评间隔须为 1 至 366 天")
	}
	if input.Metric != nil {
		if err := ValidatePlanningCycleMetric(*input.Metric); err != nil {
			return err
		}
	}
	if input.Budget != nil {
		return input.Budget.Validate()
	}
	return nil
}

// The model snapshot is server-owned. Later configurable models must introduce
// a new version rather than accepting caller-defined weights under this name.
func planningCycleModelSnapshot() map[string]any {
	model := DefaultWeightedAssessmentModel()
	return map[string]any{"version": model.Version, "weights": map[string]int{"strategic": model.Strategic, "user_value": model.UserValue, "business": model.Business, "risk": model.Risk}, "effort_unit": "person_day", "confidence_values": []string{"0.50", "0.80", "1.00"}, "minimum_effort_person_days": "0.50"}
}

func CreatePlanningCycle(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input PlanningCycleDraft) (CommandResult, error) {
	if identity.Action != "product_priorities:cycle-create" {
		return CommandResult{}, invalid("product_command_identity_invalid", "周期创建命令不匹配")
	}
	if err := ValidatePlanningCycleDraft(input); err != nil {
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
		var total, reserve, reliability, usability, growth any
		if b := input.Budget; b != nil {
			total = b.Total.String()
			reserve = b.Reserve.String()
			reliability = b.Reliability.String()
			usability = b.Usability.String()
			growth = b.Growth.String()
		}
		model := planningCycleModelSnapshot()
		modelJSON, err := json.Marshal(model)
		if err != nil {
			return nil, err
		}
		metricDefinition, baselineValue, targetValue, err := planningCycleMetricColumns(input.Metric)
		if err != nil {
			return nil, err
		}
		bizID := uuid.NewString()
		result, err := tx.ExecContext(ctx, `INSERT INTO product_planning_cycles(biz_id,product_code,title,starts_on,ends_on,goal_summary,total_person_days,reserve_person_days,reliability_person_days,usability_person_days,growth_person_days,model_version,model_snapshot,review_interval_days,metric_definition,baseline_value,target_value,status,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, bizID, identity.ProductCode, input.Title, input.StartsOn, input.EndsOn, input.GoalSummary, total, reserve, reliability, usability, growth, AssessmentModel, modelJSON, input.ReviewIntervalDays, metricDefinition, baselineValue, targetValue, identity.ActorUID, identity.ActorUID)
		if err != nil {
			return nil, err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		value := map[string]any{"id": id, "biz_id": bizID, "product_code": identity.ProductCode, "title": input.Title, "starts_on": input.StartsOn, "ends_on": input.EndsOn, "goal_summary": input.GoalSummary, "budget": input.Budget, "review_interval_days": input.ReviewIntervalDays, "status": "draft", "revision": 1, "queue_revision": 1, "workspace_revision": root.Revision + 1, "model_version": AssessmentModel, "model_snapshot": model, "next_review_at": nil, "metric": input.Metric}
		changes, err := json.Marshal(map[string]any{"after": value})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'planning_cycle',?,'create',?,1,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, bizID, identity.ActorUID, changes, identity.IdempotencyKey)
		return value, err
	})
}
