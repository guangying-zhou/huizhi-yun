package server

import (
	"encoding/json"
	aims "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"strings"
	"time"
)

var enterpriseHandoffActions = map[string]string{
	"/v1/enterprise/aims/handoff:detail":                "detail",
	"/v1/enterprise/aims/handoff:projects":              "projects",
	"/v1/enterprise/aims/handoff:requirements":          "requirements",
	"/v1/enterprise/aims/handoff:project-authorization": "project-authorization",
	"/v1/enterprise/aims/handoff:create":                "create",
}

type enterpriseHandoffInput struct {
	ProductCode           string                           `json:"productCode"`
	Tenant                string                           `json:"tenant"`
	Deployment            string                           `json:"deployment"`
	Input                 json.RawMessage                  `json:"input"`
	Authorization         pc.AuthorizationPermit           `json:"authorization"`
	PlanningAuthorization pc.AuthorizationPermit           `json:"planning_authorization"`
	RequestAuthorization  pc.AuthorizationPermit           `json:"request_authorization"`
	VersionAuthorization  pc.AuthorizationPermit           `json:"version_authorization"`
	ProjectAuthorization  aims.ProductHandoffProjectPermit `json:"project_authorization"`
}

func (s *Server) routeEnterpriseHandoff(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.enterpriseHandoff == nil {
		return routeResult{}, httperror.New(503, "enterprise_handoff_unavailable", "Unified project handoff is not enabled")
	}
	capability := "aims:product-priorities:project-authorization"
	if action == "create" {
		capability = "aims:product-priorities:handoff"
	}
	if action == "detail" {
		capability = "aims:product-priorities:read"
	}
	route := enterpriseRouteContext{Binding: e.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Action: capability[strings.LastIndex(capability, ":")+1:], Capability: capability}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.handoff." + action, Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "handoff_query_invalid", "Query is not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	var input enterpriseHandoffInput
	if err = decodeEnterprisePlanningInput(raw, &input); err != nil {
		return result, err
	}
	check := func(p pc.AuthorizationPermit, resource, permission string) error {
		return validateEnterpriseProductPermit(input.ProductCode, input.Tenant, input.Deployment, p, resource, permission, verified, time.Now())
	}
	var out any
	if action == "create" {
		var v pc.PlanningHandoffInput
		if err = decodeEnterprisePlanningInput(input.Input, &v); err != nil {
			return result, err
		}
		if err = check(input.PlanningAuthorization, "product_priorities", "handoff"); err != nil {
			return result, err
		}
		if v.RequestBizID != "" {
			if err = check(input.RequestAuthorization, "product_requests", "handoff"); err != nil {
				return result, err
			}
		}
		if err = check(input.VersionAuthorization, "product_versions", "view"); err != nil {
			return result, err
		}
		p := input.ProjectAuthorization
		now := time.Now().UnixMilli()
		if p.Resource != "requirements" || p.Action != "edit" || p.Facts.ActorUID != verified.ActorUID || p.Facts.ProjectCode != v.ProjectCode || p.ExpiresAt <= now || p.ExpiresAt > now+15000 {
			return result, httperror.New(403, "handoff_project_authorization_invalid", "Current project edit authorization is required")
		}
		id := pc.CommandIdentity{ProductCode: input.ProductCode, ActorUID: verified.ActorUID, Action: "product_priorities:handoff", IdempotencyKey: r.Header.Get("Idempotency-Key")}
		out, err = s.enterpriseHandoff.HandoffPlanningItem(r.Context(), id, input.PlanningAuthorization, input.RequestAuthorization, input.VersionAuthorization, p, v)
	} else {
		if err = check(input.Authorization, "product_priorities", "view"); err != nil {
			return result, err
		}
		switch action {
		case "detail":
			var v struct {
				BizID string `json:"biz_id"`
			}
			if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
				out, err = s.enterpriseHandoff.Detail(r.Context(), input.ProductCode, verified.ActorUID, v.BizID, input.Authorization)
			}
		case "project-authorization":
			var v struct {
				ProjectCode string `json:"project_code"`
			}
			if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
				out, err = s.enterpriseHandoff.ScopedProjectAuthorizationFacts(r.Context(), input.ProductCode, verified.ActorUID, v.ProjectCode, input.Authorization)
			}
		case "projects", "requirements":
			var v struct {
				Keyword     string `json:"keyword"`
				ProjectCode string `json:"project_code"`
			}
			if err = decodeEnterprisePlanningInput(input.Input, &v); err != nil {
				return result, err
			}
			if len([]rune(v.Keyword)) > 200 || strings.ContainsRune(v.Keyword, 0) {
				return result, httperror.New(400, "handoff_keyword_invalid", "Keyword is invalid")
			}
			if action == "projects" {
				if v.ProjectCode != "" {
					return result, httperror.New(400, "handoff_project_input_invalid", "Project is not supported")
				}
				out, err = s.enterpriseHandoff.Projects(r.Context(), input.ProductCode, verified.ActorUID, v.Keyword, input.Authorization)
			} else {
				out, err = s.enterpriseHandoff.Requirements(r.Context(), input.ProductCode, verified.ActorUID, v.ProjectCode, v.Keyword, input.Authorization)
			}
		}
	}
	if err != nil {
		return result, aims.EnterpriseProductCommandError(err)
	}
	result.Body = map[string]any{"code": 0, "data": out}
	return result, nil
}
