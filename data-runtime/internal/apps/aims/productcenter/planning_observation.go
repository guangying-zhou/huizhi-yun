package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"
)

// Observations are attributed manual results, never inferred from task progress.
type PlanningObservationCreate struct {
	PlanningCycleTransition
	ValueMode       string  `json:"value_mode"`
	ObservedValue   *string `json:"observed_value"`
	ObservedAt      string  `json:"observed_at"`
	EvidenceSummary string  `json:"evidence_summary"`
	EvidenceSource  string  `json:"evidence_source"`
	Conclusion      string  `json:"conclusion"`
	CorrectionOfID  *int64  `json:"correction_of_id"`
}

func ValidatePlanningObservationCreate(input PlanningObservationCreate) error {
	if err := ValidatePlanningCycleTransition(input.PlanningCycleTransition); err != nil {
		return err
	}
	if input.ValueMode != "known" && input.ValueMode != "unknown" {
		return invalid("planning_observation_invalid", "必须明确观测值是否已知")
	}
	if (input.ValueMode == "known") != (input.ObservedValue != nil) || (input.ObservedValue != nil && !cycleMetricDecimal.MatchString(*input.ObservedValue)) {
		return invalid("planning_observation_invalid", "观测值须为有效十进制字符串；未知不能填写数值")
	}
	observed, err := time.Parse(time.RFC3339Nano, input.ObservedAt)
	if err != nil || observed.Year() < 1000 || observed.Year() > 9999 || observed.Nanosecond()%1_000_000 != 0 {
		return invalid("planning_observation_invalid", "观测时间须包含时区且精度不超过毫秒")
	}
	if input.CorrectionOfID != nil && *input.CorrectionOfID < 1 {
		return invalid("planning_observation_invalid", "更正对象标识无效")
	}
	for _, value := range []string{input.EvidenceSummary, input.EvidenceSource, input.Conclusion} {
		if strings.TrimSpace(value) == "" || !utf8.ValidString(value) || strings.ContainsRune(value, '\x00') || utf8.RuneCountInString(value) > 2000 {
			return invalid("planning_observation_invalid", "证据摘要、来源与结论必须明确，最多 2000 字")
		}
	}
	return nil
}

func CreatePlanningObservation(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input PlanningObservationCreate) (CommandResult, error) {
	if identity.Action != "product_priorities:observation-create" {
		return CommandResult{}, invalid("product_command_identity_invalid", "观测命令不匹配")
	}
	if err := ValidatePlanningObservationCreate(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "observe", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "产品空间已归档")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化，请重新读取")
		}
		cycle, err := loadPlanningCycle(ctx, tx, identity.ProductCode, input.BizID)
		if err != nil {
			return nil, err
		}
		if cycle.Revision != input.ExpectedCycleRevision {
			return nil, invalid("planning_cycle_revision_conflict", "周期已变化，请重新读取")
		}
		if cycle.Status != "open" && cycle.Status != "closed" {
			return nil, invalid("planning_cycle_state_conflict", "草案周期不能记录正式观测")
		}
		observed, _ := time.Parse(time.RFC3339Nano, input.ObservedAt)
		if observed.After(time.Now().UTC()) {
			return nil, invalid("planning_observation_invalid", "观测时间不能晚于当前时间")
		}
		var metric PlanningCycleMetric
		if err = json.Unmarshal(cycle.MetricDefinition, &metric); err != nil {
			return nil, invalid("planning_cycle_metric_required", "周期缺少有效指标定义")
		}
		metric.BaselineValue = cycle.BaselineValue
		metric.TargetValue = cycle.TargetValue
		if err = ValidatePlanningCycleMetric(metric); err != nil {
			return nil, err
		}
		snapshot, err := json.Marshal(metric)
		if err != nil {
			return nil, err
		}
		if input.CorrectionOfID != nil {
			// Bind corrections to this cycle, and prevent competing correction branches.
			var prior []byte
			if err = tx.QueryRowContext(ctx, `SELECT metric_snapshot FROM product_outcome_observations WHERE id=? AND cycle_id=?`, *input.CorrectionOfID, cycle.ID).Scan(&prior); err != nil {
				return nil, err
			}
			var corrected bool
			if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM product_outcome_observations WHERE correction_of_id=? AND cycle_id=?)`, *input.CorrectionOfID, cycle.ID).Scan(&corrected); err != nil {
				return nil, err
			}
			if corrected {
				return nil, invalid("planning_observation_already_corrected", "该记录已有更正，请基于最新更正追加")
			}
			// A correction keeps the original measurement contract.
			if err = json.Unmarshal(prior, &metric); err != nil {
				return nil, err
			}
			if err = ValidatePlanningCycleMetric(metric); err != nil {
				return nil, err
			}
			snapshot = prior
		}
		evidence, err := json.Marshal(map[string]string{"summary": input.EvidenceSummary, "source": input.EvidenceSource, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		var value any
		if input.ObservedValue != nil {
			value = canonicalCycleMetricValue(*input.ObservedValue)
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO product_outcome_observations(cycle_id,metric_snapshot,observed_value,observed_at,evidence,conclusion,correction_of_id,recorded_by,recorded_at) VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`, cycle.ID, snapshot, value, observed.UTC(), evidence, input.Conclusion, input.CorrectionOfID, identity.ActorUID)
		if err != nil {
			return nil, err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_cycles SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, identity.ActorUID, cycle.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"id": id, "cycle_biz_id": cycle.BizID, "workspace_revision": root.Revision + 1, "cycle_revision": cycle.Revision + 1, "correction_of_id": input.CorrectionOfID}
		changes, err := json.Marshal(map[string]any{"observation": out, "input": input, "metric_snapshot": json.RawMessage(snapshot)})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'planning_cycle',?,'observe',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, cycle.BizID, identity.ActorUID, cycle.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
