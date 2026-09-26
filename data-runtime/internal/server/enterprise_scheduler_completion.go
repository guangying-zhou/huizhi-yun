package server

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func (s *Server) routeEnterpriseSchedulerComplete(r *http.Request, success bool) (routeResult, error) {
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
	action := "fail"
	if success {
		action = "succeed"
	}
	result := routeResult{Operation: "enterprise.aims.integration-operations." + action, Auth: &service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Scheduler query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	operationKey, ok := body["operationKey"].(string)
	if !ok || operationKey == "" {
		return result, httperror.New(400, "enterprise_scheduler_input_invalid", "An operation key is required")
	}
	// As in the original dispatcher, the caller retains the claim request ID
	// across delivery and acknowledgement. Body fields cannot select its worker.
	worker := fmt.Sprintf("aims:%s:%s", service.ClientID, requestID(r))
	if len(worker) > 240 {
		return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Invalid worker request identity")
	}
	var data map[string]any
	if success {
		data, err = s.enterpriseScheduler.Succeed(r.Context(), identity, worker, operationKey, body, time.Now().UTC())
	} else {
		data, err = s.enterpriseScheduler.Fail(r.Context(), identity, worker, operationKey, body, time.Now().UTC())
	}
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
		return result, httperror.New(503, "enterprise_scheduler_completion_unavailable", "Scheduler completion is unavailable")
	}
	result.Body = map[string]any{"code": 0, "data": data}
	return result, nil
}
