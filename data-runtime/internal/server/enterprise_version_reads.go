package server

import (
	"encoding/json"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"time"
)

type enterpriseVersionReadInput struct {
	ProductCode          string                            `json:"productCode"`
	Tenant               string                            `json:"tenant"`
	Deployment           string                            `json:"deployment"`
	Authorization        productcenter.AuthorizationPermit `json:"authorization"`
	RequestAuthorization productcenter.AuthorizationPermit `json:"request_authorization"`
	Input                json.RawMessage                   `json:"input"`
}

func (s *Server) routeEnterpriseVersionRead(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.enterprisePlanning == nil {
		return routeResult{}, httperror.New(503, "enterprise_planning_unavailable", "Enterprise planning is not enabled")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Capability: "aims:product-versions:read"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	operation := "enterprise.aims.versions." + action
	result := routeResult{Operation: operation, Auth: &verified.Service}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	var input enterpriseVersionReadInput
	if err = decodeEnterprisePlanningInput(raw, &input); err != nil {
		return result, err
	}
	if err = validateEnterpriseProductPermit(input.ProductCode, input.Tenant, input.Deployment, input.Authorization, "product_versions", "view", verified, time.Now()); err != nil {
		return result, err
	}
	var output any
	if action == "view" {
		var query struct {
			VersionID int64 `json:"version_id"`
		}
		if err = decodeEnterprisePlanningInput(input.Input, &query); err != nil {
			return result, err
		}
		if query.VersionID <= 0 {
			return result, httperror.New(400, "enterprise_version_input_invalid", "A positive version identity is required")
		}
		output, err = s.enterprisePlanning.ReadVersion(r.Context(), input.ProductCode, verified.ActorUID, input.Authorization, query.VersionID)
	} else if action == "plan" || action == "plan-items" {
		if err = validateEnterpriseProductPermit(input.ProductCode, input.Tenant, input.Deployment, input.RequestAuthorization, "product_requests", "view", verified, time.Now()); err != nil {
			return result, err
		}
		var query struct {
			VersionID int64 `json:"version_id"`
			productcenter.LightweightVersionPlanItemQuery
		}
		if err = decodeEnterprisePlanningInput(input.Input, &query); err != nil {
			return result, err
		}
		if query.VersionID <= 0 {
			return result, httperror.New(400, "enterprise_version_input_invalid", "A positive version identity is required")
		}
		if action == "plan" {
			output, err = s.enterprisePlanning.ReadPlan(r.Context(), input.ProductCode, verified.ActorUID, query.VersionID, input.Authorization, input.RequestAuthorization)
		} else {
			output, err = s.enterprisePlanning.ListPlanItems(r.Context(), input.ProductCode, verified.ActorUID, query.VersionID, input.Authorization, input.RequestAuthorization, query.LightweightVersionPlanItemQuery)
		}
	} else {
		var query productcenter.ProductVersionPageQuery
		if err = decodeEnterprisePlanningInput(input.Input, &query); err != nil {
			return result, err
		}
		output, err = s.enterprisePlanning.ListVersions(r.Context(), input.ProductCode, verified.ActorUID, input.Authorization, query)
	}
	if err != nil {
		return result, aimsapp.EnterpriseProductCommandError(err)
	}
	result.Body = map[string]any{"code": 0, "data": output}
	return result, nil
}
