package server

import (
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
)

func (s *Server) routeEnterpriseNotificationDetail(r *http.Request, domain string, adapter runtimeHandler) (routeResult, error) {
	identity, err := authenticateEnterpriseNotificationDetail(r, s.cfg, s.auth, s.verifyEnterpriseCredential, domain)
	result := routeResult{Auth: &identity, Operation: "enterprise." + domain + ".notification_detail.purpose"}
	if err != nil {
		return result, err
	}
	if identity.AppCode != "enterprise" {
		result.Operation = domain + ".notification_detail.legacy"
	}
	uid, depts, err := notificationDetailViewer(r, identity)
	if err != nil {
		return result, err
	}
	purpose := "notification-detail-authorization"
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "notification_detail_query_invalid", "Query is not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	query := runtimeQueryWithAuth(url.Values{}, identity, uid, depts)
	query.Set("hzy_runtime_actor_delegated", "1")
	query.Set("hzy_runtime_actor_purpose", purpose)
	setRuntimeTrustedQuery(query, identity, requestID(r))
	setRuntimeTrustedBody(body, identity, requestID(r))
	body["current_user"] = uid
	body["hzy_runtime_actor_purpose"] = purpose
	// The inspected viewer is purpose restricted; no user mutation route accepts it.
	out, _, err := adapter.HandleRuntime(r.Context(), http.MethodPost, "/v1/"+domain+"/notification-details/authorize", query, body)
	result.Body = out
	return result, err
}

func authenticateEnterpriseNotificationDetail(r *http.Request, cfg config.Config, authenticator *auth.Authenticator, verify enterpriseCredentialVerifier, domain string) (auth.Context, error) {
	legacyDomain := domain == "aims" || domain == "assets"
	if !legacyDomain && domain != "altoc" && domain != "people" && domain != "finance" {
		return auth.Context{}, httperror.New(403, "notification_detail_domain_invalid", "Notification domain invalid")
	}
	if authenticator == nil {
		return auth.Context{}, httperror.New(503, "notification_detail_credential_unavailable", "Notification credential state unavailable")
	}
	identity, err := authenticator.Authenticate(r, auth.Requirement{Scope: domain + ":notification-detail:authorize", SourceAppCode: "enterprise", StrictServiceClaims: true, RequireDeploymentBinding: true})
	if enterpriseSourceMismatch(err) && legacyDomain && cfg.Enterprise.AllowLegacyNotificationDetails {
		identity, err = authenticator.Authenticate(r, auth.Requirement{Scope: domain + ".read", SourceAppCode: domain, StrictServiceClaims: true, RequireDeploymentBinding: true})
	}
	if err != nil {
		return identity, err
	}
	scope := domain + ":notification-detail:authorize"
	if identity.AppCode != "enterprise" || identity.ClientID != "enterprise.runtime" {
		if !legacyDomain || !cfg.Enterprise.AllowLegacyNotificationDetails || identity.AppCode != domain || identity.ClientID != domain+".runtime" {
			return identity, httperror.New(403, "notification_detail_source_invalid", "Notification inspection source is invalid")
		}
		scope = domain + ".read"
		if !hasExactCapability(identity.Scopes, scope) && hasExactCapability(identity.Scopes, identity.Audience+":"+domain+":read") {
			scope = identity.Audience + ":" + domain + ":read"
		}
	}
	if cfg.DeploymentBindings[identity.AppCode] == "" || identity.Deployment != cfg.DeploymentBindings[identity.AppCode] {
		return identity, httperror.New(403, "notification_detail_deployment_mismatch", "Notification source deployment mismatch")
	}
	if identity.Mode != string(config.AuthJWT) || identity.Subject != "client:"+identity.ClientID || identity.Tenant != cfg.Tenant || identity.CredentialID <= 0 || !hasExactCapability(identity.Scopes, scope) {
		return identity, httperror.New(403, "notification_detail_capability_required", "Exact notification inspection capability required")
	}
	if verify == nil {
		return identity, httperror.New(503, "notification_detail_credential_unavailable", "Notification credential state unavailable")
	}
	active, err := verify(r.Context(), identity, scope)
	if err != nil {
		return identity, httperror.New(503, "notification_detail_credential_unavailable", "Notification credential state unavailable")
	}
	if !active {
		return identity, httperror.New(403, "notification_detail_credential_inactive", "Notification credential or grant inactive")
	}
	return identity, nil
}

func notificationDetailViewer(r *http.Request, identity auth.Context) (string, []string, error) {
	uid, depts, purpose, delegated := runtimeSignedActorContext(r)
	if !delegated || uid == "" || uid == identity.Subject || purpose != "notification-detail-authorization" {
		return "", nil, httperror.New(403, "trusted_notification_actor_required", "Purpose-bound notification delegation required")
	}
	return uid, depts, nil
}
