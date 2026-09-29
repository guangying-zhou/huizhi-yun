package server

import (
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"strconv"
)

// This is the existing manifest capability, retained across storage migration.
const enterpriseSchedulerCapability = "aims:integration_operation:execute"

// The selected generation travels with every claim and checkpoint, so a stale
// wake cannot silently become a consumer of a newly registered queue.
func validateEnterpriseSchedulerGeneration(r *http.Request, expected uint64) error {
	value := r.Header.Get("X-HZY-Scheduler-Generation")
	generation, err := strconv.ParseUint(value, 10, 64)
	if err != nil || generation == 0 || strconv.FormatUint(generation, 10) != value {
		return httperror.New(400, "enterprise_scheduler_generation_invalid", "A canonical scheduler generation is required")
	}
	if generation != expected {
		return httperror.New(409, "enterprise_scheduler_generation_stale", "Scheduler generation has changed")
	}
	return nil
}

type enterpriseSchedulerRoute struct {
	// App is both the worker's source app and the owning domain; its registered
	// client must be <app>.runtime.
	App                            string
	Binding                        enterprise.BindingKey
	WorkerDeployment, WorkerClient string
}

// Scheduled milestone rollover is a separate exact capability: holding the
// outbox execution grant must not also permit rewriting milestone periods.
const enterpriseMilestoneRolloverCapability = "aims:milestone-rollover:execute"

func authenticateEnterpriseScheduler(r *http.Request, authenticator *auth.Authenticator, route enterpriseSchedulerRoute, verify enterpriseCredentialVerifier) (auth.Context, enterprise.SchedulerIdentity, error) {
	return authenticateEnterpriseSchedulerCapability(r, authenticator, route, verify, enterpriseSchedulerCapability)
}

func authenticateEnterpriseSchedulerCapability(r *http.Request, authenticator *auth.Authenticator, route enterpriseSchedulerRoute, verify enterpriseCredentialVerifier, capability string) (auth.Context, enterprise.SchedulerIdentity, error) {
	deny := func(status int, code, message string) (auth.Context, enterprise.SchedulerIdentity, error) {
		return auth.Context{}, enterprise.SchedulerIdentity{}, httperror.New(status, code, message)
	}
	if authenticator == nil || verify == nil || route.Binding.Tenant == "" || route.Binding.Environment == "" || route.Binding.RuntimeDeployment == "" || route.WorkerDeployment == "" || route.App == "" || route.WorkerClient != route.App+".runtime" {
		return deny(503, "enterprise_scheduler_unavailable", "Scheduler service binding is unavailable")
	}
	service, err := authenticator.Authenticate(r, auth.Requirement{AppCode: route.App, SourceAppCode: route.App, Scope: capability, StrictServiceClaims: true, RequireDeploymentBinding: true})
	if err != nil {
		return auth.Context{}, enterprise.SchedulerIdentity{}, err
	}
	if service.Mode != string(config.AuthJWT) || service.Tenant != route.Binding.Tenant || service.Deployment != route.WorkerDeployment || service.AppCode != route.App || service.ClientID != route.WorkerClient || service.Subject != "client:"+route.WorkerClient || service.CredentialID <= 0 {
		return deny(403, "enterprise_scheduler_identity_mismatch", "Scheduler identity does not match its registered binding")
	}
	exact := false
	for _, scope := range service.Scopes {
		if scope == capability {
			exact = true
			break
		}
	}
	if !exact {
		return deny(403, "enterprise_scheduler_capability_required", "An exact scheduler capability is required")
	}
	active, err := verify(r.Context(), service, capability)
	if err != nil {
		return deny(503, "enterprise_scheduler_credential_unavailable", "Scheduler credential state is unavailable")
	}
	if !active {
		return deny(403, "enterprise_scheduler_credential_inactive", "Scheduler credential or capability has been revoked")
	}
	// The domain scheduler stores the canonical client code; the transport
	// subject above is the Console JWT's explicitly verified client:<code>.
	return service, enterprise.SchedulerIdentity{Tenant: service.Tenant, Deployment: service.Deployment, SourceApp: service.AppCode, ClientID: service.ClientID, Subject: service.ClientID}, nil
}
