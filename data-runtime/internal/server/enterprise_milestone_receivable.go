package server

import (
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// This is the existing target-domain mutation capability frozen in the Aims
// operation. aims.write remains the legacy callback ingress scope; it cannot
// itself authorize the opt-in cross-domain coordinator.
const aimsMilestoneReceivableCapability = "altoc:receivable:mark-billable"

// isAimsMilestoneReceivableWorkflowCallback deliberately recognizes only the
// already-established Aims callback subtype. Other Workflow callbacks retain
// their owning adapter path.
func isAimsMilestoneReceivableWorkflowCallback(method, path string, body map[string]any) bool {
	return method == http.MethodPost && path == "/v1/aims/service/workflow/callback" &&
		strings.TrimSpace(bodyText(body, "resource_code", "resourceCode")) == "milestones" &&
		strings.TrimSpace(bodyText(body, "action_code", "actionCode")) == "milestone_completion"
}

func bodyText(body map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := body[key]; ok {
			if text, ok := value.(string); ok {
				return text
			}
		}
	}
	return ""
}

// routeAimsMilestoneReceivableWorkflowCallback is reached only after
// routeAppRuntime verifies the legacy Aims runtime bearer and injects its
// reserved trusted context. It neither validates a Workflow JWT nor treats the
// BFF marker as a new security boundary.
func (s *Server) routeAimsMilestoneReceivableWorkflowCallback(r *http.Request, identity auth.Context, body map[string]any) (routeResult, error) {
	result := routeResult{Operation: "aims.milestone_completion_requests.workflow_callback", Auth: &identity}
	if !s.cfg.Enterprise.Enabled || s.enterpriseMilestoneReceivable == nil {
		return result, httperror.New(http.StatusServiceUnavailable, "enterprise_milestone_receivable_disabled", "Milestone receivable coordination is not enabled")
	}
	// The broad Aims callback ingress was authenticated by routeAppRuntime. The
	// opt-in coordinator re-authenticates the same bearer with complete bound
	// service claims before it can cross into Altoc.
	strict, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "aims", SourceAppCode: "aims", Scope: "aims.write", StrictServiceClaims: true, RequireDeploymentBinding: true})
	if err != nil {
		return result, err
	}
	identity = strict
	result.Auth = &identity
	if identity.Mode != string(config.AuthJWT) || identity.Tenant != s.cfg.Tenant ||
		identity.Deployment != s.cfg.DeploymentBindings["aims"] || identity.AppCode != "aims" ||
		identity.ClientID != "aims.runtime" || identity.Subject != "aims.runtime" || identity.CredentialID <= 0 {
		return result, httperror.New(http.StatusForbidden, "aims_milestone_receivable_identity_mismatch", "Aims runtime identity does not match its registered binding")
	}
	if !hasExactCapability(identity.Scopes, aimsMilestoneReceivableCapability) {
		return result, httperror.New(http.StatusForbidden, "aims_milestone_receivable_exact_capability_required", "An exact milestone receivable capability is required")
	}
	active, err := s.verifyEnterpriseCredential(r.Context(), identity, aimsMilestoneReceivableCapability)
	if err != nil {
		return result, httperror.New(http.StatusServiceUnavailable, "aims_milestone_receivable_credential_state_unavailable", "Aims credential state is unavailable")
	}
	if !active {
		return result, httperror.New(http.StatusForbidden, "aims_milestone_receivable_credential_inactive", "Aims credential or grant has been revoked")
	}
	callback, err := aims.VerifiedMilestoneCompletionCallbackFromTrustedRuntime(r.URL.Query(), body)
	if err != nil {
		return result, err
	}
	data, err := s.enterpriseMilestoneReceivable.Complete(r.Context(), callback)
	if err != nil {
		return result, err
	}
	result.Body = map[string]any{"code": 0, "data": data}
	return result, nil
}

func hasExactCapability(scopes []string, capability string) bool {
	for _, scope := range scopes {
		if strings.TrimSpace(scope) == capability {
			return true
		}
	}
	return false
}
