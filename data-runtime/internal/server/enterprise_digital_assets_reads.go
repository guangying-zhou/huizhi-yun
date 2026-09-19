package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseDigitalAssetIdentifier = regexp.MustCompile(`^[1-9][0-9]{0,18}$`)

type enterpriseDigitalAssetsReadInput struct {
	ID            string                           `json:"id"`
	Query         map[string]string                `json:"query"`
	Authorization enterpriseDirectoryAuthorization `json:"authorization"`
}

func enterpriseDigitalAssetReadScope(p enterpriseDirectoryAuthorization, verified enterpriseRequestContext, now time.Time) (url.Values, error) {
	if p.ActorUID != verified.ActorUID || p.Tenant != verified.Route.Binding.Tenant || p.Deployment != verified.Route.HostDeployment || p.Resource != "digital_assets" || p.Action != "view" || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return nil, httperror.New(http.StatusForbidden, "enterprise_digital_assets_authorization_invalid", "Fresh bound digital-assets authorization is required")
	}
	q := url.Values{
		"current_user":                          {verified.ActorUID},
		"current_user_assets_permission_action": {"view"},
	}
	for key, value := range p.Scope {
		if key != "current_user_assets_object_access" && key != "current_user_assets_scope_units" {
			return nil, httperror.New(http.StatusForbidden, "enterprise_digital_assets_authorization_invalid", "Digital-assets authorization scope contains an unsupported field")
		}
		q.Set(key, value)
	}
	access := q.Get("current_user_assets_object_access")
	if access == "none" {
		return nil, httperror.New(http.StatusForbidden, "enterprise_digital_assets_authorization_invalid", "Digital-assets access is denied")
	}
	if access == "all" && q.Get("current_user_assets_scope_units") != "" {
		return nil, httperror.New(http.StatusForbidden, "enterprise_digital_assets_authorization_invalid", "Tenant-wide digital-assets authorization must not include scope units")
	}
	return q, nil
}

func (s *Server) routeEnterpriseDigitalAssetsRead(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.cfg.Enterprise.Domains["assets"].Read != enterprise.PathUnified || s.assets == nil {
		return routeResult{}, httperror.New(503, "enterprise_digital_assets_unavailable", "Digital assets reads are not enabled")
	}
	route := enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "assets", LogicalTarget: "assets", Action: "read", Capability: "assets:digital-asset:read",
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.assets.digital-assets." + action, Auth: &verified.Service}
	if len(r.URL.Query()) != 0 {
		return result, httperror.New(http.StatusBadRequest, "invalid_digital_assets_query", "Query parameters are not accepted")
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
	var input enterpriseDigitalAssetsReadInput
	if err = decoder.Decode(&input); err != nil {
		return result, httperror.New(http.StatusBadRequest, "enterprise_digital_assets_input_invalid", "Invalid digital assets read input")
	}
	scope, err := enterpriseDigitalAssetReadScope(input.Authorization, verified, time.Now())
	if err != nil {
		return result, err
	}
	for key, value := range input.Query {
		if !map[string]bool{"page": true, "pageSize": true, "search": true, "status": true}[key] || strings.TrimSpace(value) == "" || len(value) > 200 {
			return result, httperror.New(http.StatusBadRequest, "invalid_digital_assets_query", "Unsupported digital asset filter")
		}
		scope.Set(key, value)
	}
	var data map[string]any
	switch action {
	case "list":
		if input.ID != "" {
			return result, httperror.New(http.StatusBadRequest, "invalid_digital_assets_read_input", "Digital asset list accepts no identifier")
		}
		data, err = s.assets.EnterpriseDigitalAssetsList(r.Context(), scope)
	case "view":
		if len(input.Query) != 0 || !enterpriseDigitalAssetIdentifier.MatchString(input.ID) {
			return result, httperror.New(http.StatusBadRequest, "invalid_digital_asset_identifier", "Digital asset identifier is invalid")
		}
		id, parseErr := strconv.ParseInt(input.ID, 10, 64)
		if parseErr != nil {
			return result, httperror.New(http.StatusBadRequest, "invalid_digital_asset_identifier", "Digital asset identifier is invalid")
		}
		data, err = s.assets.EnterpriseDigitalAssetView(r.Context(), scope, id)
	default:
		return result, httperror.New(http.StatusBadRequest, "invalid_digital_assets_action", "Unsupported digital assets read")
	}
	if err != nil {
		return result, enterpriseAssetsError(err)
	}
	result.Body = map[string]any{"code": 0, "data": data, "message": "ok"}
	return result, nil
}
