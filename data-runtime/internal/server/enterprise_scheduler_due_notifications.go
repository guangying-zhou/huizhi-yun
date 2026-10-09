package server

import (
	"errors"
	"net/http"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// The due-notification worker gets its own exact capability on the unified
// path; neither the outbox nor the rollover grant covers checkpoint writes.
const enterpriseDueNotificationCapability = "aims:notifications-due:execute"

var enterpriseDueNotificationActions = map[string]string{
	"/v1/enterprise/aims/notifications:scan-due":            "scan-due",
	"/v1/enterprise/aims/notifications:acknowledge":         "acknowledge",
	"/v1/enterprise/aims/notifications:acknowledge-closure": "acknowledge-closure",
}

var legacyAimsDueNotificationPaths = map[string]bool{
	"/v1/aims/service/notifications:scan-due":            true,
	"/v1/aims/service/notifications:acknowledge":         true,
	"/v1/aims/service/notifications:acknowledge-closure": true,
}

func (s *Server) routeEnterpriseDueNotification(r *http.Request, action string) (routeResult, error) {
	if s.enterpriseScheduler == nil || s.cfg.Enterprise.AimsDeliveryWorker == nil {
		return routeResult{}, httperror.New(503, "enterprise_scheduler_unavailable", "Unified scheduler is not enabled")
	}
	binding := s.cfg.Enterprise.AimsDeliveryWorker
	route := enterpriseSchedulerRoute{App: "aims", Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, WorkerDeployment: binding.Deployment, WorkerClient: binding.ServiceClientID}
	service, identity, err := authenticateEnterpriseSchedulerCapability(r, s.auth, route, s.verifyEnterpriseCredential, enterpriseDueNotificationCapability)
	if err != nil {
		return routeResult{}, err
	}
	if err := validateEnterpriseSchedulerGeneration(r, s.cfg.Enterprise.Generation); err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.notifications." + action, Auth: &service}
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
	// Same closed field sets as the legacy worker contract for Aims.
	if err := validateDueNotificationWorkerBody("/v1/aims/service/notifications:"+action, body); err != nil {
		return result, err
	}
	data, err := s.enterpriseScheduler.DueNotification(r.Context(), identity, action, body)
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

// A unified scheduler owner makes the legacy Aims due-notification entries
// unusable, so an unmigrated worker cannot write checkpoints without fencing.
func legacyAimsDueNotificationOwnedByUnified(path string, enabled bool, scheduler enterprise.PathMode) bool {
	return legacyAimsDueNotificationPaths[path] && enabled && scheduler == enterprise.PathUnified
}
