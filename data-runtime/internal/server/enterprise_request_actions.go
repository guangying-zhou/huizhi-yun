package server

import (
	"encoding/json"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"time"
)

var enterpriseRequestActions = map[string]string{
	"/v1/enterprise/aims/product-requests:merge":  "merge",
	"/v1/enterprise/aims/product-requests:edit":   "edit",
	"/v1/enterprise/aims/product-requests:decide": "decide",
	"/v1/enterprise/aims/request-sources:list":    "source-list",
	"/v1/enterprise/aims/request-sources:create":  "source-create",
	"/v1/enterprise/aims/request-sources:delete":  "source-delete",
}

func (s *Server) routeEnterpriseRequestAction(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.enterpriseRequests == nil {
		return routeResult{}, httperror.New(503, "enterprise_product_writer_unavailable", "Enterprise request service is not enabled")
	}
	permission := map[string]string{"merge": "decide", "edit": "edit", "decide": "decide", "source-list": "view", "source-create": "edit", "source-delete": "delete"}[action]
	capability := action
	if action == "source-list" {
		capability = "read"
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Action: capability, Capability: "aims:product-requests:" + capability}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.requests." + action, Auth: &verified.Service}
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
	if err = validateEnterpriseProductPermit(input.ProductCode, input.Tenant, input.Deployment, input.Authorization, "product_requests", permission, verified, time.Now()); err != nil {
		return result, err
	}
	id := pc.CommandIdentity{ProductCode: input.ProductCode, ActorUID: verified.ActorUID, Action: "product_requests:" + action, IdempotencyKey: r.Header.Get("Idempotency-Key")}
	var out any
	switch action {
	case "merge":
		var v pc.RequestMerge
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseRequests.Merge(r.Context(), id, input.Authorization, v)
		}
	case "edit":
		var v pc.RequestEdit
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseRequests.Edit(r.Context(), id, input.Authorization, v)
		}
	case "decide":
		var v pc.RequestDecision
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseRequests.Decide(r.Context(), id, input.Authorization, v)
		}
	case "source-create":
		var v pc.ManualRequestSource
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseRequests.AddSource(r.Context(), id, input.Authorization, v)
		}
	case "source-delete":
		var v pc.RequestSourceDelete
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseRequests.DeleteSource(r.Context(), id, input.Authorization, v)
		}
	case "source-list":
		var v pc.RequestSourcePageQuery
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseRequests.ListSources(r.Context(), input.ProductCode, verified.ActorUID, input.Authorization, v)
		}
	default:
		return result, httperror.New(503, "enterprise_request_action_unavailable", "Request operation is not registered")
	}
	if err != nil {
		return result, aimsapp.EnterpriseProductCommandError(err)
	}
	result.Body = map[string]any{"code": 0, "data": out}
	return result, nil
}
