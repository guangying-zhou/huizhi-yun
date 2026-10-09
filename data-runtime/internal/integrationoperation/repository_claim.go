package integrationoperation

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const recoverExpiredLeasesSQL = `
UPDATE integration_operation
SET status = 'partial_unknown',
    next_attempt_at = ?,
    locked_by = NULL,
    locked_until = NULL,
    version_no = version_no + 1,
    updated_by = ?,
    updated_at = ?
WHERE tenant_code = ?
  AND deployment_code = ?
  AND source_app = ?
  AND status = 'processing'
  AND locked_until IS NOT NULL
  AND locked_until <= ?`

const recoverExpiredLeaseAttemptsSQL = `
UPDATE integration_operation_attempt attempt
INNER JOIN integration_operation operation
        ON operation.operation_id = attempt.operation_id
       AND operation.attempt_count = attempt.attempt_no
       AND operation.locked_by = attempt.locked_by
       AND operation.fencing_token = attempt.fencing_token
SET attempt.result_status = 'partial_unknown',
    attempt.error_code = 'lease_expired',
    attempt.error_class = 'transient',
    attempt.error_summary = 'worker lease expired before checkpoint',
    attempt.finished_at = ?,
    attempt.duration_ms = GREATEST(0, TIMESTAMPDIFF(MICROSECOND, attempt.started_at, ?) DIV 1000)
WHERE operation.tenant_code = ?
  AND operation.deployment_code = ?
  AND operation.source_app = ?
  AND operation.status = 'processing'
  AND operation.locked_until IS NOT NULL
  AND operation.locked_until <= ?
  AND attempt.result_status = 'processing'
  AND attempt.finished_at IS NULL`

const recoverExpiredLeaseByOperationKeySQL = `
UPDATE integration_operation
SET status = 'partial_unknown',
    next_attempt_at = ?,
    locked_by = NULL,
    locked_until = NULL,
    version_no = version_no + 1,
    updated_by = ?,
    updated_at = ?
WHERE tenant_code = ?
  AND deployment_code = ?
  AND source_app = ?
  AND operation_key = ?
  AND status = 'processing'
  AND locked_until IS NOT NULL
  AND locked_until <= ?`

const recoverExpiredLeaseAttemptByOperationKeySQL = `
UPDATE integration_operation_attempt attempt
INNER JOIN integration_operation operation
        ON operation.operation_id = attempt.operation_id
       AND operation.attempt_count = attempt.attempt_no
       AND operation.locked_by = attempt.locked_by
       AND operation.fencing_token = attempt.fencing_token
SET attempt.result_status = 'partial_unknown',
    attempt.error_code = 'lease_expired',
    attempt.error_class = 'transient',
    attempt.error_summary = 'worker lease expired before checkpoint',
    attempt.finished_at = ?,
    attempt.duration_ms = GREATEST(0, TIMESTAMPDIFF(MICROSECOND, attempt.started_at, ?) DIV 1000)
WHERE operation.tenant_code = ?
  AND operation.deployment_code = ?
  AND operation.source_app = ?
  AND operation.operation_key = ?
  AND operation.status = 'processing'
  AND operation.locked_until IS NOT NULL
  AND operation.locked_until <= ?
  AND attempt.result_status = 'processing'
  AND attempt.finished_at IS NULL`

const claimNextSQL = `
SELECT
  o.operation_id,
  o.operation_key,
  o.correlation_key,
  o.sequence_no,
  o.depends_on_operation_key,
  o.tenant_code,
  o.deployment_code,
  o.source_app,
  o.target_app,
  o.operation_code,
  o.required_capability,
  o.source_biz_type,
  o.source_biz_code,
  o.target_biz_type,
  o.target_biz_code,
  o.idempotency_key,
  o.command_schema_version,
  o.command_json,
  o.command_sha256,
  o.status,
  o.attempt_count,
  o.max_attempts,
  o.fencing_token,
  o.version_no,
  o.original_request_id,
  o.correlation_id,
  o.original_actor_uid,
  o.service_client_id,
  o.replay_count,
  o.created_at
FROM integration_operation o
WHERE o.tenant_code = ?
  AND o.deployment_code = ?
  AND o.source_app = ?
  AND o.status IN ('pending', 'retry_wait', 'partial_unknown')
  AND o.next_attempt_at <= ?
  AND (
    o.depends_on_operation_key IS NULL
    OR EXISTS (
      SELECT 1
      FROM integration_operation dependency
      WHERE dependency.tenant_code = o.tenant_code
        AND dependency.deployment_code = o.deployment_code
        AND dependency.source_app = o.source_app
        AND dependency.operation_key = o.depends_on_operation_key
        AND dependency.status = 'succeeded'
    )
  )
ORDER BY o.correlation_key, o.sequence_no, o.created_at, o.operation_id
LIMIT 1
FOR UPDATE SKIP LOCKED`

