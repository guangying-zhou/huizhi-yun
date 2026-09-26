package server

import (
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
)

func (s *Server) routeAimsWorkItemCompletionCallback(r *http.Request) (routeResult, error) {
	capability := aimsapp.WorkItemCompletionCallbackCapability
	identity, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "aims", SourceAppCode: "aims", Scope: capability, StrictServiceClaims: true, RequireDeploymentBinding: true})
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "aims.work_item_completion_requests.workflow_callback", Auth: &identity}
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return result, httperror.New(503, "work_item_completion_unavailable", "Unified work item completion is not enabled")
	}
	if identity.Mode != string(config.AuthJWT) || identity.Tenant != s.cfg.Tenant || identity.Deployment != s.cfg.DeploymentBindings["aims"] || identity.ClientID != "aims.runtime" || identity.Subject != "client:aims.runtime" || identity.CredentialID <= 0 || !hasExactCapability(identity.Scopes, capability) {
		return result, httperror.New(403, "work_item_completion_callback_identity_mismatch", "Aims runtime callback identity does not match its binding")
	}
	active, err := s.verifyEnterpriseCredential(r.Context(), identity, capability)
	if err != nil {
		return result, httperror.New(503, "work_item_completion_callback_credential_unavailable", "Callback credential state is unavailable")
	}
	if !active {
		return result, httperror.New(403, "work_item_completion_callback_credential_inactive", "Callback credential or grant is inactive")
	}
	if len(r.URL.Query()) != 1 || r.URL.Query().Get("workflow_callback_verified") != "1" {
		return result, httperror.New(400, "work_item_completion_callback_query_invalid", "Only the verified callback marker is supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	setRuntimeTrustedBody(body, identity, requestID(r))
	callback, err := aimsapp.VerifiedWorkItemCompletionCallbackFromTrustedRuntime(r.URL.Query(), body)
	if err != nil {
		return result, err
	}
	data, err := s.aims.ApplyWorkItemCompletionCallback(r.Context(), callback)
	result.Body = map[string]any{"code": 0, "data": data}
	return result, err
}
