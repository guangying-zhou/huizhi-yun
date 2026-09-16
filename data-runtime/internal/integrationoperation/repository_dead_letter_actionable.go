package integrationoperation

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const materializeDeadLetterActionablesSQL = `
INSERT IGNORE INTO integration_operation_dead_letter_actionable (
  operation_id, generation_no, tenant_code, deployment_code, source_app,
  target_app, operation_code, source_biz_type, source_biz_code,
  attempt_count, max_attempts, last_error_code, last_error_class,
  dead_lettered_at, original_actor_uid, source_operation_version,
  actionable_key, publish_object_version, created_at, updated_at
)
SELECT
  operation_id, version_no, tenant_code, deployment_code, source_app,
  target_app, operation_code, source_biz_type, source_biz_code,
  attempt_count, max_attempts, last_error_code, last_error_class,
  dead_lettered_at, original_actor_uid, version_no,
  CONCAT('integration-operation:', source_app, ':', operation_id, ':dead-letter:g', version_no),
  CONCAT('dead-letter:g', version_no, ':operation-v', version_no), ?, ?
FROM integration_operation
WHERE tenant_code = ?
  AND deployment_code = ?
  AND source_app = ?
  AND status = 'dead_letter'
  AND dead_lettered_at IS NOT NULL`

const listPendingDeadLetterActionablesSQL = `
SELECT
  d.operation_id, d.generation_no, d.target_app, d.operation_code,
  d.source_biz_type, d.source_biz_code, d.attempt_count, d.max_attempts,
  d.last_error_code, d.last_error_class, d.dead_lettered_at,
  d.original_actor_uid, d.source_operation_version, d.actionable_key,
  d.publish_object_version
FROM integration_operation_dead_letter_actionable d
WHERE d.tenant_code = ?
  AND d.deployment_code = ?
  AND d.source_app = ?
  AND d.publish_acked_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM integration_operation_dead_letter_actionable prior
    WHERE prior.operation_id = d.operation_id
      AND prior.generation_no < d.generation_no
      AND prior.closure_state IS NOT NULL
      AND prior.closure_acked_at IS NULL
  )
ORDER BY d.dead_lettered_at, d.operation_id, d.generation_no
LIMIT ?`

const markDeadLetterActionablePublishedSQL = `
UPDATE integration_operation_dead_letter_actionable
SET notification_id = ?, recipient_uids = CAST(? AS JSON), publish_acked_at = ?, updated_at = ?
WHERE operation_id = ? AND generation_no = ?
  AND tenant_code = ? AND deployment_code = ? AND source_app = ?
  AND source_operation_version = ? AND actionable_key = ? AND publish_object_version = ?
  AND publish_acked_at IS NULL`

const loadDeadLetterActionablePublishedAckSQL = `
SELECT notification_id, recipient_uids, publish_object_version
FROM integration_operation_dead_letter_actionable
WHERE operation_id = ? AND generation_no = ?
  AND tenant_code = ? AND deployment_code = ? AND source_app = ?
  AND source_operation_version = ? AND actionable_key = ?
LIMIT 1`

const listPendingDeadLetterClosuresSQL = `
SELECT operation_id, generation_no, actionable_key, publish_object_version,
       closure_object_version, closure_state, recipient_uids
FROM integration_operation_dead_letter_actionable
WHERE tenant_code = ? AND deployment_code = ? AND source_app = ?
  AND publish_acked_at IS NOT NULL
  AND closure_state IS NOT NULL
  AND closure_acked_at IS NULL
ORDER BY closure_pending_at, operation_id, generation_no
LIMIT ?`

const markDeadLetterClosureAcknowledgedSQL = `
UPDATE integration_operation_dead_letter_actionable
SET closure_acked_at = ?, updated_at = ?
WHERE operation_id = ? AND generation_no = ?
  AND tenant_code = ? AND deployment_code = ? AND source_app = ?
  AND actionable_key = ? AND publish_object_version = ?
  AND closure_object_version = ? AND closure_state = ?
  AND publish_acked_at IS NOT NULL AND closure_acked_at IS NULL`

