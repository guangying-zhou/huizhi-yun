package enterprisescheduler

import (
	"context"
	"database/sql"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"time"
)

type notificationPersistence struct {
	repository *integrationoperation.Repository
	tx         *sql.Tx
}

var _ aimsapp.NotificationRepository = notificationPersistence{}

// Notification runs original Aims parsing/response logic in the registered scheduler transaction.
func (s *Service) Notification(ctx context.Context, identity enterprise.SchedulerIdentity, action, operationID string, body map[string]any, now time.Time) (map[string]any, error) {
	return notificationTransaction(ctx, s, identity, func(tx *sql.Tx) (map[string]any, error) {
		tables := s.source.Tables()
		trusted := integrationoperation.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.Deployment, SourceApp: identity.SourceApp, ServiceClientID: identity.ClientID, OutboxTables: &tables}
		return aimsapp.ExecuteIntegrationOperationNotification(ctx, notificationPersistence{s.repository, tx}, trusted, action, operationID, body, now)
	})
}
func (p notificationPersistence) ListPendingFailureNotifications(ctx context.Context, tenant, deployment, source string, limit int) ([]integrationoperation.FailureNotificationCandidate, error) {
	return p.repository.ListPendingFailureNotificationsInTransaction(ctx, p.tx, tenant, deployment, source, limit)
}
func (p notificationPersistence) ListPendingDeadLetterActionables(ctx context.Context, tenant, deployment, source string, limit int, now time.Time) ([]integrationoperation.DeadLetterActionableCandidate, error) {
	return p.repository.ListPendingDeadLetterActionablesInTransaction(ctx, p.tx, tenant, deployment, source, limit, now)
}
func (p notificationPersistence) ListPendingDeadLetterClosures(ctx context.Context, tenant, deployment, source string, limit int) ([]integrationoperation.DeadLetterClosureCandidate, error) {
	return p.repository.ListPendingDeadLetterClosuresInTransaction(ctx, p.tx, tenant, deployment, source, limit)
}
func (p notificationPersistence) MarkFailureNotified(ctx context.Context, input integrationoperation.MarkFailureNotifiedInput) (bool, error) {
	return p.repository.MarkFailureNotifiedInTransaction(ctx, p.tx, input)
}
func (p notificationPersistence) MarkDeadLetterActionablePublished(ctx context.Context, input integrationoperation.MarkDeadLetterActionablePublishedInput) (bool, error) {
	return p.repository.MarkDeadLetterActionablePublishedInTransaction(ctx, p.tx, input)
}
func (p notificationPersistence) MarkDeadLetterClosureAcknowledged(ctx context.Context, input integrationoperation.MarkDeadLetterClosureAcknowledgedInput) (bool, error) {
	return p.repository.MarkDeadLetterClosureAcknowledgedInTransaction(ctx, p.tx, input)
}
