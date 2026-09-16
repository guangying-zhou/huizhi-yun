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

type ProductObjectiveObservation struct {
	CorrectionOfID            *int64 `json:"correction_of_id"`
	CorrectionReason          string `json:"correction_reason"`
	ObjectiveID               int64  `json:"objective_id"`
	ExpectedRevision          uint64 `json:"expected_revision"`
	ExpectedObjectiveRevision uint64 `json:"expected_objective_revision"`
	ObservedOn                string `json:"observed_on"`
	MeasuredValue             string `json:"measured_value"`
	Evidence                  string `json:"evidence"`
	Note                      string `json:"note"`
}

func ValidateProductObjectiveObservation(input ProductObjectiveObservation) error {
	if input.ObjectiveID < 1 || input.ExpectedRevision < 1 || input.ExpectedObjectiveRevision < 1 || !cycleMetricDecimal.MatchString(input.MeasuredValue) {
		return invalid("product_objective_observation_invalid", "目标、修订或观测值无效")
	}
	if input.CorrectionOfID == nil && input.CorrectionReason != "" {
		return invalid("product_objective_correction_invalid", "更正原因须对应原观测")
	}
	if input.CorrectionOfID != nil && (*input.CorrectionOfID < 1 || strings.TrimSpace(input.CorrectionReason) == "" || !utf8.ValidString(input.CorrectionReason) || strings.ContainsRune(input.CorrectionReason, '\x00') || utf8.RuneCountInString(input.CorrectionReason) > 2000) {
		return invalid("product_objective_correction_invalid", "更正对象或原因无效")
	}
	observed, err := time.Parse("2006-01-02", input.ObservedOn)
	if err != nil || observed.Year() < 1000 {
		return invalid("product_objective_observation_invalid", "观测日期无效")
	}
	for _, field := range []struct {
		value    string
		required bool
	}{{input.Evidence, true}, {input.Note, false}} {
		if !utf8.ValidString(field.value) || strings.ContainsRune(field.value, '\x00') || utf8.RuneCountInString(field.value) > 10000 || (field.required && strings.TrimSpace(field.value) == "") {
			return invalid("product_objective_observation_invalid", "证据须明确，证据和备注最多10000字")
		}
	}
	return nil
}

func CreateProductObjectiveObservation(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductObjectiveObservation) (CommandResult, error) {
	if identity.Action != "product_objectives:observe" {
		return CommandResult{}, invalid("product_command_identity_invalid", "目标观测命令不匹配")
	}
	if err := ValidateProductObjectiveObservation(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_objectives", "observe", permit)
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
		objective, err := scanProductObjective(tx.QueryRowContext(ctx, `SELECT `+objectiveColumns+` FROM product_objectives WHERE BINARY product_code=BINARY ? AND id=? FOR UPDATE`, identity.ProductCode, input.ObjectiveID))
		if err != nil {
			return nil, err
		}
		if objective.Revision != input.ExpectedObjectiveRevision {
			return nil, invalid("product_objective_revision_conflict", "目标已变化")
		}
		if objective.Status != "active" && objective.Status != "closed" {
			return nil, invalid("product_objective_state_conflict", "仅进行中或已结束目标可记录观测")
		}
		if (input.CorrectionOfID == nil && (input.ObservedOn < objective.StartsOn || input.ObservedOn > objective.EndsOn)) || input.ObservedOn > time.Now().UTC().Format("2006-01-02") {
			return nil, invalid("product_objective_observation_invalid", "观测日期须在目标期间内且不晚于今天")
		}
		metric := objective.Metric
		metricRevision := objective.Revision
		if input.CorrectionOfID != nil {
			var originalSnapshot []byte
			var originalDate string
			if err = tx.QueryRowContext(ctx, `SELECT metric_snapshot,objective_revision,DATE_FORMAT(observed_on,'%Y-%m-%d') FROM product_objective_observations WHERE id=? AND objective_id=? AND BINARY product_code=BINARY ? FOR UPDATE`, *input.CorrectionOfID, objective.ID, identity.ProductCode).Scan(&originalSnapshot, &metricRevision, &originalDate); err != nil {
				return nil, err
			}
			if originalDate != input.ObservedOn {
				return nil, invalid("product_objective_correction_invalid", "更正须保留原观测日期")
			}
			var corrected bool
			if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM product_objective_observations WHERE correction_of_id=?)`, *input.CorrectionOfID).Scan(&corrected); err != nil {
				return nil, err
			}
			if corrected {
				return nil, invalid("product_objective_correction_conflict", "原记录已有更正，请选择最新更正记录")
			}
			if err = json.Unmarshal(originalSnapshot, &metric); err != nil {
				return nil, err
			}
		}
		attainment, err := ProductObjectiveAttainment(metric, &input.MeasuredValue)
		if err != nil {
			return nil, err
		}
		snapshot, err := json.Marshal(metric)
		if err != nil {
			return nil, err
		}
		bizID := uuid.NewString()
		var inserted sql.Result
		if input.CorrectionOfID == nil {
			inserted, err = tx.ExecContext(ctx, `INSERT INTO product_objective_observations(biz_id,objective_id,product_code,objective_revision,metric_snapshot,observed_on,measured_value,evidence,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`, bizID, objective.ID, identity.ProductCode, metricRevision, snapshot, input.ObservedOn, canonicalCycleMetricValue(input.MeasuredValue), input.Evidence, input.Note, identity.ActorUID)
		} else {
			inserted, err = tx.ExecContext(ctx, `INSERT INTO product_objective_observations(biz_id,objective_id,product_code,objective_revision,metric_snapshot,observed_on,measured_value,evidence,note,created_by,created_at,correction_of_id,correction_reason) VALUES(?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),?,?)`, bizID, objective.ID, identity.ProductCode, metricRevision, snapshot, input.ObservedOn, canonicalCycleMetricValue(input.MeasuredValue), input.Evidence, input.Note, identity.ActorUID, *input.CorrectionOfID, input.CorrectionReason)
		}
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
		out := map[string]any{"id": id, "biz_id": bizID, "objective_id": objective.ID, "product_code": identity.ProductCode, "objective_revision": metricRevision, "metric_snapshot": metric, "observed_on": input.ObservedOn, "measured_value": canonicalCycleMetricValue(input.MeasuredValue), "attainment_percent": attainment, "evidence": input.Evidence, "note": input.Note, "workspace_revision": root.Revision + 1, "correction_of_id": input.CorrectionOfID, "correction_reason": input.CorrectionReason}
		changes, err := json.Marshal(map[string]any{"after": out})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'objective_observation',?,'create',?,1,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(id, 10), identity.ActorUID, changes, identity.IdempotencyKey)
		return out, err
	})
}
