package integrationoperation

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

const listPendingFailureNotificationsSQL = `
SELECT
  operation_id,
  operation_key,
  target_app,
  operation_code,
  source_biz_type,
  source_biz_code,
  attempt_count,
  max_attempts,
  last_error_code,
  last_error_class,
  dead_lettered_at,
  original_actor_uid
FROM integration_operation
WHERE tenant_code = ?
  AND deployment_code = ?
  AND source_app = ?
  AND status = 'dead_letter'
  AND failure_notified_at IS NULL
ORDER BY dead_lettered_at, operation_id
LIMIT ?`

const markFailureNotifiedSQL = `
UPDATE integration_operation
SET failure_notified_at = ?,
    failure_notification_id = ?,
    updated_at = ?
WHERE operation_id = ?
  AND tenant_code = ?
  AND deployment_code = ?
  AND source_app = ?
  AND status = 'dead_letter'
  AND failure_notified_at IS NULL`

const loadFailureNotificationMarkerSQL = `
SELECT failure_notification_id
FROM integration_operation
WHERE operation_id = ?
  AND tenant_code = ?
  AND deployment_code = ?
  AND source_app = ?
  AND status = 'dead_letter'
LIMIT 1`

type FailureNotificationCandidate struct {
	OperationID      string
	OperationKey     string
	TargetApp        string
	OperationCode    string
	SourceBizType    string
	SourceBizCode    string
	AttemptCount     int
	MaxAttempts      int
	LastErrorCode    string
	LastErrorClass   string
	DeadLetteredAt   time.Time
	OriginalActorUID string
}

type MarkFailureNotifiedInput struct {
	TenantCode     string
	DeploymentCode string
	SourceApp      string
	OperationID    string
	NotificationID string
	Now            time.Time
}

func (r *Repository) listPendingFailureNotifications(ctx context.Context, executor notificationExecutor, tenantCode, deploymentCode, sourceApp string, limit int) ([]FailureNotificationCandidate, error) {
	if err := validateFailureNotificationScope(tenantCode, deploymentCode, sourceApp); err != nil {
		return nil, err
	}
	if limit < 1 || limit > 20 {
		return nil, fmt.Errorf("failure notification limit must be between 1 and 20")
	}
	rows, err := executor.QueryContext(ctx, r.sql(listPendingFailureNotificationsSQL), tenantCode, deploymentCode, sourceApp, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]FailureNotificationCandidate, 0)
	for rows.Next() {
		var item FailureNotificationCandidate
		var errorCode sql.NullString
		var errorClass sql.NullString
		var originalActorUID sql.NullString
		if err := rows.Scan(
			&item.OperationID,
			&item.OperationKey,
			&item.TargetApp,
			&item.OperationCode,
			&item.SourceBizType,
			&item.SourceBizCode,
			&item.AttemptCount,
			&item.MaxAttempts,
			&errorCode,
			&errorClass,
			&item.DeadLetteredAt,
			&originalActorUID,
		); err != nil {
			return nil, err
		}
		item.LastErrorCode = errorCode.String
		item.LastErrorClass = errorClass.String
		item.OriginalActorUID = originalActorUID.String
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *Repository) markFailureNotified(ctx context.Context, executor notificationExecutor, input MarkFailureNotifiedInput) (bool, error) {
	if err := validateFailureNotificationScope(input.TenantCode, input.DeploymentCode, input.SourceApp); err != nil {
		return false, err
	}
	if err := ValidateOperationID(input.OperationID); err != nil {
		return false, err
	}
	if !identityValuePattern.MatchString(strings.TrimSpace(input.NotificationID)) {
		return false, fmt.Errorf("%w: notification_id", ErrInvalidIdentity)
	}
	if input.Now.IsZero() {
		return false, fmt.Errorf("failure notification time is required")
	}
	result, err := executor.ExecContext(
		ctx,
		r.sql(markFailureNotifiedSQL),
		input.Now,
		input.NotificationID,
		input.Now,
		input.OperationID,
		input.TenantCode,
		input.DeploymentCode,
		input.SourceApp,
	)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if affected == 1 {
		return true, nil
	}
	var existing sql.NullString
	err = executor.QueryRowContext(
		ctx,
		r.sql(loadFailureNotificationMarkerSQL),
		input.OperationID,
		input.TenantCode,
		input.DeploymentCode,
		input.SourceApp,
	).Scan(&existing)
	if err != nil {
		if err == sql.ErrNoRows {
			return false, ErrOperationNotFound
		}
		return false, err
	}
	if existing.String == input.NotificationID {
		return true, nil
	}
	return false, ErrPersistenceRace
}

func validateFailureNotificationScope(tenantCode string, deploymentCode string, sourceApp string) error {
	for name, value := range map[string]string{
		"tenant_code": tenantCode, "deployment_code": deploymentCode, "source_app": sourceApp,
	} {
		if !identityValuePattern.MatchString(strings.TrimSpace(value)) {
			return fmt.Errorf("%w: %s", ErrInvalidIdentity, name)
		}
	}
	return nil
}
