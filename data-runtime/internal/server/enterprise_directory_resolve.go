package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type enterpriseDirectoryResolveInput struct {
	Query struct {
		Codes []string `json:"codes"`
	} `json:"query"`
	Authorization enterpriseDirectoryAuthorization `json:"authorization"`
}

// Batch product names and grant-scoped aggregates for cross-domain rendering.
// Authorization, catalog readiness and the grant predicate are the same as the
// directory list; unreadable codes come back as unresolved, never as names.
func (s *Server) routeEnterpriseProductDirectoryResolve(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.enterpriseRegistry == nil {
		return routeResult{}, httperror.New(503, "enterprise_runtime_unavailable", "Enterprise runtime is not enabled")
	}
	route := enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "assets", LogicalTarget: "assets", Action: "read", Capability: "assets:product:read",
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.assets.product-directory.resolve", Auth: &verified.Service}
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
	var input enterpriseDirectoryResolveInput
	if err := decoder.Decode(&input); err != nil {
		return result, httperror.New(400, "enterprise_directory_input_invalid", "Invalid product directory input")
	}
	scope, err := validateEnterpriseDirectoryAuthorization(enterpriseDirectoryInput{Authorization: input.Authorization}, verified, time.Now())
	if err != nil {
		return result, err
	}
	id := enterprise.DirectoryIdentity{SourceDomain: route.LogicalSource, Key: route.Binding, ActorUID: verified.ActorUID, SchemaVersion: s.cfg.Enterprise.SchemaVersion, Generation: s.cfg.Enterprise.Generation, AssetsOwnerDeployment: s.cfg.Enterprise.Domains["assets"].OwnerDeployment}
	service := enterprise.ProductDirectoryService{Registry: s.enterpriseRegistry, Authorizer: enterpriseDirectoryAuthorizer{registry: s.enterpriseRegistry, scope: scope, expiresAt: time.UnixMilli(input.Authorization.ExpiresAt)}}
	resolved, err := service.Resolve(r.Context(), id, input.Query.Codes)
	if err != nil {
		switch {
		case errors.Is(err, enterprise.ErrDirectoryAccess):
			return result, httperror.New(403, "enterprise_directory_forbidden", "Product directory access denied")
		case errors.Is(err, enterprise.ErrDirectoryQuery):
			return result, httperror.New(400, "enterprise_directory_query_invalid", "Invalid product directory query")
		case errors.Is(err, enterprise.ErrDirectoryChanged):
			return result, httperror.New(409, "enterprise_directory_changed", "Product directory changed; restart pagination")
		default:
			return result, httperror.New(503, "enterprise_directory_unavailable", "Product directory is unavailable")
		}
	}
	result.Body = map[string]any{"code": 0, "data": resolved}
	return result, nil
}
