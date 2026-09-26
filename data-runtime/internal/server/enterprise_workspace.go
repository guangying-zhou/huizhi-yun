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

type enterpriseWorkspaceInput struct {
	ProductCode         string                           `json:"productCode"`
	Tenant              string                           `json:"tenant"`
	Deployment          string                           `json:"deployment"`
	Authorization       pc.AuthorizationPermit           `json:"authorization"`
	AssetsAuthorization enterpriseDirectoryAuthorization `json:"assets_authorization"`
}

func (s *Server) routeEnterpriseProductWorkspace(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.enterpriseCatalog == nil {
		return routeResult{}, httperror.New(503, "enterprise_workspace_unavailable", "Unified workspace reader is not enabled")
	}
	route := enterpriseRouteContext{Binding: e.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Capability: "aims:products:view"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.workspace.view", Auth: &verified.Service}
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
	var input enterpriseWorkspaceInput
	if err = decoder.Decode(&input); err != nil {
		return result, httperror.New(400, "enterprise_workspace_input_invalid", "Invalid product workspace input")
	}
	now := time.Now()
	if err = validateEnterpriseProductPermit(input.ProductCode, input.Tenant, input.Deployment, input.Authorization, "products", "view", verified, now); err != nil {
		return result, err
	}
	scope, err := validateEnterpriseDirectoryAuthorizationScope(enterpriseDirectoryInput{Authorization: input.AssetsAuthorization}, verified, now, true)
	if err != nil {
		return result, err
	}
	out, err := s.enterpriseCatalog.ReadWorkspace(r.Context(), input.ProductCode, verified.ActorUID, input.Authorization, enterpriseDirectoryAuthorizer{registry: s.enterpriseRegistry, scope: scope, expiresAt: time.UnixMilli(input.AssetsAuthorization.ExpiresAt), allowEmpty: true})
	if err != nil {
		if errors.Is(err, e.ErrDirectoryAccess) {
			return result, httperror.New(403, "enterprise_workspace_forbidden", "Product workspace catalog scope is invalid")
		}
		return result, aimsapp.EnterpriseProductCommandError(err)
	}
	result.Body = map[string]any{"code": 0, "data": out}
	return result, nil
}
