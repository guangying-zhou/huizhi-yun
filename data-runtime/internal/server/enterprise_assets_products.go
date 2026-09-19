package server

import (
	"encoding/json"
	"errors"
	"github.com/go-sql-driver/mysql"
	assets "github.com/huizhi-yun/data-runtime/internal/apps/assets"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var enterpriseAssetsProductActions = map[string]string{
	"/v1/enterprise/assets/products:link-base":            "link-base",
	"/v1/enterprise/assets/products:link-asset":           "link-asset",
	"/v1/enterprise/assets/products:link-document":        "link-document",
	"/v1/enterprise/assets/products:base-candidates":      "base-candidates",
	"/v1/enterprise/assets/products:asset-candidates":     "asset-candidates",
	"/v1/enterprise/assets/product-categories:admin-list": "category-admin-list",
	"/v1/enterprise/assets/product-categories:save":       "category-save",
	"/v1/enterprise/assets/products:create":               "create",
	"/v1/enterprise/assets/products:edit":                 "edit",
	"/v1/enterprise/assets/products:list":                 "list",
	"/v1/enterprise/assets/products:view":                 "view",
	"/v1/enterprise/assets/product-dictionaries:list":     "dictionaries",
	"/v1/enterprise/assets/product-categories:list":       "categories",
}

type enterpriseAssetsProductInput struct {
	BaseAuthorization  *enterpriseDirectoryAuthorization `json:"baseAuthorization"`
	AssetAuthorization *enterpriseDirectoryAuthorization `json:"assetAuthorization"`
	Input              map[string]any                    `json:"input"`
	ID                 int64                             `json:"id"`
	Query              map[string]string                 `json:"query"`
	Authorization      enterpriseDirectoryAuthorization  `json:"authorization"`
}

func (s *Server) routeEnterpriseAssetsProduct(r *http.Request, action string) (routeResult, error) {
	if strings.HasPrefix(action, "link-") || strings.HasSuffix(action, "-candidates") {
		return s.routeEnterpriseAssetsLink(r, action)
	}
	if !s.cfg.Enterprise.Enabled || s.enterpriseRegistry == nil || s.enterpriseAssetsProducts == nil {
		return routeResult{}, httperror.New(503, "enterprise_assets_unavailable", "Assets product management is not enabled")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "assets", LogicalTarget: "assets", Action: "read", Capability: "assets:product:read"}
	if action == "create" || action == "edit" {
		route.Action = "edit"
		route.Capability = "assets:product:edit"
	}
	if action == "category-save" || action == "category-admin-list" {
		route.Action = "admin"
		route.Capability = "assets:admin:admin"
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.assets.products." + action, Auth: &verified.Service}
	if len(r.URL.Query()) != 0 {
		return result, httperror.New(400, "invalid_assets_query", "Query parameters are not accepted")
	}
	var input enterpriseAssetsProductInput
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	if err = decodeEnterprisePlanningInput(raw, &input); err != nil {
		return result, err
	}
	var q url.Values
	if action == "category-save" || action == "category-admin-list" {
		p := input.Authorization
		now := time.Now()
		if p.ActorUID != verified.ActorUID || p.Tenant != verified.Route.Binding.Tenant || p.Deployment != verified.Route.HostDeployment || p.Resource != "admin" || p.Action != "admin" || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() || p.Scope["current_user_assets_object_access"] != "all" || len(p.Scope) != 1 {
			return result, httperror.New(403, "assets_admin_required", "Fresh tenant-wide Assets administrator required")
		}
		q = url.Values{}
	} else if action == "create" || action == "edit" {
		q, err = enterpriseAssetsProductEditScope(input.Authorization, verified)
	} else {
		q, err = validateEnterpriseDirectoryAuthorization(enterpriseDirectoryInput{Authorization: input.Authorization}, verified, time.Now())
	}
	if err != nil {
		return result, err
	}
	if action == "list" || action == "view" {
		q.Set("current_user_product_relations_scoped", "true")
		for kind, p := range map[string]*enterpriseDirectoryAuthorization{"base": input.BaseAuthorization, "asset": input.AssetAuthorization} {
			q.Set("current_user_product_"+kind+"_access", "none")
			if p != nil {
				target, scopeErr := enterpriseAssetsTargetScope(*p, verified, kind)
				if scopeErr != nil {
					return result, scopeErr
				}
				q.Set("current_user_product_"+kind+"_access", target.Get("current_user_assets_object_access"))
				q.Set("current_user_product_"+kind+"_units", target.Get("current_user_assets_scope_units"))
			}
		}
	}
	allowed := map[string]bool{"page": true, "pageSize": true, "search": true, "product_line": true, "status": true, "sortBy": true, "sortOrder": true}
	if action == "categories" || action == "category-admin-list" {
		allowed = map[string]bool{"scope": true}
	}
	if action == "view" || action == "dictionaries" || action == "create" || action == "edit" || action == "category-save" {
		allowed = map[string]bool{}
	}
	for k, v := range input.Query {
		if !allowed[k] {
			return result, httperror.New(400, "invalid_assets_query", "Unsupported product filter")
		}
		q.Set(k, v)
	}
	var data any
	switch action {
	case "category-admin-list":
		if q.Get("scope") != "" && q.Get("scope") != "product" {
			return result, httperror.New(400, "invalid_category_scope", "Only product categories supported")
		}
		data, err = s.enterpriseAssetsProducts.Categories(r.Context(), "product", true)
	case "category-save":
		key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
		if key == "" || len(key) > 240 || input.ID < 0 {
			return result, httperror.New(400, "invalid_category_command", "Valid id and idempotency key required")
		}
		identity := assets.ProductMasterCommandIdentity{Tenant: verified.Route.Binding.Tenant, CommandDeployment: s.cfg.DeploymentBindings["assets"], ActorUID: verified.ActorUID, ClientID: verified.Service.ClientID, RequestID: requestID(r), Key: key}
		data, err = s.enterpriseAssetsProducts.SaveProductCategory(r.Context(), identity, input.ID, input.Input)

	case "create", "edit":
		if (action == "create" && input.ID != 0) || (action == "edit" && input.ID <= 0) {
			return result, httperror.New(400, "invalid_product_id", "Product id invalid")
		}
		key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
		if key == "" || len(key) > 240 {
			return result, httperror.New(400, "idempotency_key_required", "Idempotency key required")
		}
		identity := assets.ProductMasterCommandIdentity{Tenant: verified.Route.Binding.Tenant, CommandDeployment: s.cfg.DeploymentBindings["assets"], ActorUID: verified.ActorUID, ClientID: verified.Service.ClientID, RequestID: requestID(r), Key: key}
		var target int64
		target, err = s.enterpriseAssetsProducts.Command(r.Context(), identity, action, input.ID, input.Input, q)
		data = map[string]any{"id": target}

	case "list":
		if !q.Has("page") {
			q.Set("page", "1")
		}
		data, err = s.enterpriseAssetsProducts.List(r.Context(), q)
	case "view":
		if input.ID <= 0 {
			return result, httperror.New(400, "invalid_product_id", "Product id is required")
		}
		data, err = s.enterpriseAssetsProducts.View(r.Context(), input.ID, q)
	case "categories":
		if q.Get("scope") != "product" {
			return result, httperror.New(400, "invalid_category_scope", "Only product categories supported")
		}
		data, err = s.enterpriseAssetsProducts.Categories(r.Context(), q.Get("scope"), false)
	case "dictionaries":
		data, err = s.enterpriseAssetsProducts.Dictionaries(r.Context())
	default:
		return result, httperror.New(400, "invalid_assets_action", "Unsupported product action")
	}
	if err != nil {
		return result, enterpriseAssetsError(err)
	}
	result.Body = map[string]any{"code": 0, "data": data, "message": "ok"}
	return result, nil
}

// Compile only a verified permit; the browser cannot supply current_user or scope.
func enterpriseAssetsProductEditScope(p enterpriseDirectoryAuthorization, verified enterpriseRequestContext) (url.Values, error) {
	if p.Action != "edit" {
		return nil, httperror.New(403, "enterprise_product_authorization_invalid", "Product edit authorization required")
	}
	p.Action = "view"
	q, err := validateEnterpriseDirectoryAuthorization(enterpriseDirectoryInput{Authorization: p}, verified, time.Now())
	if err != nil {
		return nil, err
	}
	q.Set("current_user_assets_permission_action", "edit")
	return q, nil
}

func enterpriseAssetsError(err error) error {
	var public httperror.Error
	if errors.As(err, &public) {
		return public
	}
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return httperror.New(409, "idempotency_payload_mismatch", "Idempotency key payload conflict")
	}
	var db *mysql.MySQLError
	if errors.As(err, &db) && db.Number == 1062 {
		return httperror.New(409, "assets_product_conflict", "Product or category already exists")
	}
	return httperror.New(503, "enterprise_assets_unavailable", "Assets product service is unavailable")
}

// routeLegacyUnifiedAssetProductCommand preserves the standalone HTTP contract
// while its configured writer has moved to the same Registry-owned store.
func (s *Server) routeLegacyUnifiedAssetProductCommand(r *http.Request, identity auth.Context, actor string, delegated bool, q url.Values, body map[string]any) (routeResult, bool, error) {
	if !s.cfg.Enterprise.Enabled || s.cfg.Enterprise.Domains["assets"].Write != enterprise.PathUnified {
		return routeResult{}, false, nil
	}
	path := cleanPath(r.URL.Path)
	action := ""
	var id int64
	if r.Method == http.MethodPost && path == "/v1/assets/products" {
		action = "create"
	}
	if r.Method == http.MethodPatch && strings.HasPrefix(path, "/v1/assets/products/") && !strings.Contains(strings.TrimPrefix(path, "/v1/assets/products/"), "/") {
		action = "edit"
		id, _ = strconv.ParseInt(strings.TrimPrefix(path, "/v1/assets/products/"), 10, 64)
	}
	if r.Method == http.MethodPost && path == "/v1/assets/admin/asset-categories" {
		action = "category-save"
	}
	if r.Method == http.MethodPut && strings.HasPrefix(path, "/v1/assets/admin/asset-categories/") && !strings.Contains(strings.TrimPrefix(path, "/v1/assets/admin/asset-categories/"), "/") {
		action = "category-save"
		id, _ = strconv.ParseInt(strings.TrimPrefix(path, "/v1/assets/admin/asset-categories/"), 10, 64)
		if id <= 0 {
			return routeResult{}, true, httperror.New(400, "invalid_category_id", "Category id invalid")
		}
	}
	if r.Method == http.MethodPost && strings.HasPrefix(path, "/v1/assets/products/") {
		parts := strings.Split(strings.TrimPrefix(path, "/v1/assets/products/"), "/")
		if len(parts) == 2 {
			action = map[string]string{"bases": "link-base", "assets": "link-asset", "documents": "link-document"}[parts[1]]
			if action != "" {
				id, _ = strconv.ParseInt(parts[0], 10, 64)
			}
		}
	}
	if action == "" {
		return routeResult{}, false, nil
	}
	result := routeResult{Operation: "assets.products." + action, Auth: &identity}
	if s.enterpriseAssetsProducts == nil {
		return result, true, httperror.New(503, "enterprise_assets_unavailable", "Assets product writer unavailable")
	}
	if s.auth == nil {
		return result, true, httperror.New(503, "assets_identity_unavailable", "Assets authentication unavailable")
	}
	// Preserve the old transport capability while enforcing the current owning
	// service binding and credential state before any unified transaction.
	verified, verifyErr := s.auth.Authenticate(r, auth.Requirement{AppCode: "assets", SourceAppCode: "assets", Scope: "assets.write", StrictServiceClaims: true, RequireDeploymentBinding: true})
	if verifyErr != nil {
		return result, true, verifyErr
	}
	result.Auth = &verified
	identity = verified
	if err := verifyLegacyUnifiedAssetsCredential(r.Context(), identity, s.cfg.Tenant, s.cfg.DeploymentBindings["assets"], s.verifyEnterpriseCredential); err != nil {
		return result, true, err
	}
	signedActor, _, purpose, signed := runtimeSignedActorContext(r)
	if !delegated || !signed || actor == "" || actor != signedActor || actor == identity.Subject || purpose != "" {
		return result, true, httperror.New(403, "trusted_assets_actor_required", "Signed Assets user required")
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" || len(key) > 240 || (action == "edit" && id <= 0) {
		return result, true, httperror.New(400, "invalid_product_command", "Product id and idempotency key required")
	}
	// Only the owning payload whitelist survives Runtime transport injection.
	payload := assets.ProductMasterBusinessPayload(body)
	command := assets.ProductMasterCommandIdentity{Tenant: identity.Tenant, CommandDeployment: s.cfg.DeploymentBindings["assets"], ActorUID: actor, ClientID: identity.ClientID, RequestID: requestID(r), Key: key}
	if action == "category-save" {
		if q.Get("current_user_assets_permission_action") != "admin" || q.Get("current_user_assets_object_access") != "all" {
			return result, true, httperror.New(403, "assets_admin_required", "Assets administrator scope required")
		}
		category := map[string]any{}
		for _, field := range []string{"scope", "label", "value", "shortCode", "description", "enabled", "sortOrder", "items"} {
			if value, ok := body[field]; ok {
				category[field] = value
			}
		}
		if category["scope"] != "product" {
			return result, true, httperror.New(400, "invalid_category_scope", "Only product categories are supported")
		}
		item, err := s.enterpriseAssetsProducts.SaveProductCategory(r.Context(), command, id, category)
		if err != nil {
			return result, true, enterpriseAssetsError(err)
		}
		result.Body = map[string]any{"code": 0, "data": item, "message": "ok"}
		return result, true, nil
	}
	if strings.HasPrefix(action, "link-") {
		link := map[string]any{}
		for _, field := range []string{"technology_base_id", "asset_id", "relation_type", "is_primary", "document_id", "document_type", "remark"} {
			if v, ok := body[field]; ok {
				link[field] = v
			}
		}
		target, err := s.enterpriseAssetsProducts.Link(r.Context(), command, action, id, link, q)
		if err != nil {
			return result, true, enterpriseAssetsError(err)
		}
		result.Body = map[string]any{"code": 0, "data": map[string]any{"id": target}}
		return result, true, nil
	}
	target, err := s.enterpriseAssetsProducts.Command(r.Context(), command, action, id, payload, q)
	if err != nil {
		return result, true, enterpriseAssetsError(err)
	}
	result.Body = map[string]any{"code": 0, "data": map[string]any{"id": target}, "message": "ok"}
	return result, true, nil
}