var claimByOperationKeySQL = strings.Replace(
	claimNextSQL,
	"\nORDER BY o.correlation_key",
	"\n  AND o.operation_key = ?\nORDER BY o.correlation_key",
	1,
)

const markClaimedSQL = `
UPDATE integration_operation
SET status = 'processing',
    attempt_count = ?,
    last_attempt_at = ?,
    locked_by = ?,
    locked_until = ?,
    fencing_token = ?,
    version_no = ?,
    updated_by = ?,
    updated_at = ?
WHERE operation_id = ?
  AND version_no = ?
  AND status = ?`

const insertAttemptSQL = `
INSERT INTO integration_operation_attempt (
  attempt_id,
  operation_id,
  operation_code,
  attempt_no,
  trigger_type,
  request_id,
  correlation_id,
  locked_by,
  fencing_token,
  result_status,
  started_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?)`

type claimRow struct {
	operation            ClaimedOperation
	status               Status
	previousAttemptCount int
	previousFencingToken uint64
	previousVersion      uint64
	replayCount          int
}

func (r *Repository) ClaimNext(
	ctx context.Context,
	tenantCode string,
	deploymentCode string,
	sourceApp string,
	worker string,
	now time.Time,
	lease time.Duration,
) (*ClaimedOperation, error) {
	return r.claim(ctx, tenantCode, deploymentCode, sourceApp, "", worker, now, lease, false)
}

func (r *Repository) ClaimByOperationKey(
	ctx context.Context,
	tenantCode string,
	deploymentCode string,
	sourceApp string,
	operationKey string,
	worker string,
	now time.Time,
	lease time.Duration,
) (*ClaimedOperation, error) {
	if !identityValuePattern.MatchString(operationKey) {
		return nil, fmt.Errorf("%w: operation_key", ErrInvalidIdentity)
	}
	return r.claim(ctx, tenantCode, deploymentCode, sourceApp, operationKey, worker, now, lease, true)
}

