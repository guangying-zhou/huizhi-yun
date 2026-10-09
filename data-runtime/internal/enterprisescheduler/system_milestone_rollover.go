package enterprisescheduler

import (
	"context"
	"database/sql"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// SystemMilestoneRollover has no worker identity, credential or outbox authority.
type SystemMilestoneRollover struct {
	guard   *enterprise.SystemSchedulerBinding
	binding enterprise.Binding
}

func NewSystemMilestoneRollover(registry *enterprise.Registry, binding enterprise.Binding) (*SystemMilestoneRollover, error) {
	domain, ok := binding.Domains["aims"]
	if !ok {
		return nil, enterprise.ErrBindingNotFound
	}
	request := enterprise.ResolveRequest{Key: binding.Key, Domain: "aims", OwnerDeployment: domain.OwnerDeployment, SchemaVersion: binding.SchemaVersion, Generation: binding.Generation, Operation: enterprise.Scheduler}
	guard, err := enterprise.NewSystemSchedulerBinding(registry, request)
	if err != nil {
		return nil, err
	}
	return &SystemMilestoneRollover{guard: guard, binding: binding}, nil
}

func (s *SystemMilestoneRollover) RolloverDueMilestones(ctx context.Context) (map[string]any, error) {
	if s == nil || s.guard == nil {
		return nil, enterprise.ErrBindingNotFound
	}
	begin := func(ctx context.Context) (*sql.Tx, error) {
		tx, _, err := s.guard.BeginSystemScheduler(ctx, enterprise.SystemMilestoneRolloverTask)
		return tx, err
	}
	// Owning-domain code fixes operator_uid=system and rechecks generation for
	// the scan and every item. Stale generation stops the remaining items.
	return aimsapp.RolloverDueMilestonesInTransactions(ctx, begin, s.binding, 100, "auto")
}
