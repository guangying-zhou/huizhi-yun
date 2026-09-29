package enterprisescheduler

import (
	"context"
	"time"

	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// CompanyWeeklySummaryPublishContent returns the immutable Markdown of the
// summary version bound to a company weekly summary operation this worker is
// currently processing. It is the unified counterpart of the legacy
// /v1/aims/company-weekly-summary-versions/{id}:publish-content read: the same
// generation guard as claim/succeed/fail, and the lease (operation key, worker,
// processing, unexpired) plus the frozen version/hash must all match.
func (s *Service) CompanyWeeklySummaryPublishContent(ctx context.Context, identity enterprise.SchedulerIdentity, worker string, body map[string]any, now time.Time) (map[string]any, error) {
	if s == nil || s.guard == nil {
		return nil, enterprise.ErrBindingNotFound
	}
	tx, _, err := s.guard.Begin(ctx, identity)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	tables := s.source.Tables()
	trusted := integrationoperation.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.Deployment, SourceApp: identity.SourceApp, ServiceClientID: identity.ClientID, OutboxTables: &tables}
	result, err := aimsapp.CompanyWeeklySummaryPublishContentInTransaction(ctx, tx, trusted, worker, body, now)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}
