package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"

	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseProjectProductID = regexp.MustCompile(`^[1-9][0-9]{0,17}$`)

type enterpriseProjectProductPermit struct {
	ActorUID   string `json:"actorUid"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	ProjectID  string `json:"projectId"`
	Allowed    bool   `json:"allowed"`
	ExpiresAt  int64  `json:"expiresAt"`
}

type enterpriseProjectProductInput struct {
	Tenant               string                         `json:"tenant"`
	Deployment           string                         `json:"deployment"`
	ProjectID            string                         `json:"projectId"`
	ProductCode          string                         `json:"productCode"`
	Authorization        enterpriseProjectProductPermit `json:"authorization"`
	ProductAuthorization pc.AuthorizationPermit         `json:"productAuthorization"`
}

func (s *Server) routeEnterpriseProjectProducts(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(503, "enterprise_project_products_unavailable", "Project product service is unavailable")
	}
	route, permission := s.enterpriseProjectProductRoute(action)
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.project-products." + action, Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "project_product_input_invalid", "Query parameters are not supported")
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if action == "link" && (key == "" || len(key) > 191) {
		return result, httperror.New(400, "project_product_key_invalid", "Idempotency-Key is required")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var input enterpriseProjectProductInput
	if decoder.Decode(&input) != nil || !enterpriseProjectProductID.MatchString(input.ProjectID) {
		return result, httperror.New(400, "project_product_input_invalid", "Invalid project product input")
	}
	p := input.Authorization
	if err := validateEnterpriseProjectProductPermit(input, p, permission, verified, time.Now()); err != nil {
		return result, err
	}
	if action == "list" {
		if input.ProductCode != "" || input.ProductAuthorization.Resource != "" {
			return result, httperror.New(400, "project_product_input_invalid", "Invalid project product input")
		}
		out, err := s.aims.ListEnterpriseProjectProducts(r.Context(), input.ProjectID, verified.ActorUID)
		if err != nil {
			return result, err
		}
		result.Body = map[string]any{"code": 0, "data": out}
		return result, nil
	}
	if err = validateEnterpriseProductPermit(input.ProductCode, input.Tenant, input.Deployment, input.ProductAuthorization, "products", "view", verified, time.Now()); err != nil {
		return result, err
	}
	id := aimsapp.EnterpriseProjectUpdateIdentity{Tenant: input.Tenant, SourceDeployment: input.Deployment, TargetDeployment: s.cfg.Deployment, ActorUID: verified.ActorUID, ServiceClientID: verified.Service.ClientID, RequestID: requestID(r), IdempotencyKey: key}
	out, err := s.aims.LinkEnterpriseProjectProduct(r.Context(), id, input.ProjectID, input.ProductCode, input.ProductAuthorization)
	if err != nil {
		return result, err
	}
	result.Body = map[string]any{"code": 0, "data": out}
	return result, nil
}

func (s *Server) enterpriseProjectProductRoute(action string) (enterpriseRouteContext, string) {
	capability := aimsapp.EnterpriseProjectProductsReadCapability
	permission := "view"
	if action == "link" {
		capability, permission = aimsapp.EnterpriseProjectProductsCreateCapability, "edit"
	}
	return enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Capability: capability}, permission
}

func validateEnterpriseProjectProductPermit(input enterpriseProjectProductInput, p enterpriseProjectProductPermit, permission string, verified enterpriseRequestContext, now time.Time) error {
	if input.Tenant != verified.Route.Binding.Tenant || input.Deployment != verified.Route.HostDeployment || p.Tenant != input.Tenant || p.Deployment != input.Deployment || p.ActorUID != verified.ActorUID || p.Resource != "projects" || p.Action != permission || p.ProjectID != input.ProjectID || !p.Allowed || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "project_product_authorization_invalid", "Project product authorization is invalid")
	}
	return nil
}
