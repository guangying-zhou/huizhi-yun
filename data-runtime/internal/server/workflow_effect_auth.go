package server

import (
	"math"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const (
	workflowIntegrationOperationScope = "workflow:integration_operation:execute"
	workflowDeliveryRecoveryScope     = "workflow:delivery-recovery:execute"
)

// A delivery worker and a break-glass maintainer have separate clients and
// grants. Both must still match the current deployment binding and live Console
// credential state; a signed but revoked token is insufficient.
func (s *Server) authenticateWorkflowEffectService(r *http.Request, scope, clientID string) (auth.Context, error) {
	verify := s.verifyEnterpriseCredential
	if s.workflowEffectVerifierCredential != nil {
		verify = s.workflowEffectVerifierCredential
	}
	return authenticateWorkflowEffectService(r, s.auth, s.cfg.Tenant, s.cfg.DeploymentBindings["workflow"], verify, scope, clientID)
}

func authenticateWorkflowEffectService(r *http.Request, authenticator *auth.Authenticator, tenant, deployment string, verify enterpriseCredentialVerifier, scope, clientID string) (auth.Context, error) {
	var empty auth.Context
	if authenticator == nil || verify == nil || deployment == "" || tenant == "" {
		return empty, httperror.New(503, "workflow_effect_binding_unavailable", "Workflow effect binding is unavailable")
	}
	identity, err := authenticator.Authenticate(r, auth.Requirement{
		AppCode: "workflow", SourceAppCode: "workflow", Scope: scope,
		StrictServiceClaims: true, RequireDeploymentBinding: true,
	})
	if err != nil {
		return empty, err
	}
	if identity.Mode != string(config.AuthJWT) || identity.Tenant != tenant ||
		identity.Deployment != deployment || identity.AppCode != "workflow" ||
		identity.ClientID != clientID || identity.Subject != "client:"+clientID || identity.CredentialID <= 0 {
		return empty, httperror.New(403, "workflow_effect_identity_mismatch", "Workflow effect identity does not match its binding")
	}
	exact := false
	for _, granted := range identity.Scopes {
		if granted == scope {
			exact = true
			break
		}
	}
	if !exact {
		return empty, httperror.New(403, "workflow_effect_scope_required", "Exact Workflow effect scope required")
	}
	active, err := verify(r.Context(), identity, scope)
	if err != nil {
		return empty, httperror.New(503, "workflow_effect_credential_unavailable", "Workflow credential state is unavailable")
	}
	if !active {
		return empty, httperror.New(403, "workflow_effect_credential_inactive", "Workflow credential or grant has been revoked")
	}
	return identity, nil
}

// The notification detail verifier is a read-only viewer check, but its body
// names the viewer, so only the Workflow runtime identity may ask. It carries
// the legacy read capability, possibly audience-qualified by the Foundation
// client; the exact granted form is re-checked against live grant state.
func (s *Server) authenticateWorkflowNotificationDetailVerifier(r *http.Request) (auth.Context, error) {
	verify := s.verifyEnterpriseCredential
	if s.workflowNotificationVerifierCredential != nil {
		verify = s.workflowNotificationVerifierCredential
	}
	return authenticateWorkflowNotificationDetailVerifier(r, s.auth, s.cfg.Tenant, s.cfg.DeploymentBindings["workflow"], verify)
}

func authenticateWorkflowNotificationDetailVerifier(r *http.Request, authenticator *auth.Authenticator, tenant, deployment string, verify enterpriseCredentialVerifier) (auth.Context, error) {
	var empty auth.Context
	if authenticator == nil || verify == nil || deployment == "" || tenant == "" {
		return empty, httperror.New(503, "workflow_notification_verifier_binding_unavailable", "Workflow notification verifier binding is unavailable")
	}
	identity, err := authenticator.Authenticate(r, auth.Requirement{
		AppCode: "workflow", SourceAppCode: "workflow", Scope: "workflow.read",
		StrictServiceClaims: true, RequireDeploymentBinding: true,
	})
	if err != nil {
		return empty, err
	}
	if identity.Mode != string(config.AuthJWT) || identity.Tenant != tenant ||
		identity.Deployment != deployment || identity.AppCode != "workflow" ||
		identity.ClientID != "workflow.runtime" || identity.Subject != "client:workflow.runtime" || identity.CredentialID <= 0 {
		return empty, httperror.New(403, "workflow_notification_verifier_identity_mismatch", "Workflow notification verifier identity does not match its binding")
	}
	granted := ""
	for _, candidate := range identity.Scopes {
		if candidate == "workflow.read" || (identity.Audience != "" && candidate == identity.Audience+":workflow:read") {
			granted = candidate
			break
		}
	}
	if granted == "" {
		return empty, httperror.New(403, "workflow_notification_verifier_scope_required", "Workflow read scope required")
	}
	active, err := verify(r.Context(), identity, granted)
	if err != nil {
		return empty, httperror.New(503, "workflow_notification_verifier_credential_unavailable", "Workflow credential state is unavailable")
	}
	if !active {
		return empty, httperror.New(403, "workflow_notification_verifier_credential_inactive", "Workflow credential or grant has been revoked")
	}
	return identity, nil
}

func workflowRecoveryInput(body map[string]any) (string, int64, error) {
	reason, reasonOK := body["reason"].(string)
	version, versionOK := body["expectedVersion"].(float64)
	reason = strings.TrimSpace(reason)
	if len(body) != 2 || !reasonOK || !versionOK || reason == "" || utf8.RuneCountInString(reason) > 200 ||
		version <= 0 || version > 9007199254740991 || math.Trunc(version) != version {
		return "", 0, httperror.New(400, "workflow_recovery_body_invalid", "Recovery reason and expected version are required")
	}
	for _, ch := range reason {
		if ch < 0x20 || ch == 0x7f {
			return "", 0, httperror.New(400, "workflow_recovery_body_invalid", "Recovery reason contains a control character")
		}
	}
	return reason, int64(version), nil
}
