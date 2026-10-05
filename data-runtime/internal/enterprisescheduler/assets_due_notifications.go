package enterprisescheduler

import (
	"context"
	"database/sql"

	assetsapp "github.com/huizhi-yun/data-runtime/internal/apps/assets"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// AssetsDueService runs Assets due notifications on the Assets domain's own
// scheduler path. It has no outbox tables, so it uses the generic worker
// binding instead of the Aims outbound source.
type AssetsDueService struct {
	guard   *enterprise.WorkerSchedulerBinding
	binding enterprise.Binding
}

func NewAssetsDueService(registry *enterprise.Registry, binding enterprise.Binding, workerDeployment, workerClient string) (*AssetsDueService, error) {
	domain, ok := binding.Domains["assets"]
	if !ok {
		return nil, enterprise.ErrBindingNotFound
	}
	request := enterprise.ResolveRequest{Key: binding.Key, Domain: "assets", OwnerDeployment: domain.OwnerDeployment, SchemaVersion: binding.SchemaVersion, Generation: binding.Generation, Operation: enterprise.Scheduler}
	guard, err := enterprise.NewWorkerSchedulerBinding(registry, request, "assets", workerDeployment, workerClient)
	if err != nil {
		return nil, err
	}
	return &AssetsDueService{guard: guard, binding: binding}, nil
}

// DueNotification runs one scan, acknowledge or closure acknowledge step. Every
// transaction re-checks the worker identity and holds the registry SHARE lock.
func (s *AssetsDueService) DueNotification(ctx context.Context, identity enterprise.SchedulerIdentity, action string, body map[string]any) (map[string]any, error) {
	if s == nil || s.guard == nil {
		return nil, enterprise.ErrBindingNotFound
	}
	begin := func(ctx context.Context) (*sql.Tx, error) { return s.guard.Begin(ctx, identity) }
	return assetsapp.EnterpriseDueNotificationCommand(ctx, begin, s.binding, action, body)
}
