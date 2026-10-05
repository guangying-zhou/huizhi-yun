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

const enterpriseCompanyWeeklySummaryContentPath = "/v1/enterprise/aims/integration-operations:company-weekly-summary-publish-content"

// routeEnterpriseSchedulerCompanyWeeklySummaryContent lets the formal Aims
// worker read the immutable Markdown for a company weekly summary operation it
// has claimed on the unified scheduler. It uses the same registered worker
// identity, exact aims:integration_operation:execute capability and
// generation guard as claim/succeed/fail; the Aims domain additionally binds
// the read to the caller's live processing lease.
func (s *Server) routeEnterpriseSchedulerCompanyWeeklySummaryContent(req *http.Request) (routeResult, error) {
	if s.enterpriseScheduler == nil || s.cfg.Enterprise.AimsDeliveryWorker == nil {
		return routeResult{}, httperror.New(503, "enterprise_scheduler_unavailable", "Unified scheduler is not enabled")
	}
	binding := s.cfg.Enterprise.AimsDeliveryWorker
	route := enterpriseSchedulerRoute{App: "aims", Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, WorkerDeployment: binding.Deployment, WorkerClient: binding.ServiceClientID}
	service, identity, err := authenticateEnterpriseScheduler(req, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	if err := validateEnterpriseSchedulerGeneration(req, s.cfg.Enterprise.Generation); err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.integration-operations.company-weekly-summary-publish-content", Auth: &service}
	if req.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Scheduler query parameters are not supported")
	}
	body, err := readJSONBody(req)
	if err != nil {
		return result, err
	}
	if body == nil {
		return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Scheduler input must be an object")
	}
	// Same worker identity as the claim: the caller keeps the claim request ID.
	worker := fmt.Sprintf("aims:%s:%s", service.ClientID, requestID(req))
	if len(worker) > 240 {
		return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Invalid worker request identity")
	}
	data, err := s.enterpriseScheduler.CompanyWeeklySummaryPublishContent(req.Context(), identity, worker, body, time.Now().UTC())
	var domainError httperror.Error
	if errors.As(err, &domainError) && domainError.Status >= 400 && domainError.Status < 500 {
		return result, domainError
	}
	if errors.Is(err, integrationoperation.ErrInvalidIdentity) {
		return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Invalid scheduler identity")
	}
	if err != nil {
		return result, httperror.New(503, "enterprise_scheduler_content_unavailable", "Scheduler content read is unavailable")
	}
	result.Body = map[string]any{"code": 0, "data": data}
	return result, nil
}
