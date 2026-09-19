package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	assets "github.com/huizhi-yun/data-runtime/internal/apps/assets"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type enterpriseIPAssetsWriteInput struct {
	ID            string                           `json:"id"`
	Input         map[string]any                   `json:"input"`
	Authorization enterpriseDirectoryAuthorization `json:"authorization"`
}

func enterpriseIPAssetEditScope(p enterpriseDirectoryAuthorization, verified enterpriseRequestContext) (url.Values, error) {
	if p.Action != "edit" {
		return nil, httperror.New(403, "enterprise_ip_assets_authorization_invalid", "IP asset edit authorization required")
	}
	p.Action = "view"
	q, err := enterpriseIPAssetReadScope(p, verified)
	if err != nil {
		return nil, err
	}
	q.Set("current_user_assets_permission_action", "edit")
	return q, nil
}

func (s *Server) routeEnterpriseIPAssetsWrite(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.cfg.Enterprise.Domains["assets"].Write != enterprise.PathUnified || s.assets == nil {
		return routeResult{}, httperror.New(503, "enterprise_ip_assets_unavailable", "IP asset writes are not enabled")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "assets", LogicalTarget: "assets", Action: "edit", Capability: "assets:ip-asset:" + action}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.assets.ip-assets." + action, Auth: &verified.Service}
	if len(r.URL.Query()) != 0 {
		return result, httperror.New(400, "invalid_ip_assets_query", "Query parameters are not accepted")
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" || len(key) > 240 {
		return result, httperror.New(400, "idempotency_key_required", "Idempotency key required")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	var input enterpriseIPAssetsWriteInput
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil {
		return result, httperror.New(400, "enterprise_ip_assets_input_invalid", "Invalid IP asset write input")
	}
	if input.Input == nil {
		return result, httperror.New(400, "invalid_ip_asset_input", "IP asset input required")
	}
	scope, err := enterpriseIPAssetEditScope(input.Authorization, verified)
	if err != nil {
		return result, err
	}
	id := int64(0)
	if action == "edit" {
		id, err = strconv.ParseInt(input.ID, 10, 64)
		if err != nil || id <= 0 {
			return result, httperror.New(400, "invalid_ip_asset_identifier", "IP asset identifier invalid")
		}
	} else if action != "create" || input.ID != "" {
		return result, httperror.New(400, "invalid_ip_asset_identifier", "IP asset create accepts no identifier")
	}
	identity := assets.ProductMasterCommandIdentity{Tenant: verified.Route.Binding.Tenant, CommandDeployment: s.cfg.DeploymentBindings["assets"], ActorUID: verified.ActorUID, ClientID: verified.Service.ClientID, RequestID: requestID(r), Key: key}
	target, err := s.assets.EnterpriseIPAssetCommand(r.Context(), identity, action, id, input.Input, scope)
	if err != nil {
		return result, enterpriseAssetsError(err)
	}
	result.Body = map[string]any{"code": 0, "data": map[string]any{"id": target}, "message": "ok"}
	return result, nil
}
