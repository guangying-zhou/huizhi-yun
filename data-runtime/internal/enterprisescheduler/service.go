// Package enterprisescheduler coordinates task persistence on the registered
// scheduler path; network delivery remains the authenticated worker's job.
package enterprisescheduler

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"time"
)

type Service struct {
	guard      *enterprise.SchedulerBinding
	repository *integrationoperation.Repository
	source     enterprise.OutboundSource
	tenant     string
	binding    enterprise.Binding
}

func New(registry *enterprise.Registry, binding enterprise.Binding, source enterprise.OutboundSource) (*Service, error) {
	if registry == nil {
		return nil, enterprise.ErrBindingNotFound
	}
	domain, ok := binding.Domains["aims"]
	if !ok {
		return nil, enterprise.ErrBindingNotFound
	}
	q := enterprise.ResolveRequest{Key: binding.Key, Domain: "aims", OwnerDeployment: domain.OwnerDeployment, SchemaVersion: binding.SchemaVersion, Generation: binding.Generation, Operation: enterprise.Scheduler}
	guard, err := enterprise.NewSchedulerBinding(registry, q, source)
	if err != nil {
		return nil, err
	}
	resolved, err := registry.Resolve(q)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	viewNames := CompletionViewNames()
	if _, ok := domain.Tables["work_item_completion_requests"]; ok {
		viewNames = append(viewNames, "work_item_completion_requests")
	}
	if err := enterprise.VerifyCompatibilityViews(ctx, resolved.DB, binding, "aims", viewNames); err != nil {
		return nil, err
	}
	repository, err := integrationoperation.NewRepository(resolved.DB, integrationoperation.WithOutboxTables(source.Tables()))
	if err != nil {
		return nil, err
	}
	return &Service{guard: guard, repository: repository, source: source, tenant: binding.Key.Tenant, binding: binding}, nil
}

// Claim atomically recovers expired leases and claims a due task. Empty key means
// the next eligible task. The returned lease is committed before external use.
func (s *Service) Claim(ctx context.Context, identity enterprise.SchedulerIdentity, operationKey, worker string, now time.Time, lease time.Duration) (*integrationoperation.ClaimedOperation, error) {
	if s == nil || s.guard == nil {
		return nil, enterprise.ErrBindingNotFound
	}
	tx, _, err := s.guard.Begin(ctx, identity)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var out *integrationoperation.ClaimedOperation
	if operationKey == "" {
		out, err = s.repository.ClaimNextInTransaction(ctx, tx, s.tenant, s.source.WorkerDeployment(), "aims", worker, now, lease)
	} else {
		out, err = s.repository.ClaimByOperationKeyInTransaction(ctx, tx, s.tenant, s.source.WorkerDeployment(), "aims", operationKey, worker, now, lease)
	}
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}

// CompletionViewNames covers the complete weekly summary checkpoint including
// governance fact snapshots. Controlled migrations install views before New;
// request transactions never perform DDL and generation changes rebuild Service.
func CompletionViewNames() []string {
	return []string{
		"company_weekly_summary_versions", "company_weekly_summaries", "weekly_reporting_periods",
		"time_entry_review_events", "time_entries", "company_weekly_summary_items",
		"weekly_report_obligations", "aims_projects", "project_weekly_report_versions", "project_management_fact_snapshots",
	}
}
