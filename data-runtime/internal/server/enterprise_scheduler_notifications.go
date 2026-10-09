package server

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func (s *Server) routeEnterpriseSchedulerNotification(r *http.Request, action string) (routeResult, error) {
	if s.enterpriseScheduler == nil || s.cfg.Enterprise.AimsDeliveryWorker == nil {
		return routeResult{}, httperror.New(503, "enterprise_scheduler_unavailable", "Unified scheduler is not enabled")
	}
	binding := s.cfg.Enterprise.AimsDeliveryWorker
	route := enterpriseSchedulerRoute{App: "aims", Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, WorkerDeployment: binding.Deployment, WorkerClient: binding.ServiceClientID}
	service, identity, err := authenticateEnterpriseScheduler(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	if err := validateEnterpriseSchedulerGeneration(r, s.cfg.Enterprise.Generation); err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.integration-operations." + action, Auth: &service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Scheduler query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	if body == nil {
		return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Notification input must be an object")
	}
	operationID := ""
	if !strings.HasPrefix(action, "pending-") {
		var ok bool
		operationID, ok = body["operationId"].(string)
		if !ok || !integrationoperation.IsValidOperationID(operationID) {
			return result, httperror.New(400, "enterprise_scheduler_input_invalid", "An operation ID is required")
		}
	}
	data, err := s.enterpriseScheduler.Notification(r.Context(), identity, action, operationID, body, time.Now().UTC())
	var domainError httperror.Error
	if errors.As(err, &domainError) && domainError.Status >= 400 && domainError.Status < 500 {
		return result, domainError
	}
	if errors.Is(err, integrationoperation.ErrStaleFencing) || errors.Is(err, integrationoperation.ErrPersistenceRace) {
		return result, httperror.New(409, "integration_operation_lease_stale", "Integration operation lease is stale")
	}
	if errors.Is(err, integrationoperation.ErrInvalidIdentity) {
		return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Invalid scheduler identity")
	}
	if err != nil {
		return result, httperror.New(503, "enterprise_scheduler_notification_unavailable", "Scheduler notification persistence is unavailable")
	}
	result.Body = map[string]any{"code": 0, "data": data}
	return result, nil
}

var enterpriseSchedulerNotificationActions = map[string]string{
	"/v1/enterprise/aims/integration-operations:pending-failure-notifications":    "pending-failure-notifications",
	"/v1/enterprise/aims/integration-operations:pending-dead-letter-actionables":  "pending-dead-letter-actionables",
	"/v1/enterprise/aims/integration-operations:pending-dead-letter-closures":     "pending-dead-letter-closures",
	"/v1/enterprise/aims/integration-operations:failure-notified":                 "failure-notified",
	"/v1/enterprise/aims/integration-operations:dead-letter-actionable-published": "dead-letter-actionable-published",
	"/v1/enterprise/aims/integration-operations:dead-letter-closure-acknowledged": "dead-letter-closure-acknowledged",
}
