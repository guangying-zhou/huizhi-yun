package server

import (
	"context"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"time"
)

type enterpriseDelegatedProjectWritePermit struct {
	enterpriseWorkItemWritePermit
	ObjectID string `json:"objectId"`
	SubID    string `json:"subId"`
}

func validateDelegatedProjectWritePermit(input enterpriseDelegatedInput, verified enterpriseRequestContext, act enterpriseDelegatedAction, now time.Time) error {
	p := input.ProjectWriteAuthorization
	if act.ScopeResource == "" {
		if p != nil {
			return httperror.New(400, "enterprise_project_command_scope_unexpected", "Project write scope is not supported")
		}
		return nil
	}
	scopeAction := act.ScopeAction
	if scopeAction == "" {
		scopeAction = "edit"
	}
	if p == nil || p.ActorUID != verified.ActorUID || p.Tenant != input.Tenant || p.Deployment != input.Deployment || p.Resource != act.ScopeResource || p.Action != scopeAction || !p.Allowed || p.ProjectID != input.ProjectID || p.WorkItemID != "" || p.ObjectID != input.ObjectID || p.SubID != input.SubID || p.Scope == nil || p.Scope.Validate() != nil || p.BundleVersion == "" || p.BundleHash == "" || p.PolicyRevision == nil || *p.PolicyRevision < 0 || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "enterprise_project_command_scope_invalid", "Project write authorization is invalid")
	}
	return nil
}

func (s *Server) delegatedProjectWriteContext(r *http.Request, input enterpriseDelegatedInput, verified enterpriseRequestContext, act enterpriseDelegatedAction, query url.Values) (context.Context, error) {
	if err := validateDelegatedProjectWritePermit(input, verified, act, time.Now()); err != nil {
		return nil, err
	}
	if act.ScopeResource == "" {
		return r.Context(), nil
	}
	p := input.ProjectWriteAuthorization
	descendants := map[string][]string{}
	if len(p.Scope.DepartmentTreeRoots) > 0 {
		if s.directory == nil {
			return nil, httperror.New(503, "enterprise_project_scope_unavailable", "Project scope facts unavailable")
		}
		var err error
		descendants, err = s.directory.EnterpriseProjectScopeDepartmentDescendants(r.Context(), p.Scope.DepartmentTreeRoots)
		if err != nil {
			return nil, httperror.New(503, "enterprise_project_scope_unavailable", "Project scope facts unavailable")
		}
	}
	scope := map[string]string{}
	for key, values := range query {
		if enterpriseDelegatedScopeKey.MatchString(key) && len(values) == 1 {
			scope[key] = values[0]
		}
	}
	identity := aimsapp.EnterpriseProjectUpdateIdentity{
		Tenant: input.Tenant, SourceDeployment: input.Deployment, TargetDeployment: s.cfg.Deployment,
		ActorUID: verified.ActorUID, ServiceClientID: verified.Service.ClientID,
		RequestID: requestID(r), IdempotencyKey: r.Header.Get("Idempotency-Key"),
		ProjectScope: scope, CommandScope: &aimsapp.EnterpriseProjectCommandScope{Projection: *p.Scope, Descendants: descendants, ExpiresAt: p.ExpiresAt},
	}
	return aimsapp.WithEnterpriseProjectCommandScope(r.Context(), identity), nil
}
