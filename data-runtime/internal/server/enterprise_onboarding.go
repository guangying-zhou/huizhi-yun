package server

import (
	"encoding/json"
	"errors"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseplanning"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"time"
)

var enterpriseOnboardActions = map[string]string{
	"/v1/enterprise/aims/product-onboard:candidates":      "candidates",
	"/v1/enterprise/aims/product-onboard:candidate":       "candidate",
	"/v1/enterprise/aims/product-line-onboard:candidates": "line-candidates",
	"/v1/enterprise/aims/product-onboard":                 "onboard",
	"/v1/enterprise/aims/product-line-onboard":            "onboard-line",
}

type enterpriseOnboardInput struct {
	Tenant              string                           `json:"tenant"`
	Deployment          string                           `json:"deployment"`
	ProductCode         string                           `json:"productCode"`
	LineCode            string                           `json:"lineCode"`
	Authorization       pc.OnboardPermit                 `json:"authorization"`
	AssetsAuthorization enterpriseDirectoryAuthorization `json:"assets_authorization"`
	Directory           pc.MemberDirectoryEvidence       `json:"directory"`
	Input               json.RawMessage                  `json:"input"`
}

func (s *Server) routeEnterpriseOnboard(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.enterpriseOnboarding == nil {
		return routeResult{}, httperror.New(503, "enterprise_onboarding_unavailable", "Unified onboarding is not enabled")
	}
	route := enterpriseRouteContext{Binding: e.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Action: "onboard", Capability: "aims:products:onboard"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims." + action, Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_onboard_input_invalid", "Query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	var input enterpriseOnboardInput
	if err = decodeEnterprisePlanningInput(raw, &input); err != nil {
		return result, err
	}
	code := input.ProductCode
	if action == "candidates" {
		code = "*"
	}
	if action == "line-candidates" || action == "onboard-line" {
		code = pc.LineWorkspaceCode(input.LineCode)
	}
	p := input.Authorization
	now := time.Now()
	if input.Tenant != route.Binding.Tenant || input.Deployment != route.HostDeployment || code == "" || p.ProductCode != code || p.ActorUID != verified.ActorUID || p.Resource != "products" || p.Action != "onboard" || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return result, httperror.New(403, "enterprise_onboard_authorization_invalid", "Fresh bound onboarding authorization is required")
	}
	scope, err := validateEnterpriseDirectoryAuthorizationScope(enterpriseDirectoryInput{Authorization: input.AssetsAuthorization}, verified, now, true)
	if err != nil {
		return result, err
	}
	authorizer := enterpriseDirectoryAuthorizer{registry: s.enterpriseRegistry, scope: scope, expiresAt: time.UnixMilli(input.AssetsAuthorization.ExpiresAt), allowEmpty: true}
	id := pc.CommandIdentity{ProductCode: code, ActorUID: verified.ActorUID, Action: "products:" + action, IdempotencyKey: r.Header.Get("Idempotency-Key")}
	var out any
	switch action {
	case "candidates":
		var v enterpriseplanning.ProductCandidatesQuery
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseOnboarding.ProductsCandidates(r.Context(), verified.ActorUID, p, v, authorizer)
		}
	case "candidate":
		out, err = s.enterpriseOnboarding.ProductCandidate(r.Context(), verified.ActorUID, p, input.ProductCode, authorizer)
	case "line-candidates":
		out, err = s.enterpriseOnboarding.LineCandidates(r.Context(), verified.ActorUID, p, input.LineCode, authorizer)
	case "onboard":
		var v pc.OnboardInput
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			out, err = s.enterpriseOnboarding.Onboard(r.Context(), id, p, input.Directory, v, authorizer)
		}
	case "onboard-line":
		var v pc.LineOnboardInput
		if err = decodeEnterprisePlanningInput(input.Input, &v); err == nil {
			if v.LineCode != input.LineCode {
				return result, httperror.New(400, "enterprise_onboard_input_invalid", "Product line identity mismatch")
			}
			out, err = s.enterpriseOnboarding.OnboardLine(r.Context(), id, p, input.Directory, v, authorizer)
		}
	default:
		return result, httperror.New(503, "enterprise_onboarding_unavailable", "Onboarding operation is not registered")
	}
	if err != nil {
		if errors.Is(err, e.ErrDirectoryAccess) {
			return result, httperror.New(403, "enterprise_onboard_forbidden", "Current product catalog access is required")
		}
		return result, aimsapp.EnterpriseProductCommandError(err)
	}
	result.Body = map[string]any{"code": 0, "data": out}
	return result, nil
}