const loadDeadLetterClosureAckSQL = `
SELECT closure_acked_at
FROM integration_operation_dead_letter_actionable
WHERE operation_id = ? AND generation_no = ?
  AND tenant_code = ? AND deployment_code = ? AND source_app = ?
  AND actionable_key = ? AND publish_object_version = ?
  AND closure_object_version = ? AND closure_state = ?
LIMIT 1`

const markLatestDeadLetterGenerationClosureSQL = `
UPDATE integration_operation_dead_letter_actionable
SET closure_state = ?,
    closure_object_version = CONCAT(?, ':g', generation_no, ':operation-v', ?),
    closure_pending_at = ?, updated_at = ?
WHERE operation_id = ?
  AND source_operation_version <= ?
  AND closure_state IS NULL
ORDER BY generation_no DESC
LIMIT 1`

const authorizeDeadLetterNotificationSQL = `
SELECT d.recipient_uids, d.closure_state, i.status, i.version_no, d.source_operation_version
FROM integration_operation_dead_letter_actionable d
JOIN integration_operation i ON i.operation_id = d.operation_id
WHERE d.operation_id = ? AND d.notification_id = ?
  AND d.tenant_code = ? AND d.deployment_code = ? AND d.source_app = ?
  AND d.publish_acked_at IS NOT NULL
ORDER BY d.generation_no DESC
LIMIT 1`

type DeadLetterActionableCandidate struct {
	OperationID, TargetApp, OperationCode, SourceBizType, SourceBizCode string
	LastErrorCode, LastErrorClass, OriginalActorUID                     string
	ActionableKey, ObjectVersion                                        string
	Generation, OperationVersion                                        uint64
	AttemptCount, MaxAttempts                                           int
	DeadLetteredAt                                                      time.Time
}

type MarkDeadLetterActionablePublishedInput struct {
	TenantCode, DeploymentCode, SourceApp, OperationID string
	ActionableKey, ObjectVersion, NotificationID       string
	Generation, OperationVersion                       uint64
	RecipientUIDs                                      []string
	Now                                                time.Time
}

type DeadLetterClosureCandidate struct {
	OperationID, ActionableKey, ExpectedVersion, NextVersion string
	State                                                    string
	Generation                                               uint64
	RecipientUIDs                                            []string
}

type MarkDeadLetterClosureAcknowledgedInput struct {
	TenantCode, DeploymentCode, SourceApp, OperationID string
	ActionableKey, ExpectedVersion, NextVersion, State string
	Generation                                         uint64
	Now                                                time.Time
}

type AuthorizeDeadLetterNotificationInput struct {
	TenantCode, DeploymentCode, SourceApp, OperationID string
	NotificationID, SubjectUID                         string
}

func validateDeadLetterLimit(limit int) error {
	if limit < 1 || limit > 20 {
		return fmt.Errorf("dead-letter actionable limit must be between 1 and 20")
	}
	return nil
}

func normalizeRecipientUIDs(values []string) ([]string, error) {
	if len(values) < 1 || len(values) > 100 {
		return nil, fmt.Errorf("recipient_uids must contain between 1 and 100 values")
	}
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" || strings.EqualFold(value, "@all") || !identityValuePattern.MatchString(value) {
			return nil, fmt.Errorf("%w: recipient_uid", ErrInvalidIdentity)
		}
		if !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	if len(result) == 0 {
		return nil, fmt.Errorf("recipient_uids are required")
	}
	sort.Strings(result)
	return result, nil
}

