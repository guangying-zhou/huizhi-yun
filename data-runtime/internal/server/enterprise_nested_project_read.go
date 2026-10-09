package server

import (
	"context"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"time"
)

// The business permit remains independent. This additional view permit binds
// the parent project and is part of the same authenticated signed command.
type enterpriseNestedProjectReadPermit struct {
	enterpriseProjectReadPermit
	ProjectID string `json:"projectId"`
}

func validateNestedProjectReadPermit(tenant, deployment, projectID string, permit *enterpriseNestedProjectReadPermit, verified enterpriseRequestContext, now time.Time) error {
	if permit == nil || !enterpriseProjectID.MatchString(projectID) || permit.ProjectID != projectID {
		return httperror.New(403, "enterprise_project_permit_invalid", "Project read authorization is invalid")
	}
	return validateEnterpriseProjectReadPermit(enterpriseProjectReadInput{Tenant: tenant, Deployment: deployment, ProjectID: projectID, Authorization: permit.enterpriseProjectReadPermit}, verified, now)
}

func (s *Server) nestedProjectReadContext(r *http.Request, projectID string, permit *enterpriseNestedProjectReadPermit, query url.Values) (context.Context, error) {
	descendants := map[string][]string{}
	if len(permit.Scope.DepartmentTreeRoots) > 0 {
		if s.directory == nil {
			return nil, httperror.New(503, "enterprise_project_scope_unavailable", "Project scope facts unavailable")
		}
		var err error
		descendants, err = s.directory.EnterpriseProjectScopeDepartmentDescendants(r.Context(), permit.Scope.DepartmentTreeRoots)
		if err != nil {
			return nil, httperror.New(503, "enterprise_project_scope_unavailable", "Project scope facts unavailable")
		}
	}
	ctx := aimsapp.WithEnterpriseProjectReadScope(r.Context(), *permit.Scope, descendants)
	if permit.ManagementAuthorization != nil {
		ctx, err := s.projectManagementReadContext(ctx, permit.ManagementAuthorization)
		if err != nil {
			return nil, err
		}
		return s.checkedNestedProjectContext(ctx, projectID, query)
	}
	// Check the owning project before any nested COUNT/page/object query. The
	// adapter still enforces each object's project ID and business permission.
	if err := s.aims.EnterpriseProjectReadAccess(ctx, projectID, query); err != nil {
		return nil, err
	}
	return ctx, nil
}

func (s *Server) checkedNestedProjectContext(ctx context.Context, projectID string, query url.Values) (context.Context, error) {
	if err := s.aims.EnterpriseProjectReadAccess(ctx, projectID, query); err != nil {
		return nil, err
	}
	return ctx, nil
}
func (s *Server) projectManagementReadContext(ctx context.Context, permit *enterpriseProjectManagementPermit) (context.Context, error) {
	descendants := map[string][]string{}
	if len(permit.Scope.DepartmentTreeRoots) > 0 {
		if s.directory == nil {
			return nil, httperror.New(503, "project_tab_authorization_unavailable", "Management facts unavailable")
		}
		var err error
		descendants, err = s.directory.EnterpriseProjectScopeDepartmentDescendants(ctx, permit.Scope.DepartmentTreeRoots)
		if err != nil {
			return nil, httperror.New(503, "project_tab_authorization_unavailable", "Management facts unavailable")
		}
	}
	return aimsapp.WithEnterpriseProjectManagementScope(ctx, *permit.Scope, descendants), nil
}
