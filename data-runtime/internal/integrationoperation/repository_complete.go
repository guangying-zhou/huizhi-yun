package integrationoperation

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

const loadCompletionStateSQL = `
SELECT
  status,
  locked_by,
  locked_until,
  fencing_token,
  attempt_count,
  max_attempts,
  version_no,
  created_at,
  last_attempt_at
FROM integration_operation
WHERE operation_id = ?
LIMIT 1
FOR UPDATE`

const recordAttemptSuccessSQL = `
UPDATE integration_operation_attempt
SET result_status = 'succeeded',
    http_status = ?,
    error_code = NULL,
    error_class = NULL,
    error_summary = NULL,
    target_biz_type = ?,
    target_biz_code = ?,
    response_summary_sha256 = ?,
    finished_at = ?,
    duration_ms = ?
WHERE operation_id = ?
  AND attempt_no = ?
  AND locked_by = ?
  AND fencing_token = ?
  AND finished_at IS NULL`

const recordOperationSuccessSQL = `
UPDATE integration_operation
SET status = 'succeeded',
    target_receipt_id = ?,
    target_biz_type = ?,
    target_biz_code = ?,
    locked_by = NULL,
    locked_until = NULL,
    last_http_status = ?,
    last_error_code = NULL,
    last_error_class = NULL,
    last_error_summary = NULL,
    last_error_at = NULL,
    response_summary_sha256 = ?,
    succeeded_at = ?,
    version_no = ?,
    updated_by = ?,
    updated_at = ?
WHERE operation_id = ?
  AND status = 'processing'
  AND locked_by = ?
  AND fencing_token = ?
  AND version_no = ?`

const recordAttemptFailureSQL = `
UPDATE integration_operation_attempt
SET result_status = ?,
    http_status = ?,
    error_code = ?,
    error_class = ?,
    error_summary = ?,
    response_summary_sha256 = ?,
    finished_at = ?,
    duration_ms = ?
WHERE operation_id = ?
  AND attempt_no = ?
  AND locked_by = ?
  AND fencing_token = ?
  AND finished_at IS NULL`

const recordOperationFailureSQL = `
UPDATE integration_operation
SET status = ?,
    next_attempt_at = ?,
    locked_by = NULL,
    locked_until = NULL,
    last_http_status = ?,
    last_error_code = ?,
    last_error_class = ?,
    last_error_summary = ?,
    last_error_at = ?,
    response_summary_sha256 = ?,
    failed_permanent_at = ?,
    dead_lettered_at = ?,
    succeeded_at = ?,
    version_no = ?,
    updated_by = ?,
    updated_at = ?
WHERE operation_id = ?
  AND status = 'processing'
  AND locked_by = ?
  AND fencing_token = ?
  AND version_no = ?`

type completionState struct {
	status        Status
	lockedBy      sql.NullString
	lockedUntil   sql.NullTime
	fencingToken  uint64
	attemptCount  int
	maxAttempts   int
	version       uint64
	createdAt     time.Time
	lastAttemptAt sql.NullTime
}

func (r *Repository) RecordSuccess(ctx context.Context, input RecordSuccessInput) (RecordResult, error) {
	return r.RecordSuccessWithMutation(ctx, input, nil)
}

// RecordSuccessWithMutation commits a source business checkpoint in the same
// transaction as the operation attempt and terminal success evidence.
func (r *Repository) RecordSuccessWithMutation(ctx context.Context, input RecordSuccessInput, mutation func(context.Context, *sql.Tx) error) (RecordResult, error) {
	return r.recordSuccess(ctx, input, mutation, nil)
}

// RecordSuccessWithMutationInTransaction keeps completion evidence and source checkpoints
// inside the caller's generation-fenced transaction. Errors abort that transaction.
func (r *Repository) RecordSuccessWithMutationInTransaction(ctx context.Context, tx *sql.Tx, input RecordSuccessInput, mutation func(context.Context, *sql.Tx) error) (RecordResult, error) {
	if tx == nil {
		return RecordResult{}, fmt.Errorf("integration operation transaction is required")
	}
	return r.recordSuccess(ctx, input, mutation, tx)
}

