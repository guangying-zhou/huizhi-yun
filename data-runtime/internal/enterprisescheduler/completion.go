package enterprisescheduler

import (
	"context"
	"time"

	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// Succeed records a verified target receipt and its source checkpoint atomically.
// Delivery occurs before this call, outside the database transaction.
func (s *Service) Succeed(ctx context.Context, identity enterprise.SchedulerIdentity, worker, operationKey string, body map[string]any, now time.Time) (map[string]any, error) {
	return s.complete(ctx, identity, worker, operationKey, body, now, true)
}

// Fail preserves the original retry classification and terminal checkpoint.
func (s *Service) Fail(ctx context.Context, identity enterprise.SchedulerIdentity, worker, operationKey string, body map[string]any, now time.Time) (map[string]any, error) {
	return s.complete(ctx, identity, worker, operationKey, body, now, false)
}

func (s *Service) complete(ctx context.Context, identity enterprise.SchedulerIdentity, worker, operationKey string, body map[string]any, now time.Time, success bool) (map[string]any, error) {
	if s == nil || s.guard == nil {
		return nil, enterprise.ErrBindingNotFound
	}
	tx, resolved, err := s.guard.Begin(ctx, identity)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	tables := s.source.Tables()
	trusted := integrationoperation.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.Deployment, SourceApp: identity.SourceApp, ServiceClientID: identity.ClientID, OutboxTables: &tables}
	var result map[string]any
	if success {
		result, err = aimsapp.SucceedIntegrationOperationInTransaction(ctx, resolved.DB, tx, trusted, worker, operationKey, body, now)
	} else {
		result, err = aimsapp.FailIntegrationOperationInTransaction(ctx, resolved.DB, tx, trusted, worker, operationKey, body, now)
	}
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}
