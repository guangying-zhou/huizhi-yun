package integrationoperation

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type notificationExecutor interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func (r *Repository) ListPendingFailureNotifications(ctx context.Context, tenantCode, deploymentCode, sourceApp string, limit int) ([]FailureNotificationCandidate, error) {
	return r.listPendingFailureNotifications(ctx, r.db, tenantCode, deploymentCode, sourceApp, limit)
}

// ListPendingFailureNotificationsInTransaction preserves the original algorithm inside the caller's
// generation-guarded transaction. Success never commits; errors roll it back.
func (r *Repository) ListPendingFailureNotificationsInTransaction(ctx context.Context, tx *sql.Tx, tenantCode, deploymentCode, sourceApp string, limit int) ([]FailureNotificationCandidate, error) {
	if tx == nil {
		return nil, fmt.Errorf("notification transaction is required")
	}
	result, err := r.listPendingFailureNotifications(ctx, tx, tenantCode, deploymentCode, sourceApp, limit)
	if err != nil {
		_ = tx.Rollback()
	}
	return result, err
}

func (r *Repository) MarkFailureNotified(ctx context.Context, input MarkFailureNotifiedInput) (bool, error) {
	return r.markFailureNotified(ctx, r.db, input)
}

// MarkFailureNotifiedInTransaction preserves the original algorithm inside the caller's
// generation-guarded transaction. Success never commits; errors roll it back.
func (r *Repository) MarkFailureNotifiedInTransaction(ctx context.Context, tx *sql.Tx, input MarkFailureNotifiedInput) (bool, error) {
	if tx == nil {
		return false, fmt.Errorf("notification transaction is required")
	}
	result, err := r.markFailureNotified(ctx, tx, input)
	if err != nil {
		_ = tx.Rollback()
	}
	return result, err
}

func (r *Repository) ListPendingDeadLetterActionables(ctx context.Context, tenantCode, deploymentCode, sourceApp string, limit int, now time.Time) ([]DeadLetterActionableCandidate, error) {
	return r.listPendingDeadLetterActionables(ctx, r.db, tenantCode, deploymentCode, sourceApp, limit, now)
}

// ListPendingDeadLetterActionablesInTransaction preserves the original algorithm inside the caller's
// generation-guarded transaction. Success never commits; errors roll it back.
func (r *Repository) ListPendingDeadLetterActionablesInTransaction(ctx context.Context, tx *sql.Tx, tenantCode, deploymentCode, sourceApp string, limit int, now time.Time) ([]DeadLetterActionableCandidate, error) {
	if tx == nil {
		return nil, fmt.Errorf("notification transaction is required")
	}
	result, err := r.listPendingDeadLetterActionables(ctx, tx, tenantCode, deploymentCode, sourceApp, limit, now)
	if err != nil {
		_ = tx.Rollback()
	}
	return result, err
}

func (r *Repository) MarkDeadLetterActionablePublished(ctx context.Context, input MarkDeadLetterActionablePublishedInput) (bool, error) {
	return r.markDeadLetterActionablePublished(ctx, r.db, input)
}

// MarkDeadLetterActionablePublishedInTransaction preserves the original algorithm inside the caller's
// generation-guarded transaction. Success never commits; errors roll it back.
func (r *Repository) MarkDeadLetterActionablePublishedInTransaction(ctx context.Context, tx *sql.Tx, input MarkDeadLetterActionablePublishedInput) (bool, error) {
	if tx == nil {
		return false, fmt.Errorf("notification transaction is required")
	}
	result, err := r.markDeadLetterActionablePublished(ctx, tx, input)
	if err != nil {
		_ = tx.Rollback()
	}
	return result, err
}

func (r *Repository) ListPendingDeadLetterClosures(ctx context.Context, tenantCode, deploymentCode, sourceApp string, limit int) ([]DeadLetterClosureCandidate, error) {
	return r.listPendingDeadLetterClosures(ctx, r.db, tenantCode, deploymentCode, sourceApp, limit)
}

// ListPendingDeadLetterClosuresInTransaction preserves the original algorithm inside the caller's
// generation-guarded transaction. Success never commits; errors roll it back.
func (r *Repository) ListPendingDeadLetterClosuresInTransaction(ctx context.Context, tx *sql.Tx, tenantCode, deploymentCode, sourceApp string, limit int) ([]DeadLetterClosureCandidate, error) {
	if tx == nil {
		return nil, fmt.Errorf("notification transaction is required")
	}
	result, err := r.listPendingDeadLetterClosures(ctx, tx, tenantCode, deploymentCode, sourceApp, limit)
	if err != nil {
		_ = tx.Rollback()
	}
	return result, err
}

func (r *Repository) MarkDeadLetterClosureAcknowledged(ctx context.Context, input MarkDeadLetterClosureAcknowledgedInput) (bool, error) {
	return r.markDeadLetterClosureAcknowledged(ctx, r.db, input)
}

// MarkDeadLetterClosureAcknowledgedInTransaction preserves the original algorithm inside the caller's
// generation-guarded transaction. Success never commits; errors roll it back.
func (r *Repository) MarkDeadLetterClosureAcknowledgedInTransaction(ctx context.Context, tx *sql.Tx, input MarkDeadLetterClosureAcknowledgedInput) (bool, error) {
	if tx == nil {
		return false, fmt.Errorf("notification transaction is required")
	}
	result, err := r.markDeadLetterClosureAcknowledged(ctx, tx, input)
	if err != nil {
		_ = tx.Rollback()
	}
	return result, err
}