func (r *Repository) recordSuccess(ctx context.Context, input RecordSuccessInput, mutation func(context.Context, *sql.Tx) error, supplied *sql.Tx) (out RecordResult, returnedErr error) {
	defer func() {
		if supplied != nil && returnedErr != nil {
			rollback(supplied)
		}
	}()

	if err := validateCompletionLease(input.Lease); err != nil {
		return RecordResult{}, err
	}
	if input.Now.IsZero() {
		return RecordResult{}, fmt.Errorf("completion time is required")
	}
	if err := validateHTTPStatus(input.HTTPStatus); err != nil {
		return RecordResult{}, err
	}
	if input.TargetReceiptID != "" {
		if err := ValidateOperationID(input.TargetReceiptID); err != nil {
			return RecordResult{}, fmt.Errorf("invalid target receipt ID: %w", err)
		}
	}
	if err := validateOptionalIdentityValue("target_biz_type", input.TargetBizType); err != nil {
		return RecordResult{}, err
	}
	if err := validateOptionalIdentityValue("target_biz_code", input.TargetBizCode); err != nil {
		return RecordResult{}, err
	}
	if (input.TargetBizType == "") != (input.TargetBizCode == "") {
		return RecordResult{}, fmt.Errorf("target business type and code must be supplied together")
	}
	if err := validateOptionalSHA256("response_summary_sha256", input.ResponseSummarySHA256); err != nil {
		return RecordResult{}, err
	}
	durationMS, err := durationMilliseconds(input.Duration)
	if err != nil {
		return RecordResult{}, err
	}

	tx := supplied
	if tx == nil {
		tx, err = beginTx(ctx, r.db)
		if err != nil {
			return RecordResult{}, err
		}
		defer rollback(tx)
	}
	state, err := r.loadAndValidateCompletionState(ctx, tx, input.Lease, input.Now)
	if err != nil {
		return RecordResult{}, err
	}
	if input.Duration == 0 {
		durationMS, err = elapsedMilliseconds(state.lastAttemptAt, input.Now)
		if err != nil {
			return RecordResult{}, err
		}
	}

	result, err := tx.ExecContext(
		ctx,
		r.sql(recordAttemptSuccessSQL),
		nullableHTTPStatus(input.HTTPStatus),
		nullableText(input.TargetBizType),
		nullableText(input.TargetBizCode),
		nullableText(input.ResponseSummarySHA256),
		input.Now,
		durationMS,
		input.Lease.OperationID,
		state.attemptCount,
		input.Lease.Worker,
		input.Lease.FencingToken,
	)
	if err != nil {
		return RecordResult{}, err
	}
	if err := requireOneRow(result); err != nil {
		return RecordResult{}, err
	}

	version := state.version + 1
	result, err = tx.ExecContext(
		ctx,
		r.sql(recordOperationSuccessSQL),
		nullableText(input.TargetReceiptID),
		nullableText(input.TargetBizType),
		nullableText(input.TargetBizCode),
		nullableHTTPStatus(input.HTTPStatus),
		nullableText(input.ResponseSummarySHA256),
		input.Now,
		version,
		input.Lease.Worker,
		input.Now,
		input.Lease.OperationID,
		input.Lease.Worker,
		input.Lease.FencingToken,
		state.version,
	)
	if err != nil {
		return RecordResult{}, err
	}
	if err := requireOneRow(result); err != nil {
		return RecordResult{}, err
	}
	if err := r.markLatestDeadLetterGenerationClosure(ctx, tx, input.Lease.OperationID, state.version, "resolved", version, input.Now); err != nil {
		return RecordResult{}, err
	}
	if mutation != nil {
		if err := mutation(ctx, tx); err != nil {
			return RecordResult{}, err
		}
	}
	if supplied == nil {
		if err := tx.Commit(); err != nil {
			return RecordResult{}, err
		}
	}
	return RecordResult{Status: StatusSucceeded, Version: version}, nil
}

