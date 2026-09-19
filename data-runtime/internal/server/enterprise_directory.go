package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"time"

	assetsapp "github.com/huizhi-yun/data-runtime/internal/apps/assets"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type enterpriseDirectoryAuthorization struct {
	ActorUID   string            `json:"actorUid"`
	Tenant     string            `json:"tenant"`
	Deployment string            `json:"deployment"`
	Resource   string            `json:"resource"`
	Action     string            `json:"action"`
	ExpiresAt  int64             `json:"expiresAt"`
	Scope      map[string]string `json:"scope"`
}

type enterpriseDirectoryInput struct {
	Query struct {
		Page        int    `json:"page"`
		PageSize    int    `json:"pageSize"`
		Keyword     string `json:"keyword"`
		ProductCode string `json:"productCode"`
		ProductLine string `json:"productLine"`
		Watermark   string `json:"watermark"`
	} `json:"query"`
	Authorization enterpriseDirectoryAuthorization `json:"authorization"`
}

func (s *Server) verifyEnterpriseCredential(ctx context.Context, identity auth.Context, capability string) (bool, error) {
	adapter, err := s.requireConsole()
	if err != nil {
		return false, err
	}
	state, err := adapter.VerifyOIDCServiceTokenState(ctx, map[string]any{
		"clientId": identity.ClientID, "credentialId": identity.CredentialID, "scope": capability,
	})
	return err == nil && state["active"] == true, err
}

type enterpriseDirectoryAuthorizer struct {
	registry   *enterprise.Registry
	scope      url.Values
	expiresAt  time.Time
	allowEmpty bool // Internal catalog composition only; never decoded from requests.
}

func (a enterpriseDirectoryAuthorizer) AimsProductsView(context.Context, *sql.Tx, enterprise.DirectoryIdentity, string) error {
	// The Assets directory endpoint cannot authorize an Aims workspace.
	return enterprise.ErrDirectoryAccess
}

func (a enterpriseDirectoryAuthorizer) AssetsProductsView(ctx context.Context, tx *sql.Tx, id enterprise.DirectoryIdentity) (enterprise.DirectoryGrant, error) {
	g := enterprise.DirectoryGrant{Key: id.Key, ActorUID: id.ActorUID, SchemaVersion: id.SchemaVersion, Generation: id.Generation, ExpiresAt: a.expiresAt}
	if a.allowEmpty && a.scope.Get("current_user_assets_object_access") == "none" {
		return g, nil
	}
	where, args, err := assetsapp.EnterpriseProductReadPredicate(a.scope, id.ActorUID)
	if err != nil {
		return g, err
	}
	if where == "1=1" {
		g.AllProducts = true
		return g, nil
	}
	resolved, err := a.registry.Resolve(enterprise.ResolveRequest{Key: id.Key, Domain: "assets", OwnerDeployment: id.AssetsOwnerDeployment, SchemaVersion: id.SchemaVersion, Generation: id.Generation, Operation: enterprise.Read})
	if err != nil {
		return g, err
	}
	table, err := resolved.Table("product_assets")
	if err != nil {
		return g, err
	}
	rows, err := tx.QueryContext(ctx, "SELECT p.product_code FROM "+table+" p WHERE "+where+" LIMIT 10001", args...)
	if err != nil {
		return g, err
	}
	defer rows.Close()
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return g, err
		}
		g.ProductCodes = append(g.ProductCodes, code)
	}
	if len(g.ProductCodes) > 10000 {
		return g, enterprise.ErrDirectoryAccess
	}
	return g, rows.Err()
}

func validateEnterpriseDirectoryAuthorization(input enterpriseDirectoryInput, verified enterpriseRequestContext, now time.Time) (url.Values, error) {
	return validateEnterpriseDirectoryAuthorizationScope(input, verified, now, false)
}

func validateEnterpriseDirectoryAuthorizationScope(input enterpriseDirectoryInput, verified enterpriseRequestContext, now time.Time, allowEmpty bool) (url.Values, error) {
	p := input.Authorization
	if p.ActorUID != verified.ActorUID || p.Tenant != verified.Route.Binding.Tenant || p.Deployment != verified.Route.HostDeployment || p.Resource != "products" || p.Action != "view" || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return nil, httperror.New(403, "enterprise_product_authorization_invalid", "Fresh bound product authorization is required")
	}
	q := url.Values{"current_user": {verified.ActorUID}, "current_user_assets_permission_action": {"view"}}
	for key, value := range p.Scope {
		if key != "current_user_assets_object_access" && key != "current_user_assets_scope_units" {
			return nil, httperror.New(403, "enterprise_product_authorization_invalid", "Product authorization scope contains an unsupported field")
		}
		q.Set(key, value)
	}
	if allowEmpty && q.Get("current_user_assets_object_access") == "none" {
		units := q.Get("current_user_assets_scope_units")
		if units != "" && units != "[]" {
			return nil, httperror.New(403, "enterprise_product_authorization_invalid", "Denied Assets scope must not contain scope units")
		}
		return q, nil
	}
	if _, _, err := assetsapp.EnterpriseProductReadPredicate(q, verified.ActorUID); err != nil {
		return nil, err
	}
	return q, nil
}

func (s *Server) routeEnterpriseProductDirectory(r *http.Request) (routeResult, error) {
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
	result := routeResult{Operation: "enterprise.assets.product-directory.read", Auth: &verified.Service}
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
	var input enterpriseDirectoryInput
	if err := decoder.Decode(&input); err != nil {
		return result, httperror.New(400, "enterprise_directory_input_invalid", "Invalid product directory input")
	}
	scope, err := validateEnterpriseDirectoryAuthorization(input, verified, time.Now())
	if err != nil {
		return result, err
	}
	id := enterprise.DirectoryIdentity{SourceDomain: route.LogicalSource, Key: route.Binding, ActorUID: verified.ActorUID, SchemaVersion: s.cfg.Enterprise.SchemaVersion, Generation: s.cfg.Enterprise.Generation, AssetsOwnerDeployment: s.cfg.Enterprise.Domains["assets"].OwnerDeployment}
	service := enterprise.ProductDirectoryService{Registry: s.enterpriseRegistry, Authorizer: enterpriseDirectoryAuthorizer{registry: s.enterpriseRegistry, scope: scope, expiresAt: time.UnixMilli(input.Authorization.ExpiresAt)}}
	page, err := service.List(r.Context(), id, enterprise.DirectoryQuery{Page: input.Query.Page, PageSize: input.Query.PageSize, Keyword: input.Query.Keyword, ProductCode: input.Query.ProductCode, ProductLine: input.Query.ProductLine, Watermark: input.Query.Watermark})
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
	result.Body = map[string]any{"code": 0, "data": page}
	return result, nil
}
