package server

import (
	"bytes"
	"encoding/json"
	assets "github.com/huizhi-yun/data-runtime/internal/apps/assets"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type enterpriseIPAssetLinkInput struct {
	ID                  string                           `json:"id"`
	Input               map[string]any                   `json:"input"`
	Authorization       enterpriseDirectoryAuthorization `json:"authorization"`
	TargetAuthorization enterpriseDirectoryAuthorization `json:"targetAuthorization"`
}

func enterpriseIPAssetProductTargetScope(p enterpriseDirectoryAuthorization, verified enterpriseRequestContext) (url.Values, error) {
	if p.Resource != "products" || p.Action != "view" {
		return nil, httperror.New(403, "enterprise_ip_assets_target_authorization_invalid", "Product view authorization required")
	}
	q, err := validateEnterpriseDirectoryAuthorization(enterpriseDirectoryInput{Authorization: p}, verified, time.Now())
	if err != nil {
		return nil, err
	}
	return q, nil
}
func (s *Server) routeEnterpriseIPAssetsLinkProduct(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.cfg.Enterprise.Domains["assets"].Write != enterprise.PathUnified || s.assets == nil {
		return routeResult{}, httperror.New(503, "enterprise_ip_assets_unavailable", "IP asset writes are not enabled")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "assets", LogicalTarget: "assets", Capability: "assets:ip-asset:link-product"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.assets.ip-assets.link-product", Auth: &verified.Service}
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
	var input enterpriseIPAssetLinkInput
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || len(input.Input) != 1 {
		return result, httperror.New(400, "enterprise_ip_assets_link_input_invalid", "Invalid IP product relation input")
	}
	id, err := strconv.ParseInt(input.ID, 10, 64)
	if err != nil || id <= 0 {
		return result, httperror.New(400, "invalid_ip_asset_identifier", "IP asset identifier invalid")
	}
	source, err := enterpriseIPAssetEditScope(input.Authorization, verified)
	if err != nil {
		return result, err
	}
	target, err := enterpriseIPAssetProductTargetScope(input.TargetAuthorization, verified)
	if err != nil {
		return result, err
	}
	source.Set("current_user_ip_product_target_access", target.Get("current_user_assets_object_access"))
	source.Set("current_user_ip_product_target_units", target.Get("current_user_assets_scope_units"))
	identity := assets.ProductMasterCommandIdentity{Tenant: verified.Route.Binding.Tenant, CommandDeployment: s.cfg.DeploymentBindings["assets"], ActorUID: verified.ActorUID, ClientID: verified.Service.ClientID, RequestID: requestID(r), Key: key}
	out, err := s.assets.EnterpriseIPAssetProductLink(r.Context(), identity, id, input.Input, source)
	if err != nil {
		return result, enterpriseAssetsError(err)
	}
	result.Body = map[string]any{"code": 0, "data": map[string]any{"id": out}, "message": "ok"}
	return result, nil
}
