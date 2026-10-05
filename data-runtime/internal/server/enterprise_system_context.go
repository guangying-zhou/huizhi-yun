package server

import (
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"strings"
)

// A system request may not smuggle even an invalid user delegation. The
// authenticated client is selected first; capabilities never select identity.
func (s *Server) authenticateEnterpriseSystem(r *http.Request, domain, legacyScope string) (auth.Context, error) {
	return authenticateEnterpriseSystemRequest(r, s.cfg, s.auth, s.verifyEnterpriseCredential, domain, legacyScope)
}

func authenticateEnterpriseSystemRequest(r *http.Request, cfg config.Config, authenticator *auth.Authenticator, verify enterpriseCredentialVerifier, domain, legacyScope string) (auth.Context, error) {
	identity, err := authenticator.Authenticate(r, auth.Requirement{Scope: domain + ":scheduler:execute", SourceAppCode: "enterprise", StrictServiceClaims: true, RequireDeploymentBinding: true})
	if enterpriseSourceMismatch(err) && domain == "aims" && legacyScope != "" && cfg.Enterprise.AllowLegacyAimsCallbacks {
		identity, err = authenticator.Authenticate(r, auth.Requirement{Scope: legacyScope, SourceAppCode: "aims", StrictServiceClaims: true, RequireDeploymentBinding: true})
	}
	if err != nil {
		return auth.Context{}, err
	}
	scope := domain + ":scheduler:execute"
	switch identity.ClientID {
	case "enterprise.runtime":
		if identity.AppCode != "enterprise" || identity.Deployment != cfg.DeploymentBindings["enterprise"] || cfg.DeploymentBindings["enterprise"] == "" {
			return identity, httperror.New(403, "enterprise_system_identity_mismatch", "System identity binding mismatch")
		}
	case "aims.runtime":
		if domain != "aims" || legacyScope == "" || !cfg.Enterprise.AllowLegacyAimsCallbacks || identity.AppCode != "aims" || identity.Deployment != cfg.DeploymentBindings["aims"] {
			return identity, httperror.New(403, "enterprise_system_legacy_disabled", "Legacy system identity is disabled")
		}
		scope = legacyScope
		if scope == "aims.write" && !hasExactCapability(identity.Scopes, scope) && hasExactCapability(identity.Scopes, identity.Audience+":aims:write") {
			scope = identity.Audience + ":aims:write"
		}
	default:
		return identity, httperror.New(403, "enterprise_system_identity_mismatch", "System identity binding mismatch")
	}
	if identity.Mode != string(config.AuthJWT) || identity.Tenant != cfg.Tenant || identity.Subject != "client:"+identity.ClientID || identity.CredentialID <= 0 || !hasExactCapability(identity.Scopes, scope) {
		return identity, httperror.New(403, "enterprise_system_capability_required", "Exact system capability required")
	}
	for key := range r.Header {
		if strings.HasPrefix(strings.ToLower(key), "x-hzy-actor-") {
			return identity, httperror.New(403, "enterprise_system_actor_forbidden", "System requests must not carry user delegation")
		}
	}
	if verify == nil {
		return identity, httperror.New(503, "enterprise_system_credential_unavailable", "Credential state unavailable")
	}
	active, err := verify(r.Context(), identity, scope)
	if err != nil {
		return identity, httperror.New(503, "enterprise_system_credential_unavailable", "Credential state unavailable")
	}
	if !active {
		return identity, httperror.New(403, "enterprise_system_credential_inactive", "System credential or grant is inactive")
	}
	return identity, nil
}

// The relative callback path and business app remain frozen; only the caller changes.
func (s *Server) routeAimsWorkflowCallback(r *http.Request, adapter runtimeHandler) (routeResult, error) {
	identity, err := s.authenticateEnterpriseSystem(r, "aims", "aims.write")
	result := routeResult{Auth: &identity, Operation: "enterprise.aims.workflow_callback"}
	if identity.AppCode == "aims" {
		result.Operation = "aims.workflow_callback.legacy"
	}
	if err != nil {
		return result, err
	}
	if r.Method != http.MethodPost {
		return result, httperror.New(405, "method_not_allowed", "POST is required")
	}
	if identity.AppCode == "enterprise" && r.URL.RawQuery != "" || identity.AppCode == "aims" && (len(r.URL.Query()) != 1 || r.URL.Query().Get("workflow_callback_verified") != "1") {
		return result, httperror.New(400, "workflow_callback_query_invalid", "Callback query is invalid")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	if body["app_code"] != "aims" {
		return result, httperror.New(403, "workflow_callback_app_mismatch", "Callback business app mismatch")
	}
	if s.cfg.Enterprise.EnableMilestoneReceivable && isAimsMilestoneReceivableWorkflowCallback(r.Method, cleanPath(r.URL.Path), body) {
		return result, httperror.New(503, "aims_milestone_receivable_lane_disabled", "Milestone receivable coordination is disabled")
	}
	query := runtimeQueryWithAuth(nil, identity, "", nil)
	query.Set("workflow_callback_verified", "1")
	setRuntimeTrustedQuery(query, identity, requestID(r))
	setRuntimeTrustedBody(body, identity, requestID(r))
	out, _, err := adapter.HandleRuntime(r.Context(), r.Method, cleanPath(r.URL.Path), query, body)
	result.Body = out
	return result, err
}

func enterpriseSourceMismatch(err error) bool {
	var e httperror.Error
	return errors.As(err, &e) && e.Status == 403 && e.Code == "source_app_mismatch"
}
