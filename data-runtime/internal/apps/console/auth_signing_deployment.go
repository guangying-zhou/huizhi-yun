package console

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// These are server configuration facts, never signing request fields. Bindings
// are copied so neither callers nor concurrent issuance can mutate the registry.
func (a *Adapter) SetOIDCSigningDeploymentBindings(runtimeDeployment string, bindings map[string]string) {
	copied := make(map[string]string, len(bindings))
	for app, deployment := range bindings {
		copied[app] = deployment
	}
	a.oidcSigningIssuerMu.Lock()
	defer a.oidcSigningIssuerMu.Unlock()
	a.oidcSigningRuntimeDeployment = runtimeDeployment
	a.oidcSigningDeploymentBindings = copied
}

func (a *Adapter) signingSourceDeployment(app string) string {
	a.oidcSigningIssuerMu.RLock()
	defer a.oidcSigningIssuerMu.RUnlock()
	if app == "" {
		return ""
	}
	if deployment := a.oidcSigningDeploymentBindings[app]; deployment != "" {
		return deployment
	}
	// Existing supporting-service rule from config.Config.DeploymentForApp.
	if app == "connector-runtime" && a.oidcSigningDeploymentBindings["console"] != "" {
		return a.oidcSigningDeploymentBindings["console"]
	}
	// Legacy configurations with no explicit map use the enrolled Runtime value;
	// an explicit map must never manufacture a missing application's deployment.
	if len(a.oidcSigningDeploymentBindings) == 0 {
		return a.oidcSigningRuntimeDeployment
	}
	return ""
}

func (a *Adapter) authorizeUserSigningDeployment(deployment any) error {
	value, ok := deployment.(string)
	if !ok || value == "" {
		return httperror.New(http.StatusForbidden, "oidc_signing_user_deployment_mismatch", "User deployment is not registered")
	}
	a.oidcSigningIssuerMu.RLock()
	defer a.oidcSigningIssuerMu.RUnlock()
	if a.oidcSigningRuntimeDeployment == "" && len(a.oidcSigningDeploymentBindings) == 0 {
		return httperror.New(http.StatusServiceUnavailable, "oidc_signing_deployment_unavailable", "Signing deployment registry is unavailable")
	}
	if value == a.oidcSigningRuntimeDeployment {
		return nil
	}
	for _, registered := range a.oidcSigningDeploymentBindings {
		if value == registered {
			return nil
		}
	}
	return httperror.New(http.StatusForbidden, "oidc_signing_user_deployment_mismatch", "User deployment is not registered")
}

func signingGrantBindingField(policy map[string]any, key string) (string, error) {
	raw := policy[key]
	if raw == nil {
		return "", nil
	}
	text, ok := raw.(string)
	if !ok {
		return "", httperror.New(http.StatusForbidden, "service_grant_policy_invalid", "Service grant deployment binding is invalid")
	}
	return strings.TrimSpace(text), nil
}

func (a *Adapter) authorizeServiceSigningDeployment(deployment any, identity serviceSigningIdentity, selected map[string]bool) error {
	expected := ""
	for _, grant := range identity.Grants {
		if !selected[grant.scope] {
			continue
		}
		var policy map[string]any
		if grant.scopeJSON.Valid && json.Unmarshal([]byte(grant.scopeJSON.String), &policy) != nil {
			return httperror.New(http.StatusForbidden, "service_grant_policy_invalid", "Service grant deployment binding is invalid")
		}
		tenant, err := signingGrantBindingField(policy, "tenantCode")
		if err != nil {
			return err
		}
		bound, err := signingGrantBindingField(policy, "deploymentCode")
		if err != nil {
			return err
		}
		if tenant == "" && bound == "" {
			// AppCode is canonical database credential identity, not source_app input.
			bound = a.signingSourceDeployment(identity.AppCode)
			if bound == "" {
				return httperror.New(http.StatusServiceUnavailable, "oidc_signing_deployment_unavailable", "Service source deployment binding is unavailable")
			}
		} else if tenant != a.tenant || bound == "" {
			return httperror.New(http.StatusForbidden, "oidc_signing_service_deployment_binding_invalid", "Service grant is not bound to this tenant and deployment")
		}
		if expected != "" && expected != bound {
			return httperror.New(http.StatusForbidden, "service_grant_policy_conflict", "Selected grants have conflicting source deployments")
		}
		expected = bound
	}
	actual, ok := deployment.(string)
	if !ok || expected == "" || actual != expected {
		return httperror.New(http.StatusForbidden, "oidc_signing_service_deployment_mismatch", "Service deployment does not match its credential grants")
	}
	return nil
}
