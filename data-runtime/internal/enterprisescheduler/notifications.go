package enterprisescheduler

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"time"
)

// notificationTransaction holds the scheduler generation through persistence.
// External notification publication happens after this transaction commits.
func notificationTransaction[T any](ctx context.Context, s *Service, identity enterprise.SchedulerIdentity, run func(*sql.Tx) (T, error)) (T, error) {
	var zero T
	if s == nil || s.guard == nil {
		return zero, enterprise.ErrBindingNotFound
	}
	tx, _, err := s.guard.Begin(ctx, identity)
	if err != nil {
		return zero, err
	}
	defer tx.Rollback()
	result, err := run(tx)
	if err != nil {
		return zero, err
	}
	if err = tx.Commit(); err != nil {
		return zero, err
	}
	return result, nil
}

func (s *Service) ListPendingFailureNotifications(ctx context.Context, identity enterprise.SchedulerIdentity, limit int) ([]integrationoperation.FailureNotificationCandidate, error) {
	return notificationTransaction(ctx, s, identity, func(tx *sql.Tx) ([]integrationoperation.FailureNotificationCandidate, error) {
		return s.repository.ListPendingFailureNotificationsInTransaction(ctx, tx, identity.Tenant, identity.Deployment, identity.SourceApp, limit)
	})
}

func (s *Service) ListPendingDeadLetterActionables(ctx context.Context, identity enterprise.SchedulerIdentity, limit int, now time.Time) ([]integrationoperation.DeadLetterActionableCandidate, error) {
	return notificationTransaction(ctx, s, identity, func(tx *sql.Tx) ([]integrationoperation.DeadLetterActionableCandidate, error) {
		return s.repository.ListPendingDeadLetterActionablesInTransaction(ctx, tx, identity.Tenant, identity.Deployment, identity.SourceApp, limit, now)
	})
}

func (s *Service) ListPendingDeadLetterClosures(ctx context.Context, identity enterprise.SchedulerIdentity, limit int) ([]integrationoperation.DeadLetterClosureCandidate, error) {
	return notificationTransaction(ctx, s, identity, func(tx *sql.Tx) ([]integrationoperation.DeadLetterClosureCandidate, error) {
		return s.repository.ListPendingDeadLetterClosuresInTransaction(ctx, tx, identity.Tenant, identity.Deployment, identity.SourceApp, limit)
	})
}

func (s *Service) MarkFailureNotified(ctx context.Context, identity enterprise.SchedulerIdentity, input integrationoperation.MarkFailureNotifiedInput) (bool, error) {
	// Input binding must agree with the separately verified worker identity.
	if input.TenantCode != identity.Tenant || input.DeploymentCode != identity.Deployment || input.SourceApp != identity.SourceApp {
		return false, enterprise.ErrBindingMismatch
	}
	return notificationTransaction(ctx, s, identity, func(tx *sql.Tx) (bool, error) {
		return s.repository.MarkFailureNotifiedInTransaction(ctx, tx, input)
	})
}

func (s *Service) MarkDeadLetterActionablePublished(ctx context.Context, identity enterprise.SchedulerIdentity, input integrationoperation.MarkDeadLetterActionablePublishedInput) (bool, error) {
	// Input binding must agree with the separately verified worker identity.
	if input.TenantCode != identity.Tenant || input.DeploymentCode != identity.Deployment || input.SourceApp != identity.SourceApp {
		return false, enterprise.ErrBindingMismatch
	}
	return notificationTransaction(ctx, s, identity, func(tx *sql.Tx) (bool, error) {
		return s.repository.MarkDeadLetterActionablePublishedInTransaction(ctx, tx, input)
	})
}

func (s *Service) MarkDeadLetterClosureAcknowledged(ctx context.Context, identity enterprise.SchedulerIdentity, input integrationoperation.MarkDeadLetterClosureAcknowledgedInput) (bool, error) {
	// Input binding must agree with the separately verified worker identity.
	if input.TenantCode != identity.Tenant || input.DeploymentCode != identity.Deployment || input.SourceApp != identity.SourceApp {
		return false, enterprise.ErrBindingMismatch
	}
	return notificationTransaction(ctx, s, identity, func(tx *sql.Tx) (bool, error) {
		return s.repository.MarkDeadLetterClosureAcknowledgedInTransaction(ctx, tx, input)
	})
}
