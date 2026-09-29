package server

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func (s *Server) routeEnterpriseSchedulerClaim(r *http.Request) (routeResult, error) {
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
	result := routeResult{Operation: "enterprise.aims.integration-operations.claim", Auth: &service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Scheduler query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	if body == nil {
		return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Scheduler input must be an object")
	}
	operationKey := ""
	for key, value := range body {
		if key != "operationKey" {
			return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Unsupported scheduler input")
		}
		var ok bool
		operationKey, ok = value.(string)
		if !ok || operationKey == "" {
			return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Invalid operation key")
		}
	}
	worker := fmt.Sprintf("aims:%s:%s", service.ClientID, requestID(r))
	if len(worker) > 240 {
		return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Invalid worker request identity")
	}
	claimed, err := s.enterpriseScheduler.Claim(r.Context(), identity, operationKey, worker, time.Now().UTC(), time.Minute)
	if errors.Is(err, integrationoperation.ErrInvalidIdentity) {
		return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Invalid scheduler identity")
	}
	if err != nil {
		return result, httperror.New(503, "enterprise_scheduler_claim_unavailable", "Scheduler claim is unavailable")
	}
	data, err := aimsapp.EnterpriseClaimedOperationResponse(claimed)
	if err != nil {
		return result, httperror.New(503, "enterprise_scheduler_claim_unavailable", "Scheduler claim is unavailable")
	}
	result.Body = map[string]any{"code": 0, "data": data}
	return result, nil
}
