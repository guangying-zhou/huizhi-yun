package enterprisecontracts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

var ErrActivationAuthorization = errors.New("contract activation permission denied")

// CompiledActivationPermit is evidence produced by the authenticated Host from
// the existing Console scoped-authorization compiler, not a browser grant.
type CompiledActivationPermit struct {
	ActorUID        string   `json:"actorUid"`
	Tenant          string   `json:"tenant"`
	Deployment      string   `json:"deployment"`
	ContractCode    string   `json:"contractCode"`
	IdempotencyKey  string   `json:"idempotencyKey"`
	ExpiresAt       int64    `json:"expiresAt"`
	Resource        string   `json:"resource"`
	Action          string   `json:"action"`
	Allowed         bool     `json:"allowed"`
	Access          string   `json:"access,omitempty"`
	DepartmentCodes []string `json:"departmentCodes,omitempty"`
}
type CompiledActivationAuthorizer struct {
	hostDeployment string
	altoc, aims    CompiledActivationPermit
}

func NewCompiledActivationAuthorizer(hostDeployment string, altoc, aims CompiledActivationPermit) (*CompiledActivationAuthorizer, error) {
	if hostDeployment == "" {
		return nil, fmt.Errorf("Host deployment unavailable")
	}
	altoc.DepartmentCodes = append([]string(nil), altoc.DepartmentCodes...)
	aims.DepartmentCodes = append([]string(nil), aims.DepartmentCodes...)
	return &CompiledActivationAuthorizer{hostDeployment: hostDeployment, altoc: altoc, aims: aims}, nil
}
func (a *CompiledActivationAuthorizer) AuthorizeContractActivation(ctx context.Context, tx *sql.Tx, id ActivationAuthorizationIdentity) (ActivationGrant, error) {
	if a == nil || tx == nil {
		return ActivationGrant{}, fmt.Errorf("%w: contract authorization unavailable", ErrActivationAuthorization)
	}
	now := time.Now()
	expiry := now.Add(15 * time.Second)
	for index, p := range []CompiledActivationPermit{a.altoc, a.aims} {
		resource, action := "contract", "edit"
		if index == 1 {
			resource, action = "projects", "create"
		}
		expires := time.UnixMilli(p.ExpiresAt)
		if !p.Allowed || p.ActorUID != id.ActorUID || p.Tenant != id.Key.Tenant || p.Deployment != a.hostDeployment || p.ContractCode != id.ContractCode || p.IdempotencyKey != id.IdempotencyKey || p.Resource != resource || p.Action != action || !expires.After(now) || expires.After(now.Add(15*time.Second)) {
			return ActivationGrant{}, fmt.Errorf("%w: bound current %s permission required", ErrActivationAuthorization, resource)
		}
		if expires.Before(expiry) {
			expiry = expires
		}
	}
	if a.aims.Access != "" || len(a.aims.DepartmentCodes) != 0 {
		return ActivationGrant{}, fmt.Errorf("%w: project-create permission has no existing-project scope", ErrActivationAuthorization)
	}
	switch a.altoc.Access {
	case "all", "self":
		if len(a.altoc.DepartmentCodes) != 0 {
			return ActivationGrant{}, fmt.Errorf("%w: unexpected department scope", ErrActivationAuthorization)
		}
	case "dept", "self_dept":
		if len(a.altoc.DepartmentCodes) == 0 {
			return ActivationGrant{}, fmt.Errorf("%w: department scope required", ErrActivationAuthorization)
		}
	default:
		return ActivationGrant{}, fmt.Errorf("%w: contract scope denied", ErrActivationAuthorization)
	}
	// The owning coordinator subsequently locks the current contract and applies
	// the original altocRequireRecordWrite owner/department predicate in this tx.
	return ActivationGrant{Identity: id, ExpiresAt: expiry, AltocContractEdit: true, AimsProjectWrite: true, AltocAccess: a.altoc.Access, DepartmentCodes: append([]string(nil), a.altoc.DepartmentCodes...)}, nil
}