func (r *Repository) claim(
	ctx context.Context,
	tenantCode string,
	deploymentCode string,
	sourceApp string,
	operationKey string,
	worker string,
	now time.Time,
	lease time.Duration,
	forceImmediateTrigger bool,
) (*ClaimedOperation, error) {
	if err := validateRepositoryScope(tenantCode, deploymentCode, sourceApp, worker, now, lease); err != nil {
		return nil, err
	}
	tx, err := beginTx(ctx, r.db)
	if err != nil {
		return nil, err
	}
	defer rollback(tx)

	result, err := r.claimInTransaction(ctx, tx, tenantCode, deploymentCode, sourceApp, operationKey, worker, now, lease, forceImmediateTrigger)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

// ClaimNextInTransaction retains lease recovery, SKIP LOCKED and fencing in the
// caller-owned transaction. Delivery starts only after the caller commits it.
func (r *Repository) ClaimNextInTransaction(ctx context.Context, tx *sql.Tx, tenantCode, deploymentCode, sourceApp, worker string, now time.Time, lease time.Duration) (*ClaimedOperation, error) {
	return r.claimShared(ctx, tx, tenantCode, deploymentCode, sourceApp, "", worker, now, lease, false)
}

func (r *Repository) ClaimByOperationKeyInTransaction(ctx context.Context, tx *sql.Tx, tenantCode, deploymentCode, sourceApp, operationKey, worker string, now time.Time, lease time.Duration) (*ClaimedOperation, error) {
	if !identityValuePattern.MatchString(operationKey) {
		if tx != nil {
			rollback(tx)
		}
		return nil, fmt.Errorf("%w: operation_key", ErrInvalidIdentity)
	}
	return r.claimShared(ctx, tx, tenantCode, deploymentCode, sourceApp, operationKey, worker, now, lease, true)
}

func (r *Repository) claimShared(ctx context.Context, tx *sql.Tx, tenantCode, deploymentCode, sourceApp, operationKey, worker string, now time.Time, lease time.Duration, immediate bool) (out *ClaimedOperation, err error) {
	if tx == nil {
		return nil, fmt.Errorf("integration operation transaction is required")
	}
	defer func() {
		if err != nil {
			rollback(tx)
		}
	}()
	if err = validateRepositoryScope(tenantCode, deploymentCode, sourceApp, worker, now, lease); err != nil {
		return nil, err
	}
	return r.claimInTransaction(ctx, tx, tenantCode, deploymentCode, sourceApp, operationKey, worker, now, lease, immediate)
}

func (r *Repository) claimInTransaction(ctx context.Context, tx *sql.Tx, tenantCode, deploymentCode, sourceApp, operationKey, worker string, now time.Time, lease time.Duration, forceImmediateTrigger bool) (*ClaimedOperation, error) {
	if operationKey == "" {
		if _, err := tx.ExecContext(
			ctx,
			r.sql(recoverExpiredLeaseAttemptsSQL),
			now, now,
			tenantCode, deploymentCode, sourceApp, now,
		); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(
			ctx,
			r.sql(recoverExpiredLeasesSQL),
			now, worker, now,
			tenantCode, deploymentCode, sourceApp, now,
		); err != nil {
			return nil, err
		}
	} else {
		if _, err := tx.ExecContext(
			ctx,
			r.sql(recoverExpiredLeaseAttemptByOperationKeySQL),
			now, now,
			tenantCode, deploymentCode, sourceApp, operationKey, now,
		); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(
			ctx,
			r.sql(recoverExpiredLeaseByOperationKeySQL),
			now, worker, now,
			tenantCode, deploymentCode, sourceApp, operationKey, now,
		); err != nil {
			return nil, err
		}
	}

	var claimQuery *sql.Row
	if operationKey == "" {
		claimQuery = tx.QueryRowContext(ctx, r.sql(claimNextSQL), tenantCode, deploymentCode, sourceApp, now)
	} else {
		claimQuery = tx.QueryRowContext(ctx, r.sql(claimByOperationKeySQL), tenantCode, deploymentCode, sourceApp, now, operationKey)
	}
	row, err := scanClaimRow(claimQuery)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	attemptID, err := r.newAttemptID()
	if err != nil {
		return nil, err
	}
	if err := ValidateOperationID(attemptID); err != nil {
		return nil, fmt.Errorf("attempt ID generator: %w", err)
	}

	attemptCount := row.previousAttemptCount + 1
	fencingToken := row.previousFencingToken + 1
	version := row.previousVersion + 1
	lockedUntil := now.Add(lease)
	result, err := tx.ExecContext(
		ctx,
		r.sql(markClaimedSQL),
		attemptCount,
		now,
		worker,
		lockedUntil,
		fencingToken,
		version,
		worker,
		now,
		row.operation.OperationID,
		row.previousVersion,
		row.status,
	)
	if err != nil {
		return nil, err
	}
	if err := requireOneRow(result); err != nil {
		return nil, err
	}

	trigger := claimTrigger(row.status, row.replayCount)
	if forceImmediateTrigger {
		trigger = AttemptTriggerImmediate
	}
	if _, err := tx.ExecContext(
		ctx,
		r.sql(insertAttemptSQL),
		attemptID,
		row.operation.OperationID,
		row.operation.Identity.OperationCode,
		attemptCount,
		trigger,
		nullableText(row.operation.OriginalRequestID),
		nullableText(row.operation.CorrelationID),
		worker,
		fencingToken,
		now,
	); err != nil {
		return nil, err
	}

	row.operation.AttemptID = attemptID
	row.operation.AttemptCount = attemptCount
	row.operation.FencingToken = fencingToken
	row.operation.Version = version
	row.operation.Worker = worker
	row.operation.LockedUntil = lockedUntil
	row.operation.Trigger = trigger
	return &row.operation, nil
}

func scanClaimRow(row *sql.Row) (claimRow, error) {
	var result claimRow
	var (
		dependsOnOperationKey sql.NullString
		targetBizType         sql.NullString
		targetBizCode         sql.NullString
		originalRequestID     sql.NullString
		correlationID         sql.NullString
		originalActorUID      sql.NullString
		serviceClientID       sql.NullString
		command               []byte
		status                string
	)
	err := row.Scan(
		&result.operation.OperationID,
		&result.operation.OperationKey,
		&result.operation.CorrelationKey,
		&result.operation.SequenceNo,
		&dependsOnOperationKey,
		&result.operation.Identity.TenantCode,
		&result.operation.Identity.DeploymentCode,
		&result.operation.Identity.SourceApp,
		&result.operation.Identity.TargetApp,
		&result.operation.Identity.OperationCode,
		&result.operation.RequiredCapability,
		&result.operation.Identity.SourceBizType,
		&result.operation.Identity.SourceBizCode,
		&targetBizType,
		&targetBizCode,
		&result.operation.Identity.IdempotencyKey,
		&result.operation.CommandSchemaVersion,
		&command,
		&result.operation.Identity.CommandSHA256,
		&status,
		&result.previousAttemptCount,
		&result.operation.MaxAttempts,
		&result.previousFencingToken,
		&result.previousVersion,
		&originalRequestID,
		&correlationID,
		&originalActorUID,
		&serviceClientID,
		&result.replayCount,
		&result.operation.CreatedAt,
	)
	if err != nil {
		return claimRow{}, err
	}
	result.status = Status(status)
	result.operation.DependsOnOperationKey = dependsOnOperationKey.String
	result.operation.TargetBizType = targetBizType.String
	result.operation.TargetBizCode = targetBizCode.String
	result.operation.OriginalRequestID = originalRequestID.String
	result.operation.CorrelationID = correlationID.String
	result.operation.OriginalActorUID = originalActorUID.String
	result.operation.ServiceClientID = serviceClientID.String
	result.operation.Command = append(json.RawMessage(nil), command...)

	if err := validateClaimRow(result); err != nil {
		return claimRow{}, err
	}
	return result, nil
}

func validateClaimRow(row claimRow) error {
	if err := ValidateOperationID(row.operation.OperationID); err != nil {
		return fmt.Errorf("%w: %v", ErrCorruptOperation, err)
	}
	if err := row.operation.Identity.Validate(); err != nil {
		return fmt.Errorf("%w: %v", ErrCorruptOperation, err)
	}
	if !row.status.Valid() || row.status != StatusPending && row.status != StatusRetryWait && row.status != StatusPartialUnknown {
		return fmt.Errorf("%w: unclaimable status %q", ErrCorruptOperation, row.status)
	}
	for name, value := range map[string]string{
		"operation_key":          row.operation.OperationKey,
		"correlation_key":        row.operation.CorrelationKey,
		"required_capability":    row.operation.RequiredCapability,
		"command_schema_version": row.operation.CommandSchemaVersion,
	} {
		if !identityValuePattern.MatchString(value) {
			return fmt.Errorf("%w: invalid %s", ErrCorruptOperation, name)
		}
	}
	var decoded any
	if err := json.Unmarshal(row.operation.Command, &decoded); err != nil {
		return fmt.Errorf("%w: command JSON: %v", ErrCorruptOperation, err)
	}
	digest, err := ValidateAndDigestCommand(decoded)
	if err != nil {
		return fmt.Errorf("%w: command: %v", ErrCorruptOperation, err)
	}
	if digest != row.operation.Identity.CommandSHA256 {
		return fmt.Errorf("%w: command digest mismatch", ErrCorruptOperation)
	}
	if row.previousAttemptCount < 0 || row.operation.MaxAttempts <= 0 {
		return fmt.Errorf("%w: invalid attempt counters", ErrCorruptOperation)
	}
	if row.operation.CreatedAt.IsZero() {
		return fmt.Errorf("%w: missing created_at", ErrCorruptOperation)
	}
	return nil
}

func claimTrigger(status Status, replayCount int) AttemptTrigger {
	switch status {
	case StatusRetryWait:
		return AttemptTriggerScheduled
	case StatusPartialUnknown:
		return AttemptTriggerLeaseRecovery
	case StatusPending:
		if replayCount > 0 {
			return AttemptTriggerManualReplay
		}
	}
	return AttemptTriggerImmediate
}
