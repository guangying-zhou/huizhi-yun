package server

import (
	"context"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// enterpriseRouteContext is supplied by the registered route and local runtime
// configuration, never decoded from request headers, query parameters or JSON.
type enterpriseRouteContext struct {
	Binding                      enterprise.BindingKey
	HostDeployment               string
	LogicalSource, LogicalTarget string
	Action, Capability           string
}

// This is verified transport identity, not a grant of object/field access.
// Each domain must still evaluate its own action and data scope before SQL.
type enterpriseRequestContext struct {
	Service                      auth.Context
	Route                        enterpriseRouteContext
	PhysicalHost, ServiceSubject string
	ActorUID, TraceID            string
	DepartmentCodes              []string
}

// Revocation and the exact grant must be checked against current local Console
// state. A nil verifier fails closed; it is not an optional optimization.
type enterpriseCredentialVerifier func(context.Context, auth.Context, string) (bool, error)

func authenticateEnterpriseRequest(r *http.Request, authenticator *auth.Authenticator, route enterpriseRouteContext, verify enterpriseCredentialVerifier) (enterpriseRequestContext, error) {
	zero := enterpriseRequestContext{}
	parts := strings.Split(route.Capability, ":")
	if authenticator == nil || verify == nil || route.Binding.Tenant == "" ||
		route.Binding.Environment == "" || route.Binding.RuntimeDeployment == "" ||
		route.HostDeployment == "" || route.LogicalSource == "" || route.LogicalTarget == "" ||
		len(parts) != 3 || parts[0] != route.LogicalTarget || parts[1] == "" || parts[2] != route.Action || route.Action == "" ||
		strings.Contains(route.Capability, "*") {
		return zero, httperror.New(503, "enterprise_route_unavailable", "Enterprise route identity is not configured")
	}
	identity, err := authenticator.Authenticate(r, auth.Requirement{
		AppCode: "enterprise", SourceAppCode: "enterprise", Scope: route.Capability, StrictServiceClaims: true, RequireDeploymentBinding: true,
	})
	if err != nil {
		return zero, err
	}
	if identity.Mode != string(config.AuthJWT) || identity.Tenant != route.Binding.Tenant ||
		identity.Deployment != route.HostDeployment || identity.AppCode != "enterprise" ||
		identity.ClientID != "enterprise.runtime" || identity.Subject != "client:enterprise.runtime" || identity.CredentialID <= 0 {
		return zero, httperror.New(403, "enterprise_identity_mismatch", "Enterprise service identity does not match its registered binding")
	}
	exact := false
	for _, scope := range identity.Scopes {
		if scope == route.Capability {
			exact = true
			break
		}
	}
	if !exact {
		return zero, httperror.New(403, "enterprise_exact_capability_required", "An exact enterprise capability is required")
	}
	actor, departments, purpose, delegated := runtimeSignedActorContext(r)
	if !delegated || actor == "" || actor == identity.Subject || purpose != "" {
		return zero, httperror.New(403, "enterprise_actor_required", "A signed user actor is required")
	}
	active, err := verify(r.Context(), identity, route.Capability)
	if err != nil {
		return zero, httperror.New(503, "enterprise_credential_state_unavailable", "Enterprise credential state is unavailable")
	}
	if !active {
		return zero, httperror.New(403, "enterprise_credential_inactive", "Enterprise credential or capability has been revoked")
	}
	return enterpriseRequestContext{
		Service: identity,
		Route:   route, PhysicalHost: identity.AppCode, ServiceSubject: identity.Subject,
		ActorUID: actor, DepartmentCodes: append([]string(nil), departments...), TraceID: requestID(r),
	}, nil
}
