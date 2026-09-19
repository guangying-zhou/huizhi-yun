package server

import (
	"encoding/json"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"strings"
	"time"
)

var enterpriseFeatureActions = map[string]string{
	"/v1/enterprise/aims/features:cycles":           "cycles",
	"/v1/enterprise/aims/features:list":             "list",
	"/v1/enterprise/aims/features:view":             "view",
	"/v1/enterprise/aims/features:create":           "create",
	"/v1/enterprise/aims/features:edit":             "edit",
	"/v1/enterprise/aims/features:delete":           "delete",
	"/v1/enterprise/aims/features:component-assign": "component-assign",
	"/v1/enterprise/aims/features:lifecycle":        "lifecycle",
	"/v1/enterprise/aims/features:request-list":     "request-list",
	"/v1/enterprise/aims/features:request-link":     "request-link",
	"/v1/enterprise/aims/features:roadmap":          "roadmap",
	"/v1/enterprise/aims/features:unscheduled":      "unscheduled",
}

type enterpriseFeatureInput struct {
	ProductCode           string                 `json:"productCode"`
	Tenant                string                 `json:"tenant"`
	Deployment            string                 `json:"deployment"`
	Input                 json.RawMessage        `json:"input"`
	Authorization         pc.AuthorizationPermit `json:"authorization"`
	RequestAuthorization  pc.AuthorizationPermit `json:"request_authorization"`
	FeatureAuthorization  pc.AuthorizationPermit `json:"feature_authorization"`
	PlanningAuthorization pc.AuthorizationPermit `json:"planning_authorization"`
}

func (s *Server) routeEnterpriseFeature(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.enterpriseFeatures == nil {
		return routeResult{}, httperror.New(503, "enterprise_features_unavailable", "Unified feature operations are not enabled")
	}
	capability := "aims:product-features:" + action
	if action == "list" || action == "view" || action == "request-list" {
		capability = "aims:product-features:read"
	}
	if action == "roadmap" || action == "unscheduled" || action == "cycles" {
		capability = "aims:product-priorities:read"
	}
	route := enterpriseRouteContext{Binding: e.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Action: capability[strings.LastIndex(capability, ":")+1:], Capability: capability}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.features." + action, Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_feature_input_invalid", "Query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	var input enterpriseFeatureInput
	if err = decodeEnterprisePlanningInput(raw, &input); err != nil {
		return result, err
	}
	check := func(p pc.AuthorizationPermit, resource, permission string) error {
		return validateEnterpriseProductPermit(input.ProductCode, input.Tenant, input.Deployment, p, resource, permission, verified, time.Now())
	}
	if action == "cycles" {
		err = check(input.Authorization, "product_priorities", "view")
	} else if action == "request-list" || action == "request-link" {
		permission := "view"
		if action == "request-link" {
			permission = "edit"
		}
		err = check(input.RequestAuthorization, "product_requests", permission)
		if err == nil {
			err = check(input.FeatureAuthorization, "product_features", "view")
		}
	} else if action == "roadmap" || action == "unscheduled" {
		err = check(input.PlanningAuthorization, "product_priorities", "view")
		if err == nil {
			err = check(input.FeatureAuthorization, "product_features", "view")
		}
	} else {
		permission := "edit"
		if action == "list" || action == "view" {
			permission = "view"
		}
		if action == "delete" {
			permission = "delete"
		}
		err = check(input.Authorization, "product_features", permission)
	}
	if err != nil {
		return result, err
	}
	id := pc.CommandIdentity{ProductCode: input.ProductCode, ActorUID: verified.ActorUID, Action: "product_features:" + action, IdempotencyKey: r.Header.Get("Idempotency-Key")}
	var out any
	switch action {
	case "cycles":
		var v pc.PlanningCyclePageQuery
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseFeatures.Cycles(r.Context(), input.ProductCode, verified.ActorUID, input.Authorization, v)
		}
	case "create":
		var v pc.FeatureDraft
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseFeatures.Create(r.Context(), id, input.Authorization, v)
		}
	case "edit":
		var v pc.FeatureEdit
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseFeatures.Edit(r.Context(), id, input.Authorization, v)
		}
	case "delete":
		var v pc.FeatureDelete
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseFeatures.Delete(r.Context(), id, input.Authorization, v)
		}
	case "component-assign":
		var v pc.FeatureComponentAssignment
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseFeatures.AssignComponent(r.Context(), id, input.Authorization, v)
		}
	case "lifecycle":
		var v pc.FeatureLifecycleChange
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseFeatures.Lifecycle(r.Context(), id, input.Authorization, v)
		}
	case "request-link":
		var v pc.FeatureRequestChange
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseFeatures.ChangeRequest(r.Context(), id, input.RequestAuthorization, input.FeatureAuthorization, v)
		}
	case "view":
		var v struct {
			BizID string `json:"biz_id"`
		}
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseFeatures.Read(r.Context(), input.ProductCode, verified.ActorUID, v.BizID, input.Authorization)
		}
	case "list":
		var v pc.FeaturePageQuery
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseFeatures.List(r.Context(), input.ProductCode, verified.ActorUID, input.Authorization, v)
		}
	case "request-list":
		var v pc.FeatureRequestPageQuery
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseFeatures.Requests(r.Context(), input.ProductCode, verified.ActorUID, input.RequestAuthorization, input.FeatureAuthorization, v)
		}
	case "roadmap":
		var v pc.FeatureRoadmapQuery
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseFeatures.Roadmap(r.Context(), input.ProductCode, verified.ActorUID, input.PlanningAuthorization, input.FeatureAuthorization, v)
		}
	case "unscheduled":
		var v pc.FeatureUnscheduledQuery
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseFeatures.Unscheduled(r.Context(), input.ProductCode, verified.ActorUID, input.PlanningAuthorization, input.FeatureAuthorization, v)
		}
	default:
		return result, httperror.New(503, "enterprise_features_unavailable", "Feature operation is not registered")
	}
	if err != nil {
		return result, aimsapp.EnterpriseProductCommandError(err)
	}
	result.Body = map[string]any{"code": 0, "data": out}
	return result, nil
}
