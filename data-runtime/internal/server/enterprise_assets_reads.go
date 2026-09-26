package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseAssetItemIdentifier = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)

type enterpriseAssetsReadInput struct {
	ID            string                           `json:"id"`
	Query         map[string]string                `json:"query"`
	Authorization enterpriseDirectoryAuthorization `json:"authorization"`
}

func enterpriseAssetItemReadScope(p enterpriseDirectoryAuthorization, verified enterpriseRequestContext, now time.Time) (url.Values, error) {
	if p.ActorUID != verified.ActorUID || p.Tenant != verified.Route.Binding.Tenant || p.Deployment != verified.Route.HostDeployment || p.Resource != "asset_items" || p.Action != "view" || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return nil, httperror.New(http.StatusForbidden, "enterprise_asset_items_authorization_invalid", "Fresh bound asset-items authorization is required")
	}
	q := url.Values{
		"current_user":                          {verified.ActorUID},
		"current_user_assets_permission_action": {"view"},
	}
	for key, value := range p.Scope {
		if key != "current_user_assets_object_access" && key != "current_user_assets_scope_units" {
			return nil, httperror.New(http.StatusForbidden, "enterprise_asset_items_authorization_invalid", "Asset-items authorization scope contains an unsupported field")
		}
		q.Set(key, value)
	}
	access := q.Get("current_user_assets_object_access")
	if access == "none" {
		return nil, httperror.New(http.StatusForbidden, "enterprise_asset_items_authorization_invalid", "Asset-items access is denied")
	}
	if access == "all" && q.Get("current_user_assets_scope_units") != "" {
		return nil, httperror.New(http.StatusForbidden, "enterprise_asset_items_authorization_invalid", "Tenant-wide asset authorization must not include scope units")
	}
	if access == "none" && q.Get("current_user_assets_scope_units") != "" && q.Get("current_user_assets_scope_units") != "[]" {
		return nil, httperror.New(http.StatusForbidden, "enterprise_asset_items_authorization_invalid", "Denied asset authorization must not include scope units")
	}
	return q, nil
}

func (s *Server) routeEnterpriseAssetsRead(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.cfg.Enterprise.Domains["assets"].Read != enterprise.PathUnified || s.assets == nil {
		return routeResult{}, httperror.New(503, "enterprise_assets_unavailable", "Assets reads are not enabled")
	}
	route := enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "assets", LogicalTarget: "assets", Capability: "assets:asset-item:read",
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.assets." + action, Auth: &verified.Service}
	if len(r.URL.Query()) != 0 {
		return result, httperror.New(http.StatusBadRequest, "invalid_assets_query", "Query parameters are not accepted")
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
	var input enterpriseAssetsReadInput
	if err = decoder.Decode(&input); err != nil {
		return result, httperror.New(http.StatusBadRequest, "enterprise_assets_input_invalid", "Invalid assets read input")
	}
	scope, err := enterpriseAssetItemReadScope(input.Authorization, verified, time.Now())
	if err != nil {
		return result, err
	}
	for key, value := range input.Query {
		if !map[string]bool{"page": true, "pageSize": true, "category": true, "search": true, "status": true}[key] || strings.TrimSpace(value) == "" || len(value) > 200 {
			return result, httperror.New(http.StatusBadRequest, "invalid_assets_query", "Unsupported asset filter")
		}
		scope.Set(key, value)
	}
	var data map[string]any
	switch action {
	case "dictionaries":
		if input.ID != "" || len(input.Query) != 0 {
			return result, httperror.New(http.StatusBadRequest, "invalid_assets_read_input", "Dictionary list accepts no identifier or filters")
		}
		data, err = s.assets.EnterpriseDictionaries(r.Context())
	case "list":
		if input.ID != "" {
			return result, httperror.New(http.StatusBadRequest, "invalid_assets_read_input", "Asset list accepts no identifier")
		}
		data, err = s.assets.EnterpriseAssetItemsList(r.Context(), scope)
	case "view":
		if len(input.Query) != 0 || !enterpriseAssetItemIdentifier.MatchString(input.ID) {
			return result, httperror.New(http.StatusBadRequest, "invalid_asset_identifier", "Asset identifier is invalid")
		}
		data, err = s.assets.EnterpriseAssetItemView(r.Context(), scope, input.ID)
	default:
		return result, httperror.New(http.StatusBadRequest, "invalid_assets_action", "Unsupported assets read")
	}
	if err != nil {
		return result, enterpriseAssetsError(err)
	}
	result.Body = map[string]any{"code": 0, "data": data, "message": "ok"}
	return result, nil
}
