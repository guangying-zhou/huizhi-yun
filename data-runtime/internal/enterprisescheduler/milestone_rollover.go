package enterprisescheduler

import (
	"context"
	"database/sql"

	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// RolloverDueMilestones runs the scheduled rollover on the registered scheduler
// path. Every transaction re-checks the worker identity and holds the registry
// SHARE lock, so a generation change fences the remaining items.
func (s *Service) RolloverDueMilestones(ctx context.Context, identity enterprise.SchedulerIdentity, limit int, carryover string) (map[string]any, error) {
	if s == nil || s.guard == nil {
		return nil, enterprise.ErrBindingNotFound
	}
	begin := func(ctx context.Context) (*sql.Tx, error) {
		tx, _, err := s.guard.Begin(ctx, identity)
		return tx, err
	}
	return aimsapp.RolloverDueMilestonesInTransactions(ctx, begin, s.binding, limit, carryover)
}
