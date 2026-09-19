package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func enterpriseIPAssetReadScope(p enterpriseDirectoryAuthorization, verified enterpriseRequestContext) (url.Values, error) {
	if p.ActorUID != verified.ActorUID || p.Tenant != verified.Route.Binding.Tenant || p.Deployment != verified.Route.HostDeployment || p.Resource != "ip_assets" || p.Action != "view" || p.ExpiresAt <= time.Now().UnixMilli() || p.ExpiresAt > time.Now().Add(15*time.Second).UnixMilli() {
		return nil, httperror.New(403, "enterprise_ip_assets_authorization_invalid", "Fresh bound IP-assets authorization is required")
	}
	q := url.Values{"current_user": {verified.ActorUID}, "current_user_assets_permission_action": {"view"}}
	for k, v := range p.Scope {
		if k != "current_user_assets_object_access" && k != "current_user_assets_scope_units" {
			return nil, httperror.New(403, "enterprise_ip_assets_authorization_invalid", "IP-assets authorization scope contains an unsupported field")
		}
		q.Set(k, v)
	}
	if q.Get("current_user_assets_object_access") == "none" {
		return nil, httperror.New(403, "enterprise_ip_assets_authorization_invalid", "IP-assets access denied")
	}
	return q, nil
}

func (s *Server) routeEnterpriseIPAssetsRead(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.cfg.Enterprise.Domains["assets"].Read != enterprise.PathUnified || s.assets == nil {
		return routeResult{}, httperror.New(503, "enterprise_ip_assets_unavailable", "IP-assets reads are not enabled")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "assets", LogicalTarget: "assets", Action: "read", Capability: "assets:ip-asset:read"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.assets.ip-assets." + action, Auth: &verified.Service}
	if len(r.URL.Query()) != 0 {
		return result, httperror.New(400, "invalid_ip_assets_query", "Query parameters are not accepted")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, _ := json.Marshal(body)
	var input enterpriseDigitalAssetsReadInput
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil {
		return result, httperror.New(400, "enterprise_ip_assets_input_invalid", "Invalid IP-assets input")
	}
	q, err := enterpriseIPAssetReadScope(input.Authorization, verified)
	if err != nil {
		return result, err
	}
	for k, v := range input.Query {
		if !map[string]bool{"page": true, "pageSize": true, "search": true, "status": true}[k] || strings.TrimSpace(v) == "" || len(v) > 200 {
			return result, httperror.New(400, "invalid_ip_assets_query", "Unsupported IP-assets filter")
		}
		q.Set(k, v)
	}
	var data map[string]any
	if action == "list" {
		if input.ID != "" {
			return result, httperror.New(400, "invalid_ip_assets_input", "IP-assets list accepts no identifier")
		}
		data, err = s.assets.EnterpriseIPAssetsList(r.Context(), q)
	} else if action == "view" {
		id, e := strconv.ParseInt(input.ID, 10, 64)
		if e != nil || id <= 0 || len(input.Query) != 0 {
			return result, httperror.New(400, "invalid_ip_asset_identifier", "IP asset identifier invalid")
		}
		data, err = s.assets.EnterpriseIPAssetView(r.Context(), q, id)
	} else {
		return result, httperror.New(400, "invalid_ip_assets_action", "Unsupported IP-assets read")
	}
	if err != nil {
		return result, enterpriseAssetsError(err)
	}
	result.Body = map[string]any{"code": 0, "data": data, "message": "ok"}
	return result, nil
}
