package integrationoperation

import (
	"context"
	"fmt"
)

const replayOperationSQL = `
UPDATE integration_operation
SET status = 'pending',
    next_attempt_at = ?,
    locked_by = NULL,
    locked_until = NULL,
    replay_count = replay_count + 1,
    last_replay_actor_uid = ?,
    last_replay_reason = ?,
    last_replay_at = ?,
    version_no = version_no + 1,
    updated_by = ?,
    updated_at = ?
WHERE operation_id = ?
  AND tenant_code = ?
  AND deployment_code = ?
  AND source_app = ?
  AND version_no = ?
  AND status IN ('failed_permanent', 'dead_letter')`

func (r *Repository) Replay(ctx context.Context, input ReplayInput) (RecordResult, error) {
	for name, value := range map[string]string{
		"tenant_code":     input.TenantCode,
		"deployment_code": input.DeploymentCode,
		"source_app":      input.SourceApp,
	} {
		if !identityValuePattern.MatchString(value) {
			return RecordResult{}, fmt.Errorf("%w: replay %s", ErrInvalidIdentity, name)
		}
	}
	if err := ValidateOperationID(input.OperationID); err != nil {
		return RecordResult{}, err
	}
	if input.ExpectedVersion == 0 {
		return RecordResult{}, fmt.Errorf("expected version must be positive")
	}
	if !identityValuePattern.MatchString(input.ActorUID) {
		return RecordResult{}, fmt.Errorf("%w: replay actor_uid", ErrInvalidIdentity)
	}
	if input.Now.IsZero() {
		return RecordResult{}, fmt.Errorf("replay time is required")
	}
	if input.Reason == "" {
		return RecordResult{}, fmt.Errorf("replay reason is required")
	}
	if err := ValidateSafeErrorSummary(input.Reason); err != nil {
		return RecordResult{}, err
	}
	safeReason := SanitizeErrorSummary(input.Reason, 500)
	if safeReason == "" {
		return RecordResult{}, fmt.Errorf("replay reason is required")
	}

	tx, err := beginTx(ctx, r.db)
	if err != nil {
		return RecordResult{}, err
	}
	defer rollback(tx)

	nextVersion := input.ExpectedVersion + 1
	if err := r.markLatestDeadLetterGenerationClosure(ctx, tx, input.OperationID, input.ExpectedVersion, "cancelled", nextVersion, input.Now); err != nil {
		return RecordResult{}, err
	}
	result, err := tx.ExecContext(
		ctx,
		r.sql(replayOperationSQL),
		input.Now,
		input.ActorUID,
		safeReason,
		input.Now,
		input.ActorUID,
		input.Now,
		input.OperationID,
		input.TenantCode,
		input.DeploymentCode,
		input.SourceApp,
		input.ExpectedVersion,
	)
	if err != nil {
		return RecordResult{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return RecordResult{}, err
	}
	if affected != 1 {
		return RecordResult{}, ErrReplayRejected
	}
	if err := tx.Commit(); err != nil {
		return RecordResult{}, err
	}
	return RecordResult{Status: StatusPending, Version: nextVersion}, nil
}
