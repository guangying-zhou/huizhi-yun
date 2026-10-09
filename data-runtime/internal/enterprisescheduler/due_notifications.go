package enterprisescheduler

import (
	"context"
	"database/sql"

	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// DueNotification runs one due-notification step (scan, acknowledge or closure
// acknowledge) on the registered scheduler path. Every transaction re-checks
// the worker identity and holds the registry SHARE lock.
func (s *Service) DueNotification(ctx context.Context, identity enterprise.SchedulerIdentity, action string, body map[string]any) (map[string]any, error) {
	if s == nil || s.guard == nil {
		return nil, enterprise.ErrBindingNotFound
	}
	begin := func(ctx context.Context) (*sql.Tx, error) {
		tx, _, err := s.guard.Begin(ctx, identity)
		return tx, err
	}
	return aimsapp.EnterpriseDueNotificationCommand(ctx, begin, s.binding, action, body)
}
