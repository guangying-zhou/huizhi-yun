package integrationoperation

import (
	"context"
	"database/sql"
	"fmt"
)

// Caller-owned transaction keeps domain audit/receipt and persistent writer
// fencing atomic. It never commits or rolls back the caller's transaction.
func (r *Repository) ReplayInTransaction(ctx context.Context, tx *sql.Tx, input ReplayInput) (RecordResult, error) {
	if tx == nil {
		return RecordResult{}, fmt.Errorf("caller transaction required")
	}
	for name, value := range map[string]string{"tenant_code": input.TenantCode, "deployment_code": input.DeploymentCode, "source_app": input.SourceApp, "actor_uid": input.ActorUID} {
		if !identityValuePattern.MatchString(value) {
			return RecordResult{}, fmt.Errorf("%w: replay %s", ErrInvalidIdentity, name)
		}
	}
	if err := ValidateOperationID(input.OperationID); err != nil {
		return RecordResult{}, err
	}
	if input.ExpectedVersion == 0 || input.ExpectedVersion == ^uint64(0) || input.Now.IsZero() || input.Reason == "" {
		return RecordResult{}, fmt.Errorf("replay version time and reason required")
	}
	if err := ValidateSafeErrorSummary(input.Reason); err != nil {
		return RecordResult{}, err
	}
	reason := SanitizeErrorSummary(input.Reason, 500)
	if reason == "" {
		return RecordResult{}, fmt.Errorf("replay reason required")
	}
	next := input.ExpectedVersion + 1
	if err := r.markLatestDeadLetterGenerationClosure(ctx, tx, input.OperationID, input.ExpectedVersion, "cancelled", next, input.Now); err != nil {
		return RecordResult{}, err
	}
	result, err := tx.ExecContext(ctx, r.sql(replayOperationSQL), input.Now, input.ActorUID, reason, input.Now, input.ActorUID, input.Now, input.OperationID, input.TenantCode, input.DeploymentCode, input.SourceApp, input.ExpectedVersion)
	if err != nil {
		return RecordResult{}, err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return RecordResult{}, err
	}
	if n != 1 {
		return RecordResult{}, ErrReplayRejected
	}
	return RecordResult{Status: StatusPending, Version: next}, nil
}
