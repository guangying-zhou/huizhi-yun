package server

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const (
	enterpriseMilestoneRolloverPath = "/v1/enterprise/aims/milestones:rollover-due"
	legacyMilestoneRolloverPath     = "/v1/aims/service/milestones:rollover-due"
)

// routeEnterpriseMilestoneRollover is the unified owner of scheduled milestone
// rollover. It reuses the registered Aims worker binding but requires its own
// exact capability and the selected scheduler generation.
func (s *Server) routeEnterpriseMilestoneRollover(r *http.Request) (routeResult, error) {
	if s.enterpriseScheduler == nil || s.cfg.Enterprise.AimsDeliveryWorker == nil {
		return routeResult{}, httperror.New(503, "enterprise_scheduler_unavailable", "Unified scheduler is not enabled")
	}
	binding := s.cfg.Enterprise.AimsDeliveryWorker
	route := enterpriseSchedulerRoute{App: "aims", Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, WorkerDeployment: binding.Deployment, WorkerClient: binding.ServiceClientID}
	service, identity, err := authenticateEnterpriseSchedulerCapability(r, s.auth, route, s.verifyEnterpriseCredential, enterpriseMilestoneRolloverCapability)
	if err != nil {
		return routeResult{}, err
	}
	if err := validateEnterpriseSchedulerGeneration(r, s.cfg.Enterprise.Generation); err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.milestones.rollover-due", Auth: &service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Scheduler query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	if body == nil {
		return result, httperror.New(400, "enterprise_scheduler_input_invalid", "Rollover input must be an object")
	}
	limit, carryover, err := enterpriseMilestoneRolloverInput(body)
	if err != nil {
		return result, err
	}
	data, err := s.enterpriseScheduler.RolloverDueMilestones(r.Context(), identity, limit, carryover)
	var domainError httperror.Error
	if errors.As(err, &domainError) {
		return result, domainError
	}
	if errors.Is(err, enterprise.ErrBindingMismatch) {
		return result, httperror.New(409, "enterprise_scheduler_generation_stale", "Scheduler generation has changed")
	}
	if err != nil {
		return result, httperror.New(503, "enterprise_milestone_rollover_unavailable", "Milestone rollover persistence is unavailable")
	}
	result.Body = map[string]any{"code": 0, "data": data}
	return result, nil
}

// Only the page size and carryover mode are caller choices; the actor, the
// review exemption and the scheduled marker are fixed by the Runtime.
func enterpriseMilestoneRolloverInput(body map[string]any) (int, string, error) {
	invalid := httperror.New(400, "enterprise_scheduler_input_invalid", "Unsupported milestone rollover input")
	limit, carryover := 100, "auto"
	for key, value := range body {
		switch key {
		case "limit":
			var number float64
			switch typed := value.(type) {
			case float64:
				number = typed
			case json.Number:
				parsed, err := typed.Float64()
				if err != nil {
					return 0, "", invalid
				}
				number = parsed
			default:
				return 0, "", invalid
			}
			if number != math.Trunc(number) || number < 1 || number > 200 {
				return 0, "", invalid
			}
			limit = int(number)
		case "carryover":
			text, ok := value.(string)
			if !ok || (text != "auto" && text != "manual") {
				return 0, "", invalid
			}
			carryover = text
		default:
			return 0, "", invalid
		}
	}
	return limit, carryover, nil
}

// A unified scheduler owner makes the legacy rollover entry unusable, so an
// unmigrated worker cannot write the same periods without generation fencing.
func legacyMilestoneRolloverOwnedByUnified(path string, enabled bool, scheduler enterprise.PathMode) bool {
	return path == legacyMilestoneRolloverPath && enabled && scheduler == enterprise.PathUnified
}