func (r *Repository) ListPendingDeadLetterActionables(ctx context.Context, tenantCode, deploymentCode, sourceApp string, limit int, now time.Time) ([]DeadLetterActionableCandidate, error) {
	if err := validateFailureNotificationScope(tenantCode, deploymentCode, sourceApp); err != nil {
		return nil, err
	}
	if err := validateDeadLetterLimit(limit); err != nil {
		return nil, err
	}
	if now.IsZero() {
		return nil, fmt.Errorf("dead-letter actionable scan time is required")
	}
	if _, err := r.db.ExecContext(ctx, materializeDeadLetterActionablesSQL, now, now, tenantCode, deploymentCode, sourceApp); err != nil {
		return nil, err
	}
	rows, err := r.db.QueryContext(ctx, listPendingDeadLetterActionablesSQL, tenantCode, deploymentCode, sourceApp, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]DeadLetterActionableCandidate, 0)
	for rows.Next() {
		var item DeadLetterActionableCandidate
		var errorCode, errorClass, actor sql.NullString
		if err := rows.Scan(&item.OperationID, &item.Generation, &item.TargetApp, &item.OperationCode, &item.SourceBizType, &item.SourceBizCode, &item.AttemptCount, &item.MaxAttempts, &errorCode, &errorClass, &item.DeadLetteredAt, &actor, &item.OperationVersion, &item.ActionableKey, &item.ObjectVersion); err != nil {
			return nil, err
		}
		item.LastErrorCode, item.LastErrorClass, item.OriginalActorUID = errorCode.String, errorClass.String, actor.String
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *Repository) MarkDeadLetterActionablePublished(ctx context.Context, input MarkDeadLetterActionablePublishedInput) (bool, error) {
	if err := validateFailureNotificationScope(input.TenantCode, input.DeploymentCode, input.SourceApp); err != nil {
		return false, err
	}
	if err := ValidateOperationID(input.OperationID); err != nil {
		return false, err
	}
	if input.Generation == 0 || input.OperationVersion == 0 || input.Now.IsZero() {
		return false, fmt.Errorf("generation, operation version and ack time are required")
	}
	for name, value := range map[string]string{"actionable_key": input.ActionableKey, "object_version": input.ObjectVersion, "notification_id": input.NotificationID} {
		if !identityValuePattern.MatchString(strings.TrimSpace(value)) {
			return false, fmt.Errorf("%w: %s", ErrInvalidIdentity, name)
		}
	}
	recipients, err := normalizeRecipientUIDs(input.RecipientUIDs)
	if err != nil {
		return false, err
	}
	recipientJSON, _ := json.Marshal(recipients)
	result, err := r.db.ExecContext(ctx, markDeadLetterActionablePublishedSQL, input.NotificationID, string(recipientJSON), input.Now, input.Now, input.OperationID, input.Generation, input.TenantCode, input.DeploymentCode, input.SourceApp, input.OperationVersion, input.ActionableKey, input.ObjectVersion)
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
	var notificationID, storedRecipients, objectVersion string
	err = r.db.QueryRowContext(ctx, loadDeadLetterActionablePublishedAckSQL, input.OperationID, input.Generation, input.TenantCode, input.DeploymentCode, input.SourceApp, input.OperationVersion, input.ActionableKey).Scan(&notificationID, &storedRecipients, &objectVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return false, ErrOperationNotFound
	}
	if err != nil {
		return false, err
	}
	if notificationID == input.NotificationID && storedRecipients == string(recipientJSON) && objectVersion == input.ObjectVersion {
		return true, nil
	}
	return false, ErrPersistenceRace
}

