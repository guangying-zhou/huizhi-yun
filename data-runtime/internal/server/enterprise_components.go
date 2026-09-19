package server

import (
	"encoding/json"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"time"
)

func (s *Server) routeEnterpriseProductComponents(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.enterprisePlanning == nil {
		return routeResult{}, httperror.New(503, "enterprise_product_reader_unavailable", "Enterprise product reader is not enabled")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Action: "read", Capability: "aims:product-components:read"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.components.list", Auth: &verified.Service}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	var input enterprisePlanningInput
	if err = decodeEnterprisePlanningInput(raw, &input); err != nil {
		return result, err
	}
	if err = validateEnterpriseProductPermit(input.ProductCode, input.Tenant, input.Deployment, input.Authorization, "product_components", "view", verified, time.Now()); err != nil {
		return result, err
	}
	var query struct {
		ParentID *int64 `json:"parent_id"`
		Page     int    `json:"page"`
		PageSize int    `json:"page_size"`
	}
	if err = decodeEnterprisePlanningInput(input.Input, &query); err != nil {
		return result, err
	}
	out, err := s.enterprisePlanning.ListComponents(r.Context(), input.ProductCode, verified.ActorUID, input.Authorization, query.ParentID, query.Page, query.PageSize)
	if err != nil {
		return result, aimsapp.EnterpriseProductCommandError(err)
	}
	result.Body = map[string]any{"code": 0, "data": out}
	return result, nil
}
