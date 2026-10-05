package enterprise

import (
	"context"
	"database/sql"
)

const SystemSchedulerPrincipal = "system:enterprise-scheduler"
const SystemMilestoneRolloverTask = "aims.milestone.rollover"

// SystemSchedulerBinding is a process-local authority, not a service identity.
// No HTTP handler accepts one; its domain/generation come from Runtime config.
type SystemSchedulerBinding struct {
	registry *Registry
	request  ResolveRequest
}

func NewSystemSchedulerBinding(registry *Registry, request ResolveRequest) (*SystemSchedulerBinding, error) {
	if registry == nil || request.Operation != Scheduler || request.Domain != "aims" {
		return nil, ErrBindingMismatch
	}
	if _, err := registry.Resolve(request); err != nil {
		return nil, err
	}
	return &SystemSchedulerBinding{registry: registry, request: request}, nil
}

// BeginSystemScheduler never borrows aims.runtime. The allowlist is checked
// before opening a transaction; Registry independently holds the SHARE fence.
func (s *SystemSchedulerBinding) BeginSystemScheduler(ctx context.Context, task string) (*sql.Tx, Resolved, error) {
	if s == nil || s.registry == nil || task != SystemMilestoneRolloverTask {
		return nil, Resolved{}, ErrBindingMismatch
	}
	tx, resolved, err := s.registry.BeginSchedulerTransaction(ctx, s.request)
	if err != nil {
		return nil, Resolved{}, err
	}
	return tx, resolved[0], nil
}

func (*SystemSchedulerBinding) Principal() string { return SystemSchedulerPrincipal }