func (r *Repository) RecordFailure(ctx context.Context, input RecordFailureInput) (RecordResult, error) {
	return r.recordFailure(ctx, input, nil)
}

// RecordFailureInTransaction keeps completion evidence and source checkpoints
// inside the caller's generation-fenced transaction. Errors abort that transaction.
func (r *Repository) RecordFailureInTransaction(ctx context.Context, tx *sql.Tx, input RecordFailureInput) (RecordResult, error) {
	if tx == nil {
		return RecordResult{}, fmt.Errorf("integration operation transaction is required")
	}
	return r.recordFailure(ctx, input, tx)
}

func (r *Repository) recordFailure(ctx context.Context, input RecordFailureInput, supplied *sql.Tx) (out RecordResult, returnedErr error) {
	defer func() {
		if supplied != nil && returnedErr != nil {
			rollback(supplied)
		}
	}()

	if err := validateCompletionLease(input.Lease); err != nil {
		return RecordResult{}, err
	}
	if input.Now.IsZero() {
		return RecordResult{}, fmt.Errorf("completion time is required")
	}
	if err := validateHTTPStatus(input.Failure.HTTPStatus); err != nil {
		return RecordResult{}, err
	}
	if err := validateOptionalIdentityValue("error_code", input.ErrorCode); err != nil {
		return RecordResult{}, err
	}
	if err := validateOptionalSHA256("response_summary_sha256", input.ResponseSummarySHA256); err != nil {
		return RecordResult{}, err
	}
	durationMS, err := durationMilliseconds(input.Duration)
	if err != nil {
		return RecordResult{}, err
	}
	safeSummary := SanitizeErrorSummary(input.ErrorSummary, DefaultErrorSummaryRunes)
	if err := ValidateSafeErrorSummary(safeSummary); err != nil {
		return RecordResult{}, err
	}
	classification := ClassifyFailure(input.Failure)

	tx := supplied
	if tx == nil {
		tx, err = beginTx(ctx, r.db)
		if err != nil {
			return RecordResult{}, err
		}
		defer rollback(tx)
	}
	state, err := r.loadAndValidateCompletionState(ctx, tx, input.Lease, input.Now)
	if err != nil {
		return RecordResult{}, err
	}
	if input.Duration == 0 {
		durationMS, err = elapsedMilliseconds(state.lastAttemptAt, input.Now)
		if err != nil {
			return RecordResult{}, err
		}
	}

	policy := r.retryPolicy
	policy.MaxAttempts = state.maxAttempts
	decision, err := policy.Decide(RetryDecisionInput{
		Classification:    classification,
		AttemptCount:      state.attemptCount,
		FirstAttemptAt:    state.createdAt,
		Now:               input.Now,
		RetryAfter:        input.RetryAfter,
		RandomUnit:        r.randomUnit(),
		DeliveryUncertain: input.DeliveryUncertain,
	})
	if err != nil {
		return RecordResult{}, err
	}

	result, err := tx.ExecContext(
		ctx,
		r.sql(recordAttemptFailureSQL),
		decision.Status,
		nullableHTTPStatus(input.Failure.HTTPStatus),
		nullableText(input.ErrorCode),
		classification.Class,
		nullableText(safeSummary),
		nullableText(input.ResponseSummarySHA256),
		input.Now,
		durationMS,
		input.Lease.OperationID,
		state.attemptCount,
		input.Lease.Worker,
		input.Lease.FencingToken,
	)
	if err != nil {
		return RecordResult{}, err
	}
	if err := requireOneRow(result); err != nil {
		return RecordResult{}, err
	}
	// `integration_operation.next_attempt_at` 在所有应用 schema 中都是
	// `DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`（规范如此，非漂移）。
	//
	// 2026-08-24 生产事故：终态（dead_letter / failed_permanent，Retry=false）时这里
	// 传 nil，UPDATE 写入 NULL 触发 `Error 1048: Column 'next_attempt_at' cannot be null`，
	// 整个 RecordFailure 事务回滚 -> `:fail` 返回 500 -> 调用方按可重试无限重试。
	// 后果：**任何 operation 都无法进入终态**，max_attempts 完全失效
	// （单条 attempt_count 冲到 5328，上限只有 8）。这是全平台缺陷，
	// aims/altoc 只是因为队列为空才未暴露。
	//
	// 终态行不会再被领取（claim 只查 status IN ('pending','retry_wait','partial_unknown')），
	// 因此这里写入完成时间即可，既满足 NOT NULL 又不影响调度语义。
	nextAttemptAt := input.Now
	if decision.Retry {
		nextAttemptAt = decision.NextAttemptAt
	}
	var failedPermanentAt any
	if decision.Status == StatusFailedPermanent {
		failedPermanentAt = input.Now
	}
	var deadLetteredAt any
	if decision.Status == StatusDeadLetter {
		deadLetteredAt = input.Now
	}
	var succeededAt any
	if decision.Status == StatusSucceeded {
		succeededAt = input.Now
	}
	version := state.version + 1
	result, err = tx.ExecContext(
		ctx,
		r.sql(recordOperationFailureSQL),
		decision.Status,
		nextAttemptAt,
		nullableHTTPStatus(input.Failure.HTTPStatus),
		nullableText(input.ErrorCode),
		classification.Class,
		nullableText(safeSummary),
		input.Now,
		nullableText(input.ResponseSummarySHA256),
		failedPermanentAt,
		deadLetteredAt,
		succeededAt,
		version,
		input.Lease.Worker,
		input.Now,
		input.Lease.OperationID,
		input.Lease.Worker,
		input.Lease.FencingToken,
		state.version,
	)
	if err != nil {
		return RecordResult{}, err
	}
	if err := requireOneRow(result); err != nil {
		return RecordResult{}, err
	}
	if decision.Status == StatusSucceeded {
		if err := r.markLatestDeadLetterGenerationClosure(ctx, tx, input.Lease.OperationID, state.version, "resolved", version, input.Now); err != nil {
			return RecordResult{}, err
		}
	}
	if supplied == nil {
		if err := tx.Commit(); err != nil {
			return RecordResult{}, err
		}
	}
	return RecordResult{Status: decision.Status, Version: version, Decision: decision}, nil
}

