package server

import (
	"bytes"
	"encoding/json"
	"errors"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"time"
)

type enterpriseProductListInput struct {
	Tenant              string                           `json:"tenant"`
	Deployment          string                           `json:"deployment"`
	Input               pc.ProductListQuery              `json:"input"`
	Authorization       pc.ProductListPermit             `json:"authorization"`
	AssetsAuthorization enterpriseDirectoryAuthorization `json:"assets_authorization"`
}

func (s *Server) routeEnterpriseProductList(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.enterpriseCatalog == nil {
		return routeResult{}, httperror.New(503, "enterprise_catalog_unavailable", "Unified product catalog is not enabled")
	}
	route := enterpriseRouteContext{Binding: e.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Action: "view", Capability: "aims:products:view"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.products.view", Auth: &verified.Service}
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
	var input enterpriseProductListInput
	if err = decoder.Decode(&input); err != nil {
		return result, httperror.New(400, "enterprise_catalog_input_invalid", "Invalid product list input")
	}
	now := time.Now()
	p := input.Authorization
	if input.Tenant != route.Binding.Tenant || input.Deployment != route.HostDeployment || p.ActorUID != verified.ActorUID || p.Resource != "products" || p.Action != "view" || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return result, httperror.New(403, "enterprise_product_authorization_invalid", "Fresh bound product list authorization is required")
	}
	scope, err := validateEnterpriseDirectoryAuthorizationScope(enterpriseDirectoryInput{Authorization: input.AssetsAuthorization}, verified, now, true)
	if err != nil {
		return result, err
	}
	authorizer := enterpriseDirectoryAuthorizer{registry: s.enterpriseRegistry, scope: scope, expiresAt: time.UnixMilli(input.AssetsAuthorization.ExpiresAt), allowEmpty: true}
	out, err := s.enterpriseCatalog.List(r.Context(), verified.ActorUID, p, input.Input, authorizer)
	if err != nil {
		if errors.Is(err, e.ErrDirectoryAccess) {
			return result, httperror.New(403, "enterprise_catalog_forbidden", "Product catalog scope is invalid")
		}
		return result, aimsapp.EnterpriseProductCommandError(err)
	}
	result.Body = map[string]any{"code": 0, "data": out}
	return result, nil
}
