package server

import (
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"strings"
)

func (s *Server) routeWorkflowAimsCompletion(r *http.Request) (routeResult, error) {
	identity, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "workflow", SourceAppCode: "workflow", Scope: "workflow:work-item-complete:create", StrictServiceClaims: true, RequireDeploymentBinding: true})
	if err != nil {
		return routeResult{}, err
	}
	adapter, err := s.requireWorkflow()
	if err != nil {
		return routeResult{}, err
	}
	if r.URL.RawQuery != "" {
		return routeResult{}, httperror.New(400, "workflow_completion_query_invalid", "Query parameters are unsupported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return routeResult{}, err
	}
	actor, depts, purpose := runtimeActorContextDetails(r, identity)
	if actor == "" || actor == strings.TrimSpace(identity.Subject) || purpose != "service-command" {
		return routeResult{}, httperror.New(403, "trusted_service_actor_required", "Trusted service-command actor delegation is required")
	}
	if err = injectRuntimeIdempotencyBody(r, body); err != nil {
		return routeResult{}, err
	}
	injectRuntimeAuthBody(body, identity, actor, depts)
	setRuntimeTrustedBody(body, identity, requestID(r))
	if err = injectTrustedServiceCommandContext(r, identity, body); err != nil {
		return routeResult{}, err
	}
	result, operation, err := adapter.HandleRuntime(r.Context(), r.Method, "/v1/workflow/service/aims-work-item-completion-approval", r.URL.Query(), body)
	return routeResult{Operation: operation, Auth: &identity, Body: result}, err
}