func (r *Repository) loadAndValidateCompletionState(ctx context.Context, tx *sql.Tx, lease CompletionLease, now time.Time) (completionState, error) {
	var state completionState
	var status string
	err := tx.QueryRowContext(ctx, r.sql(loadCompletionStateSQL), lease.OperationID).Scan(
		&status,
		&state.lockedBy,
		&state.lockedUntil,
		&state.fencingToken,
		&state.attemptCount,
		&state.maxAttempts,
		&state.version,
		&state.createdAt,
		&state.lastAttemptAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return completionState{}, ErrOperationNotFound
	}
	if err != nil {
		return completionState{}, err
	}
	state.status = Status(status)
	if state.status != StatusProcessing || !state.lockedBy.Valid || state.lockedBy.String != lease.Worker || state.fencingToken != lease.FencingToken {
		return completionState{}, ErrStaleFencing
	}
	if !state.lockedUntil.Valid || !now.Before(state.lockedUntil.Time) {
		return completionState{}, ErrStaleFencing
	}
	if state.attemptCount <= 0 || state.maxAttempts <= 0 || state.version == 0 || state.createdAt.IsZero() {
		return completionState{}, fmt.Errorf("%w: invalid completion state", ErrCorruptOperation)
	}
	return state, nil
}

func elapsedMilliseconds(start sql.NullTime, end time.Time) (uint64, error) {
	if !start.Valid {
		return 0, fmt.Errorf("%w: missing last_attempt_at", ErrCorruptOperation)
	}
	if end.Before(start.Time) {
		return 0, fmt.Errorf("completion time precedes attempt start")
	}
	return uint64(end.Sub(start.Time) / time.Millisecond), nil
}
