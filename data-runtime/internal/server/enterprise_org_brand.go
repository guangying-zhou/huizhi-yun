package server

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
)

const enterpriseOrgBrandPath = "/v1/enterprise/console/org-brand:view"

func (s *Server) routeEnterpriseOrgBrand(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.console == nil {
		return routeResult{}, httperror.New(503, "enterprise_org_brand_unavailable", "Enterprise brand is unavailable")
	}
	route := enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "console", LogicalTarget: "console",
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.console.org-brand.read", Auth: &verified.Service}
	if err := validateDirectorySelfInput(r); err != nil {
		return result, err
	}
	brand, err := s.console.OrgBrand(r.Context())
	if err != nil {
		return result, err
	}
	result.Body = map[string]any{"code": 0, "data": brand}
	return result, nil
}
