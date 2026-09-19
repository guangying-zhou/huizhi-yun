package server

import (
	"encoding/json"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"time"
)

var enterpriseComponentActions = map[string]string{
	"/v1/enterprise/aims/components:create": "create",
	"/v1/enterprise/aims/components:edit":   "edit",
	"/v1/enterprise/aims/components:move":   "move",
	"/v1/enterprise/aims/components:delete": "delete",
}

func (s *Server) routeEnterpriseComponentAction(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.enterpriseComponents == nil {
		return routeResult{}, httperror.New(503, "enterprise_components_unavailable", "Unified component commands are not enabled")
	}
	permission := "edit"
	if action == "delete" {
		permission = "delete"
	}
	route := enterpriseRouteContext{Binding: e.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Action: action, Capability: "aims:product-components:" + action}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.components." + action, Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_component_input_invalid", "Query parameters are not supported")
	}
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
	if err = validateEnterpriseProductPermit(input.ProductCode, input.Tenant, input.Deployment, input.Authorization, "product_components", permission, verified, time.Now()); err != nil {
		return result, err
	}
	id := pc.CommandIdentity{ProductCode: input.ProductCode, ActorUID: verified.ActorUID, Action: "product_components:" + action, IdempotencyKey: r.Header.Get("Idempotency-Key")}
	var out any
	switch action {
	case "create":
		var v pc.ProductComponentDraft
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseComponents.Create(r.Context(), id, input.Authorization, v)
		}
	case "edit":
		var v pc.ProductComponentEdit
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseComponents.Edit(r.Context(), id, input.Authorization, v)
		}
	case "move":
		var v pc.ProductComponentMove
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseComponents.Move(r.Context(), id, input.Authorization, v)
		}
	case "delete":
		var v pc.ProductComponentDelete
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseComponents.Delete(r.Context(), id, input.Authorization, v)
		}
	default:
		return result, httperror.New(503, "enterprise_components_unavailable", "Component operation is not registered")
	}
	if err != nil {
		return result, aimsapp.EnterpriseProductCommandError(err)
	}
	result.Body = map[string]any{"code": 0, "data": out}
	return result, nil
}