func (r *Repository) ListPendingDeadLetterClosures(ctx context.Context, tenantCode, deploymentCode, sourceApp string, limit int) ([]DeadLetterClosureCandidate, error) {
	if err := validateFailureNotificationScope(tenantCode, deploymentCode, sourceApp); err != nil {
		return nil, err
	}
	if err := validateDeadLetterLimit(limit); err != nil {
		return nil, err
	}
	rows, err := r.db.QueryContext(ctx, listPendingDeadLetterClosuresSQL, tenantCode, deploymentCode, sourceApp, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]DeadLetterClosureCandidate, 0)
	for rows.Next() {
		var item DeadLetterClosureCandidate
		var recipientsJSON []byte
		if err := rows.Scan(&item.OperationID, &item.Generation, &item.ActionableKey, &item.ExpectedVersion, &item.NextVersion, &item.State, &recipientsJSON); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(recipientsJSON, &item.RecipientUIDs); err != nil {
			return nil, fmt.Errorf("%w: invalid dead-letter recipients", ErrCorruptOperation)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *Repository) MarkDeadLetterClosureAcknowledged(ctx context.Context, input MarkDeadLetterClosureAcknowledgedInput) (bool, error) {
	if err := validateFailureNotificationScope(input.TenantCode, input.DeploymentCode, input.SourceApp); err != nil {
		return false, err
	}
	if err := ValidateOperationID(input.OperationID); err != nil {
		return false, err
	}
	if input.Generation == 0 || input.Now.IsZero() || (input.State != "resolved" && input.State != "cancelled") {
		return false, fmt.Errorf("valid generation, state and ack time are required")
	}
	for name, value := range map[string]string{"actionable_key": input.ActionableKey, "expected_version": input.ExpectedVersion, "next_version": input.NextVersion} {
		if !identityValuePattern.MatchString(strings.TrimSpace(value)) {
			return false, fmt.Errorf("%w: %s", ErrInvalidIdentity, name)
		}
	}
	if input.ExpectedVersion == input.NextVersion {
		return false, fmt.Errorf("closure versions must differ")
	}
	result, err := r.db.ExecContext(ctx, markDeadLetterClosureAcknowledgedSQL, input.Now, input.Now, input.OperationID, input.Generation, input.TenantCode, input.DeploymentCode, input.SourceApp, input.ActionableKey, input.ExpectedVersion, input.NextVersion, input.State)
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
	var acknowledged sql.NullTime
	err = r.db.QueryRowContext(ctx, loadDeadLetterClosureAckSQL, input.OperationID, input.Generation, input.TenantCode, input.DeploymentCode, input.SourceApp, input.ActionableKey, input.ExpectedVersion, input.NextVersion, input.State).Scan(&acknowledged)
	if errors.Is(err, sql.ErrNoRows) {
		return false, ErrOperationNotFound
	}
	if err != nil {
		return false, err
	}
	if acknowledged.Valid {
		return true, nil
	}
	return false, ErrPersistenceRace
}

func markLatestDeadLetterGenerationClosure(ctx context.Context, tx *sql.Tx, operationID string, maximumSourceVersion uint64, state string, operationVersion uint64, now time.Time) error {
	_, err := tx.ExecContext(ctx, markLatestDeadLetterGenerationClosureSQL, state, state, operationVersion, now, now, operationID, maximumSourceVersion)
	return err
}

func (r *Repository) AuthorizeDeadLetterNotification(ctx context.Context, input AuthorizeDeadLetterNotificationInput) (bool, string, error) {
	if err := validateFailureNotificationScope(input.TenantCode, input.DeploymentCode, input.SourceApp); err != nil {
		return false, "", err
	}
	if err := ValidateOperationID(input.OperationID); err != nil {
		return false, "", err
	}
	if !identityValuePattern.MatchString(strings.TrimSpace(input.NotificationID)) || !identityValuePattern.MatchString(strings.TrimSpace(input.SubjectUID)) {
		return false, "", fmt.Errorf("%w: notification identity", ErrInvalidIdentity)
	}
	var recipientsJSON []byte
	var closureState sql.NullString
	var status string
	var currentVersion, sourceVersion uint64
	err := r.db.QueryRowContext(ctx, authorizeDeadLetterNotificationSQL, input.OperationID, input.NotificationID, input.TenantCode, input.DeploymentCode, input.SourceApp).Scan(&recipientsJSON, &closureState, &status, &currentVersion, &sourceVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return false, "not_found", nil
	}
	if err != nil {
		return false, "", err
	}
	var recipients []string
	if err := json.Unmarshal(recipientsJSON, &recipients); err != nil {
		return false, "", fmt.Errorf("%w: invalid dead-letter recipients", ErrCorruptOperation)
	}
	member := false
	for _, recipient := range recipients {
		if recipient == input.SubjectUID {
			member = true
			break
		}
	}
	if !member {
		return false, "not_recipient", nil
	}
	if closureState.Valid || Status(status) != StatusDeadLetter || currentVersion != sourceVersion {
		return false, "stale_notification", nil
	}
	return true, "allowed", nil
}
