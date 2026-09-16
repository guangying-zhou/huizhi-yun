package integrationoperation

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type AttemptTimelineInput struct {
	TenantCode     string
	DeploymentCode string
	SourceApp      string
	OperationID    string
	Limit          int
}

type AttemptTimelineEntry struct {
	AttemptID     string     `json:"attemptId"`
	OperationID   string     `json:"operationId"`
	OperationCode string     `json:"operationCode"`
	AttemptNo     int        `json:"attemptNo"`
	TriggerType   string     `json:"triggerType"`
	ResultStatus  string     `json:"resultStatus"`
	HTTPStatus    int        `json:"httpStatus,omitempty"`
	ErrorCode     string     `json:"errorCode,omitempty"`
	ErrorClass    string     `json:"errorClass,omitempty"`
	TargetBizType string     `json:"targetBizType,omitempty"`
	TargetBizCode string     `json:"targetBizCode,omitempty"`
	StartedAt     time.Time  `json:"startedAt"`
	FinishedAt    *time.Time `json:"finishedAt,omitempty"`
	DurationMS    *uint64    `json:"durationMs,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
}

func (r *Repository) ListAttemptTimeline(ctx context.Context, input AttemptTimelineInput) ([]AttemptTimelineEntry, error) {
	for name, value := range map[string]string{
		"tenant_code": input.TenantCode, "deployment_code": input.DeploymentCode, "source_app": input.SourceApp,
	} {
		if !identityValuePattern.MatchString(value) {
			return nil, fmt.Errorf("%w: attempt timeline %s", ErrInvalidIdentity, name)
		}
	}
	if err := ValidateOperationID(input.OperationID); err != nil {
		return nil, err
	}
	if input.Limit < 1 || input.Limit > 100 {
		return nil, fmt.Errorf("attempt timeline limit must be between 1 and 100")
	}
	rows, err := r.db.QueryContext(ctx, `
SELECT
  a.attempt_id, a.operation_id, a.operation_code, a.attempt_no, a.trigger_type,
  a.result_status,
  a.http_status, a.error_code, a.error_class, a.target_biz_type, a.target_biz_code,
  a.started_at, a.finished_at, a.duration_ms, a.created_at
FROM integration_operation_attempt a
INNER JOIN integration_operation o ON o.operation_id = a.operation_id
WHERE o.tenant_code = ?
  AND o.deployment_code = ?
  AND o.source_app = ?
  AND o.operation_id = ?
ORDER BY a.attempt_no ASC
LIMIT ?`, input.TenantCode, input.DeploymentCode, input.SourceApp, input.OperationID, input.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]AttemptTimelineEntry, 0)
	for rows.Next() {
		var item AttemptTimelineEntry
		var errorCode, errorClass, targetBizType, targetBizCode sql.NullString
		var httpStatus, durationMS sql.NullInt64
		var finishedAt sql.NullTime
		if err := rows.Scan(
			&item.AttemptID, &item.OperationID, &item.OperationCode, &item.AttemptNo, &item.TriggerType,
			&item.ResultStatus,
			&httpStatus, &errorCode, &errorClass, &targetBizType, &targetBizCode,
			&item.StartedAt, &finishedAt, &durationMS, &item.CreatedAt,
		); err != nil {
			return nil, err
		}
		item.ErrorCode, item.ErrorClass = errorCode.String, errorClass.String
		item.TargetBizType, item.TargetBizCode = targetBizType.String, targetBizCode.String
		if httpStatus.Valid {
			item.HTTPStatus = int(httpStatus.Int64)
		}
		if finishedAt.Valid {
			value := finishedAt.Time
			item.FinishedAt = &value
		}
		if durationMS.Valid {
			value := uint64(durationMS.Int64)
			item.DurationMS = &value
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}
