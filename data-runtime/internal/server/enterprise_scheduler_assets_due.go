package server

import (
	"errors"
	"net/http"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Assets due notifications on the unified path use their own exact capability
// and the registered Assets worker, never the Aims scheduler identity.
const enterpriseAssetsDueNotificationCapability = "assets:notifications-due:execute"

var enterpriseAssetsDueNotificationActions = map[string]string{
	"/v1/enterprise/assets/notifications:scan-due":            "scan-due",
	"/v1/enterprise/assets/notifications:acknowledge":         "acknowledge",
	"/v1/enterprise/assets/notifications:acknowledge-closure": "acknowledge-closure",
}

var legacyAssetsDueNotificationPaths = map[string]bool{
	"/v1/assets/service/notifications:scan-due":            true,
	"/v1/assets/service/notifications:acknowledge":         true,
	"/v1/assets/service/notifications:acknowledge-closure": true,
}

func (s *Server) routeEnterpriseAssetsDueNotification(r *http.Request, action string) (routeResult, error) {
	if s.enterpriseAssetsScheduler == nil || s.cfg.Enterprise.AssetsDeliveryWorker == nil {
		return routeResult{}, httperror.New(503, "enterprise_scheduler_unavailable", "Unified Assets scheduler is not enabled")
	}
	worker := s.cfg.Enterprise.AssetsDeliveryWorker
	route := enterpriseSchedulerRoute{App: "assets", Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, WorkerDeployment: worker.Deployment, WorkerClient: worker.ServiceClientID}
	service, identity, err := authenticateEnterpriseSchedulerCapability(r, s.auth, route, s.verifyEnterpriseCredential, enterpriseAssetsDueNotificationCapability)
	if err != nil {
		return routeResult{}, err
	}
	if err := validateEnterpriseSchedulerGeneration(r, s.cfg.Enterprise.Generation); err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.assets.notifications." + action, Auth: &service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Scheduler query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	if body == nil {
		return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Due notification input must be an object")
	}
	// Same closed field sets as the legacy Assets worker contract.
	if err := validateDueNotificationWorkerBody("/v1/assets/service/notifications:"+action, body); err != nil {
		return result, err
	}
	data, err := s.enterpriseAssetsScheduler.DueNotification(r.Context(), identity, action, body)
	var domainError httperror.Error
	if errors.As(err, &domainError) {
		return result, domainError
	}
	if errors.Is(err, enterprise.ErrBindingMismatch) {
		return result, httperror.New(409, "enterprise_scheduler_generation_stale", "Scheduler generation has changed")
	}
	if err != nil {
		return result, httperror.New(503, "enterprise_due_notification_unavailable", "Due notification persistence is unavailable")
	}
	result.Body = map[string]any{"code": 0, "data": data}
	return result, nil
}

// A unified Assets scheduler owner makes the legacy Assets due-notification
// entries unusable, so the local cron cannot write checkpoints without fencing.
func legacyAssetsDueNotificationOwnedByUnified(path string, enabled bool, scheduler enterprise.PathMode) bool {
	return legacyAssetsDueNotificationPaths[path] && enabled && scheduler == enterprise.PathUnified
}
